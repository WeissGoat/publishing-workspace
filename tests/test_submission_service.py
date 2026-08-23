from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import pytest
from PIL import Image

from publishing_workspace.catalog.repository import CatalogRepository
from publishing_workspace.config import init_workspace
from publishing_workspace.metadata import default_image_node_reader_registry
from publishing_workspace.models import ImportedItem, SelectionSet
from publishing_workspace.submissions.models import (
    SubmissionRevisionConflictError,
)
from publishing_workspace.submissions.service import SubmissionService
from publishing_workspace.tasks.models import SelectionImportHistory
from publishing_workspace.tasks.paths import TaskPaths
from publishing_workspace.tasks.repository import TaskRepository


def _make_image(path: Path, color: str = "red") -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (8, 8), color).save(path)
    return path


def _seed_workspace_with_catalog(root: Path) -> tuple[Path, str, list[str]]:
    paths, _, _ = init_workspace(root)
    img_a = _make_image(root / "source" / "a.png", "red")
    img_b = _make_image(root / "source" / "b.png", "blue")
    img_c = _make_image(root / "source" / "c.png", "green")

    selection = SelectionSet(
        id="import-1",
        source_type="directory",
        source_ref=str(root / "source"),
        items=[
            ImportedItem(
                source_path=str(img_a),
                resolved_path=str(img_a),
                source_type="directory",
                source_ref=str(root / "source"),
                source_order=0,
                display_name=img_a.name,
            ),
            ImportedItem(
                source_path=str(img_b),
                resolved_path=str(img_b),
                source_type="directory",
                source_ref=str(root / "source"),
                source_order=1,
                display_name=img_b.name,
            ),
            ImportedItem(
                source_path=str(img_c),
                resolved_path=str(img_c),
                source_type="directory",
                source_ref=str(root / "source"),
                source_order=2,
                display_name=img_c.name,
            ),
        ],
    )
    catalog_repo = CatalogRepository(paths.catalog)
    catalog_repo.import_selection(
        selection,
        readers=default_image_node_reader_registry(),
        enrichers=[],
    )
    imported = catalog_repo.assets_for_import("import-1")
    asset_ids = [item.asset_id for item in imported]
    return paths.root, "import-1", asset_ids


def test_submission_service_create_and_update(tmp_path: Path):
    root, import_id, asset_ids = _seed_workspace_with_catalog(tmp_path)
    service = SubmissionService()

    # 1. 创建新投稿
    created = service.create_or_update(
        root,
        task_id=None,
        title="初稿任务",
        source_import_id=import_id,
        sets={"all": asset_ids[:2]},
    )

    assert created.task_id.startswith("submission-")
    assert created.revision == 1
    assert created.sets["all"] == asset_ids[:2]
    assert created.sets["post"] == []
    assert created.sets["cover"] == []

    task_paths = TaskPaths.from_workspace(init_workspace(root)[0], created.task_id)
    assert task_paths.task_yaml.is_file()
    assert task_paths.submission_yaml.is_file()
    assert task_paths.candidates_snapshot.is_file()
    assert task_paths.candidates_playlist.is_file()
    assert (task_paths.selection_dirs["all"] / "0001_a.png").is_file()
    assert len(list(task_paths.selection_dirs["post"].glob("*"))) == 0
    assert len(list(task_paths.selection_dirs["cover"].glob("*"))) == 0

    # 2. 更新投稿
    updated = service.create_or_update(
        root,
        task_id=created.task_id,
        title="第二版投稿",
        source_import_id=import_id,
        sets={"all": asset_ids, "post": [asset_ids[1]], "cover": [asset_ids[1]]},
        expected_revision=1,
    )
    assert updated.revision == 2
    assert updated.title == "第二版投稿"
    assert len(updated.sets["all"]) == 3
    assert updated.sets["post"] == [asset_ids[1]]
    assert updated.sets["cover"] == [asset_ids[1]]


def test_submission_service_rejects_stale_revision(tmp_path: Path):
    root, import_id, asset_ids = _seed_workspace_with_catalog(tmp_path)
    service = SubmissionService()

    created = service.create_or_update(
        root,
        task_id=None,
        title="初稿",
        source_import_id=import_id,
        sets={"all": [asset_ids[0]]},
    )
    updated = service.create_or_update(
        root,
        task_id=created.task_id,
        title="第二版",
        source_import_id=import_id,
        sets={"all": [asset_ids[0]]},
        expected_revision=created.revision,
    )

    assert updated.revision == created.revision + 1
    with pytest.raises(SubmissionRevisionConflictError):
        service.create_or_update(
            root,
            task_id=created.task_id,
            title="旧版本",
            source_import_id=import_id,
            sets={"all": [asset_ids[0]]},
            expected_revision=created.revision,
        )


def test_submission_service_rejects_empty_all(tmp_path: Path):
    root, import_id, _ = _seed_workspace_with_catalog(tmp_path)
    service = SubmissionService()

    with pytest.raises(ValueError, match="all 集合不能为空"):
        service.create_or_update(
            root,
            task_id=None,
            title="空投稿",
            source_import_id=import_id,
            sets={"all": []},
        )


def test_submission_service_rejects_missing_asset(tmp_path: Path):
    root, import_id, _ = _seed_workspace_with_catalog(tmp_path)
    service = SubmissionService()

    with pytest.raises(ValueError, match="素材在 Catalog 中不存在"):
        service.create_or_update(
            root,
            task_id=None,
            title="非法素材投稿",
            source_import_id=import_id,
            sets={"all": ["sha256:nonexistent"]},
        )


def test_submission_service_preserves_history_on_update(tmp_path: Path):
    root, import_id, asset_ids = _seed_workspace_with_catalog(tmp_path)
    service = SubmissionService()

    created = service.create_or_update(
        root,
        task_id=None,
        title="初稿",
        source_import_id=import_id,
        sets={"all": [asset_ids[0]]},
    )
    task_paths = TaskPaths.from_workspace(init_workspace(root)[0], created.task_id)

    # 写入一条 history 记录
    history_record = SelectionImportHistory(
        history_id="test-hist-1",
        selection="all",
        mode="replace",
        source_type="catalog",
        source_ref=import_id,
        materialized_files=["0001_a.png"],
    )
    TaskRepository.record_history(task_paths, history_record)
    history_files = list(task_paths.history_dir.glob("*.json"))
    assert len(history_files) == 1

    # 更新投稿
    service.create_or_update(
        root,
        task_id=created.task_id,
        title="第二版",
        source_import_id=import_id,
        sets={"all": asset_ids[:2]},
        expected_revision=1,
    )

    # 验证 history 仍然完整保留
    updated_history_files = list(task_paths.history_dir.glob("*.json"))
    assert len(updated_history_files) == 1
    assert updated_history_files[0].name == history_files[0].name


def test_submission_service_full_rollback_on_failure(tmp_path: Path):
    root, import_id, asset_ids = _seed_workspace_with_catalog(tmp_path)
    service = SubmissionService()

    created = service.create_or_update(
        root,
        task_id=None,
        title="初稿",
        source_import_id=import_id,
        sets={"all": [asset_ids[0]]},
    )
    task_paths = TaskPaths.from_workspace(init_workspace(root)[0], created.task_id)

    # 写入测试 build 和 history
    (task_paths.builds_root / "build-test").mkdir(parents=True)
    (task_paths.builds_root / "build-test" / "marker.txt").write_text("keep this build")
    (task_paths.history_dir / "hist-keep.json").write_text('{"keep": true}')

    original_task_yaml = task_paths.task_yaml.read_text(encoding="utf-8")
    original_submission_yaml = task_paths.submission_yaml.read_text(encoding="utf-8")
    original_candidates = task_paths.candidates_snapshot.read_text(encoding="utf-8")

    # 模拟在保存 submission.yaml 时发生异常
    with patch(
        "publishing_workspace.submissions.repository.SubmissionRepository.save",
        side_effect=RuntimeError("模拟保存失败"),
    ):
        with pytest.raises(RuntimeError, match="模拟保存失败"):
            service.create_or_update(
                root,
                task_id=created.task_id,
                title="失败修改",
                source_import_id=import_id,
                sets={"all": [asset_ids[1]]},
                expected_revision=1,
            )

    # 验证所有文件完整回滚，没有丢失任何数据
    assert task_paths.task_yaml.read_text(encoding="utf-8") == original_task_yaml
    assert task_paths.submission_yaml.read_text(encoding="utf-8") == original_submission_yaml
    assert task_paths.candidates_snapshot.read_text(encoding="utf-8") == original_candidates
    assert (task_paths.builds_root / "build-test" / "marker.txt").read_text() == "keep this build"
    assert (task_paths.history_dir / "hist-keep.json").read_text() == '{"keep": true}'
    assert (task_paths.selection_dirs["all"] / "0001_a.png").is_file()


def test_submission_service_delete_and_unmark(tmp_path: Path):
    from datetime import datetime
    from zoneinfo import ZoneInfo
    from publishing_workspace.plans.models import ScheduleEntry, TaskContent
    from publishing_workspace.plans.paths import PlanPaths
    from publishing_workspace.plans.repository import PlanRepository

    root, import_id, asset_ids = _seed_workspace_with_catalog(tmp_path)
    paths, _, _ = init_workspace(root)
    catalog_repo = CatalogRepository(paths.catalog)
    service = SubmissionService()

    # 预先给 a, b 打上 posted 标记
    aid_a, aid_b, aid_c = asset_ids[0], asset_ids[1], asset_ids[2]
    catalog_repo.set_asset_marks([aid_a, aid_b], mark="posted")

    # 1. 创建投稿 1（包含 a, b）
    sub1 = service.create_or_update(
        root,
        task_id=None,
        title="投稿 1",
        source_import_id=import_id,
        sets={"all": [aid_a, aid_b]},
    )

    # 2. 创建投稿 2（包含 b, c）
    sub2 = service.create_or_update(
        root,
        task_id=None,
        title="投稿 2",
        source_import_id=import_id,
        sets={"all": [aid_b, aid_c]},
    )

    # 3. 在月度计划 2026-08 中排期投稿 1
    plan_repo = PlanRepository()
    plan_paths = PlanPaths.from_workspace(paths, "2026-08")
    plan = plan_repo.create(plan_paths)
    plan.entries.append(
        ScheduleEntry(
            entry_id="entry-sub1",
            scheduled_at=datetime(2026, 8, 10, 20, 0, tzinfo=ZoneInfo("Asia/Shanghai")),
            title="排期投稿 1",
            content=TaskContent(kind="task", task_id=sub1.task_id),
        )
    )
    plan_repo.save(plan_paths, plan)

    # 4. 删除投稿 1
    res = service.delete(root, sub1.task_id)
    assert res["deleted_task_id"] == sub1.task_id
    assert aid_a in res["unmarked_asset_ids"]
    assert aid_b not in res["unmarked_asset_ids"]  # b 还在投稿 2 中，不应该被取消标记

    # 5. 验证 Catalog 标记状态
    marks = catalog_repo.all_asset_marks()
    assert "posted" not in marks.get(aid_a, [])
    assert "posted" in marks.get(aid_b, [])

    # 6. 验证月度计划中对投稿 1 的引用已被自动移除
    updated_plan = plan_repo.load(plan_paths)
    assert len(updated_plan.entries) == 0

    # 7. 删除投稿 2
    res2 = service.delete(root, sub2.task_id)
    assert res2["deleted_task_id"] == sub2.task_id
    assert aid_b in res2["unmarked_asset_ids"]  # 此时 b 不在任何投稿中了，应该被取消标记

    marks_final = catalog_repo.all_asset_marks()
    assert "posted" not in marks_final.get(aid_b, [])
