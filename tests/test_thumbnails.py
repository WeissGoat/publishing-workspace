from __future__ import annotations

import io
import os
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image

from publishing_workspace.web.schedule_api import create_app
from publishing_workspace.web.thumbnails import THUMBNAIL_MEDIA_TYPE, thumbnail_path, thumbnail_width

from test_plan_search import seed_catalog


def _big_png(path: Path, size: tuple[int, int] = (1200, 1800)) -> None:
    Image.new("RGB", size, "purple").save(path)


def test_thumbnail_width_snaps_to_fixed_buckets():
    assert thumbnail_width(16) == 320
    assert thumbnail_width(321) == 640
    assert thumbnail_width(5000) == 960


def test_thumbnail_is_generated_cached_and_revalidated(tmp_path: Path):
    paths, _, assets = seed_catalog(tmp_path)
    asset = assets[0]
    _big_png(Path(asset.path))
    client = TestClient(create_app(tmp_path))

    response = client.get(f"/api/assets/{asset.asset_id}/thumbnail?w=500")
    assert response.status_code == 200
    assert response.headers["content-type"] == THUMBNAIL_MEDIA_TYPE
    with Image.open(io.BytesIO(response.content)) as thumb:
        assert thumb.size == (640, 960)
    cached = thumbnail_path(paths.cache / "thumbnails", asset.asset_id, 640)
    assert cached.is_file()

    etag = response.headers["etag"]
    not_modified = client.get(
        f"/api/assets/{asset.asset_id}/thumbnail?w=500", headers={"If-None-Match": etag}
    )
    assert not_modified.status_code == 304
    assert not_modified.content == b""


def test_thumbnail_regenerates_when_source_is_overwritten(tmp_path: Path):
    paths, _, assets = seed_catalog(tmp_path)
    asset = assets[0]
    source = Path(asset.path)
    _big_png(source)
    client = TestClient(create_app(tmp_path))
    first = client.get(f"/api/assets/{asset.asset_id}/thumbnail")
    assert first.status_code == 200

    # 模拟局部重绘覆盖写入原图
    _big_png(source, (900, 900))
    cached = thumbnail_path(paths.cache / "thumbnails", asset.asset_id, 320)
    future = cached.stat().st_mtime_ns + 5_000_000_000
    os.utime(source, ns=(future, future))

    second = client.get(
        f"/api/assets/{asset.asset_id}/thumbnail", headers={"If-None-Match": first.headers["etag"]}
    )
    assert second.status_code == 200
    with Image.open(io.BytesIO(second.content)) as thumb:
        assert thumb.size == (320, 320)


def test_thumbnail_unknown_asset_is_404(tmp_path: Path):
    seed_catalog(tmp_path)
    client = TestClient(create_app(tmp_path))
    assert client.get("/api/assets/sha256:missing/thumbnail").status_code == 404


def test_thumbnail_falls_back_to_original_for_unreadable_image(tmp_path: Path):
    _, _, assets = seed_catalog(tmp_path)
    asset = assets[0]
    Path(asset.path).write_bytes(b"not an image")
    client = TestClient(create_app(tmp_path))

    response = client.get(f"/api/assets/{asset.asset_id}/thumbnail")
    assert response.status_code == 200
    assert response.content == b"not an image"
