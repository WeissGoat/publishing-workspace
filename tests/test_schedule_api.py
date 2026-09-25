from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient

from publishing_workspace.config import init_workspace
from publishing_workspace.plans.service import ScheduleService
from publishing_workspace.tasks.paths import TaskPaths
from publishing_workspace.tasks.repository import TaskRepository
from publishing_workspace.web.schedule_api import create_app


def entry_payload(entry_id: str = "entry-1") -> dict:
    return {
        "revision": 1,
        "entry": {
            "entry_id": entry_id,
            "scheduled_at": "2026-09-05T20:00:00+08:00",
            "title": "API 测试",
            "content": {"kind": "inline_selection", "sets": {"all": [], "post": ["sha256:a"], "cover": []}},
        },
    }


def client_for(root: Path) -> TestClient:
    init_workspace(root)
    ScheduleService().create_plan(root, "2026-09")
    return TestClient(create_app(root))


def test_plan_api_returns_revision_and_entries(tmp_path: Path):
    client = client_for(tmp_path)

    response = client.get("/api/plans/2026-09")

    assert response.status_code == 200
    assert response.json()["revision"] == 1
    assert response.json()["entries"] == []


def test_plan_api_get_creates_missing_month(tmp_path: Path):
    init_workspace(tmp_path)
    client = TestClient(create_app(tmp_path))

    response = client.get("/api/plans/2026-10")

    assert response.status_code == 200
    assert response.json()["month"] == "2026-10"
    assert response.json()["status"] == "draft"
    assert (tmp_path / "plans" / "2026-10" / "plan.yaml").is_file()


def test_plan_api_adds_and_moves_entry(tmp_path: Path):
    client = client_for(tmp_path)

    created = client.post("/api/plans/2026-09/entries", json=entry_payload())
    assert created.status_code == 200
    assert created.json()["revision"] == 2

    moved = client.patch(
        "/api/plans/2026-09/entries/entry-1/date",
        json={"revision": 2, "target_date": "2026-09-08"},
    )
    assert moved.status_code == 200
    assert moved.json()["entries"][0]["scheduled_at"].startswith("2026-09-08")


def test_plan_api_returns_409_for_stale_revision(tmp_path: Path):
    client = client_for(tmp_path)
    client.post("/api/plans/2026-09/entries", json=entry_payload())

    response = client.post(
        "/api/plans/2026-09/lock",
        json={"revision": 1},
    )

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "plan_revision_conflict"


def test_asset_search_api_returns_empty_result_for_empty_catalog(tmp_path: Path):
    client = client_for(tmp_path)

    response = client.get("/api/assets/search", params={"limit": 10})

    assert response.status_code == 200
    assert response.json() == []


def test_asset_search_api_accepts_subtype_facet(tmp_path: Path):
    client = client_for(tmp_path)

    response = client.get(
        "/api/assets/search",
        params={"facets": json.dumps({"subtype": ["kiss"]})},
    )

    assert response.status_code == 200
    assert response.json() == []


def test_node_search_api_returns_paginated_candidates(tmp_path: Path):
    client = client_for(tmp_path)

    response = client.get(
        "/api/nodes",
        params={"role": "character", "q": "hom", "offset": 0, "limit": 20},
    )

    assert response.status_code == 200
    assert response.json() == {
        "schema": "publishing-workspace.web.node-list/v1",
        "role": "character",
        "nodes": [],
        "offset": 0,
        "limit": 20,
        "has_more": False,
    }


def test_schedule_api_serves_static_calendar(tmp_path: Path):
    client = client_for(tmp_path)

    response = client.get("/schedule.html")

    assert response.status_code == 200
    assert "月度投稿计划" in response.text
    assert "classify.yaml 二次过滤" in response.text
    assert "添加筛选" in response.text
    assert "Subtype" in response.text
    assert "创建空计划" not in response.text
    assert "锁定计划" not in response.text


def test_schedule_api_lists_existing_tasks(tmp_path: Path):
    paths, _, _ = init_workspace(tmp_path)
    TaskRepository.create(TaskPaths.from_workspace(paths, "demo-task"), title="演示任务")
    client = TestClient(create_app(tmp_path))

    response = client.get("/api/tasks")

    assert response.status_code == 200
    assert response.json() == [{"task_id": "demo-task", "title": "演示任务"}]


def test_plan_api_auto_heals_invalid_cross_month_entry(tmp_path: Path):
    """测试当 plan.yaml 存在非法跨月脏数据时，API 能自动自愈加载而不是 422 崩溃。"""
    client = client_for(tmp_path)
    plan_file = tmp_path / "plans" / "2026-09" / "plan.yaml"

    # 手动注入一条 8 月份的脏数据到 9 月份 plan.yaml
    dirty_content = """schema_id: publishing-workspace.monthly-plan/v1
plan_id: 2026-09
month: 2026-09
timezone: Asia/Shanghai
status: draft
revision: 1
entries:
- entry_id: entry-valid-sep
  scheduled_at: '2026-09-01T20:00:00+08:00'
  title: 九月合法条目
  content:
    kind: inline_selection
    sets: {all: [], post: [], cover: []}
  execution:
    build_on_due: true
    notify_on_complete: true
    publish: false
- entry_id: entry-dirty-aug
  scheduled_at: '2026-08-31T20:00:00+08:00'
  title: 八月残留脏数据
  content:
    kind: inline_selection
    sets: {all: [], post: [], cover: []}
  execution:
    build_on_due: true
    notify_on_complete: true
    publish: false
"""
    plan_file.write_text(dirty_content, encoding="utf-8")

    # 访问 9 月份计划，应该成功返回 200 并自愈只保留 9 月份的条目
    res = client.get("/api/plans/2026-09")
    assert res.status_code == 200
    data = res.json()
    assert len(data["entries"]) == 1
    assert data["entries"][0]["entry_id"] == "entry-valid-sep"


def test_plan_api_moves_entry_across_months(tmp_path: Path):
    """测试跨月修改日期时，条目自动从原月份迁移至目标月份。"""
    client = client_for(tmp_path)

    # 1. 在 9 月创建一条排期
    created = client.post("/api/plans/2026-09/entries", json=entry_payload("entry-cross"))
    assert created.status_code == 200

    # 2. 将其日期跨月移动到 8 月 31 日
    moved = client.patch(
        "/api/plans/2026-09/entries/entry-cross/date",
        json={"revision": 2, "target_date": "2026-08-31"},
    )
    assert moved.status_code == 200

    # 3. 检查 9 月份计划已不再包含该条目
    sep_plan = client.get("/api/plans/2026-09").json()
    assert not any(e["entry_id"] == "entry-cross" for e in sep_plan["entries"])

    # 4. 检查 8 月份计划已自动创建并包含该条目
    aug_plan = client.get("/api/plans/2026-08").json()
    assert any(e["entry_id"] == "entry-cross" for e in aug_plan["entries"])

