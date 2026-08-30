from pathlib import Path
import io
import pytest
from PIL import Image
from fastapi.testclient import TestClient

from publishing_workspace.config import init_workspace
from publishing_workspace.catalog.repository import CatalogRepository
from publishing_workspace.metadata.registry import default_image_node_reader_registry
from publishing_workspace.web.schedule_api import create_app
from publishing_workspace.inpaint.service import InpaintService
from publishing_workspace.inpaint.client import NovelAIInpaintClient


class MockInpaintClient(NovelAIInpaintClient):
    async def generate_single(self, **kwargs):
        buf = io.BytesIO()
        Image.new("RGB", (64, 64), "blue").save(buf, format="PNG")
        return buf.getvalue(), 12345678


def setup_inpaint_test_env(tmp_path: Path):
    paths, config, _ = init_workspace(tmp_path)
    catalog = CatalogRepository(paths.catalog, backups_dir=paths.backups)
    catalog.initialize()

    # 创建测试原图
    src_dir = tmp_path / "source"
    src_dir.mkdir(parents=True, exist_ok=True)
    img_path = src_dir / "inpaint_asset.png"
    Image.new("RGB", (64, 64), "yellow").save(img_path)

    with catalog.connection() as conn:
        stat = img_path.stat()
        res = catalog.ingest_asset(
            conn,
            img_path,
            expected_size=stat.st_size,
            expected_modified_ns=stat.st_mtime_ns,
            readers=default_image_node_reader_registry(),
            enrichers=[],
        )
        asset_id = res.asset.asset_id

    app = create_app(tmp_path)
    client = TestClient(app)
    return client, tmp_path, asset_id, img_path


def test_inpaint_api_workflow(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    # Mock InpaintClient in InpaintService
    monkeypatch.setattr(
        "publishing_workspace.inpaint.service.NovelAIInpaintClient",
        MockInpaintClient,
    )

    client, root, asset_id, img_path = setup_inpaint_test_env(tmp_path)

    # 1. 构造测试 Mask base64
    import base64
    mask_buf = io.BytesIO()
    Image.new("L", (64, 64), 255).save(mask_buf, format="PNG")
    mask_b64 = base64.b64encode(mask_buf.getvalue()).decode()

    # 2. 发送 POST /api/assets/{asset_id}/inpaint
    resp = client.post(
        f"/api/assets/{asset_id}/inpaint",
        json={
            "mask_base64": mask_b64,
            "prompt": "1girl, blue hair",
            "negative_prompt": "low quality",
            "strength": 0.7,
            "count": 2,
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["asset_id"] == asset_id
    assert len(data["candidates"]) == 2
    session_id = data["session_id"]
    cand_0 = data["candidates"][0]

    # 3. 获取候选图预览 GET /api/inpaint-cache/{session_id}/{filename}
    preview_resp = client.get(f"/api/inpaint-cache/{session_id}/{cand_0['filename']}")
    assert preview_resp.status_code == 200
    assert preview_resp.headers["content-type"] == "image/png"

    # 4. 确认应用 POST /api/assets/{asset_id}/inpaint/apply
    apply_resp = client.post(
        f"/api/assets/{asset_id}/inpaint/apply",
        json={
            "session_id": session_id,
            "candidate_id": cand_0["candidate_id"],
        },
    )
    assert apply_resp.status_code == 200
    apply_data = apply_resp.json()
    assert apply_data["success"] is True

    # 5. 验证原图文件已更新为蓝色图片
    with Image.open(img_path) as updated_img:
        pixel = updated_img.getpixel((32, 32))
        assert pixel == (0, 0, 255)
