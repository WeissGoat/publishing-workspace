from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from publishing_workspace.catalog.repository import CatalogRepository
from publishing_workspace.config import init_workspace
from publishing_workspace.metadata import default_image_node_reader_registry
from publishing_workspace.models import ImportedItem, SelectionSet
from publishing_workspace.web.schedule_api import create_app


def _make_image(path: Path, color: str = "red") -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (8, 8), color).save(path)
    return path


def client_with_catalog(root: Path) -> tuple[TestClient, str, list[str]]:
    paths, _, _ = init_workspace(root)
    img_a = _make_image(root / "source" / "a.png", "red")
    img_b = _make_image(root / "source" / "b.png", "blue")

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
    client = TestClient(create_app(root))
    return client, "import-1", asset_ids


def test_library_assets_returns_page_contract(tmp_path: Path):
    client, import_id, asset_ids = client_with_catalog(tmp_path)

    response = client.get(
        "/api/library/assets",
        params={
            "offset": 0,
            "limit": 1,
            "import_id": import_id,
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["schema"] == "publishing-workspace.asset-page/v1"
    assert data["offset"] == 0
    assert data["limit"] == 1
    assert len(data["items"]) == 1
    assert data["has_more"] is True
    assert data["next_offset"] == 1


def test_library_assets_limit_validation(tmp_path: Path):
    client, _, _ = client_with_catalog(tmp_path)

    # limit > 200 在新接口被拒绝
    resp_over = client.get("/api/library/assets", params={"limit": 201})
    assert resp_over.status_code == 422

    # 旧接口支持 limit=1000
    resp_old = client.get("/api/assets/search", params={"limit": 1000})
    assert resp_old.status_code == 200
    assert isinstance(resp_old.json(), list)


def test_library_facets_returns_dict(tmp_path: Path):
    client, import_id, _ = client_with_catalog(tmp_path)

    response = client.get("/api/library/facets", params={"import_id": import_id})
    assert response.status_code == 200
    assert isinstance(response.json(), dict)


def test_create_submission_returns_task_and_filled_sets(tmp_path: Path):
    client, import_id, asset_ids = client_with_catalog(tmp_path)

    response = client.post(
        "/api/submissions",
        json={
            "title": "API 投稿",
            "source_import_id": import_id,
            "sets": {"all": [asset_ids[0]]},
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["task_id"]
    assert body["title"] == "API 投稿"
    assert body["sets"]["all"] == [asset_ids[0]]
    assert body["sets"]["post"] == []
    assert body["sets"]["cover"] == []
    assert (tmp_path / "tasks" / body["task_id"] / "submission.yaml").is_file()


def test_submission_crud_lifecycle(tmp_path: Path):
    client, import_id, asset_ids = client_with_catalog(tmp_path)

    # 1. 创建
    create_resp = client.post(
        "/api/submissions",
        json={
            "title": "初始投稿",
            "source_import_id": import_id,
            "sets": {"all": asset_ids},
        },
    )
    assert create_resp.status_code == 200
    task_id = create_resp.json()["task_id"]
    rev = create_resp.json()["revision"]

    # 2. 获取详情
    get_resp = client.get(f"/api/submissions/{task_id}")
    assert get_resp.status_code == 200
    assert get_resp.json()["task_id"] == task_id
    assert get_resp.json()["title"] == "初始投稿"

    # 3. 成功更新
    put_resp = client.put(
        f"/api/submissions/{task_id}",
        json={
            "title": "更新后标题",
            "source_import_id": import_id,
            "sets": {"all": [asset_ids[1]], "post": [asset_ids[1]], "cover": [asset_ids[1]]},
            "revision": rev,
        },
    )
    assert put_resp.status_code == 200
    assert put_resp.json()["title"] == "更新后标题"
    assert put_resp.json()["revision"] == rev + 1

    # 4. 冲突更新 (使用过期 revision)
    conflict_resp = client.put(
        f"/api/submissions/{task_id}",
        json={
            "title": "冲突修改",
            "source_import_id": import_id,
            "sets": {"all": [asset_ids[0]]},
            "revision": rev,
        },
    )
    assert conflict_resp.status_code == 409
    assert conflict_resp.json()["detail"]["code"] == "submission_revision_conflict"

    # 5. 列表
    list_resp = client.get("/api/submissions")
    assert list_resp.status_code == 200
    summaries = list_resp.json()
    assert len(summaries) >= 1
    assert any(s["task_id"] == task_id for s in summaries)


def test_submission_pixiv_crop_persistence(tmp_path: Path):
    import yaml

    client, import_id, asset_ids = client_with_catalog(tmp_path)

    # 1. 创建带有 crop_x / crop_y 的投稿
    create_resp = client.post(
        "/api/submissions",
        json={
            "title": "裁剪测试投稿",
            "source_import_id": import_id,
            "sets": {"all": [asset_ids[0]]},
            "pixiv": {
                "title": "裁剪测试投稿",
                "caption": "简介",
                "tags": ["标签A"],
                "crop_x": 0.145833,
                "crop_y": None,
            },
        },
    )
    assert create_resp.status_code == 200
    task_id = create_resp.json()["task_id"]
    rev = create_resp.json()["revision"]
    assert create_resp.json()["pixiv"]["crop_x"] == 0.145833
    assert create_resp.json()["pixiv"]["crop_y"] is None

    # 2. 验证 YAML 文件落盘持久化
    yaml_path = tmp_path / "tasks" / task_id / "submission.yaml"
    assert yaml_path.is_file()
    yaml_data = yaml.safe_load(yaml_path.read_text(encoding="utf-8"))
    assert yaml_data["pixiv"]["crop_x"] == 0.145833
    assert yaml_data["pixiv"]["crop_y"] is None

    # 3. 读取详情校验
    get_resp = client.get(f"/api/submissions/{task_id}")
    assert get_resp.status_code == 200
    assert get_resp.json()["pixiv"]["crop_x"] == 0.145833

    # 4. 更新 crop_y (竖图裁剪) 并持久化
    put_resp = client.put(
        f"/api/submissions/{task_id}",
        json={
            "title": "裁剪测试投稿",
            "source_import_id": import_id,
            "sets": {"all": [asset_ids[0]]},
            "pixiv": {
                "title": "裁剪测试投稿",
                "caption": "简介",
                "tags": ["标签A"],
                "crop_x": None,
                "crop_y": 0.25,
            },
            "revision": rev,
        },
    )
    assert put_resp.status_code == 200
    assert put_resp.json()["pixiv"]["crop_x"] is None
    assert put_resp.json()["pixiv"]["crop_y"] == 0.25

    # 5. 再次验证磁盘 YAML
    yaml_data2 = yaml.safe_load(yaml_path.read_text(encoding="utf-8"))
    assert yaml_data2["pixiv"]["crop_x"] is None
    assert yaml_data2["pixiv"]["crop_y"] == 0.25



def test_submission_api_error_responses(tmp_path: Path):
    client, import_id, _ = client_with_catalog(tmp_path)

    # 1. 投稿不存在
    not_found = client.get("/api/submissions/nonexistent-task")
    assert not_found.status_code == 404
    assert not_found.json()["detail"]["code"] == "task_not_found"

    # 2. 空 all 集合
    empty_all = client.post(
        "/api/submissions",
        json={
            "title": "空投稿",
            "source_import_id": import_id,
            "sets": {"all": []},
        },
    )
    assert empty_all.status_code == 422
    assert empty_all.json()["detail"]["code"] == "invalid_submission"

    # 3. 未知素材 ID
    unknown_asset = client.post(
        "/api/submissions",
        json={
            "title": "未知素材",
            "source_import_id": import_id,
            "sets": {"all": ["sha256:unknown"]},
        },
    )
    assert unknown_asset.status_code == 422
    assert unknown_asset.json()["detail"]["code"] == "invalid_submission"


def test_update_build_image_endpoint(tmp_path: Path):
    import io
    from PIL import Image
    from publishing_workspace.config import load_workspace
    from publishing_workspace.tasks.paths import TaskPaths

    client, _, _ = client_with_catalog(tmp_path)
    paths, _ = load_workspace(client.app.state.publishing_root)
    task_paths = TaskPaths.from_workspace(paths, "sub-mock-edit")
    build_dir = task_paths.builds_root / "latest" / "output" / "post"
    build_dir.mkdir(parents=True, exist_ok=True)
    orig_img_file = build_dir / "0001_test.png"

    orig_im = Image.new("RGB", (64, 64), color="blue")
    orig_im.save(orig_img_file, format="PNG")

    edited_im = Image.new("RGB", (64, 64), color="red")
    buf = io.BytesIO()
    edited_im.save(buf, format="PNG")
    edited_bytes = buf.getvalue()

    # 1. 正常覆盖
    resp = client.put(
        "/api/submissions/sub-mock-edit/build-images/post/0001_test.png",
        content=edited_bytes,
        headers={"Content-Type": "image/png"},
    )
    assert resp.status_code == 200
    assert resp.json()["success"] is True

    # 验证读取到的确实是新图片
    with Image.open(orig_img_file) as im:
        assert im.getpixel((0, 0)) == (255, 0, 0)

    # 2. 非法 selection
    bad_sel = client.put(
        "/api/submissions/sub-mock-edit/build-images/invalid/0001_test.png",
        content=edited_bytes,
    )
    assert bad_sel.status_code == 400

    # 3. 非法图片字节
    bad_img = client.put(
        "/api/submissions/sub-mock-edit/build-images/post/0001_test.png",
        content=b"not an image",
    )
    assert bad_img.status_code == 400


def test_delete_submission_endpoint(tmp_path: Path):
    client, import_id, asset_ids = client_with_catalog(tmp_path)

    # 1. 创建投稿
    create_resp = client.post(
        "/api/submissions",
        json={
            "title": "待删除投稿",
            "source_import_id": import_id,
            "sets": {"all": [asset_ids[0]]},
        },
    )
    assert create_resp.status_code == 200
    task_id = create_resp.json()["task_id"]

    # 2. 删除投稿
    del_resp = client.delete(f"/api/submissions/{task_id}")
    assert del_resp.status_code == 200
    assert del_resp.json()["success"] is True
    assert del_resp.json()["deleted_task_id"] == task_id
    assert asset_ids[0] in del_resp.json()["unmarked_asset_ids"]

    # 3. 再次获取应为 404
    get_resp = client.get(f"/api/submissions/{task_id}")
    assert get_resp.status_code == 404


def test_generate_submission_metadata(tmp_path: Path):
    client, import_id, asset_ids = client_with_catalog(tmp_path)

    resp = client.post(
        "/api/submissions/generate-metadata",
        json={
            "asset_ids": asset_ids,
            "import_id": import_id,
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "title" in data
    assert "caption" in data
    assert "tag_suggestions" in data
    assert "preset" in data["tag_suggestions"]
    assert "character" in data["tag_suggestions"]
    assert "action" in data["tag_suggestions"]
    assert data["r18"] is True
    assert data["allow_tag_edit"] is True


def test_submission_with_pixiv_metadata(tmp_path: Path):
    client, import_id, asset_ids = client_with_catalog(tmp_path)

    pixiv_payload = {
        "title": "暁美ほむら / akemi homura",
        "caption": "Hi there!",
        "tags": ["AIイラスト", "暁美ほむら"],
        "r18": True,
        "allow_tag_edit": True,
    }

    create_resp = client.post(
        "/api/submissions",
        json={
            "title": "带 Pixiv 元数据投稿",
            "source_import_id": import_id,
            "sets": {"all": [asset_ids[0]]},
            "pixiv": pixiv_payload,
        },
    )
    assert create_resp.status_code == 200
    res_data = create_resp.json()
    assert res_data["pixiv"] is not None
    assert res_data["pixiv"]["title"] == "暁美ほむら / akemi homura"
    assert res_data["pixiv"]["tags"] == ["AIイラスト", "暁美ほむら"]

    task_id = res_data["task_id"]
    get_resp = client.get(f"/api/submissions/{task_id}")
    assert get_resp.status_code == 200
    get_data = get_resp.json()
    assert get_data["pixiv"] is not None
    assert get_data["pixiv"]["title"] == "暁美ほむら / akemi homura"
    assert get_data["pixiv"]["tags"] == ["AIイラスト", "暁美ほむら"]


def test_publish_to_pixiv_endpoint_missing_cookie(tmp_path: Path):
    client, import_id, asset_ids = client_with_catalog(tmp_path)

    create_resp = client.post(
        "/api/submissions",
        json={
            "title": "待发布投稿",
            "source_import_id": import_id,
            "sets": {"all": [asset_ids[0]]},
            "pixiv": {"title": "待发布投稿", "tags": ["AIイラスト"]},
        },
    )
    assert create_resp.status_code == 200
    task_id = create_resp.json()["task_id"]

    # 未配置 cookie 时调用 publish 接口
    pub_resp = client.post(f"/api/submissions/{task_id}/publish/pixiv", json={})
    assert pub_resp.status_code == 400
    assert pub_resp.json()["detail"]["code"] == "cookie_missing"


def test_schedule_publish_endpoint_validation_and_toggle(tmp_path: Path, monkeypatch):
    client, import_id, asset_ids = client_with_catalog(tmp_path)

    create_resp = client.post(
        "/api/submissions",
        json={
            "title": "定时投稿测试",
            "source_import_id": import_id,
            "sets": {"all": [asset_ids[0]]},
            "pixiv": {"title": "定时投稿测试", "tags": ["AIイラスト"]},
        },
    )
    assert create_resp.status_code == 200
    task_id = create_resp.json()["task_id"]

    # 1. 尝试开启定时发布但没有 scheduled_at
    resp1 = client.post(f"/api/submissions/{task_id}/schedule-publish", json={"enable": True})
    assert resp1.status_code == 422
    assert resp1.json()["detail"]["code"] == "missing_scheduled_at"

    # 2. 提供 scheduled_at 但缺少 Cookie
    resp2 = client.post(
        f"/api/submissions/{task_id}/schedule-publish",
        json={"enable": True, "scheduled_at": "2026-09-05T20:00:00+08:00"},
    )
    assert resp2.status_code == 422
    assert resp2.json()["detail"]["code"] == "missing_cookie"

    # 3. 设置 Cookie 但尚未导出发布包
    monkeypatch.setenv("PIXIV_COOKIE", "PHPSESSID=test_session")
    resp_no_build = client.post(
        f"/api/submissions/{task_id}/schedule-publish",
        json={"enable": True, "scheduled_at": "2026-09-05T20:00:00+08:00"},
    )
    assert resp_no_build.status_code == 422
    assert resp_no_build.json()["detail"]["code"] == "missing_build_package"

    # 4. 执行导出生成构建包
    from publishing_workspace.packages.builder import PackageBuilder
    PackageBuilder().build(tmp_path, task_id)

    # 5. 导出构建包后成功开启定时发布 (测试带 allow_delay 与 max_delay_minutes)
    resp3 = client.post(
        f"/api/submissions/{task_id}/schedule-publish",
        json={
            "enable": True,
            "scheduled_at": "2026-09-05T20:00:00+08:00",
            "allow_delay": True,
            "max_delay_minutes": 120,
        },
    )
    assert resp3.status_code == 200
    data3 = resp3.json()
    assert data3["success"] is True
    assert data3["scheduled_publish"] is True
    assert data3["allow_delay"] is True
    assert data3["max_delay_minutes"] == 120

    # 4. 获取投稿详情，验证 scheduled_publish=True 及 allow_delay
    get_resp = client.get(f"/api/submissions/{task_id}")
    assert get_resp.status_code == 200
    get_data = get_resp.json()
    assert get_data["scheduled_publish"] is True
    assert get_data["scheduled_at"] == "2026-09-05T20:00:00+08:00"
    assert get_data["allow_delay"] is True
    assert get_data["max_delay_minutes"] == 120

    # 5. 取消定时发布
    resp4 = client.post(
        f"/api/submissions/{task_id}/schedule-publish",
        json={"enable": False},
    )
    assert resp4.status_code == 200
    assert resp4.json()["scheduled_publish"] is False

    # 6. 再次获取投稿详情，验证 scheduled_publish=False
    get_resp2 = client.get(f"/api/submissions/{task_id}")
    assert get_resp2.status_code == 200
    assert get_resp2.json()["scheduled_publish"] is False


def test_library_assets_sorting(tmp_path: Path):
    client, import_id, asset_ids = client_with_catalog(tmp_path)

    # 1. 默认正序 (order_asc)
    resp_asc = client.get(f"/api/library/assets?import_id={import_id}&sort_by=order_asc")
    assert resp_asc.status_code == 200
    items_asc = resp_asc.json()["items"]
    ids_asc = [it["asset_id"] for it in items_asc]
    assert ids_asc == asset_ids

    # 2. 逆序 (order_desc)
    resp_desc = client.get(f"/api/library/assets?import_id={import_id}&sort_by=order_desc")
    assert resp_desc.status_code == 200
    items_desc = resp_desc.json()["items"]
    ids_desc = [it["asset_id"] for it in items_desc]
    assert ids_desc == list(reversed(asset_ids))

    # 3. 按名称升序 (name_asc)
    resp_name = client.get(f"/api/library/assets?import_id={import_id}&sort_by=name_asc")
    assert resp_name.status_code == 200
    items_name = resp_name.json()["items"]
    names = [it["display_name"].casefold() for it in items_name]
    assert names == sorted(names)


def test_imports_summary_ordering(tmp_path: Path):
    client, import_id, _ = client_with_catalog(tmp_path)
    resp = client.get("/api/imports")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) >= 1
    assert "import_id" in data[0]
    assert "source_ref" in data[0]
    assert "total_items" in data[0]
    assert data[0]["total_items"] >= 1


def test_update_build_image_syncs_across_all_folders_and_archives(tmp_path: Path):
    import io
    import zipfile
    from PIL import Image
    from publishing_workspace.packages.builder import PackageBuilder

    client, import_id, asset_ids = client_with_catalog(tmp_path)

    # 1. 创建投稿任务并导出构建包 (包含 all, post, cover)
    create_resp = client.post(
        "/api/submissions",
        json={
            "title": "打码同步测试",
            "source_import_id": import_id,
            "sets": {"all": [asset_ids[0]], "post": [asset_ids[0]], "cover": [asset_ids[0]]},
            "pixiv": {"title": "打码同步测试", "tags": ["AIイラスト"]},
        },
    )
    assert create_resp.status_code == 200
    task_id = create_resp.json()["task_id"]

    build_res = PackageBuilder().build(tmp_path, task_id)

    # 2. 生成一张新的已打码图片数据 (绿色 8x8)
    buf = io.BytesIO()
    Image.new("RGB", (8, 8), "green").save(buf, format="PNG")
    new_png_bytes = buf.getvalue()

    # 获取第一张图片的文件名
    first_img_name = [f.name for f in (build_res.output_paths["all"]).iterdir()][0]

    # 3. 发送 PUT 请求更新 "all" 下的第一张图片
    put_resp = client.put(
        f"/api/submissions/{task_id}/build-images/all/{first_img_name}",
        content=new_png_bytes,
        headers={"Content-Type": "image/png"},
    )
    assert put_resp.status_code == 200
    data = put_resp.json()
    assert data["success"] is True
    assert set(data["updated_selections"]) == {"all", "post", "cover"}

    # 4. 验证磁盘上 output/all, output/post, output/cover 中的图片内容均已同步更新为绿色图片数据
    from publishing_workspace.config import load_workspace
    from publishing_workspace.tasks.paths import TaskPaths
    paths, _ = load_workspace(tmp_path)
    task_paths = TaskPaths.from_workspace(paths, task_id)
    latest_output = task_paths.builds_root / "latest" / "output"

    for sel in ("all", "post", "cover"):
        img_file = latest_output / sel / first_img_name
        assert img_file.is_file(), f"{sel}/{first_img_name} 应当存在"
        assert img_file.read_bytes() == new_png_bytes, f"{sel}/{first_img_name} 内容未同步覆盖"


def test_asset_details_includes_snapshots(tmp_path: Path):
    client, import_id, asset_ids = client_with_catalog(tmp_path)
    asset_id = asset_ids[0]

    resp = client.get(f"/api/assets/{asset_id}/details")
    assert resp.status_code == 200
    data = resp.json()
    assert "snapshots" in data
    assert len(data["snapshots"]) >= 1
    snap = data["snapshots"][0]
    assert snap["import_id"] == import_id
    assert snap["source_order"] == 0
    assert "name" in snap

    snap_resp = client.get(f"/api/assets/{asset_id}/snapshots")
    assert snap_resp.status_code == 200
    snap_data = snap_resp.json()
    assert snap_data["asset_id"] == asset_id
    assert len(snap_data["snapshots"]) >= 1


def test_asset_details_includes_related(tmp_path: Path):
    client, import_id, asset_ids = client_with_catalog(tmp_path)
    asset_id = asset_ids[0]

    rel_resp = client.get(f"/api/assets/{asset_id}/related")
    assert rel_resp.status_code == 200
    rel_data = rel_resp.json()
    assert "dimensions" in rel_data
    assert "same_batch" in rel_data["dimensions"]
    assert "same_seed" in rel_data["dimensions"]
    assert "time_adjacent" in rel_data["dimensions"]


def test_library_batch_actions(tmp_path: Path):
    client, import_id, asset_ids = client_with_catalog(tmp_path)
    assert len(asset_ids) >= 1

    # 1. 批量收藏
    fav_resp = client.post("/api/library/batch-action", json={"asset_ids": asset_ids, "action": "favorite"})
    assert fav_resp.status_code == 200
    assert fav_resp.json()["success"] is True

    # 2. 批量打标签
    tag_resp = client.post("/api/library/batch-action", json={"asset_ids": asset_ids, "action": "add_tags", "tags": ["batch_test_tag"]})
    assert tag_resp.status_code == 200

    # 3. 批量标记已投稿
    post_resp = client.post("/api/library/batch-action", json={"asset_ids": asset_ids, "action": "mark_posted"})
    assert post_resp.status_code == 200

    # 4. 批量取消收藏
    unfav_resp = client.post("/api/library/batch-action", json={"asset_ids": asset_ids, "action": "unfavorite"})
    assert unfav_resp.status_code == 200








