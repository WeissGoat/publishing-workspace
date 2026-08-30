from __future__ import annotations

import json
import os
import subprocess
import time
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from ..catalog.repository import CatalogRepository
from ..config import load_workspace
from ..logging import get_logger
from ..plans.search import AssetSearchFilter, AssetSearchService
from ..submissions.models import PixivMetadata, SubmissionRevisionConflictError
from ..submissions.pixiv_metadata import (
    fetch_pixiv_past_tags_sync,
    generate_caption,
    generate_title,
    suggest_tags_from_assets,
    suggest_tags_from_pixiv_sync,
)
from ..submissions.pixiv_uploader import PixivUploadService
from ..submissions.repository import SubmissionRepository
from ..submissions.service import SubmissionService
from ..tasks.paths import TaskPaths
from ..tasks.repository import TaskRepository


logger = get_logger(__name__)


class PixivPublishRequest(BaseModel):
    force_rebuild: bool = False
    force_republish: bool = False


class SchedulePublishRequest(BaseModel):
    enable: bool = True
    scheduled_at: str | None = None
    allow_delay: bool = False
    max_delay_minutes: int = 0


class SubmissionMutation(BaseModel):
    task_id: str | None = None
    revision: int | None = Field(default=None, ge=1)
    title: str
    source_import_id: str | None = None
    sets: dict[str, list[str]]
    pixiv: dict[str, Any] | PixivMetadata | None = None
    scheduled_at: str | None = None


class GenerateMetadataRequest(BaseModel):
    asset_ids: list[str] = Field(default_factory=list)
    import_id: str | None = None


class SuggestPixivTagsRequest(BaseModel):
    asset_id: str
    import_id: str | None = None


def _sync_submission_schedule(
    root: Path,
    task_id: str,
    title: str,
    scheduled_at: str | None,
    publish: bool | None = None,
    allow_delay: bool | None = None,
    max_delay_minutes: int | None = None,
) -> None:
    from datetime import datetime
    from zoneinfo import ZoneInfo
    from ..plans.models import ExecutionPolicy, ScheduleEntry, TaskContent
    from ..service import PublishingService

    if not scheduled_at or not scheduled_at.strip():
        return

    clean_sched = scheduled_at.strip()
    try:
        dt = datetime.fromisoformat(clean_sched)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=ZoneInfo("Asia/Shanghai"))
        month_str = dt.strftime("%Y-%m")
    except Exception:
        return

    svc = PublishingService()
    try:
        try:
            plan = svc.schedule_show(root, month_str)
        except KeyError:
            plan = svc.schedule_create(root, month_str)

        if plan.status == "locked":
            return

        existing_entry = None
        for e in plan.entries:
            if isinstance(e.content, TaskContent) and e.content.task_id == task_id:
                existing_entry = e
                break

        exec_policy = ExecutionPolicy()
        if existing_entry is not None:
            exec_policy = existing_entry.execution
        
        update_dict = {}
        if publish is not None:
            update_dict["publish"] = publish
            update_dict["build_on_due"] = True
        if allow_delay is not None:
            update_dict["allow_delay"] = allow_delay
        if max_delay_minutes is not None:
            update_dict["max_delay_minutes"] = max_delay_minutes
        if update_dict:
            exec_policy = exec_policy.model_copy(update=update_dict)

        if existing_entry is not None:
            new_entry = ScheduleEntry(
                entry_id=existing_entry.entry_id,
                scheduled_at=dt,
                title=title or existing_entry.title,
                content=TaskContent(task_id=task_id),
                execution=exec_policy,
            )
            svc.schedule_update_entry(root, month_str, new_entry, expected_revision=plan.revision)
        else:
            new_entry = ScheduleEntry(
                entry_id=f"entry-{task_id}",
                scheduled_at=dt,
                title=title,
                content=TaskContent(task_id=task_id),
                execution=exec_policy,
            )
            svc.schedule_add_entry(root, month_str, new_entry, expected_revision=plan.revision)
    except Exception:
        pass


def _find_task_schedule_info(root: Path, task_id: str) -> dict[str, Any]:
    from ..plans.models import TaskContent
    from ..service import PublishingService
    from ..config import load_workspace

    paths, _ = load_workspace(root)
    if not paths.plans.is_dir():
        return {}

    try:
        for plan_dir in paths.plans.iterdir():
            if plan_dir.is_dir() and (plan_dir / "plan.yaml").is_file():
                try:
                    plan = PublishingService().schedule_show(root, plan_dir.name)
                    for e in plan.entries:
                        if isinstance(e.content, TaskContent) and e.content.task_id == task_id:
                            return {
                                "scheduled_at": e.scheduled_at.isoformat(),
                                "scheduled_publish": bool(e.execution.publish),
                                "allow_delay": bool(getattr(e.execution, "allow_delay", False)),
                                "max_delay_minutes": int(getattr(e.execution, "max_delay_minutes", 0) or 0),
                                "build_on_due": bool(e.execution.build_on_due),
                                "entry_id": e.entry_id,
                                "month": plan_dir.name,
                            }
                except Exception:
                    pass
    except Exception:
        pass
    return {}


def _find_task_scheduled_at(root: Path, task_id: str) -> str | None:
    info = _find_task_schedule_info(root, task_id)
    return info.get("scheduled_at")


def _set_task_schedule_publish(
    root: Path,
    task_id: str,
    enable: bool,
    allow_delay: bool = False,
    max_delay_minutes: int = 0,
) -> bool:
    from ..plans.models import TaskContent, ScheduleEntry
    from ..service import PublishingService
    from ..config import load_workspace

    paths, _ = load_workspace(root)
    if not paths.plans.is_dir():
        return False

    svc = PublishingService()
    for plan_dir in paths.plans.iterdir():
        if plan_dir.is_dir() and (plan_dir / "plan.yaml").is_file():
            try:
                plan = svc.schedule_show(root, plan_dir.name)
                for e in plan.entries:
                    if isinstance(e.content, TaskContent) and e.content.task_id == task_id:
                        new_exec = e.execution.model_copy(
                            update={
                                "publish": enable,
                                "build_on_due": True,
                                "allow_delay": allow_delay if enable else False,
                                "max_delay_minutes": max_delay_minutes if enable else 0,
                            }
                        )
                        new_entry = ScheduleEntry(
                            entry_id=e.entry_id,
                            scheduled_at=e.scheduled_at,
                            title=e.title,
                            content=e.content,
                            execution=new_exec,
                        )
                        svc.schedule_update_entry(root, plan_dir.name, new_entry, expected_revision=plan.revision)
                        return True
            except Exception:
                pass
    return False


def register_library_routes(app: FastAPI) -> None:
    """注册素材库与 Submission 相关的 HTTP API。"""

    @app.get("/api/library/assets")
    def search_library_assets(
        offset: int = Query(default=0, ge=0),
        limit: int = Query(default=60, ge=1, le=200),
        import_id: str | None = None,
        import_ids: str | None = None,
        text: str = "",
        artist: str | None = None,
        character: str | None = None,
        action_group: str | None = None,
        action: str | None = None,
        facets: str | None = None,
        tags: str | None = None,
        posted: bool | None = None,
        favorite_mode: str = "all",
        favorite_ids: str | None = None,
        sort_by: str = "order_asc",
    ):
        parsed_facets: dict[str, set[str]] = {}
        if facets:
            try:
                raw = json.loads(facets)
            except json.JSONDecodeError as exc:
                raise ValueError(f"facets 必须是 JSON 对象：{exc}") from exc
            if not isinstance(raw, dict):
                raise ValueError("facets 必须是 JSON 对象")
            parsed_facets = {
                str(field): set(values if isinstance(values, list) else [values])
                for field, values in raw.items()
            }

        parsed_fav_ids: set[str] = set()
        if favorite_ids:
            try:
                raw_fav = json.loads(favorite_ids)
                if isinstance(raw_fav, list):
                    parsed_fav_ids = {str(x).strip() for x in raw_fav if str(x).strip()}
                elif isinstance(raw_fav, str):
                    parsed_fav_ids = {x.strip() for x in raw_fav.split(",") if x.strip()}
            except Exception:
                parsed_fav_ids = {x.strip() for x in favorite_ids.split(",") if x.strip()}

        parsed_tags: set[str] = set()
        if tags:
            try:
                raw_tags = json.loads(tags)
                if isinstance(raw_tags, list):
                    parsed_tags = {str(x).strip() for x in raw_tags if str(x).strip()}
                elif isinstance(raw_tags, str):
                    parsed_tags = {x.strip() for x in raw_tags.split(",") if x.strip()}
            except Exception:
                parsed_tags = {x.strip() for x in tags.split(",") if x.strip()}

        parsed_import_ids: list[str] | None = None
        if import_ids:
            try:
                raw_ids = json.loads(import_ids)
                if isinstance(raw_ids, list):
                    parsed_import_ids = [str(x).strip() for x in raw_ids if str(x).strip() and str(x).strip() != "__all__"]
                elif isinstance(raw_ids, str):
                    parsed_import_ids = [x.strip() for x in raw_ids.split(",") if x.strip() and x.strip() != "__all__"]
            except Exception:
                parsed_import_ids = [x.strip() for x in import_ids.split(",") if x.strip() and x.strip() != "__all__"]
        elif import_id and import_id != "__all__":
            parsed_import_ids = [import_id.strip()]

        fav_mode = favorite_mode if favorite_mode in {"all", "favorited", "unfavorited"} else "all"

        filters = AssetSearchFilter(
            offset=offset,
            limit=limit,
            import_id=import_id,
            import_ids=parsed_import_ids,
            text=text,
            artist=artist,
            character=character,
            action_group=action_group,
            action=action,
            facets=parsed_facets,
            tags=parsed_tags,
            posted=posted,
            favorite_mode=fav_mode,
            favorite_ids=parsed_fav_ids,
            sort_by=sort_by,
        )
        t0 = time.perf_counter()
        catalog = getattr(app.state, "catalog", None)
        page_res = AssetSearchService().search_page(
            app.state.publishing_root, filters, catalog=catalog
        )
        elapsed_ms = (time.perf_counter() - t0) * 1000
        snap_label = (
            ",".join(parsed_import_ids)
            if parsed_import_ids
            else (import_id or "全部")
        )
        logger.info(
            "🔍 素材检索: 快照=%s offset=%d limit=%d 排序=%s 过滤=[字:%s 词:%s 标:%s] -> 命中 %d/%d 项 (耗时: %.1fms)",
            snap_label,
            offset,
            limit,
            sort_by,
            text or "-",
            artist or character or action_group or action or "-",
            ",".join(parsed_tags) if parsed_tags else "-",
            len(page_res.items),
            page_res.total,
            elapsed_ms,
        )
        return page_res.model_dump(mode="json", by_alias=True)

    @app.get("/api/library/facets")
    def library_facets(import_id: str | None = None, import_ids: str | None = None):
        catalog = getattr(app.state, "catalog", None)
        parsed_import_ids: list[str] | None = None
        if import_ids:
            try:
                raw_ids = json.loads(import_ids)
                if isinstance(raw_ids, list):
                    parsed_import_ids = [str(x).strip() for x in raw_ids if str(x).strip() and str(x).strip() != "__all__"]
                elif isinstance(raw_ids, str):
                    parsed_import_ids = [x.strip() for x in raw_ids.split(",") if x.strip() and x.strip() != "__all__"]
            except Exception:
                parsed_import_ids = [x.strip() for x in import_ids.split(",") if x.strip() and x.strip() != "__all__"]
        elif import_id and import_id != "__all__":
            parsed_import_ids = [import_id.strip()]

        return AssetSearchService().facets(
            app.state.publishing_root, import_id=import_id, import_ids=parsed_import_ids, catalog=catalog
        )

    @app.get("/api/library/tags")
    def library_tags():
        catalog = getattr(app.state, "catalog", None)
        if catalog is None:
            paths, _ = load_workspace(app.state.publishing_root)
            catalog = CatalogRepository(paths.catalog, backups_dir=paths.backups)
            app.state.catalog = catalog
        return catalog.get_all_tags()

    @app.get("/api/submissions")
    def list_submissions():
        return [
            item.model_dump(mode="json")
            for item in SubmissionService().list(app.state.publishing_root)
        ]

    @app.get("/api/submissions/{task_id}")
    def get_submission(task_id: str):
        try:
            sub = SubmissionService().get(
                app.state.publishing_root, task_id
            ).model_dump(mode="json")
            sched_info = _find_task_schedule_info(app.state.publishing_root, task_id)
            sub["scheduled_at"] = sched_info.get("scheduled_at")
            sub["scheduled_publish"] = sched_info.get("scheduled_publish", False)
            sub["allow_delay"] = sched_info.get("allow_delay", False)
            sub["max_delay_minutes"] = sched_info.get("max_delay_minutes", 0)

            try:
                paths, _ = load_workspace(app.state.publishing_root)
                t_paths = TaskPaths.from_workspace(paths, task_id)
                t_cfg = TaskRepository.load(t_paths)
                m_op = t_cfg.processing.operations.get("mosaic")
                if m_op:
                    sub["mosaic_options"] = {
                        "enabled": bool(m_op.enabled),
                        "pixel_size": int(m_op.options.get("pixel_size", 10)) if m_op.options else 10,
                    }
            except Exception:
                pass

            return sub
        except FileNotFoundError as exc:
            return JSONResponse(
                status_code=404,
                content={"detail": {"code": "task_not_found", "message": str(exc)}},
            )

    @app.post("/api/submissions")
    def create_submission(payload: SubmissionMutation):
        try:
            detail = SubmissionService().create_or_update(
                app.state.publishing_root,
                task_id=payload.task_id,
                title=payload.title,
                source_import_id=payload.source_import_id,
                sets=payload.sets,
                pixiv=payload.pixiv,
                expected_revision=payload.revision,
            )
            if payload.scheduled_at:
                _sync_submission_schedule(
                    app.state.publishing_root,
                    detail.task_id,
                    payload.title,
                    payload.scheduled_at,
                )
            result = detail.model_dump(mode="json")
            result["scheduled_at"] = payload.scheduled_at
            total_images = sum(len(v) for v in detail.sets.values()) if detail.sets else 0
            logger.info("💾 创建投稿任务: task_id=%s title=%r 图片数=%d 定时=%s", detail.task_id, detail.title, total_images, payload.scheduled_at or "无")
            return result
        except SubmissionRevisionConflictError as exc:
            return JSONResponse(
                status_code=409,
                content={"detail": {"code": "submission_revision_conflict", "message": str(exc)}},
            )
        except ValueError as exc:
            return JSONResponse(
                status_code=422,
                content={"detail": {"code": "invalid_submission", "message": str(exc)}},
            )
        except FileNotFoundError as exc:
            return JSONResponse(
                status_code=422,
                content={"detail": {"code": "asset_unavailable", "message": str(exc)}},
            )

    @app.put("/api/submissions/{task_id}")
    def update_submission(task_id: str, payload: SubmissionMutation):
        try:
            detail = SubmissionService().create_or_update(
                app.state.publishing_root,
                task_id=task_id,
                title=payload.title,
                source_import_id=payload.source_import_id,
                sets=payload.sets,
                pixiv=payload.pixiv,
                expected_revision=payload.revision,
            )
            if payload.scheduled_at is not None:
                _sync_submission_schedule(
                    app.state.publishing_root,
                    task_id,
                    payload.title,
                    payload.scheduled_at,
                )
            result = detail.model_dump(mode="json")
            result["scheduled_at"] = payload.scheduled_at
            total_images = sum(len(v) for v in detail.sets.values()) if detail.sets else 0
            logger.info("💾 更新投稿任务: task_id=%s title=%r 图片数=%d 定时=%s", detail.task_id, detail.title, total_images, payload.scheduled_at or "无")
            return result
        except SubmissionRevisionConflictError as exc:
            return JSONResponse(
                status_code=409,
                content={"detail": {"code": "submission_revision_conflict", "message": str(exc)}},
            )
        except ValueError as exc:
            return JSONResponse(
                status_code=422,
                content={"detail": {"code": "invalid_submission", "message": str(exc)}},
            )
        except FileNotFoundError as exc:
            return JSONResponse(
                status_code=422,
                content={"detail": {"code": "asset_unavailable", "message": str(exc)}},
            )

    @app.post("/api/submissions/generate-metadata")
    def generate_submission_metadata(payload: GenerateMetadataRequest):
        paths, config = load_workspace(app.state.publishing_root)
        catalog_repo = CatalogRepository(paths.catalog)
        assets_map = catalog_repo.assets_by_ids(payload.asset_ids, import_id=payload.import_id)
        if len(assets_map) < len(payload.asset_ids):
            fallback_map = catalog_repo.assets_by_ids(payload.asset_ids)
            fallback_map.update(assets_map)
            assets_map = fallback_map

        assets = list(assets_map.values())

        title = generate_title(assets)
        caption = generate_caption(config.pixiv)
        tag_suggestions = suggest_tags_from_assets(assets, config.pixiv)

        return {
            "title": title,
            "caption": caption,
            "tag_suggestions": tag_suggestions,
            "r18": config.pixiv.r18,
            "allow_tag_edit": config.pixiv.allow_tag_edit,
        }

    @app.post("/api/submissions/suggest-pixiv-tags")
    def suggest_pixiv_tags(payload: SuggestPixivTagsRequest):
        paths, config = load_workspace(app.state.publishing_root)
        catalog_repo = CatalogRepository(paths.catalog)
        assets_map = catalog_repo.assets_by_ids([payload.asset_id], import_id=payload.import_id)
        if not assets_map or payload.asset_id not in assets_map:
            assets_map = catalog_repo.assets_by_ids([payload.asset_id])
        if not assets_map or payload.asset_id not in assets_map:
            raise HTTPException(status_code=404, detail="素材不存在")

        asset = assets_map[payload.asset_id]
        cookie = config.pixiv.pixiv_cookie or os.environ.get("PIXIV_COOKIE", "")
        token = config.pixiv.pixiv_token or os.environ.get("PIXIV_TOKEN", "")

        tags = suggest_tags_from_pixiv_sync(asset.path, cookie=cookie, token=token)
        return {"tags": tags}

    @app.post("/api/submissions/sync-pixiv-past-tags")
    def sync_pixiv_past_tags():
        paths, config = load_workspace(app.state.publishing_root)
        cookie = config.pixiv.pixiv_cookie or os.environ.get("PIXIV_COOKIE", "")
        if not cookie:
            raise HTTPException(status_code=400, detail="未配置 Pixiv Cookie，请在 workspace.yaml 中配置 pixiv.pixiv_cookie")

        tags = fetch_pixiv_past_tags_sync(cookie)
        if not tags:
            raise HTTPException(status_code=502, detail="未能从 Pixiv 提取到常用标签，请检查 Cookie 是否过期或网络连接")

        # 保持基础常用标签在最前，合并拉取的标签
        merged_tags: list[str] = ["AIイラスト", "NovelAI"]
        seen = {t.casefold() for t in merged_tags}
        for t in tags:
            if t.casefold() not in seen:
                seen.add(t.casefold())
                merged_tags.append(t)

        # 写回 workspace.yaml 以便持久化预设
        try:
            import yaml
            config_file = paths.config
            if config_file.is_file():
                raw_yaml = yaml.safe_load(config_file.read_text(encoding="utf-8")) or {}
                if "pixiv" not in raw_yaml or not isinstance(raw_yaml["pixiv"], dict):
                    raw_yaml["pixiv"] = {}
                raw_yaml["pixiv"]["default_tags"] = merged_tags
                config_file.write_text(yaml.safe_dump(raw_yaml, allow_unicode=True, sort_keys=False), encoding="utf-8")
        except Exception as exc:
            import logging
            logging.getLogger(__name__).warning("保存同步的常用标签到 workspace.yaml 失败: %s", exc)

        return {"tags": merged_tags, "count": len(merged_tags)}

    @app.delete("/api/submissions/{task_id}")
    @app.post("/api/submissions/{task_id}/delete")
    def delete_submission(task_id: str):
        try:
            result = SubmissionService().delete(app.state.publishing_root, task_id)
            return {"success": True, **result}
        except FileNotFoundError as exc:
            return JSONResponse(
                status_code=404,
                content={"detail": {"code": "submission_not_found", "message": str(exc)}},
            )
        except Exception as exc:
            return JSONResponse(
                status_code=500,
                content={"detail": {"code": "submission_delete_failed", "message": str(exc)}},
            )

    @app.post("/api/submissions/{task_id}/publish/pixiv")
    def publish_submission_to_pixiv(
        task_id: str,
        payload: PixivPublishRequest | None = None,
    ):
        req_payload = payload or PixivPublishRequest()
        logger.info("🚀 收到 Pixiv 手动发布请求: task_id=%s force_rebuild=%s force_republish=%s", task_id, req_payload.force_rebuild, req_payload.force_republish)
        uploader = PixivUploadService()
        result = uploader.publish_task(
            app.state.publishing_root,
            task_id,
            force_rebuild=req_payload.force_rebuild,
            force_republish=req_payload.force_republish,
        )
        if not result.success:
            status_code = 400
            if result.error_code == "already_published":
                status_code = 409
            elif result.error_code == "task_not_found":
                status_code = 404
            elif result.error_code == "cookie_missing":
                status_code = 400
            elif result.error_code == "captcha_required":
                status_code = 429
            logger.warning("❌ Pixiv 手动发布失败: task_id=%s code=%s error=%s", task_id, result.error_code, result.error)
            return JSONResponse(
                status_code=status_code,
                content={
                    "detail": {
                        "code": result.error_code,
                        "message": result.error,
                        "illust_id": result.illust_id,
                        "pixiv_url": result.pixiv_url,
                    }
                },
            )
        logger.info("🎉 Pixiv 手动发布成功: task_id=%s illust_id=%s", task_id, result.illust_id)
        return {
            "success": True,
            "task_id": result.task_id,
            "illust_id": result.illust_id,
            "pixiv_url": result.pixiv_url,
            "published_at": result.published_at,
            "message": f"发布成功！作品 PID: {result.illust_id}",
        }

    @app.post("/api/submissions/{task_id}/schedule-publish")
    def toggle_schedule_publish(task_id: str, payload: SchedulePublishRequest | None = None):
        req_payload = payload or SchedulePublishRequest()
        root = app.state.publishing_root
        paths, config = load_workspace(root)
        task_paths = TaskPaths.from_workspace(paths, task_id)
        if not task_paths.task_yaml.is_file():
            return JSONResponse(
                status_code=404,
                content={"detail": {"code": "task_not_found", "message": f"投稿任务不存在: {task_id}"}},
            )

        submission = SubmissionRepository.load(task_paths)
        if submission is None:
            return JSONResponse(
                status_code=404,
                content={"detail": {"code": "submission_not_found", "message": f"投稿记录不存在: {task_id}"}},
            )

        # 取消定时发布
        if not req_payload.enable:
            _set_task_schedule_publish(root, task_id, enable=False)
            logger.info("⏰ 取消定时发布: task_id=%s", task_id)
            return {"success": True, "message": "已取消定时发布", "scheduled_publish": False}

        # 开启定时发布：严格校验所有必填参数
        sched_info = _find_task_schedule_info(root, task_id)
        scheduled_at_str = req_payload.scheduled_at or sched_info.get("scheduled_at")
        if not scheduled_at_str or not scheduled_at_str.strip():
            return JSONResponse(
                status_code=422,
                content={"detail": {"code": "missing_scheduled_at", "message": "请先设置定时发布的时间（日期与时间）"}},
            )

        try:
            from datetime import datetime
            from zoneinfo import ZoneInfo

            dt = datetime.fromisoformat(scheduled_at_str.strip())
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=ZoneInfo("Asia/Shanghai"))
        except Exception as exc:
            return JSONResponse(
                status_code=422,
                content={"detail": {"code": "invalid_scheduled_at", "message": f"定时时间格式不合法: {exc}"}},
            )

        # 校验标题
        title = ((submission.pixiv.title if submission.pixiv else "") or submission.title or "").strip()
        if not title:
            return JSONResponse(
                status_code=422,
                content={"detail": {"code": "missing_title", "message": "投稿标题不能为空"}},
            )

        # 校验标签（1~10 个）
        tags = (submission.pixiv.tags if submission.pixiv else []) or config.pixiv.default_tags
        tags = [str(t).strip() for t in tags if str(t).strip()]
        if not tags:
            return JSONResponse(
                status_code=422,
                content={"detail": {"code": "missing_tags", "message": "投稿标签不能为空，请至少添加 1 个标签"}},
            )
        if len(tags) > 10:
            return JSONResponse(
                status_code=422,
                content={"detail": {"code": "too_many_tags", "message": f"Pixiv 标签数量不能超过 10 个（当前有 {len(tags)} 个）"}},
            )

        # 校验图片集合
        sets = submission.sets or {}
        post_imgs = sets.get("post") or sets.get("all") or []
        if not post_imgs:
            return JSONResponse(
                status_code=422,
                content={"detail": {"code": "missing_images", "message": "投稿图片集合为空，请至少选择 1 张图片"}},
            )

        # 校验 Pixiv Cookie
        cookie = (config.pixiv.pixiv_cookie or os.environ.get("PIXIV_COOKIE", "")).strip()
        if not cookie:
            return JSONResponse(
                status_code=422,
                content={"detail": {"code": "missing_cookie", "message": "未配置 Pixiv Cookie，无法开启定时发布，请在 workspace.yaml 中配置 pixiv.pixiv_cookie"}},
            )

        # 校验是否已有导出的发布构建包
        task_paths = TaskPaths.from_workspace(paths, task_id)
        latest_manifest = task_paths.builds_root / "latest" / "manifest.json"
        latest_build_manifest = task_paths.builds_root / "latest" / "build_manifest.json"
        if not latest_manifest.is_file() and not latest_build_manifest.is_file():
            return JSONResponse(
                status_code=422,
                content={"detail": {"code": "missing_build_package", "message": "当前投稿尚未导出构建包，请先点击【开始导出】生成发布包并确认打码效果，再开启定时自动发布。"}},
            )

        # 同步写入排期计划并开启 publish=True
        _sync_submission_schedule(
            root,
            task_id,
            title,
            dt.isoformat(),
            publish=True,
            allow_delay=req_payload.allow_delay,
            max_delay_minutes=req_payload.max_delay_minutes,
        )

        if req_payload.allow_delay and req_payload.max_delay_minutes > 0:
            from datetime import timedelta
            end_dt = dt + timedelta(minutes=req_payload.max_delay_minutes)
            time_window_str = f"{dt.strftime('%Y-%m-%d %H:%M')} - {end_dt.strftime('%Y-%m-%d %H:%M')}"
        else:
            time_window_str = dt.strftime("%Y-%m-%d %H:%M")

        logger.info("⏰ 开启定时发布: task_id=%s 计划时间=%s (容差=%s分钟)", task_id, time_window_str, req_payload.max_delay_minutes if req_payload.allow_delay else 0)

        return {
            "success": True,
            "message": f"⏰ 已成功开启定时发布！将于 {time_window_str} 自动发布到 Pixiv",
            "scheduled_at": dt.isoformat(),
            "scheduled_publish": True,
            "allow_delay": req_payload.allow_delay,
            "max_delay_minutes": req_payload.max_delay_minutes,
        }

    # 导出作业相关路由
    @app.post("/api/submissions/{task_id}/exports")
    async def start_task_export(task_id: str, req: Request):
        try:
            body = await req.json()
        except Exception:
            body = {}

        enable_mosaic = body.get("enable_mosaic")
        mosaic_pixel_size = body.get("mosaic_pixel_size")
        if mosaic_pixel_size is not None:
            try:
                mosaic_pixel_size = int(mosaic_pixel_size)
            except (ValueError, TypeError):
                mosaic_pixel_size = 10
        else:
            mosaic_pixel_size = 10

        if enable_mosaic is not None:
            try:
                from ..config import load_workspace
                from ..tasks.paths import TaskPaths
                from ..tasks.repository import TaskRepository
                from ..tasks.models import OperationConfig

                paths, _ = load_workspace(app.state.publishing_root)
                task_paths = TaskPaths.from_workspace(paths, task_id)
                if task_paths.task_yaml.is_file():
                    task_config = TaskRepository.load(task_paths)
                    task_config.processing.operations["mosaic"] = OperationConfig(
                        enabled=bool(enable_mosaic),
                        adapter="anr_plugin_auto_mosaics",
                        options={
                            "detector": "yolo_sam",
                            "method": "pixel",
                            "parts": ["penis", "pussy"],
                            "pixel_size": mosaic_pixel_size,
                        },
                    )
                    TaskRepository.save(task_paths, task_config)
            except Exception as e:
                logger.warning("更新任务打码配置失败：%s", e)

        try:
            job = app.state.export_jobs.start(
                app.state.publishing_root,
                task_id,
                enable_mosaic=enable_mosaic,
                mosaic_pixel_size=mosaic_pixel_size,
            )
            status_code = 202 if job.status == "queued" else 200
            return JSONResponse(
                status_code=status_code,
                content=job.model_dump(mode="json", by_alias=True),
            )
        except FileNotFoundError as exc:
            return JSONResponse(
                status_code=404,
                content={"detail": {"code": "task_not_found", "message": str(exc)}},
            )

    @app.get("/api/export-jobs/{job_id}")
    def get_export_job(job_id: str):
        try:
            job = app.state.export_jobs.get(app.state.publishing_root, job_id)
            return job.model_dump(mode="json", by_alias=True)
        except FileNotFoundError as exc:
            return JSONResponse(
                status_code=404,
                content={"detail": {"code": "export_job_not_found", "message": str(exc)}},
            )

    @app.get("/api/submissions/{task_id}/exports")
    def list_task_exports(task_id: str):
        jobs = app.state.export_jobs.list_for_task(app.state.publishing_root, task_id)
        return [job.model_dump(mode="json", by_alias=True) for job in jobs]

    @app.post("/api/export-jobs/{job_id}/open-output")
    def open_export_output(job_id: str):
        from ..export_jobs.models import ExportOutputNotFoundError, ExportOutputOpenError

        try:
            output_dir = app.state.export_jobs.open_output(app.state.publishing_root, job_id)
            return {"output_dir": output_dir}
        except ExportOutputNotFoundError as exc:
            return JSONResponse(
                status_code=404,
                content={"detail": {"code": "export_output_not_found", "message": str(exc)}},
            )
        except ExportOutputOpenError as exc:
            return JSONResponse(
                status_code=422,
                content={
                    "detail": {
                        "code": "export_output_open_failed",
                        "message": str(exc),
                        "output_dir": exc.output_dir,
                    }
                },
            )

    @app.get("/api/submissions/{task_id}/latest-build")
    def get_latest_submission_build(task_id: str):
        import datetime
        import json
        from pathlib import Path
        from ..config import load_workspace
        from ..tasks.paths import TaskPaths
        from ..tasks.repository import TaskRepository

        paths, workspace_config = load_workspace(app.state.publishing_root)
        task_paths = TaskPaths.from_workspace(paths, task_id)
        if not task_paths.task_root.is_dir():
            return JSONResponse(
                status_code=404,
                content={"detail": {"code": "task_not_found", "message": f"任务不存在：{task_id}"}},
            )

        # 定位最新导出目录
        latest_dir = task_paths.builds_root / "latest"
        build_dir = None
        if latest_dir.is_dir():
            build_dir = latest_dir
        elif task_paths.builds_root.is_dir():
            candidates = [d for d in task_paths.builds_root.iterdir() if d.is_dir() and d.name != "history"]
            if candidates:
                candidates.sort(key=lambda d: d.stat().st_mtime, reverse=True)
                build_dir = candidates[0]

        if not build_dir or not build_dir.is_dir():
            return {"has_build": False}

        # 读取 build_manifest.json
        manifest_path = build_dir / "build_manifest.json"
        manifest_data = {}
        if manifest_path.is_file():
            try:
                manifest_data = json.loads(manifest_path.read_text(encoding="utf-8"))
            except Exception:
                pass

        build_id = manifest_data.get("build_id", build_dir.name)
        mtime = build_dir.stat().st_mtime
        exported_at = datetime.datetime.fromtimestamp(mtime, datetime.timezone.utc).isoformat()

        # 读取 task.yaml 中的处理配置
        try:
            task_config = TaskRepository.load(task_paths)
            proc_config = task_config.processing
        except Exception:
            proc_config = None

        # 整理流水线算子 (Pipeline Operations)
        operations = []
        if proc_config:
            # 1. strip_metadata
            strip_op = proc_config.operations.get("strip_metadata")
            strip_enabled = strip_op.enabled if strip_op else True
            operations.append({
                "name": "strip_metadata",
                "title": "清除图片元数据 (EXIF & AI Prompt)",
                "enabled": strip_enabled,
                "description": "已彻底剥离 AI 生图 Prompt、Workflow 参数与 EXIF 信息，保护工作流隐私。" if strip_enabled else "未启用（保留原始生图参数）",
            })

            # 2. mosaic
            mosaic_op = proc_config.operations.get("mosaic")
            mosaic_enabled = mosaic_op.enabled if mosaic_op else False
            if mosaic_enabled:
                opts = mosaic_op.options if mosaic_op and mosaic_op.options else {}
                detector = opts.get("detector", "yolo_sam")
                method = opts.get("method", "pixel")
                psize = opts.get("pixel_size", 10)
                parts = opts.get("parts", ["penis", "pussy"])
                parts_str = ", ".join(parts) if isinstance(parts, list) else str(parts)
                method_desc = f"{method} (强度 {psize}px)" if method == "pixel" else method
                operations.append({
                    "name": "mosaic",
                    "title": "AI 智能自动打码 (Auto Mosaic)",
                    "enabled": True,
                    "description": f"已启用自动打码：检测器 [{detector}]，方式 [{method_desc}]，检测部位 [{parts_str}]",
                })
            else:
                operations.append({
                    "name": "mosaic",
                    "title": "AI 智能自动打码 (Auto Mosaic)",
                    "enabled": False,
                    "description": "未启用（原图直通导出）",
                })

        # 扫描 output 各集合图片
        images = {"all": [], "post": [], "cover": []}
        output_root = build_dir / "output"
        image_exts = set(workspace_config.image_extensions)
        if output_root.is_dir():
            for sel in ("all", "post", "cover"):
                sel_dir = output_root / sel
                if sel_dir.is_dir():
                    for f in sorted(sel_dir.iterdir()):
                        if f.is_file() and f.suffix.casefold() in image_exts:
                            images[sel].append({
                                "filename": f.name,
                                "preview_url": f"/api/submissions/{task_id}/build-images/{sel}/{f.name}?v={int(f.stat().st_mtime)}",
                                "size_bytes": f.stat().st_size,
                            })

        # 扫描 archives 压缩包
        archives = []
        archives_root = build_dir / "archives"
        if archives_root.is_dir():
            for f in sorted(archives_root.iterdir()):
                if f.is_file() and f.suffix.casefold() == ".zip":
                    archives.append({
                        "filename": f.name,
                        "download_url": f"/api/submissions/{task_id}/build-archives/{f.name}",
                        "size_bytes": f.stat().st_size,
                    })

        mosaic_options = {"enabled": True, "pixel_size": 10}
        if proc_config:
            mosaic_op = proc_config.operations.get("mosaic")
            if mosaic_op:
                mosaic_options["enabled"] = bool(mosaic_op.enabled)
                if mosaic_op.options:
                    mosaic_options["pixel_size"] = int(mosaic_op.options.get("pixel_size", 10))

        return {
            "has_build": True,
            "build_id": build_id,
            "output_dir": str(build_dir),
            "exported_at": exported_at,
            "manifest": manifest_data,
            "operations": operations,
            "mosaic_options": mosaic_options,
            "images": images,
            "archives": archives,
        }

    @app.get("/api/submissions/{task_id}/build-images/{selection}/{filename}")
    def get_build_image(task_id: str, selection: str, filename: str):
        from pathlib import Path
        from fastapi.responses import FileResponse
        from ..config import load_workspace
        from ..tasks.paths import TaskPaths

        if selection not in ("all", "post", "cover"):
            raise HTTPException(status_code=400, detail="Invalid selection")

        paths, _ = load_workspace(app.state.publishing_root)
        task_paths = TaskPaths.from_workspace(paths, task_id)
        latest_dir = task_paths.builds_root / "latest"
        build_dir = latest_dir if latest_dir.is_dir() else None
        if not build_dir and task_paths.builds_root.is_dir():
            candidates = [d for d in task_paths.builds_root.iterdir() if d.is_dir() and d.name != "history"]
            if candidates:
                candidates.sort(key=lambda d: d.stat().st_mtime, reverse=True)
                build_dir = candidates[0]

        if not build_dir:
            raise HTTPException(status_code=404, detail="Build not found")

        image_path = build_dir / "output" / selection / filename
        if not image_path.is_file():
            raise HTTPException(status_code=404, detail="Image not found in build")

        media_types = {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".webp": "image/webp",
        }
        media_type = media_types.get(image_path.suffix.casefold(), "application/octet-stream")
        return FileResponse(image_path, media_type=media_type, headers={"Cache-Control": "no-cache, must-revalidate"})

    @app.put("/api/submissions/{task_id}/build-images/{selection}/{filename}")
    async def update_build_image(task_id: str, selection: str, filename: str, req: Request):
        import io
        import os
        from pathlib import Path
        from PIL import Image
        from ..config import load_workspace
        from ..tasks.paths import TaskPaths

        if selection not in ("all", "post", "cover"):
            raise HTTPException(status_code=400, detail="Invalid selection")

        body = await req.body()
        if not body:
            raise HTTPException(status_code=400, detail="Empty image data")

        try:
            with Image.open(io.BytesIO(body)) as img:
                img.verify()
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Invalid image content: {exc}")

        paths, _ = load_workspace(app.state.publishing_root)
        task_paths = TaskPaths.from_workspace(paths, task_id)
        latest_dir = task_paths.builds_root / "latest"
        build_dir = latest_dir if latest_dir.is_dir() else None
        if not build_dir and task_paths.builds_root.is_dir():
            candidates = [d for d in task_paths.builds_root.iterdir() if d.is_dir() and d.name != "history"]
            if candidates:
                candidates.sort(key=lambda d: d.stat().st_mtime, reverse=True)
                build_dir = candidates[0]

        if not build_dir:
            raise HTTPException(status_code=404, detail="Build not found")

        output_root = build_dir / "output"
        updated_selections: list[str] = []
        if output_root.is_dir():
            for sel in ("all", "post", "cover"):
                target_file = output_root / sel / filename
                if target_file.is_file():
                    tmp_file = target_file.with_name(f".{target_file.name}.{os.getpid()}.tmp")
                    tmp_file.write_bytes(body)
                    os.replace(tmp_file, target_file)
                    updated_selections.append(sel)

        if not updated_selections:
            raise HTTPException(status_code=404, detail="Image not found in build")

        # 同步更新 zip 归档（如果存在）
        from ..packages.builder import _write_zip
        archives_root = build_dir / "archives"
        if archives_root.is_dir():
            for sel in updated_selections:
                archive = archives_root / f"{sel}.zip"
                if archive.is_file():
                    try:
                        _write_zip(archive, output_root / sel)
                    except Exception as exc:
                        logger.warning("同步更新 zip 归档失败: %s - %s", archive, exc)

        logger.info(
            "✏️ 手动打码保存: task_id=%s filename=%s 同步更新集合=%s (大小=%d 字节)",
            task_id,
            filename,
            updated_selections,
            len(body),
        )

        return {
            "success": True,
            "filename": filename,
            "selection": selection,
            "updated_selections": updated_selections,
            "size_bytes": len(body),
        }

    @app.get("/api/submissions/{task_id}/build-archives/{filename}")
    def get_build_archive(task_id: str, filename: str):
        from pathlib import Path
        from fastapi.responses import FileResponse
        from ..config import load_workspace
        from ..tasks.paths import TaskPaths

        paths, _ = load_workspace(app.state.publishing_root)
        task_paths = TaskPaths.from_workspace(paths, task_id)
        latest_dir = task_paths.builds_root / "latest"
        build_dir = latest_dir if latest_dir.is_dir() else None
        if not build_dir and task_paths.builds_root.is_dir():
            candidates = [d for d in task_paths.builds_root.iterdir() if d.is_dir() and d.name != "history"]
            if candidates:
                candidates.sort(key=lambda d: d.stat().st_mtime, reverse=True)
                build_dir = candidates[0]

        if not build_dir:
            raise HTTPException(status_code=404, detail="Build not found")

        archive_path = build_dir / "archives" / filename
        if not archive_path.is_file():
            raise HTTPException(status_code=404, detail="Archive not found")

        return FileResponse(
            archive_path,
            media_type="application/zip",
            filename=filename,
        )

    @app.post("/api/submissions/{task_id}/open-latest-build")
    def open_latest_submission_build(task_id: str):
        import os
        import subprocess
        from pathlib import Path
        from ..config import load_workspace
        from ..tasks.paths import TaskPaths

        paths, _ = load_workspace(app.state.publishing_root)
        task_paths = TaskPaths.from_workspace(paths, task_id)
        latest_dir = task_paths.builds_root / "latest"
        target_dir = latest_dir.resolve() if (latest_dir.is_symlink() or latest_dir.is_dir()) else None

        if not target_dir or not target_dir.is_dir():
            builds = sorted(
                [p for p in task_paths.builds_root.iterdir() if p.is_dir() and p.name.startswith("build-")],
                reverse=True,
            )
            if builds:
                target_dir = builds[0]

        if not target_dir or not target_dir.is_dir():
            history_root = task_paths.builds_root / "history"
            if history_root.is_dir():
                h_builds = sorted([p for p in history_root.iterdir() if p.is_dir()], reverse=True)
                if h_builds:
                    target_dir = h_builds[0]

        if not target_dir or not target_dir.is_dir():
            target_dir = task_paths.builds_root

        if not target_dir.is_dir():
            raise HTTPException(status_code=404, detail="导出目录不存在")

        if (target_dir / "output").is_dir():
            target_dir = target_dir / "output"

        resolved_str = str(target_dir.resolve())
        try:
            if os.name == "nt":
                subprocess.Popen(["explorer", resolved_str])
            else:
                subprocess.Popen(["xdg-open", resolved_str])
            return {"output_dir": resolved_str}
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"打开导出目录失败: {exc}")

    @app.post("/api/submissions/{task_id}/build-images/{selection}/{filename}/reveal")
    def reveal_submission_build_image(task_id: str, selection: str, filename: str):
        from pathlib import Path
        from ..config import load_workspace
        from ..tasks.paths import TaskPaths

        paths, _ = load_workspace(app.state.publishing_root)
        task_paths = TaskPaths.from_workspace(paths, task_id)

        latest_dir = task_paths.builds_root / "latest"
        build_dir = latest_dir.resolve() if (latest_dir.is_symlink() or latest_dir.is_dir()) else None
        if not build_dir or not build_dir.is_dir():
            builds = sorted(
                [p for p in task_paths.builds_root.iterdir() if p.is_dir() and p.name.startswith("build-")],
                reverse=True,
            )
            if builds:
                build_dir = builds[0]

        if not build_dir or not build_dir.is_dir():
            history_root = task_paths.builds_root / "history"
            if history_root.is_dir():
                h_builds = sorted([p for p in history_root.iterdir() if p.is_dir()], reverse=True)
                if h_builds:
                    build_dir = h_builds[0]

        if not build_dir or not build_dir.is_dir():
            raise HTTPException(status_code=404, detail="未找到构建产物")

        # 检查 images 目录或 output 目录中的实际文件
        file_path = build_dir / "images" / selection / filename
        if not file_path.is_file():
            file_path = build_dir / "output" / selection / filename

        if not file_path.is_file():
            raise HTTPException(status_code=404, detail=f"导出图片不存在：{filename}")

        resolved_path = str(file_path.resolve())
        try:
            if os.name == "nt":
                subprocess.Popen(["explorer", f"/select,{resolved_path}"])
            else:
                subprocess.Popen(["xdg-open", str(file_path.parent.resolve())])
            return {"success": True, "path": resolved_path}
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"打开文件所在文件夹失败: {exc}")

    @app.get("/api/favorites")
    def get_favorites(import_id: str | None = None, import_ids: str | None = None):
        from ..catalog.repository import CatalogRepository
        from ..config import load_workspace

        paths, _ = load_workspace(app.state.publishing_root)
        catalog = CatalogRepository(paths.catalog, backups_dir=paths.backups)
        marks_map = catalog.all_asset_marks()
        fav_ids = [asset_id for asset_id, marks in marks_map.items() if "favorite" in marks]

        parsed_import_ids: list[str] | None = None
        if import_ids:
            try:
                raw_ids = json.loads(import_ids)
                if isinstance(raw_ids, list):
                    parsed_import_ids = [str(x).strip() for x in raw_ids if str(x).strip() and str(x).strip() != "__all__"]
                elif isinstance(raw_ids, str):
                    parsed_import_ids = [x.strip() for x in raw_ids.split(",") if x.strip() and x.strip() != "__all__"]
            except Exception:
                parsed_import_ids = [x.strip() for x in import_ids.split(",") if x.strip() and x.strip() != "__all__"]
        elif import_id and import_id != "__all__":
            parsed_import_ids = [import_id.strip()]

        if parsed_import_ids:
            with catalog.connection() as conn:
                placeholders = ",".join("?" for _ in parsed_import_ids)
                rows = conn.execute(
                    f"SELECT asset_id FROM import_items WHERE import_id IN ({placeholders})",
                    parsed_import_ids,
                ).fetchall()
                snapshot_assets = {r["asset_id"] for r in rows if r["asset_id"]}
            fav_ids = [aid for aid in fav_ids if aid in snapshot_assets]
        return {"favorites": fav_ids}

    @app.post("/api/favorites/toggle")
    async def toggle_favorite_mark(req: Request):
        from ..catalog.repository import CatalogRepository
        from ..config import load_workspace

        body = await req.json()
        asset_id = str(body.get("asset_id", "")).strip()
        favorited = bool(body.get("favorited", True))
        if not asset_id:
            raise HTTPException(status_code=422, detail="asset_id 不能为空")

        paths, _ = load_workspace(app.state.publishing_root)
        catalog = CatalogRepository(paths.catalog, backups_dir=paths.backups)
        if favorited:
            catalog.set_asset_marks([asset_id], mark="favorite", note="Web UI favorite")
        else:
            with catalog.connection() as conn:
                conn.execute(
                    "DELETE FROM asset_marks WHERE asset_id=? AND mark='favorite'", (asset_id,)
                )
                conn.commit()
        return {"asset_id": asset_id, "favorited": favorited}

    def _extract_image_file_metadata(p: Path) -> dict[str, Any]:
        import datetime
        from PIL import Image
        from ..png_metadata import read_png_text_chunks

        gen_info: dict[str, Any] = {
            "file_size": 0,
            "file_size_human": "-",
            "modified_at": "-",
            "width": 0,
            "height": 0,
            "image_format": "PNG",
            "prompt": "",
            "negative_prompt": "",
            "seed": None,
            "model": "",
            "sampler": "",
            "steps": None,
            "scale": None,
            "noise_schedule": "",
            "software": "",
            "raw_parameters": "",
            "all_chunks": {},
        }

        if not p.is_file():
            return gen_info

        try:
            stat = p.stat()
            gen_info["file_size"] = stat.st_size
            size_mb = stat.st_size / (1024 * 1024)
            gen_info["file_size_human"] = (
                f"{size_mb:.2f} MB" if size_mb >= 1 else f"{stat.st_size / 1024:.1f} KB"
            )
            gen_info["modified_at"] = datetime.datetime.fromtimestamp(stat.st_mtime).strftime(
                "%Y-%m-%d %H:%M:%S"
            )
        except Exception:
            pass

        try:
            with Image.open(p) as img:
                gen_info["width"] = img.width
                gen_info["height"] = img.height
                gen_info["image_format"] = img.format or "PNG"
        except Exception:
            pass

        try:
            chunks = read_png_text_chunks(p)
            gen_info["all_chunks"] = chunks
            gen_info["software"] = chunks.get("Software", "")
            gen_info["model"] = chunks.get("Source", "")

            if "Comment" in chunks:
                try:
                    import json
                    comment_obj = json.loads(chunks["Comment"])
                    if isinstance(comment_obj, dict):
                        gen_info["prompt"] = comment_obj.get("prompt") or chunks.get("Description", "")
                        gen_info["negative_prompt"] = comment_obj.get("uc") or comment_obj.get("negative_prompt", "")
                        gen_info["seed"] = comment_obj.get("seed")
                        gen_info["steps"] = comment_obj.get("steps")
                        gen_info["scale"] = comment_obj.get("scale")
                        gen_info["sampler"] = comment_obj.get("sampler")
                        gen_info["noise_schedule"] = comment_obj.get("noise_schedule")
                        if not gen_info["model"]:
                            gen_info["model"] = comment_obj.get("model", "")
                except Exception:
                    gen_info["raw_parameters"] = chunks["Comment"]

            if not gen_info["prompt"] and "parameters" in chunks:
                raw = chunks["parameters"]
                gen_info["raw_parameters"] = raw
                lines = raw.split("\n")
                prompt_lines = []
                neg_lines = []
                param_line = ""
                mode = "prompt"
                for line in lines:
                    if line.startswith("Negative prompt:"):
                        mode = "neg"
                        neg_lines.append(line.replace("Negative prompt:", "").strip())
                    elif mode == "neg" and ("Steps:" in line or "Sampler:" in line):
                        param_line = line
                        mode = "params"
                    elif mode == "prompt" and ("Steps:" in line or "Sampler:" in line):
                        param_line = line
                        mode = "params"
                    elif mode == "prompt":
                        prompt_lines.append(line)
                    elif mode == "neg":
                        neg_lines.append(line)
                gen_info["prompt"] = "\n".join(prompt_lines).strip()
                gen_info["negative_prompt"] = "\n".join(neg_lines).strip()

                if param_line:
                    for part in param_line.split(","):
                        if ":" in part:
                            k, v = part.split(":", 1)
                            k = k.strip().lower()
                            v = v.strip()
                            if k == "seed": gen_info["seed"] = v
                            elif k == "steps": gen_info["steps"] = v
                            elif k == "sampler": gen_info["sampler"] = v
                            elif k == "cfg scale": gen_info["scale"] = v
                            elif k == "model": gen_info["model"] = v

            if not gen_info["prompt"] and "Description" in chunks:
                gen_info["prompt"] = chunks["Description"]
        except Exception:
            pass

        return gen_info

    @app.get("/api/submissions/{task_id}/build-images/{selection}/{filename}/details")
    def get_submission_build_image_details(task_id: str, selection: str, filename: str):
        from pathlib import Path
        from ..config import load_workspace
        from ..tasks.paths import TaskPaths

        paths, _ = load_workspace(app.state.publishing_root)
        task_paths = TaskPaths.from_workspace(paths, task_id)

        latest_dir = task_paths.builds_root / "latest"
        build_dir = latest_dir.resolve() if (latest_dir.is_symlink() or latest_dir.is_dir()) else None
        if not build_dir or not build_dir.is_dir():
            builds = sorted(
                [p for p in task_paths.builds_root.iterdir() if p.is_dir() and p.name.startswith("build-")],
                reverse=True,
            )
            if builds:
                build_dir = builds[0]

        if not build_dir or not build_dir.is_dir():
            history_root = task_paths.builds_root / "history"
            if history_root.is_dir():
                h_builds = sorted([p for p in history_root.iterdir() if p.is_dir()], reverse=True)
                if h_builds:
                    build_dir = h_builds[0]

        if not build_dir or not build_dir.is_dir():
            raise HTTPException(status_code=404, detail="未找到构建产物")

        file_path = build_dir / "images" / selection / filename
        if not file_path.is_file():
            file_path = build_dir / "output" / selection / filename

        if not file_path.is_file():
            raise HTTPException(status_code=404, detail=f"导出图片不存在：{filename}")

        meta = _extract_image_file_metadata(file_path)
        return {
            "filename": filename,
            "path": str(file_path.resolve()),
            "width": meta["width"],
            "height": meta["height"],
            "image_format": meta["image_format"],
            "generation_info": meta,
        }

    @app.get("/api/assets/{asset_id}/details")
    def get_asset_details(asset_id: str):
        from ..catalog.repository import CatalogRepository
        from ..config import load_workspace

        paths, config = load_workspace(app.state.publishing_root)
        catalog = CatalogRepository(paths.catalog, backups_dir=paths.backups)
        assets = catalog.assets_by_ids([asset_id])
        asset = assets.get(asset_id)
        if asset is None:
            raise HTTPException(status_code=404, detail="找不到资产记录")

        p = Path(asset.path)
        gen_info = _extract_image_file_metadata(p)

        marks = catalog.all_asset_marks().get(asset_id, [])
        is_fav = "favorite" in marks
        is_posted = any(m == "posted" or m.startswith("posted:") for m in marks)
        tags = [m[4:] for m in marks if m.startswith("tag:")]
        snapshots = catalog.snapshots_for_asset(asset_id)

        return {
            "asset_id": asset.asset_id,
            "path": str(asset.path),
            "display_name": asset.display_name,
            "width": asset.image.width if asset.image else gen_info["width"],
            "height": asset.image.height if asset.image else gen_info["height"],
            "image_format": asset.image.format if asset.image else gen_info["image_format"],
            "is_favorited": is_fav,
            "is_posted": is_posted,
            "marks": marks,
            "tags": tags,
            "snapshots": snapshots,
            "generation_info": gen_info,
        }

    @app.get("/api/assets/{asset_id}/snapshots")
    def get_asset_snapshots(asset_id: str):
        from ..catalog.repository import CatalogRepository
        from ..config import load_workspace

        paths, _ = load_workspace(app.state.publishing_root)
        catalog = getattr(app.state, "catalog", None) or CatalogRepository(paths.catalog, backups_dir=paths.backups)
        return {"asset_id": asset_id, "snapshots": catalog.snapshots_for_asset(asset_id)}

    @app.post("/api/assets/{asset_id}/reveal")
    def reveal_asset_file(asset_id: str):
        from ..catalog.repository import CatalogRepository
        from ..config import load_workspace

        paths, _ = load_workspace(app.state.publishing_root)
        catalog = CatalogRepository(paths.catalog, backups_dir=paths.backups)
        assets = catalog.assets_by_ids([asset_id])
        asset = assets.get(asset_id)
        if asset is None or not Path(asset.path).is_file():
            raise HTTPException(status_code=404, detail="文件不存在或不可用")

        resolved_path = str(Path(asset.path).resolve())
        try:
            if os.name == "nt":
                subprocess.Popen(["explorer", f"/select,{resolved_path}"])
            else:
                subprocess.Popen(["xdg-open", str(Path(asset.path).parent.resolve())])
            return {"success": True, "path": resolved_path}
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"打开文件所在文件夹失败: {exc}")

    @app.post("/api/assets/{asset_id}/toggle-posted")
    async def toggle_asset_posted(asset_id: str, req: Request):
        from ..catalog.repository import CatalogRepository
        from ..config import load_workspace

        body = await req.json()
        posted = bool(body.get("posted", True))

        paths, _ = load_workspace(app.state.publishing_root)
        catalog = CatalogRepository(paths.catalog, backups_dir=paths.backups)
        if posted:
            catalog.set_asset_marks([asset_id], mark="posted", note="Web UI manual mark")
        else:
            with catalog.connection() as conn:
                conn.execute(
                    "DELETE FROM asset_marks WHERE asset_id=? AND (mark='posted' OR mark LIKE 'posted:%')",
                    (asset_id,),
                )
                conn.commit()
        return {"asset_id": asset_id, "posted": posted}

    @app.post("/api/assets/{asset_id}/inpaint")
    async def generate_asset_inpaint(asset_id: str, req: Request):
        import base64
        from ..config import load_workspace
        from ..inpaint.models import InpaintGenerateRequest
        from ..inpaint.service import InpaintService

        body = await req.json()
        payload = InpaintGenerateRequest.model_validate(body)

        mask_raw = payload.mask_base64
        if "," in mask_raw:
            mask_raw = mask_raw.split(",", 1)[1]
        try:
            mask_bytes = base64.b64decode(mask_raw)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Mask base64 解码失败: {exc}")

        if not mask_bytes:
            raise HTTPException(status_code=400, detail="Mask 数据不能为空")

        paths, _ = load_workspace(app.state.publishing_root)
        service = InpaintService()
        try:
            res = await service.generate(
                paths=paths,
                asset_id=asset_id,
                mask_bytes=mask_bytes,
                prompt=payload.prompt,
                negative_prompt=payload.negative_prompt,
                strength=payload.strength,
                count=payload.count,
            )
            return res.model_dump(mode="json")
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc))
        except Exception as exc:
            logger.error("AI 局部重绘生成失败: %s", exc)
            raise HTTPException(status_code=500, detail=f"局部重绘生成失败: {exc}")

    @app.get("/api/inpaint-cache/{session_id}/{filename}")
    def get_inpaint_cache_image(session_id: str, filename: str):
        from ..config import load_workspace

        paths, _ = load_workspace(app.state.publishing_root)
        cache_file = paths.root / "tmp" / "inpaint" / session_id / filename
        if not cache_file.is_file():
            raise HTTPException(status_code=404, detail="未找到候选图片")

        return FileResponse(cache_file, media_type="image/png", headers={"Cache-Control": "no-cache"})

    @app.post("/api/assets/{asset_id}/inpaint/apply")
    async def apply_asset_inpaint(asset_id: str, req: Request):
        from ..config import load_workspace
        from ..inpaint.models import ApplyCandidateRequest
        from ..inpaint.service import InpaintService

        body = await req.json()
        payload = ApplyCandidateRequest.model_validate(body)

        paths, _ = load_workspace(app.state.publishing_root)
        service = InpaintService()
        try:
            res = service.apply_candidate(
                paths=paths,
                asset_id=asset_id,
                session_id=payload.session_id,
                candidate_id=payload.candidate_id,
            )
            return res
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc))
        except Exception as exc:
            logger.error("应用重绘候选图失败: %s", exc)
            raise HTTPException(status_code=500, detail=f"应用重绘结果失败: {exc}")

    @app.delete("/api/inpaint-cache/{session_id}")
    def cleanup_inpaint_cache(session_id: str):
        from ..config import load_workspace
        from ..inpaint.service import InpaintService

        paths, _ = load_workspace(app.state.publishing_root)
        service = InpaintService()
        service.cleanup_session(paths, session_id)
        return {"success": True, "session_id": session_id}

