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


