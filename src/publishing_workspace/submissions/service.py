from __future__ import annotations

import datetime
import hashlib
import os
import shutil
from pathlib import Path
from typing import Any, Callable
from uuid import uuid4

from ..catalog.repository import CatalogRepository
from ..config import PublishingWorkspaceConfig, WorkspacePaths, load_workspace
from ..logging import get_logger
from ..models import AssetRecord, ImportedItem, SelectionSet, utc_now_iso
from ..plans.models import InlineContent, TaskContent
from ..plans.paths import PlanPaths
from ..plans.repository import PlanRepository
from ..plans.search import clear_search_caches
from ..tasks.models import TaskConfig
from ..tasks.paths import TaskPaths
from ..tasks.repository import TaskRepository
from ..tasks.scanner import CurrentSelectionScanner
from ..tasks.selection import SelectionMaterializer, SelectionSnapshotWriter
from .models import (
    PixivMetadata,
    SelectionName,
    Submission,
    SubmissionDetail,
    SubmissionRevisionConflictError,
    SubmissionSummary,
)
from .repository import SUPPORTED_IMAGE_EXTENSIONS, SubmissionRepository

logger = get_logger(__name__)


def selection_from_assets(
    assets: list[AssetRecord],
    *,
    source_ref: str,
    source_type: str = "catalog",
) -> SelectionSet:
    """将 Catalog 的 AssetRecord 列表转为 SelectionSet。"""
    items = []
    for order, asset in enumerate(assets, start=1):
        items.append(
            ImportedItem(
                source_path=asset.path,
                resolved_path=asset.path,
                source_type=source_type,
                source_ref=source_ref,
                source_order=order,
                display_name=asset.display_name or Path(asset.path).name,
                warnings=list(asset.warnings),
            )
        )
    return SelectionSet(
        source_type=source_type,
        source_ref=source_ref,
        items=items,
    )


class SubmissionService:
    """Submission 业务服务，负责 asset 校验、task 创建/更新与集合物化。"""

    def __init__(
        self,
        catalog_factory: Callable[[Path], CatalogRepository] | None = None,
    ) -> None:
        self.catalog_factory = catalog_factory

    def _get_catalog_repo(self, paths: WorkspacePaths) -> CatalogRepository:
        if self.catalog_factory is not None:
            return self.catalog_factory(paths.catalog)
        return CatalogRepository(paths.catalog)

    def create_or_update(
        self,
        root: str | Path,
        *,
        task_id: str | None,
        title: str,
        source_import_id: str | None,
        sets: dict[str, list[str]],
        pixiv: PixivMetadata | dict[str, Any] | None = None,
        expected_revision: int | None = None,
    ) -> SubmissionDetail:
        """创建或更新投稿，并在 tasks/<task_id> 下立即物化素材和配置文件。"""
        paths, workspace_config = load_workspace(root)

        clean_title = str(title or "").strip()
        if not clean_title:
            raise ValueError("title 不能为空")

        # 检查 all 集合
        raw_all = sets.get("all", []) if isinstance(sets, dict) else []
        clean_all = [str(x).strip() for x in raw_all if str(x).strip()]
        if not clean_all:
            raise ValueError("all 集合不能为空")

        # 用户指定的 post 与 cover（保存时保持原样，不自动补齐）
        raw_post = sets.get("post", []) if isinstance(sets, dict) else []
        clean_post = [str(x).strip() for x in raw_post if str(x).strip()]

        raw_cover = sets.get("cover", []) if isinstance(sets, dict) else []
        clean_cover = [str(x).strip() for x in raw_cover if str(x).strip()]

        clean_import_id = str(source_import_id).strip() if source_import_id is not None else None
        if not clean_import_id:
            clean_import_id = None

        # 确定 task_id
        if task_id is None or not str(task_id).strip():
            now_str = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
            target_task_id = f"submission-{now_str}-{uuid4().hex[:6]}"
            is_new = True
        else:
            target_task_id = str(task_id).strip()
            task_test_paths = TaskPaths.from_workspace(paths, target_task_id)
            is_new = not (task_test_paths.task_yaml.is_file() or task_test_paths.submission_yaml.is_file())

        task_paths = TaskPaths.from_workspace(paths, target_task_id)

        # 提前进行 expected_revision 冲突校验（在任何图片物化或临时目录创建前）
        if not is_new:
            existing_submission = SubmissionRepository.load(task_paths)
            current_rev = existing_submission.revision if existing_submission is not None else 1
            if expected_revision is not None and current_rev != expected_revision:
                raise SubmissionRevisionConflictError(
                    f"投稿 revision 已变化：expected={expected_revision} actual={current_rev}"
                )
            next_revision = current_rev + 1
            created_at = existing_submission.created_at if existing_submission is not None else utc_now_iso()
            last_export = existing_submission.last_export if existing_submission is not None else None
        else:
            existing_submission = None
            next_revision = 1
            created_at = utc_now_iso()
            last_export = None

        catalog_repo = self._get_catalog_repo(paths)

        # 自动将所有集合中的 ID 解析为最新权威 ID（自动修复历史别名/重绘后旧 Hash）
        resolved_all = [catalog_repo.resolve_asset_id(x) for x in clean_all]
        resolved_post = [catalog_repo.resolve_asset_id(x) for x in clean_post]
        resolved_cover = [catalog_repo.resolve_asset_id(x) for x in clean_cover]

        # 验证所有 asset_id 在 Catalog 中存在且文件可用
        all_unique_ids = list(dict.fromkeys(resolved_all + resolved_post + resolved_cover))
        asset_map: dict[str, Any] = {}
        if clean_import_id is not None:
            asset_map = catalog_repo.assets_by_ids(all_unique_ids, import_id=clean_import_id)

        if len(asset_map) < len(all_unique_ids):
            # 若按 import_id 无法全量命中（跨快照导入或重绘后资产），在全局 Catalog 中查找
            global_map = catalog_repo.assets_by_ids(all_unique_ids)
            for aid, rec in global_map.items():
                asset_map.setdefault(aid, rec)

        missing_ids = [aid for aid in all_unique_ids if aid not in asset_map]
        if missing_ids:
            raise ValueError(f"素材在 Catalog 中不存在：{missing_ids}")

        unavailable_ids = [aid for aid, rec in asset_map.items() if not Path(rec.path).is_file()]
        if unavailable_ids:
            raise FileNotFoundError(f"素材文件不存在或不可读：{unavailable_ids}")

        # 解析 pixiv 元数据
        pixiv_meta: PixivMetadata | None = None
        if pixiv is not None:
            if isinstance(pixiv, PixivMetadata):
                pixiv_meta = pixiv
            elif isinstance(pixiv, dict):
                pixiv_meta = PixivMetadata.model_validate(pixiv)
        elif not is_new and existing_submission is not None:
            pixiv_meta = existing_submission.pixiv

        submission = Submission(
            submission_id=target_task_id,
            task_id=target_task_id,
            title=clean_title,
            revision=next_revision,
            source_import_id=clean_import_id,
            sets={
                "all": resolved_all,
                "post": resolved_post,
                "cover": resolved_cover,
            },
            pixiv=pixiv_meta,
            created_at=created_at,
            updated_at=utc_now_iso(),
            last_export=last_export,
        )

        # 临时 staging 目录与事务备份
        staging_root = task_paths.task_root / f".submission-save.{uuid4().hex}.tmp"
        staged_paths = TaskPaths.from_task_root(paths, staging_root, task_id=target_task_id)
        staged_paths.ensure_layout()

        old_task_yaml_bytes = (
            task_paths.task_yaml.read_bytes() if task_paths.task_yaml.exists() else None
        )
        old_submission_yaml_bytes = (
            task_paths.submission_yaml.read_bytes() if task_paths.submission_yaml.exists() else None
        )
        old_selection_backup = task_paths.task_root / f".selection.{uuid4().hex}.old"
        selection_swapped = False
        task_dir_created_empty = False

        try:
            if not task_paths.task_root.exists():
                task_paths.task_root.mkdir(parents=True, exist_ok=True)
                task_dir_created_empty = True

            # 复制既有 history（不能丢失任何历史 JSON）
            if task_paths.history_dir.is_dir():
                shutil.copytree(task_paths.history_dir, staged_paths.history_dir, dirs_exist_ok=True)

            # 在 staged_paths.selection_dirs 中分别物化 all/post/cover
            for name in ("all", "post", "cover"):
                target_ids = submission.sets[name]  # type: ignore[index]
                target_records = [asset_map[aid] for aid in target_ids]
                selection_set = selection_from_assets(
                    target_records,
                    source_ref=clean_import_id or "catalog",
                )
                SelectionMaterializer().materialize(
                    selection_set,
                    staged_paths.selection_dirs[name],
                    mode="replace",
                    image_extensions=set(workspace_config.image_extensions),
                )

            # 基于临时 all 生成 candidates.snapshot.json 和 candidates.nvpls
            all_records = [asset_map[aid] for aid in submission.sets["all"]]
            all_selection_set = selection_from_assets(
                all_records,
                source_ref=clean_import_id or "catalog",
            )
            SelectionSnapshotWriter().write_candidates(staged_paths, all_selection_set)

            # 安全替换 selection 目录（支持 Windows 句柄占用回退）
            _safe_replace_dir(staged_paths.selection_root, task_paths.selection_root, old_selection_backup)
            selection_swapped = True

            # 创建或更新 task.yaml（只更新 title，不覆盖 processing/packages）
            if is_new:
                task_config = TaskConfig(task_id=target_task_id, title=clean_title)
            else:
                try:
                    existing_task_config = TaskRepository.load(task_paths)
                    # 确保 mosaic 算子拥有规范的 adapter 和 options
                    mosaic_op = existing_task_config.processing.operations.get("mosaic")
                    if mosaic_op and not mosaic_op.adapter:
                        existing_task_config.processing.operations["mosaic"] = mosaic_op.model_copy(
                            update={
                                "adapter": "anr_plugin_auto_mosaics",
                                "options": mosaic_op.options or {
                                    "detector": "yolo_sam",
                                    "method": "pixel",
                                    "parts": ["penis", "pussy"],
                                    "pixel_size": 10,
                                },
                            }
                        )
                    task_config = existing_task_config.model_copy(update={"title": clean_title})
                except Exception:
                    task_config = TaskConfig(task_id=target_task_id, title=clean_title)
            TaskRepository.save(task_paths, task_config)

            # 保存 submission.yaml
            SubmissionRepository.save(task_paths, submission)

            # 成功后清理备份和临时目录
            if old_selection_backup.exists():
                shutil.rmtree(old_selection_backup, ignore_errors=True)
            if staging_root.exists():
                shutil.rmtree(staging_root, ignore_errors=True)

            # 如果是编辑既有投稿且移除了部分图片，检查移除的图片是否不再被其他投稿引用，若是则自动清理 posted 标记
            if existing_submission is not None:
                old_aids = set()
                for s_name in ("all", "post", "cover"):
                    for aid in existing_submission.sets.get(s_name, []):
                        if aid and str(aid).strip():
                            old_aids.add(str(aid).strip())
                new_aids = set()
                for s_name in ("all", "post", "cover"):
                    for aid in submission.sets.get(s_name, []):
                        if aid and str(aid).strip():
                            new_aids.add(str(aid).strip())
                removed_aids = old_aids - new_aids
                if removed_aids:
                    img_exts = {ext.casefold() for ext in workspace_config.image_extensions}
                    referenced_elsewhere = _find_referenced_asset_ids(paths, extensions=img_exts)
                    orphaned = [aid for aid in removed_aids if aid not in referenced_elsewhere]
                    if orphaned:
                        catalog_repo.remove_posted_marks(orphaned)

            # 清理全局缓存
            clear_search_caches()

        except BaseException:
            # 完整事务回滚
            if selection_swapped:
                if old_selection_backup.exists():
                    _safe_replace_dir(old_selection_backup, task_paths.selection_root, staging_root / ".rollback_tmp")
            else:
                if old_selection_backup.exists():
                    shutil.rmtree(old_selection_backup, ignore_errors=True)

            if old_task_yaml_bytes is not None:
                task_paths.task_yaml.write_bytes(old_task_yaml_bytes)
            elif is_new and task_paths.task_yaml.exists():
                task_paths.task_yaml.unlink(missing_ok=True)

            if old_submission_yaml_bytes is not None:
                task_paths.submission_yaml.write_bytes(old_submission_yaml_bytes)
            elif is_new and task_paths.submission_yaml.exists():
                task_paths.submission_yaml.unlink(missing_ok=True)

            if is_new and task_dir_created_empty:
                shutil.rmtree(task_paths.task_root, ignore_errors=True)

            if staging_root.exists():
                shutil.rmtree(staging_root, ignore_errors=True)
            raise

        return SubmissionDetail.model_validate(
            {
                **submission.model_dump(mode="json"),
                "warnings": [],
                "unresolved_files": [],
            }
        )

    def get(self, root: str | Path, task_id: str) -> SubmissionDetail:
        """获取投稿详情；若缺少 submission.yaml 则通过扫描现有 selection 和 Catalog 组装。"""
        paths, _ = load_workspace(root)
        task_paths = TaskPaths.from_workspace(paths, task_id)
        if not task_paths.task_root.is_dir() or not task_paths.task_yaml.is_file():
            raise FileNotFoundError(f"投稿任务不存在：{task_id}")

        submission = SubmissionRepository.load(task_paths)
        if submission is not None:
            catalog_repo = self._get_catalog_repo(paths)
            needs_update = False
            resolved_sets = {}
            for sel_name, ids in submission.sets.items():
                new_ids = []
                for aid in ids:
                    target_aid = catalog_repo.resolve_asset_id(aid)
                    if target_aid != aid:
                        needs_update = True
                    new_ids.append(target_aid)
                resolved_sets[sel_name] = new_ids

            if needs_update:
                try:
                    submission = submission.model_copy(update={"sets": resolved_sets})
                    SubmissionRepository.save(task_paths, submission)
                    logger.info("投稿任务已自愈更新别名资产引用: task_id=%s", task_id)
                except Exception as exc:
                    logger.warning("自愈更新 submission.yaml 别名引用失败: %s", exc)

            return SubmissionDetail.model_validate(
                {
                    **submission.model_dump(mode="json"),
                    "warnings": [],
                    "unresolved_files": [],
                }
            )

        # 兼容旧 task：读取 task.yaml 并扫描 selection 目录
        task_config = TaskRepository.load(task_paths)
        catalog_repo = self._get_catalog_repo(paths)

        warnings: list[str] = ["缺少 submission.yaml 配置文件"]
        unresolved_files: list[str] = []
        sets: dict[SelectionName, list[str]] = {"all": [], "post": [], "cover": []}

        for name in ("all", "post", "cover"):
            sel_dir = task_paths.selection_dirs[name]
            if not sel_dir.is_dir():
                continue
            image_files = sorted(
                [
                    f
                    for f in sel_dir.iterdir()
                    if f.is_file() and f.suffix.casefold() in SUPPORTED_IMAGE_EXTENSIONS
                ],
                key=lambda f: f.name,
            )
            for img in image_files:
                digest = _sha256(img)
                candidate_id = f"sha256:{digest}"
                found = catalog_repo.assets_by_ids([candidate_id])
                if candidate_id in found:
                    if candidate_id not in sets[name]:
                        sets[name].append(candidate_id)
                else:
                    unresolved_files.append(str(img.name))
                    warnings.append(f"图片未在 Catalog 找到：{img.name}")

        return SubmissionDetail(
            submission_id=task_config.task_id,
            task_id=task_config.task_id,
            title=task_config.title,
            revision=1,
            source_import_id=None,
            sets=sets,
            created_at=utc_now_iso(),
            updated_at=utc_now_iso(),
            last_export=None,
            warnings=warnings,
            unresolved_files=unresolved_files,
        )

    def list(self, root: str | Path) -> list[SubmissionSummary]:
        """列出所有投稿摘要。"""
        paths, _ = load_workspace(root)
        return SubmissionRepository.list(paths)

    def delete(self, root: str | Path, task_id: str) -> dict[str, Any]:
        """删除投稿任务及其选集/构建产物，同步移除月度计划中的引用，并自动清理不再被任何投稿引用的图片的已投稿标记。"""
        paths, workspace_config = load_workspace(root)
        clean_task_id = str(task_id or "").strip()
        task_paths = TaskPaths.from_workspace(paths, clean_task_id)
        if not task_paths.task_root.is_dir():
            raise FileNotFoundError(f"投稿任务不存在：{clean_task_id}")

        extensions = {ext.casefold() for ext in workspace_config.image_extensions}

        # 1. 收集被删除任务所包含的全部素材 ID
        target_asset_ids: set[str] = set()
        submission = SubmissionRepository.load(task_paths)
        if submission is not None:
            for s_name in ("all", "post", "cover"):
                for aid in submission.sets.get(s_name, []):
                    if aid and str(aid).strip():
                        target_asset_ids.add(str(aid).strip())

        if task_paths.selection_root.is_dir():
            sels = CurrentSelectionScanner().scan(task_paths, extensions)
            for sel_name, items in sels.items():
                for it in items:
                    target_asset_ids.add(f"sha256:{it.content_sha256}")

        # 2. 删除 tasks/<task_id> 目录
        shutil.rmtree(task_paths.task_root, ignore_errors=True)

        # 3. 从月度计划中清除对此任务的引用
        if paths.plans.is_dir():
            plan_repo = PlanRepository()
            for plan_yaml in sorted(paths.plans.glob("*/plan.yaml")):
                month = plan_yaml.parent.name
                plan_paths = PlanPaths.from_workspace(paths, month)
                try:
                    plan = plan_repo.load(plan_paths)
                    orig_len = len(plan.entries)
                    remaining_entries = [
                        e
                        for e in plan.entries
                        if not (isinstance(e.content, TaskContent) and e.content.task_id == clean_task_id)
                    ]
                    if len(remaining_entries) != orig_len:
                        plan.entries = remaining_entries
                        plan.revision += 1
                        plan_repo.save(plan_paths, plan)
                except Exception as exc:
                    logger.warning("删除投稿时同步清理月度计划失败：%s：%s", plan_yaml, exc)

        # 4. 计算剩余任务与计划引用的资产，找出变成孤立的资产
        remaining_referenced = _find_referenced_asset_ids(paths, extensions=extensions)
        unmarked_aids = [aid for aid in target_asset_ids if aid not in remaining_referenced]

        # 5. 从 Catalog 中清除孤立资产的 posted 标记
        if unmarked_aids:
            catalog_repo = self._get_catalog_repo(paths)
            catalog_repo.remove_posted_marks(unmarked_aids)

        # 6. 清除内存全局缓存
        clear_search_caches()

        return {
            "deleted_task_id": clean_task_id,
            "unmarked_asset_ids": unmarked_aids,
        }


def _find_referenced_asset_ids(
    paths: WorkspacePaths,
    exclude_task_id: str | None = None,
    extensions: set[str] | None = None,
) -> set[str]:
    """收集当前工作区中所有投稿与月度计划所引用的全部素材 ID。"""
    referenced: set[str] = set()
    img_exts = extensions or {".png", ".jpg", ".jpeg", ".webp"}

    # 1. 扫描所有 tasks
    if paths.tasks.is_dir():
        for task_dir in paths.tasks.iterdir():
            if not task_dir.is_dir() or (exclude_task_id and task_dir.name == exclude_task_id):
                continue
            task_paths = TaskPaths.from_workspace(paths, task_dir.name)
            sub = SubmissionRepository.load(task_paths)
            if sub is not None:
                for s_name in ("all", "post", "cover"):
                    for aid in sub.sets.get(s_name, []):
                        if aid and str(aid).strip():
                            referenced.add(str(aid).strip())
            elif task_paths.selection_root.is_dir():
                sels = CurrentSelectionScanner().scan(task_paths, img_exts)
                for s_name, items in sels.items():
                    for it in items:
                        referenced.add(f"sha256:{it.content_sha256}")

    # 2. 扫描所有月度计划
    if paths.plans.is_dir():
        plan_repo = PlanRepository()
        for plan_yaml in sorted(paths.plans.glob("*/plan.yaml")):
            month = plan_yaml.parent.name
            try:
                plan = plan_repo.load(PlanPaths.from_workspace(paths, month))
                for entry in plan.entries:
                    if isinstance(entry.content, InlineContent):
                        for s_list in entry.content.sets.values():
                            for aid in s_list:
                                if aid and str(aid).strip():
                                    referenced.add(str(aid).strip())
            except Exception:
                continue

    return referenced


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _safe_replace_dir(source: Path, target: Path, backup: Path) -> None:
    """原子重命名目录，若 Windows 下遇到目录句柄锁定则安全回退到内容同步。"""
    try:
        if target.exists():
            if backup.exists():
                shutil.rmtree(backup, ignore_errors=True)
            os.replace(target, backup)
        os.replace(source, target)
    except (PermissionError, OSError):
        target.mkdir(parents=True, exist_ok=True)
        # 清理旧子项
        for sub in list(target.iterdir()):
            if sub.is_file():
                try:
                    sub.unlink()
                except Exception:
                    pass
            elif sub.is_dir():
                shutil.rmtree(sub, ignore_errors=True)
        # 复制新子项
        for sub in source.iterdir():
            if sub.is_file():
                shutil.copy2(sub, target / sub.name)
            elif sub.is_dir():
                shutil.copytree(sub, target / sub.name, dirs_exist_ok=True)

