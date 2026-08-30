from __future__ import annotations

import asyncio
import io
import json
import logging
import os
import shutil
import uuid
from pathlib import Path
from typing import Any

from PIL import Image

from ..catalog.repository import CatalogRepository, normalize_path_key, _sha256_file
from ..config import WorkspacePaths, load_workspace
from ..metadata.registry import default_image_node_reader_registry
from ..png_metadata import read_png_text_chunks
from .client import NovelAIInpaintClient, resolve_novelai_token
from .models import InpaintCandidate, InpaintSessionResult

logger = logging.getLogger(__name__)


def _extract_asset_gen_params(image_path: Path) -> dict[str, Any]:
    """Extract generation parameters from image file chunks."""
    params: dict[str, Any] = {
        "model": "nai-diffusion-4-5-full",
        "prompt": "",
        "negative_prompt": "",
        "steps": 28,
        "scale": 6.0,
        "sampler": "k_euler_ancestral",
        "noise_schedule": "karras",
        "cfg_rescale": 0.7,
    }
    if not image_path.is_file():
        return params

    try:
        chunks = read_png_text_chunks(image_path)
        if "Comment" in chunks:
            try:
                comment_obj = json.loads(chunks["Comment"])
                if isinstance(comment_obj, dict):
                    params["prompt"] = comment_obj.get("prompt") or chunks.get("Description", "")
                    params["negative_prompt"] = comment_obj.get("uc") or comment_obj.get("negative_prompt", "")
                    if comment_obj.get("model"):
                        params["model"] = comment_obj["model"]
                    if comment_obj.get("steps") is not None:
                        params["steps"] = int(comment_obj["steps"])
                    if comment_obj.get("scale") is not None:
                        params["scale"] = float(comment_obj["scale"])
                    if comment_obj.get("sampler"):
                        params["sampler"] = str(comment_obj["sampler"])
                    if comment_obj.get("noise_schedule"):
                        params["noise_schedule"] = str(comment_obj["noise_schedule"])
                    if comment_obj.get("cfg_rescale") is not None:
                        params["cfg_rescale"] = float(comment_obj["cfg_rescale"])
            except Exception:
                pass

        if not params["prompt"] and "Description" in chunks:
            params["prompt"] = chunks["Description"]

    except Exception as exc:
        logger.warning("解析原图生成参数失败: %s - %s", image_path, exc)

    return params


def _sync_inpainted_asset_to_tasks(
    paths: WorkspacePaths,
    old_asset_id: str,
    new_asset_id: str,
    asset_name: str,
    new_bytes: bytes,
) -> int:
    """Sync the updated inpaint image bytes and asset ID across all tasks in workspace."""
    if not paths.tasks.is_dir():
        return 0

    updated_tasks = 0
    from ..tasks.paths import TaskPaths
    from ..submissions.repository import SubmissionRepository

    old_sha = old_asset_id.split(":")[-1].lower() if ":" in old_asset_id else old_asset_id.lower()

    for task_dir in paths.tasks.iterdir():
        if not task_dir.is_dir() or task_dir.name.startswith("."):
            continue

        task_paths = TaskPaths(paths, task_dir.name)
        task_touched = False

        # 1. 检查并更新 selections/all, post, cover 中的对应图片文件
        for sel_name, sel_dir in task_paths.selection_dirs.items():
            if not sel_dir.is_dir():
                continue
            for file_path in sel_dir.iterdir():
                if not file_path.is_file() or file_path.name.startswith("."):
                    continue

                # 匹配策略：同名、带序号前缀 (如 0001_sample.png)、或哈希与 old_asset_id 一致
                is_match = (
                    file_path.name == asset_name
                    or file_path.name.endswith(f"_{asset_name}")
                )
                if not is_match and old_sha:
                    try:
                        f_sha = _sha256_file(file_path).lower()
                        if f_sha == old_sha:
                            is_match = True
                    except Exception:
                        pass

                if is_match:
                    try:
                        tmp_file = file_path.with_name(f".{file_path.name}.inpaint.{uuid.uuid4().hex[:8]}.tmp")
                        tmp_file.write_bytes(new_bytes)
                        os.replace(tmp_file, file_path)
                        task_touched = True
                    except Exception as exc:
                        logger.warning("同步更新任务图片失败: %s - %s", file_path, exc)

        # 2. 检查并更新 submission.yaml 中引用的 asset_id
        if task_paths.submission_yaml.is_file():
            try:
                submission = SubmissionRepository.load(task_paths)
                sub_modified = False
                for set_name in ("all", "post", "cover"):
                    id_list = getattr(submission.sets, set_name, None)
                    if isinstance(id_list, list) and old_asset_id in id_list:
                        new_list = [new_asset_id if aid == old_asset_id else aid for aid in id_list]
                        setattr(submission.sets, set_name, new_list)
                        sub_modified = True

                if sub_modified:
                    SubmissionRepository.save(task_paths, submission)
                    task_touched = True
            except Exception as exc:
                logger.warning("更新任务 submission.yaml 引用失败: %s - %s", task_paths.task_id, exc)

        if task_touched:
            updated_tasks += 1

    return updated_tasks


class InpaintService:
    def __init__(self, client: NovelAIInpaintClient | None = None):
        self.client = client or NovelAIInpaintClient()

    def get_inpaint_tmp_dir(self, paths: WorkspacePaths) -> Path:
        tmp_dir = paths.root / "tmp" / "inpaint"
        tmp_dir.mkdir(parents=True, exist_ok=True)
        return tmp_dir

    async def generate(
        self,
        paths: WorkspacePaths,
        asset_id: str,
        mask_bytes: bytes,
        prompt: str | None = None,
        negative_prompt: str | None = None,
        strength: float = 0.7,
        count: int = 2,
    ) -> InpaintSessionResult:
        """Run inpaint generation for an asset and return candidates list."""
        catalog = CatalogRepository(paths.catalog, backups_dir=paths.backups)
        assets = catalog.assets_by_ids([asset_id])
        asset = assets.get(asset_id)
        if asset is None or not Path(asset.path).is_file():
            raise FileNotFoundError(f"找不到资产源文件: asset_id={asset_id}")

        asset_path = Path(asset.path)
        image_bytes = asset_path.read_bytes()

        # 继承原图元数据
        gen_params = _extract_asset_gen_params(asset_path)
        final_prompt = prompt if prompt is not None and prompt.strip() else gen_params["prompt"]
        final_negative = (
            negative_prompt if negative_prompt is not None and negative_prompt.strip() else gen_params["negative_prompt"]
        )
        model = gen_params["model"]
        steps = gen_params["steps"]
        scale = gen_params["scale"]
        sampler = gen_params["sampler"]
        noise_schedule = gen_params["noise_schedule"]
        cfg_rescale = gen_params["cfg_rescale"]

        # 创建 session 缓存目录
        session_id = f"inp_{uuid.uuid4().hex[:12]}"
        session_dir = self.get_inpaint_tmp_dir(paths) / session_id
        session_dir.mkdir(parents=True, exist_ok=True)

        count = max(1, min(4, count))

        # 并发生成 count 张候选图
        async def _gen_one(index: int) -> InpaintCandidate:
            cand_bytes, seed = await self.client.generate_single(
                image_bytes=image_bytes,
                mask_bytes=mask_bytes,
                prompt=final_prompt,
                negative_prompt=final_negative,
                strength=strength,
                model=model,
                steps=steps,
                scale=scale,
                sampler=sampler,
                noise_schedule=noise_schedule,
                cfg_rescale=cfg_rescale,
            )
            cand_id = f"cand_{index}"
            cand_filename = f"{cand_id}.png"
            cand_path = session_dir / cand_filename
            cand_path.write_bytes(cand_bytes)

            with Image.open(io.BytesIO(cand_bytes)) as img:
                w, h = img.size

            return InpaintCandidate(
                candidate_id=cand_id,
                filename=cand_filename,
                preview_url=f"/api/inpaint-cache/{session_id}/{cand_filename}",
                seed=seed,
                width=w,
                height=h,
                size_bytes=len(cand_bytes),
            )

        # 串行逐张生成 count 张候选图 (一张接一张生成，避免瞬时高并发)
        candidates: list[InpaintCandidate] = []
        for i in range(count):
            logger.info("开始生成 Inpaint 候选图 %d/%d (asset_id=%s)...", i + 1, count, asset_id)
            cand = await _gen_one(i)
            candidates.append(cand)
            if i < count - 1:
                await asyncio.sleep(0.3)

        # 保存 session 元数据
        session_meta = {
            "session_id": session_id,
            "asset_id": asset_id,
            "asset_path": str(asset_path),
            "prompt": final_prompt,
            "negative_prompt": final_negative,
            "strength": strength,
            "model": model,
            "candidates": [c.model_dump() for c in candidates],
        }
        (session_dir / "session.json").write_text(json.dumps(session_meta, ensure_ascii=False, indent=2), encoding="utf-8")

        return InpaintSessionResult(
            session_id=session_id,
            asset_id=asset_id,
            candidates=candidates,
            prompt=final_prompt,
            negative_prompt=final_negative,
            strength=strength,
            model=model,
        )

    def apply_candidate(
        self,
        paths: WorkspacePaths,
        asset_id: str,
        session_id: str,
        candidate_id: str,
    ) -> dict[str, Any]:
        """Atomically overwrite original asset with chosen candidate and sync catalog."""
        session_dir = self.get_inpaint_tmp_dir(paths) / session_id
        candidate_file = session_dir / f"{candidate_id}.png"
        if not candidate_file.is_file():
            raise FileNotFoundError(f"未找到重绘候选图片: {candidate_id} (session={session_id})")

        catalog = CatalogRepository(paths.catalog, backups_dir=paths.backups)
        assets = catalog.assets_by_ids([asset_id])
        asset = assets.get(asset_id)
        if asset is None or not Path(asset.path).is_file():
            raise FileNotFoundError(f"找不到原始资产文件: asset_id={asset_id}")

        asset_path = Path(asset.path)
        new_bytes = candidate_file.read_bytes()

        # 1. 验证候选图片完整性
        with Image.open(io.BytesIO(new_bytes)) as img:
            img.verify()

        # 2. 原子覆写原图文件
        tmp_target = asset_path.with_name(f".{asset_path.name}.inpaint.{uuid.uuid4().hex[:8]}.tmp")
        tmp_target.write_bytes(new_bytes)
        os.replace(tmp_target, asset_path)

        # 3. 重新 Ingest 进 Catalog
        stat = asset_path.stat()
        readers = default_image_node_reader_registry()

        old_marks = catalog.all_asset_marks().get(asset_id, [])

        with catalog.connection() as conn:
            ingest_res = catalog.ingest_asset(
                conn,
                asset_path,
                expected_size=stat.st_size,
                expected_modified_ns=stat.st_mtime_ns,
                readers=readers,
                enrichers=[],
            )
            new_asset = ingest_res.asset
            new_asset_id = new_asset.asset_id

            # 同步更新所有快照 import_items 记录中的 asset_id 为最新权威 Hash
            conn.execute(
                "UPDATE import_items SET asset_id=? WHERE resolved_path=? OR asset_id=?",
                (new_asset_id, str(asset_path), asset_id),
            )

        # 4. 迁移历史标记并持久化别名映射（向后兼容任何旧 hash 引用）
        catalog.record_asset_alias(asset_id, new_asset_id, str(asset_path))
        if old_marks and new_asset_id != asset_id:
            for mark in old_marks:
                catalog.set_asset_marks([new_asset_id], mark)

        # 5. 跨任务级联同步：更新所有既有任务 selections 中的图片副本与 submission.yaml
        synced_tasks_count = _sync_inpainted_asset_to_tasks(
            paths=paths,
            old_asset_id=asset_id,
            new_asset_id=new_asset_id,
            asset_name=asset_path.name,
            new_bytes=new_bytes,
        )
        if synced_tasks_count > 0:
            logger.info("✅ 局部重绘已同步级联更新 %d 个既有任务的 selection 文件与配置", synced_tasks_count)

        # 6. 清理当前重绘会话临时文件
        self.cleanup_session(paths, session_id)

        logger.info(
            "✅ 局部重绘成功覆写原图: asset_id=%s -> new_asset_id=%s path=%s size=%d",
            asset_id,
            new_asset_id,
            asset_path,
            stat.st_size,
        )

        return {
            "success": True,
            "old_asset_id": asset_id,
            "new_asset_id": new_asset_id,
            "path": str(asset_path),
            "size_bytes": stat.st_size,
            "mtime": int(stat.st_mtime),
            "width": new_asset.image.width if new_asset.image else 0,
            "height": new_asset.image.height if new_asset.image else 0,
        }

    def cleanup_session(self, paths: WorkspacePaths, session_id: str) -> None:
        """Remove temporary candidate files for an inpaint session."""
        session_dir = self.get_inpaint_tmp_dir(paths) / session_id
        if session_dir.is_dir():
            try:
                shutil.rmtree(session_dir)
            except Exception as exc:
                logger.warning("清理 inpaint 临时目录失败: %s - %s", session_dir, exc)
