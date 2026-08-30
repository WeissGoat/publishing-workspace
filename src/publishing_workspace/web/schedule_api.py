import asyncio
import json
import time
from datetime import date
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager

from pydantic import BaseModel, Field

from ..catalog.repository import CatalogRepository
from ..config import load_workspace
from ..export_jobs.service import ExportJobService
from ..plans.models import ScheduleEntry
from ..plans.repository import PlanRevisionConflictError
from ..plans.search import AssetSearchFilter, AssetSearchService, NodeSearchService
from ..plans.service import PlanLockedError, PlanValidationError
from ..service import PublishingService
from ..tasks.paths import TaskPaths
from ..tasks.repository import TaskRepository
from ..logging import get_logger
from .library_api import register_library_routes


logger = get_logger(__name__)


class EntryMutation(BaseModel):
    revision: int | None = Field(default=None, ge=1)
    entry: ScheduleEntry


class DateMutation(BaseModel):
    revision: int | None = Field(default=None, ge=1)
    target_date: date


class RevisionMutation(BaseModel):
    revision: int | None = Field(default=None, ge=1)


def create_app(root: str | Path, *, export_jobs: ExportJobService | None = None) -> FastAPI:
    publishing_root = Path(root).expanduser().resolve()
    jobs_service = export_jobs if export_jobs is not None else ExportJobService()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        recovered = jobs_service.recover_interrupted(publishing_root)
        if recovered:
            logger.warning("Web 启动时恢复中断导出：count=%s", recovered)

        async def _warmup():
            search_service = AssetSearchService()
            catalog = getattr(app.state, "catalog", None)
            # 阶段 1：首屏核心活跃快照与使用索引快速就绪（耗时约 0.2~0.5s）
            try:
                t0 = time.perf_counter()
                logger.info("Web 正在预热首屏素材检索索引与节点缓存...")
                await asyncio.to_thread(
                    search_service.preload_fast, publishing_root, catalog=catalog
                )
                logger.info("Web 首屏素材检索索引就绪 (耗时: %.2fs)", time.perf_counter() - t0)
            except Exception as exc:
                logger.warning("Web 首屏素材检索索引预热跳过：%s", exc)

            # 阶段 2：避峰静默等待（等待 3.5 秒，让前端首屏并发获取资源完全不受干扰）
            try:
                await asyncio.sleep(3.5)
            except asyncio.CancelledError:
                return

            # 阶段 3：多阶段空闲温和后台预热剩余历史快照
            try:
                paths, _ = load_workspace(publishing_root)
                catalog_inst = catalog or CatalogRepository(paths.catalog, backups_dir=paths.backups)
                sources = catalog_inst.import_sources()
                remaining = sources[1:]
                if remaining:
                    logger.info("Web 开始后台空闲预热 %d 个历史快照...", len(remaining))
                    for idx, (imp_id, _) in enumerate(remaining, 1):
                        try:
                            t_snap = time.perf_counter()
                            await asyncio.to_thread(
                                search_service.preload_snapshot,
                                publishing_root,
                                imp_id,
                                catalog=catalog_inst,
                            )
                            logger.info(
                                "Web 空闲预热快照 (%d/%d): id=%s (耗时: %.2fs)",
                                idx, len(remaining), imp_id[:8], time.perf_counter() - t_snap
                            )
                        except Exception as exc:
                            logger.info("Web 空闲预热快照跳过: id=%s (%s)", imp_id[:8], exc)

                        # 协作式休眠让步，释放 GIL 锁与磁盘 I/O
                        await asyncio.sleep(0.5)

                    # 阶段 4：所有单快照已在内存中，秒级无盘拼接出全量聚合（__all__）索引
                    try:
                        await asyncio.to_thread(
                            search_service.preload_all_aggregated,
                            publishing_root,
                            catalog=catalog_inst,
                        )
                        logger.info("Web 全部历史快照后台空闲预热完成 (共 %d 个快照已常驻内存)", len(sources))
                    except Exception as exc:
                        logger.debug("Web 全量聚合缓存预热跳过：%s", exc)
            except asyncio.CancelledError:
                return
            except Exception as exc:
                logger.warning("Web 历史快照后台空闲预热跳过：%s", exc)

        async def _schedule_daemon():
            from ..plans.executor import SubmissionExecutor

            executor = SubmissionExecutor()
            # 启动时先等待 3 秒完成基础初始化，然后开始周期性到期与延迟补偿扫描
            await asyncio.sleep(3)
            while True:
                try:
                    await asyncio.to_thread(executor.run_due, publishing_root)
                except asyncio.CancelledError:
                    break
                except Exception as exc:
                    logger.error("定时投稿后台调度轮询异常：%s", exc)
                try:
                    await asyncio.sleep(60)
                except asyncio.CancelledError:
                    break

        warmup_task = asyncio.create_task(_warmup())
        schedule_task = asyncio.create_task(_schedule_daemon())
        try:
            yield
        finally:
            if not warmup_task.done():
                warmup_task.cancel()
            if not schedule_task.done():
                schedule_task.cancel()
            jobs_service.close(wait=True)

    app = FastAPI(
        title="Publishing Workspace Schedule API",
        lifespan=lifespan,
    )
    paths, config = load_workspace(publishing_root)
    app.state.publishing_root = publishing_root
    app.state.workspace_paths = paths
    app.state.workspace_config = config
    app.state.catalog = CatalogRepository(paths.catalog, backups_dir=paths.backups)
    app.state.export_jobs = jobs_service

    @app.exception_handler(PlanRevisionConflictError)
    async def revision_conflict(_, exc: PlanRevisionConflictError):
        return _json_error(409, "plan_revision_conflict", str(exc))

    @app.exception_handler(PlanLockedError)
    async def locked_plan(_, exc: PlanLockedError):
        return _json_error(409, "plan_locked", str(exc))

    @app.exception_handler(PlanValidationError)
    async def invalid_plan(_, exc: PlanValidationError):
        return _json_error(422, "plan_validation_error", str(exc))

    @app.exception_handler(KeyError)
    async def missing_resource(_, exc: KeyError):
        return _json_error(404, "not_found", str(exc))

    @app.exception_handler(ValueError)
    async def invalid_request(_, exc: ValueError):
        return _json_error(422, "invalid_request", str(exc))

    @app.exception_handler(FileExistsError)
    async def resource_exists(_, exc: FileExistsError):
        return _json_error(409, "already_exists", str(exc))

    @app.post("/api/plans/{month}")
    def create_plan(month: str, default_import_id: str | None = None):
        return PublishingService().schedule_create(
            app.state.publishing_root,
            month,
            default_import_id=default_import_id,
        ).model_dump(mode="json", by_alias=True)

    @app.get("/api/plans/{month}")
    def get_plan(month: str):
        return PublishingService().schedule_show(app.state.publishing_root, month).model_dump(
            mode="json", by_alias=True
        )

    @app.post("/api/plans/{month}/entries")
    def add_entry(month: str, payload: EntryMutation):
        return PublishingService().schedule_add_entry(
            app.state.publishing_root,
            month,
            payload.entry,
            expected_revision=payload.revision,
        ).model_dump(mode="json", by_alias=True)

    @app.put("/api/plans/{month}/entries/{entry_id}")
    def update_entry(month: str, entry_id: str, payload: EntryMutation):
        if payload.entry.entry_id != entry_id:
            raise ValueError("URL entry_id 与 body entry_id 不一致")
        return PublishingService().schedule_update_entry(
            app.state.publishing_root,
            month,
            payload.entry,
            expected_revision=payload.revision,
        ).model_dump(mode="json", by_alias=True)

    @app.patch("/api/plans/{month}/entries/{entry_id}/date")
    def move_entry_date(month: str, entry_id: str, payload: DateMutation):
        return PublishingService().schedule_move_date(
            app.state.publishing_root,
            month,
            entry_id,
            payload.target_date,
            expected_revision=payload.revision,
        ).model_dump(mode="json", by_alias=True)

    @app.delete("/api/plans/{month}/entries/{entry_id}")
    def delete_entry(month: str, entry_id: str, revision: int | None = Query(default=None, ge=1)):
        return PublishingService().schedule_delete_entry(
            app.state.publishing_root,
            month,
            entry_id,
            expected_revision=revision,
        ).model_dump(mode="json", by_alias=True)

    @app.post("/api/plans/{month}/lock")
    def lock_plan(month: str, payload: RevisionMutation):
        return PublishingService().schedule_lock(
            app.state.publishing_root,
            month,
            expected_revision=payload.revision,
        ).model_dump(mode="json", by_alias=True)

    @app.post("/api/plans/{month}/unlock")
    def unlock_plan(month: str, payload: RevisionMutation):
        return PublishingService().schedule_unlock(
            app.state.publishing_root,
            month,
            expected_revision=payload.revision,
        ).model_dump(mode="json", by_alias=True)

    @app.get("/api/assets/search")
    def search_assets(
        import_id: str | None = None,
        text: str = "",
        artist: str | None = None,
        character: str | None = None,
        action_group: str | None = None,
        action: str | None = None,
        facets: str | None = None,
        sort_by: str = "order_asc",
        limit: int = Query(default=100, ge=1, le=1000),
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
        query = AssetSearchFilter(
            import_id=import_id,
            text=text,
            artist=artist,
            character=character,
            action_group=action_group,
            action=action,
            facets=parsed_facets,
            sort_by=sort_by,
            limit=limit,
        )
        return [
            item.model_dump(mode="json")
            for item in AssetSearchService().search(app.state.publishing_root, query)
        ]

    @app.get("/api/nodes")
    def search_nodes(
        role: str,
        q: str = "",
        import_id: str | None = None,
        import_ids: str | None = None,
        offset: int = Query(default=0, ge=0),
        limit: int = Query(default=20, ge=1, le=100),
    ):
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

        return NodeSearchService().search(
            app.state.publishing_root,
            role=role,
            query=q,
            import_id=import_id,
            import_ids=parsed_import_ids,
            offset=offset,
            limit=limit,
        ).model_dump(mode="json", by_alias=True)

    @app.get("/api/assets/facets")
    def asset_facets(import_id: str | None = None, import_ids: str | None = None):
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

        return AssetSearchService().facets(app.state.publishing_root, import_id=import_id, import_ids=parsed_import_ids)

    @app.get("/api/imports")
    def list_imports():
        catalog = getattr(app.state, "catalog", None)
        if catalog is None:
            paths, _ = load_workspace(app.state.publishing_root)
            catalog = CatalogRepository(paths.catalog, backups_dir=paths.backups)
            app.state.catalog = catalog
        return catalog.list_imports_summary()

    @app.get("/api/tags")
    def list_tags():
        catalog = getattr(app.state, "catalog", None)
        if catalog is None:
            paths, _ = load_workspace(app.state.publishing_root)
            catalog = CatalogRepository(paths.catalog, backups_dir=paths.backups)
            app.state.catalog = catalog
        return catalog.get_all_tags()

    @app.get("/api/tasks")
    def list_tasks():
        """返回可被月历引用的已有投稿任务，不读取任务选择图片。"""
        paths = getattr(app.state, "workspace_paths", None)
        if paths is None:
            paths, _ = load_workspace(app.state.publishing_root)
        tasks_root = paths.tasks
        if not tasks_root.is_dir():
            return []
        result = []
        for task_root in sorted(tasks_root.iterdir(), key=lambda item: item.name.casefold()):
            if not task_root.is_dir() or not (task_root / "task.yaml").is_file():
                continue
            try:
                task = TaskRepository.load(TaskPaths.from_workspace(paths, task_root.name))
            except (OSError, UnicodeError, ValueError) as exc:
                logger.warning("Web 任务列表跳过损坏任务：%s：%s", task_root, exc)
                continue
            result.append({"task_id": task.task_id, "title": task.title})
        return result

    @app.get("/api/assets/{asset_id}/preview")
    def asset_preview(asset_id: str):
        catalog = getattr(app.state, "catalog", None)
        if catalog is None:
            paths, _ = load_workspace(app.state.publishing_root)
            catalog = CatalogRepository(paths.catalog, backups_dir=paths.backups)
            app.state.catalog = catalog
        path = catalog.get_asset_path(asset_id)
        if path is None or not Path(path).is_file():
            raise KeyError(f"Catalog 中找不到可预览资产：{asset_id}")
        return FileResponse(path)

    register_library_routes(app)

    static_root = Path(__file__).with_name("static")
    if static_root.is_dir():
        if (static_root / "calendar.html").is_file():
            @app.get("/calendar", include_in_schema=False)
            def calendar_page():
                return FileResponse(static_root / "calendar.html")

            @app.get("/", include_in_schema=False)
            def root_calendar_page():
                return FileResponse(static_root / "calendar.html")
        elif (static_root / "schedule.html").is_file():
            @app.get("/", include_in_schema=False)
            def schedule_page():
                return FileResponse(static_root / "schedule.html")

        if (static_root / "library.html").is_file():
            @app.get("/library", include_in_schema=False)
            def library_page():
                return FileResponse(static_root / "library.html")

        app.mount("/", StaticFiles(directory=static_root, html=True), name="static")

    return app


def _json_error(status_code: int, code: str, message: str):
    from fastapi.responses import JSONResponse

    return JSONResponse(
        status_code=status_code,
        content={"detail": {"code": code, "message": message}},
    )
