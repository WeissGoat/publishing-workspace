from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from ..catalog.repository import CatalogRepository
from ..config import load_workspace
from ..logging import get_logger
from ..packages.builder import PackageBuilder
from ..packages.models import BuildManifest, BuildResult
from ..submissions.pixiv_uploader import PixivUploadService
from ..submissions.repository import SubmissionRepository
from ..tasks.paths import TaskPaths
from ..tasks.service import TaskWorkflowService
from .materializer import InlineTaskMaterializer, MaterializedPlanTask
from .models import ExecutionRecord, InlineContent, MonthlyPlan, ScheduleEntry, TaskContent
from .notifier import ConsoleNotifier, Notifier, NotificationResult, SubmissionEvent
from .paths import PlanPaths
from .repository import PlanRepository


logger = get_logger(__name__)
_LOGGED_OVERDUE_ENTRIES: set[tuple[str, str]] = set()


class SubmissionExecutor:
    _last_publish_time: datetime | None = None

    @classmethod
    def set_last_publish_time(cls, dt: datetime | None) -> None:
        cls._last_publish_time = dt

    @classmethod
    def get_last_publish_time(cls) -> datetime | None:
        return cls._last_publish_time

    def __init__(
        self,
        *,
        notifier: Notifier | None = None,
        repository: PlanRepository | None = None,
        builder: PackageBuilder | None = None,
        materializer: InlineTaskMaterializer | None = None,
        pixiv_uploader: PixivUploadService | None = None,
    ):
        self.notifier = notifier or ConsoleNotifier()
        self.repository = repository or PlanRepository()
        self.builder = builder or PackageBuilder()
        self.materializer = materializer or InlineTaskMaterializer()
        self.pixiv_uploader = pixiv_uploader or PixivUploadService()

    def run_due(
        self,
        root: str | Path,
        *,
        now: datetime | None = None,
        max_delay_minutes: int | None = None,
    ) -> list[ExecutionRecord]:
        current_time = now or datetime.now(timezone.utc)
        _require_aware(current_time)
        paths, config = load_workspace(root)
        cooldown_minutes = getattr(config.pixiv, "publish_cooldown_minutes", 10)
        cooldown_seconds = cooldown_minutes * 60

        allowed_delay_minutes = (
            max_delay_minutes
            if max_delay_minutes is not None
            else getattr(config.pixiv, "schedule_max_delay_minutes", 240)
        )
        records: list[ExecutionRecord] = []
        if not paths.plans.is_dir():
            return records
        for plan_root in sorted(paths.plans.iterdir(), key=lambda item: item.name):
            if not plan_root.is_dir():
                continue
            try:
                plan_paths = PlanPaths.from_workspace(paths, plan_root.name)
                plan = self.repository.load(plan_paths)
            except (OSError, UnicodeError, ValueError) as exc:
                logger.error("到期扫描跳过损坏计划：%s：%s", plan_root, exc)
                continue
            for entry in sorted(plan.entries, key=lambda item: item.scheduled_at):
                if not entry.execution.build_on_due or entry.scheduled_at > current_time:
                    continue

                # 延迟容差检查：仅对开启了自动发布 (publish=True) 的条目进行延迟窗口拦截，避免重启后误发很久以前的过期投稿
                elapsed_seconds = (current_time - entry.scheduled_at).total_seconds()
                if entry.execution.publish or max_delay_minutes is not None:
                    if max_delay_minutes is not None:
                        entry_allowed_delay = max_delay_minutes
                    elif getattr(entry.execution, "allow_delay", False):
                        entry_allowed_delay = (
                            entry.execution.max_delay_minutes
                            if getattr(entry.execution, "max_delay_minutes", 0) > 0
                            else getattr(config.pixiv, "schedule_max_delay_minutes", 240)
                        )
                    else:
                        # 默认准时投稿模式：允许冷却缓冲（cooldown_minutes + 5 分钟），过期不补发
                        entry_allowed_delay = max(3, cooldown_minutes + 5)

                    if entry_allowed_delay >= 0 and elapsed_seconds > entry_allowed_delay * 60:
                        entry_key = (plan.plan_id, entry.entry_id)
                        if entry_key not in _LOGGED_OVERDUE_ENTRIES:
                            _LOGGED_OVERDUE_ENTRIES.add(entry_key)
                            logger.info(
                                "到期扫描跳过超时投稿（已归档，后续周期静默跳过）：plan_id=%s entry_id=%s 已超时 %.1f 分钟 (当前容差 %d 分钟, 准时模式=%s)",
                                plan.plan_id,
                                entry.entry_id,
                                elapsed_seconds / 60,
                                entry_allowed_delay,
                                not getattr(entry.execution, "allow_delay", False),
                            )
                        continue

                execution_id = _due_execution_id(plan, entry)

                # 检查执行记录与冷却保护
                record = self._get_terminal_or_running_record(plan_paths, execution_id)
                if record and record.status == "running":
                    continue

                if entry.execution.publish:
                    target_task_id = (
                        entry.content.task_id
                        if isinstance(entry.content, TaskContent)
                        else None
                    )
                    if target_task_id:
                        task_paths = TaskPaths.from_workspace(paths, target_task_id)
                        submission = SubmissionRepository.load(task_paths)
                        if submission and submission.pixiv and submission.pixiv.illust_id:
                            # 已经成功发布到 Pixiv (获得了 illust_id)，跳过
                            continue
                    else:
                        if record and record.status == "completed":
                            continue

                    # 检查全局发布冷却期 (无论初次还是重试，均需遵守冷却)
                    if SubmissionExecutor._last_publish_time is not None:
                        time_since_last = (current_time - SubmissionExecutor._last_publish_time).total_seconds()
                        if 0 <= time_since_last < cooldown_seconds:
                            remaining_cooldown = cooldown_seconds - time_since_last
                            logger.info(
                                "⏳ Pixiv 处于发布冷却保护中 (冷却 %d 分钟，剩余 %.0f 秒)，跳过自动发布并在冷却后重试：plan_id=%s entry_id=%s task_id=%s",
                                cooldown_minutes,
                                remaining_cooldown,
                                plan.plan_id,
                                entry.entry_id,
                                target_task_id,
                            )
                            continue
                else:
                    if record and record.status in {"completed", "failed", "running"}:
                        continue

                records.append(
                    self._execute_entry(
                        root,
                        plan_paths,
                        plan,
                        entry,
                        execution_id=execution_id,
                        reason="due",
                        current_time=current_time,
                    )
                )
        return records

    def build_now(
        self,
        root: str | Path,
        month: str,
        entry_id: str,
    ) -> ExecutionRecord:
        paths, _ = load_workspace(root)
        plan_paths = PlanPaths.from_workspace(paths, month)
        plan = self.repository.load(plan_paths)
        entry = _find_entry(plan, entry_id)
        return self._execute_entry(
            root,
            plan_paths,
            plan,
            entry,
            execution_id=f"preview-{uuid4().hex[:16]}",
            reason="manual_preview",
        )

    def retry(
        self,
        root: str | Path,
        month: str,
        entry_id: str,
    ) -> ExecutionRecord | None:
        paths, _ = load_workspace(root)
        plan_paths = PlanPaths.from_workspace(paths, month)
        plan = self.repository.load(plan_paths)
        entry = _find_entry(plan, entry_id)
        previous = self.repository.list_executions(plan_paths, entry_id)
        if not previous or previous[-1].status != "failed":
            return None
        return self._execute_entry(
            root,
            plan_paths,
            plan,
            entry,
            execution_id=f"retry-{uuid4().hex[:16]}",
            reason="retry",
        )

    def _execute_entry(
        self,
        root: str | Path,
        plan_paths: PlanPaths,
        plan: MonthlyPlan,
        entry: ScheduleEntry,
        *,
        execution_id: str,
        reason: str,
        current_time: datetime | None = None,
    ) -> ExecutionRecord:
        now_dt = current_time or datetime.now(timezone.utc)
        task_id = entry.content.task_id if isinstance(entry.content, TaskContent) else None
        running = ExecutionRecord(
            execution_id=execution_id,
            entry_id=entry.entry_id,
            plan_revision=plan.revision,
            scheduled_at=entry.scheduled_at,
            status="running",
            task_id=task_id,
            reason=reason,
        )
        self.repository.save_execution(plan_paths, running)
        materialized: MaterializedPlanTask | None = None
        try:
            if isinstance(entry.content, TaskContent):
                paths, _ = load_workspace(root)
                task_paths = TaskPaths.from_workspace(paths, entry.content.task_id)
                latest_manifest_path = task_paths.builds_root / "latest" / "build_manifest.json"
                if not latest_manifest_path.is_file():
                    latest_manifest_path = task_paths.builds_root / "latest" / "manifest.json"
                if latest_manifest_path.is_file():
                    try:
                        manifest = BuildManifest.model_validate_json(
                            latest_manifest_path.read_text(encoding="utf-8")
                        )
                        if manifest.status == "success":
                            latest_dir = task_paths.builds_root / "latest"
                            result = BuildResult(
                                build_id=manifest.build_id,
                                build_root=latest_dir,
                                manifest_path=latest_manifest_path,
                                output_paths={
                                    "all": latest_dir / "output" / "all",
                                    "post": latest_dir / "output" / "post",
                                    "cover": latest_dir / "output" / "cover",
                                },
                                archive_paths={},
                                selection=manifest.selection,
                            )
                            logger.info(
                                "📦 投稿任务 %s 已有导出的最新构建包 (build_id=%s)，直接复用，避免重新构建覆盖自定义设置",
                                entry.content.task_id,
                                manifest.build_id,
                            )
                        else:
                            result = TaskWorkflowService().build(root, entry.content.task_id)
                    except Exception as e:
                        logger.warning("解析已有构建包 manifest 失败，将重新构建：%s", e)
                        result = TaskWorkflowService().build(root, entry.content.task_id)
                else:
                    result = TaskWorkflowService().build(root, entry.content.task_id)
            else:
                paths, _ = load_workspace(root)
                catalog = CatalogRepository(paths.catalog, backups_dir=paths.backups)
                materialized = self.materializer.materialize(
                    root,
                    plan_id=plan.plan_id,
                    entry=entry,
                    catalog=catalog,
                    execution_id=execution_id,
                )
                result = self.builder.build_paths(
                    materialized.task_paths,
                    output_root=materialized.formal_builds_root,
                )
            completed = running.model_copy(
                update={
                    "status": "completed",
                    "build_id": result.build_id,
                }
            )

            # 如果策略配置了 publish=True，在构建就绪后立即自动上传发布到 Pixiv
            if entry.execution.publish:
                target_task_id = (
                    entry.content.task_id
                    if isinstance(entry.content, TaskContent)
                    else (materialized.task_paths.task_id if materialized else None)
                )
                if target_task_id:
                    paths, config = load_workspace(root)
                    cooldown_minutes = getattr(config.pixiv, "publish_cooldown_minutes", 10)
                    SubmissionExecutor._last_publish_time = now_dt
                    try:
                        pub_res = self.pixiv_uploader.publish_task(root, target_task_id)
                        if not pub_res.success:
                            logger.error(
                                "定时自动发布 Pixiv 失败：plan_id=%s entry_id=%s task_id=%s error=%s (已进入 %d 分钟冷却期，冷却后将自动重试)",
                                plan.plan_id,
                                entry.entry_id,
                                target_task_id,
                                pub_res.error,
                                cooldown_minutes,
                            )
                            failed = running.model_copy(
                                update={
                                    "status": "failed",
                                    "build_id": result.build_id,
                                    "error": f"PixivPublishError: {pub_res.error}",
                                }
                            )
                            self.repository.save_execution(plan_paths, failed)
                            return failed
                        else:
                            if pub_res.illust_id:
                                try:
                                    t_paths = TaskPaths.from_workspace(paths, target_task_id)
                                    sub_obj = SubmissionRepository.load(t_paths)
                                    if not sub_obj:
                                        from ..submissions.models import Submission
                                        sub_obj = Submission(
                                            submission_id=target_task_id,
                                            task_id=target_task_id,
                                            title=entry.title or target_task_id,
                                            sets={"all": [], "post": []},
                                        )
                                    if not sub_obj.pixiv:
                                        from ..submissions.models import PixivMetadata
                                        sub_obj.pixiv = PixivMetadata()
                                    sub_obj.pixiv.illust_id = str(pub_res.illust_id)
                                    sub_obj.pixiv.last_publish_status = "success"
                                    sub_obj.pixiv.last_publish_error = None
                                    SubmissionRepository.save(t_paths, sub_obj)
                                except Exception as save_err:
                                    logger.warning("回写 submission.pixiv.illust_id 失败：%s", save_err)

                            pub_at_str = (
                                pub_res.published_at
                                if isinstance(getattr(pub_res, "published_at", None), str)
                                else now_dt.isoformat()
                            )
                            completed = completed.model_copy(
                                update={
                                    "illust_id": str(pub_res.illust_id) if pub_res.illust_id else None,
                                    "published_at": pub_at_str,
                                }
                            )
                            logger.info(
                                "🎉 定时自动发布 Pixiv 成功：plan_id=%s entry_id=%s task_id=%s illust_id=%s (已进入 %d 分钟冷却期)",
                                plan.plan_id,
                                entry.entry_id,
                                target_task_id,
                                pub_res.illust_id,
                                cooldown_minutes,
                            )
                    except Exception as pub_exc:
                        logger.error(
                            "定时自动发布 Pixiv 异常：plan_id=%s entry_id=%s error=%s (已进入 %d 分钟冷却期，冷却后将自动重试)",
                            plan.plan_id,
                            entry.entry_id,
                            pub_exc,
                            cooldown_minutes,
                        )
                        failed = running.model_copy(
                            update={
                                "status": "failed",
                                "build_id": result.build_id,
                                "error": f"PixivPublishException: {pub_exc}",
                            }
                        )
                        self.repository.save_execution(plan_paths, failed)
                        return failed
        except Exception as exc:
            failed = running.model_copy(
                update={"status": "failed", "error": f"{type(exc).__name__}: {exc}"}
            )
            self.repository.save_execution(plan_paths, failed)
            logger.error(
                "投稿构建失败：plan_id=%s entry_id=%s error=%s",
                plan.plan_id,
                entry.entry_id,
                exc,
            )
            return failed
        finally:
            if materialized is not None:
                materialized.cleanup()

        notification = self._notify(plan, entry, completed, result)
        completed = completed.model_copy(
            update={"notification_status": notification.status}
        )
        self.repository.save_execution(plan_paths, completed)
        return completed

    def _notify(self, plan, entry, record, result) -> NotificationResult:
        if not entry.execution.notify_on_complete:
            return NotificationResult(status="disabled")
        event = SubmissionEvent(
            plan_id=plan.plan_id,
            entry_id=entry.entry_id,
            title=entry.title,
            scheduled_at=entry.scheduled_at,
            status="completed",
            build_id=record.build_id,
            task_id=record.task_id,
            output_root=str(result.build_root),
            post_count=result.selection.get("post", 0),
        )
        try:
            return self.notifier.notify(event)
        except Exception as exc:
            logger.error(
                "投稿构建通知失败：plan_id=%s entry_id=%s error=%s",
                plan.plan_id,
                entry.entry_id,
                exc,
            )
            return NotificationResult(status="failed", message=str(exc))

    def _get_terminal_or_running_record(
        self,
        plan_paths: PlanPaths,
        execution_id: str,
    ) -> ExecutionRecord | None:
        try:
            return self.repository.load_execution(plan_paths, execution_id)
        except FileNotFoundError:
            return None

    def _has_terminal_or_running_record(
        self,
        plan_paths: PlanPaths,
        execution_id: str,
    ) -> bool:
        record = self._get_terminal_or_running_record(plan_paths, execution_id)
        if record is None:
            return False
        return record.status in {"running", "completed", "failed"}


def _find_entry(plan: MonthlyPlan, entry_id: str) -> ScheduleEntry:
    for entry in plan.entries:
        if entry.entry_id == entry_id:
            return entry
    raise KeyError(f"投稿不存在：{entry_id}")


def _due_execution_id(plan: MonthlyPlan, entry: ScheduleEntry) -> str:
    value = f"{plan.plan_id}|{entry.entry_id}|{plan.revision}|{entry.scheduled_at.isoformat()}"
    return "due-" + hashlib.sha256(value.encode("utf-8")).hexdigest()[:24]


def _require_aware(value: datetime) -> None:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("执行时间必须包含时区")
