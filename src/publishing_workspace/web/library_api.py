from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from ..catalog.repository import CatalogRepository
from ..config import load_workspace
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
from ..submissions.service import SubmissionService


class PixivPublishRequest(BaseModel):
    force_rebuild: bool = False
    force_republish: bool = False


class SubmissionMutation(BaseModel):
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
) -> None:
    from datetime import datetime
    from zoneinfo import ZoneInfo
    from ..plans.models import ScheduleEntry, TaskContent
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

        if existing_entry is not None:
            new_entry = ScheduleEntry(
                entry_id=existing_entry.entry_id,
                scheduled_at=dt,
                title=title or existing_entry.title,
                content=TaskContent(task_id=task_id),
                execution=existing_entry.execution,
            )
            svc.schedule_update_entry(root, month_str, new_entry, expected_revision=plan.revision)
        else:
            new_entry = ScheduleEntry(
                entry_id=f"entry-{task_id}",
                scheduled_at=dt,
                title=title,
                content=TaskContent(task_id=task_id),
            )
            svc.schedule_add_entry(root, month_str, new_entry, expected_revision=plan.revision)
    except Exception:
        pass


def _find_task_scheduled_at(root: Path, task_id: str) -> str | None:
    from ..plans.models import TaskContent
    from ..service import PublishingService
    from ..config import load_workspace

    paths, _ = load_workspace(root)
    if not paths.plans.is_dir():
        return None

    try:
        for plan_dir in paths.plans.iterdir():
            if plan_dir.is_dir() and (plan_dir / "plan.yaml").is_file():
                try:
                    plan = PublishingService().schedule_show(root, plan_dir.name)
                    for e in plan.entries:
                        if isinstance(e.content, TaskContent) and e.content.task_id == task_id:
                            return e.scheduled_at.isoformat()
                except Exception:
                    pass
    except Exception:
        pass
    return None


def register_library_routes(app: FastAPI) -> None:
    """注册素材库与 Submission 相关的 HTTP API。"""

    @app.get("/api/library/assets")
    def search_library_assets(
        offset: int = Query(default=0, ge=0),
        limit: int = Query(default=60, ge=1, le=200),
        import_id: str | None = None,
        text: str = "",
        artist: str | None = None,
        character: str | None = None,
        action_group: str | None = None,
        action: str | None = None,
        facets: str | None = None,
        posted: bool | None = None,
        favorite_mode: str = "all",
        favorite_ids: str | None = None,
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

        fav_mode = favorite_mode if favorite_mode in {"all", "favorited", "unfavorited"} else "all"

        filters = AssetSearchFilter(
            offset=offset,
            limit=limit,
            import_id=import_id,
            text=text,
            artist=artist,
            character=character,
            action_group=action_group,
            action=action,
            facets=parsed_facets,
            posted=posted,
            favorite_mode=fav_mode,
            favorite_ids=parsed_fav_ids,
        )
        return AssetSearchService().search_page(
            app.state.publishing_root, filters
        ).model_dump(mode="json", by_alias=True)

    @app.get("/api/library/facets")
    def library_facets(import_id: str | None = None):
        return AssetSearchService().facets(app.state.publishing_root, import_id=import_id)

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
            sub["scheduled_at"] = _find_task_scheduled_at(app.state.publishing_root, task_id)
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
                task_id=None,
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
        return {
            "success": True,
            "task_id": result.task_id,
            "illust_id": result.illust_id,
            "pixiv_url": result.pixiv_url,
            "published_at": result.published_at,
            "message": f"发布成功！作品 PID: {result.illust_id}",
        }

    # 导出作业相关路由
    @app.post("/api/submissions/{task_id}/exports")
    async def start_task_export(task_id: str, req: Request):
        try:
            body = await req.json()
        except Exception:
            body = {}

        enable_mosaic = body.get("enable_mosaic")
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
                        },
                    )
                    TaskRepository.save(task_paths, task_config)
            except Exception as e:
                logger.warning("更新任务打码配置失败：%s", e)

        try:
            job = app.state.export_jobs.start(app.state.publishing_root, task_id, enable_mosaic=enable_mosaic)
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
                parts = opts.get("parts", ["penis", "pussy"])
                parts_str = ", ".join(parts) if isinstance(parts, list) else str(parts)
                operations.append({
                    "name": "mosaic",
                    "title": "AI 智能自动打码 (Auto Mosaic)",
                    "enabled": True,
                    "description": f"已启用自动打码：检测器 [{detector}]，方式 [{method}]，检测部位 [{parts_str}]",
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

        return {
            "has_build": True,
            "build_id": build_id,
            "output_dir": str(build_dir),
            "exported_at": exported_at,
            "manifest": manifest_data,
            "operations": operations,
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

        target_file = build_dir / "output" / selection / filename
        if not target_file.is_file():
            raise HTTPException(status_code=404, detail="Image not found in build")

        tmp_file = target_file.with_name(f".{target_file.name}.tmp")
        tmp_file.write_bytes(body)
        os.replace(tmp_file, target_file)

        return {
            "success": True,
            "filename": filename,
            "selection": selection,
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
    def get_favorites(import_id: str | None = None):
        from ..catalog.repository import CatalogRepository
        from ..config import load_workspace

        paths, _ = load_workspace(app.state.publishing_root)
        catalog = CatalogRepository(paths.catalog, backups_dir=paths.backups)
        marks_map = catalog.all_asset_marks()
        fav_ids = [asset_id for asset_id, marks in marks_map.items() if "favorite" in marks]
        if import_id and import_id != "__all__":
            with catalog.connection() as conn:
                rows = conn.execute(
                    "SELECT asset_id FROM import_items WHERE import_id=?", (import_id,)
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
            "generation_info": gen_info,
        }

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
