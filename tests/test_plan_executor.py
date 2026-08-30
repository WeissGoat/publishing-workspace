from __future__ import annotations

from datetime import datetime
from pathlib import Path

from PIL import Image

from publishing_workspace.config import init_workspace
from publishing_workspace.plans.executor import SubmissionExecutor
from publishing_workspace.plans.models import ScheduleEntry, TaskContent
from publishing_workspace.plans.notifier import NotificationResult
from publishing_workspace.plans.service import ScheduleService
from publishing_workspace.tasks.paths import TaskPaths
from publishing_workspace.tasks.repository import TaskRepository


def create_task(root: Path, task_id: str, *, broken: bool = False) -> Path:
    paths, _, _ = init_workspace(root)
    task_paths = TaskPaths.from_workspace(paths, task_id)
    TaskRepository.create(task_paths, title=task_id)
    image_path = task_paths.selection_dirs["all"] / "0001.png"
    image_path.write_bytes(b"broken" if broken else b"")
    if not broken:
        Image.new("RGB", (8, 8), "red").save(image_path)
    task_paths.selection_dirs["post"].mkdir(parents=True, exist_ok=True)
    post_path = task_paths.selection_dirs["post"] / "0001.png"
    if broken:
        post_path.write_bytes(b"broken")
    else:
        Image.new("RGB", (8, 8), "blue").save(post_path)
    return image_path


def entry(entry_id: str, task_id: str, scheduled_at: str) -> ScheduleEntry:
    return ScheduleEntry(
        entry_id=entry_id,
        scheduled_at=datetime.fromisoformat(scheduled_at),
        title=task_id,
        content=TaskContent(task_id=task_id),
    )


class RecordingNotifier:
    def __init__(self, result: NotificationResult):
        self.result = result
        self.events = []

    def notify(self, event):
        self.events.append(event)
        return self.result


def locked_plan(root: Path, entries: list[ScheduleEntry]):
    service = ScheduleService()
    service.create_plan(root, "2026-09")
    for item in entries:
        service.add_entry(root, "2026-09", item)
    service.lock(root, "2026-09")


def test_run_due_continues_after_one_entry_fails(tmp_path: Path):
    init_workspace(tmp_path)
    create_task(tmp_path, "bad-task")
    create_task(tmp_path, "good-task")
    bad_source = tmp_path / "tasks" / "bad-task" / "selection" / "all" / "0001.png"
    bad_source.write_bytes(b"not-an-image")
    locked_plan(
        tmp_path,
        [
            entry("bad-entry", "bad-task", "2026-09-05T20:00:00+08:00"),
            entry("good-entry", "good-task", "2026-09-05T21:00:00+08:00"),
        ],
    )

    records = SubmissionExecutor().run_due(
        tmp_path,
        now=datetime.fromisoformat("2026-09-05T22:00:00+08:00"),
    )

    assert [record.status for record in records] == ["failed", "completed"]
    assert records[0].error
    assert records[1].build_id
    assert (tmp_path / "tasks" / "good-task" / "builds").is_dir()


def test_run_due_executes_draft_plan(tmp_path: Path):
    init_workspace(tmp_path)
    create_task(tmp_path, "draft-task")
    service = ScheduleService()
    service.create_plan(tmp_path, "2026-09")
    service.add_entry(
        tmp_path,
        "2026-09",
        entry("draft-entry", "draft-task", "2026-09-05T20:00:00+08:00"),
    )

    records = SubmissionExecutor().run_due(
        tmp_path,
        now=datetime.fromisoformat("2026-09-05T22:00:00+08:00"),
    )

    assert [record.status for record in records] == ["completed"]


def test_run_due_is_idempotent_after_success(tmp_path: Path):
    init_workspace(tmp_path)
    create_task(tmp_path, "good-task")
    locked_plan(
        tmp_path,
        [entry("good-entry", "good-task", "2026-09-05T20:00:00+08:00")],
    )
    executor = SubmissionExecutor()
    now = datetime.fromisoformat("2026-09-05T22:00:00+08:00")

    first = executor.run_due(tmp_path, now=now)
    second = executor.run_due(tmp_path, now=now)

    assert len(first) == 1
    assert first[0].status == "completed"
    assert second == []


def test_notification_failure_does_not_fail_build(tmp_path: Path):
    init_workspace(tmp_path)
    create_task(tmp_path, "good-task")
    locked_plan(
        tmp_path,
        [entry("good-entry", "good-task", "2026-09-05T20:00:00+08:00")],
    )
    notifier = RecordingNotifier(
        NotificationResult(status="failed", message="test notification error")
    )

    records = SubmissionExecutor(notifier=notifier).run_due(
        tmp_path,
        now=datetime.fromisoformat("2026-09-05T22:00:00+08:00"),
    )

    assert records[0].status == "completed"
    assert records[0].notification_status == "failed"
    assert len(notifier.events) == 1


def test_retry_only_reexecutes_failed_entry(tmp_path: Path):
    init_workspace(tmp_path)
    create_task(tmp_path, "good-task")
    locked_plan(
        tmp_path,
        [entry("good-entry", "good-task", "2026-09-05T20:00:00+08:00")],
    )
    executor = SubmissionExecutor()
    first = executor.run_due(
        tmp_path,
        now=datetime.fromisoformat("2026-09-05T22:00:00+08:00"),
    )
    assert first[0].status == "completed"

    assert executor.retry(tmp_path, "2026-09", "good-entry") is None


def test_run_due_delay_tolerance_skips_expired(tmp_path: Path):
    init_workspace(tmp_path)
    create_task(tmp_path, "task-expired")
    create_task(tmp_path, "task-fresh")

    service = ScheduleService()
    service.create_plan(tmp_path, "2026-09")
    # task-expired is scheduled at 10:00 (now is 14:00, 4 hours later > 120min tolerance)
    service.add_entry(
        tmp_path,
        "2026-09",
        entry("entry-expired", "task-expired", "2026-09-05T10:00:00+08:00"),
    )
    # task-fresh is scheduled at 13:00 (now is 14:00, 1 hour later <= 120min tolerance)
    service.add_entry(
        tmp_path,
        "2026-09",
        entry("entry-fresh", "task-fresh", "2026-09-05T13:00:00+08:00"),
    )

    executor = SubmissionExecutor()
    now = datetime.fromisoformat("2026-09-05T14:00:00+08:00")
    records = executor.run_due(tmp_path, now=now, max_delay_minutes=120)

    # Only the fresh entry within tolerance should be executed
    assert len(records) == 1
    assert records[0].entry_id == "entry-fresh"
    assert records[0].status == "completed"


def test_run_due_triggers_pixiv_publishing(tmp_path: Path):
    from unittest.mock import MagicMock
    from publishing_workspace.plans.models import ExecutionPolicy

    init_workspace(tmp_path)
    create_task(tmp_path, "auto-publish-task")

    schedule_entry = entry("entry-publish", "auto-publish-task", "2026-09-05T20:00:00+08:00")
    schedule_entry.execution = ExecutionPolicy(build_on_due=True, publish=True, allow_delay=True, max_delay_minutes=60)

    service = ScheduleService()
    service.create_plan(tmp_path, "2026-09")
    service.add_entry(tmp_path, "2026-09", schedule_entry)

    mock_uploader = MagicMock()
    mock_uploader.publish_task.return_value = MagicMock(success=True, illust_id="123456789")

    executor = SubmissionExecutor(pixiv_uploader=mock_uploader)
    now = datetime.fromisoformat("2026-09-05T20:30:00+08:00")
    records = executor.run_due(tmp_path, now=now)

    assert len(records) == 1
    assert records[0].status == "completed"
    mock_uploader.publish_task.assert_called_once_with(tmp_path, "auto-publish-task")


def test_run_due_punctual_mode_skips_overdue(tmp_path: Path):
    from unittest.mock import MagicMock
    from publishing_workspace.plans.models import ExecutionPolicy

    init_workspace(tmp_path)
    create_task(tmp_path, "punctual-task")

    schedule_entry = entry("entry-punctual", "punctual-task", "2026-09-05T20:00:00+08:00")
    # 默认 allow_delay=False (准时模式)
    schedule_entry.execution = ExecutionPolicy(build_on_due=True, publish=True, allow_delay=False)

    service = ScheduleService()
    service.create_plan(tmp_path, "2026-09")
    service.add_entry(tmp_path, "2026-09", schedule_entry)

    mock_uploader = MagicMock()
    executor = SubmissionExecutor(pixiv_uploader=mock_uploader)
    SubmissionExecutor.set_last_publish_time(None)

    # 30 分钟后扫描 (超过准时容差 15 分钟)，应跳过不发布
    now = datetime.fromisoformat("2026-09-05T20:30:00+08:00")
    records = executor.run_due(tmp_path, now=now)
    assert len(records) == 0
    mock_uploader.publish_task.assert_not_called()

    # 准时扫描 (1 分钟后)，正常触发发布
    now_on_time = datetime.fromisoformat("2026-09-05T20:01:00+08:00")
    records_on_time = executor.run_due(tmp_path, now=now_on_time)
    assert len(records_on_time) == 1
    mock_uploader.publish_task.assert_called_once_with(tmp_path, "punctual-task")


def test_run_due_publish_cooldown_defers_second_entry(tmp_path: Path):
    from unittest.mock import MagicMock
    from publishing_workspace.plans.models import ExecutionPolicy

    init_workspace(tmp_path)
    create_task(tmp_path, "task-1")
    create_task(tmp_path, "task-2")

    # 两个任务同时在 20:00 到期
    entry1 = entry("entry-1", "task-1", "2026-09-05T20:00:00+08:00")
    entry1.execution = ExecutionPolicy(build_on_due=True, publish=True, allow_delay=True, max_delay_minutes=60)
    entry2 = entry("entry-2", "task-2", "2026-09-05T20:00:00+08:00")
    entry2.execution = ExecutionPolicy(build_on_due=True, publish=True, allow_delay=True, max_delay_minutes=60)

    service = ScheduleService()
    service.create_plan(tmp_path, "2026-09")
    service.add_entry(tmp_path, "2026-09", entry1)
    service.add_entry(tmp_path, "2026-09", entry2)

    mock_uploader = MagicMock()
    mock_uploader.publish_task.return_value = MagicMock(success=True, illust_id="111")
    executor = SubmissionExecutor(pixiv_uploader=mock_uploader)
    SubmissionExecutor.set_last_publish_time(None)

    # 第一次执行 (20:00:00)，任务 1 发布成功，任务 2 因 10 分钟冷却被跳过
    now = datetime.fromisoformat("2026-09-05T20:00:00+08:00")
    records1 = executor.run_due(tmp_path, now=now)
    assert len(records1) == 1
    assert records1[0].entry_id == "entry-1"
    mock_uploader.publish_task.assert_called_once_with(tmp_path, "task-1")

    # 5 分钟后 (20:05:00)，任务 2 仍在 10 分钟冷却期内，跳过
    now_5m = datetime.fromisoformat("2026-09-05T20:05:00+08:00")
    records_5m = executor.run_due(tmp_path, now=now_5m)
    assert len(records_5m) == 0

    # 11 分钟后 (20:11:00)，冷却期已过，任务 2 自动发布成功！
    mock_uploader.publish_task.reset_mock()
    mock_uploader.publish_task.return_value = MagicMock(success=True, illust_id="222")
    now_11m = datetime.fromisoformat("2026-09-05T20:11:00+08:00")
    records_11m = executor.run_due(tmp_path, now=now_11m)
    assert len(records_11m) == 1
    assert records_11m[0].entry_id == "entry-2"
    mock_uploader.publish_task.assert_called_once_with(tmp_path, "task-2")


def test_run_due_publish_failure_retries_after_cooldown(tmp_path: Path):
    from unittest.mock import MagicMock
    from publishing_workspace.plans.models import ExecutionPolicy

    init_workspace(tmp_path)
    create_task(tmp_path, "task-fail-retry")

    schedule_entry = entry("entry-fail-retry", "task-fail-retry", "2026-09-05T20:00:00+08:00")
    schedule_entry.execution = ExecutionPolicy(build_on_due=True, publish=True, allow_delay=True, max_delay_minutes=60)

    service = ScheduleService()
    service.create_plan(tmp_path, "2026-09")
    service.add_entry(tmp_path, "2026-09", schedule_entry)

    mock_uploader = MagicMock()
    # 第一次发布失败
    mock_uploader.publish_task.return_value = MagicMock(success=False, error="Rate limit")
    executor = SubmissionExecutor(pixiv_uploader=mock_uploader)
    SubmissionExecutor.set_last_publish_time(None)

    # 20:00 尝试发布失败，挂上 10 分钟冷却
    now = datetime.fromisoformat("2026-09-05T20:00:00+08:00")
    executor.run_due(tmp_path, now=now)
    mock_uploader.publish_task.assert_called_once_with(tmp_path, "task-fail-retry")

    # 20:05 在冷却期中，不重试
    now_5m = datetime.fromisoformat("2026-09-05T20:05:00+08:00")
    records_5m = executor.run_due(tmp_path, now=now_5m)
    assert len(records_5m) == 0

    # 20:11 冷却结束后重试，此次发布成功！
    mock_uploader.publish_task.reset_mock()
    mock_uploader.publish_task.return_value = MagicMock(success=True, illust_id="999888")
    now_11m = datetime.fromisoformat("2026-09-05T20:11:00+08:00")
    records_11m = executor.run_due(tmp_path, now=now_11m)
    assert len(records_11m) == 1
    mock_uploader.publish_task.assert_called_once_with(tmp_path, "task-fail-retry")


def test_run_due_reuses_existing_build_without_overwriting(tmp_path: Path):
    from unittest.mock import MagicMock
    from publishing_workspace.plans.models import ExecutionPolicy
    from publishing_workspace.packages.builder import PackageBuilder
    from publishing_workspace.tasks.service import TaskWorkflowService

    init_workspace(tmp_path)
    create_task(tmp_path, "task-reuse-build")

    # 先执行一次真实构建
    build_result_1 = PackageBuilder().build(tmp_path, "task-reuse-build")
    build_id_1 = build_result_1.build_id

    schedule_entry = entry("entry-reuse", "task-reuse-build", "2026-09-05T20:00:00+08:00")
    schedule_entry.execution = ExecutionPolicy(build_on_due=True, publish=False)

    service = ScheduleService()
    service.create_plan(tmp_path, "2026-09")
    service.add_entry(tmp_path, "2026-09", schedule_entry)

    # 运行 executor，应该复用已有的 build_id_1，而不重新调用 PackageBuilder
    executor = SubmissionExecutor()
    now = datetime.fromisoformat("2026-09-05T20:00:00+08:00")
    records = executor.run_due(tmp_path, now=now)

    assert len(records) == 1
    assert records[0].status == "completed"
    assert records[0].build_id == build_id_1

