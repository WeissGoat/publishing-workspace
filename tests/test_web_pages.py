from __future__ import annotations

import re
from pathlib import Path

from fastapi.testclient import TestClient

from publishing_workspace.config import init_workspace
from publishing_workspace.web.schedule_api import create_app

APP_DIR = Path(__file__).parent.parent / "src" / "publishing_workspace" / "web" / "static" / "app"


def _client(tmp_path: Path) -> TestClient:
    init_workspace(tmp_path)
    return TestClient(create_app(tmp_path))


def test_page_routes_serve_single_page_app(tmp_path: Path):
    client = _client(tmp_path)

    for path in ("/", "/library", "/calendar"):
        response = client.get(path)
        assert response.status_code == 200, path
        assert '<div id="app"></div>' in response.text
        assert response.headers["cache-control"] == "no-cache"


def test_built_assets_referenced_by_index_are_served(tmp_path: Path):
    client = _client(tmp_path)

    html = client.get("/").text
    assets = re.findall(r'(?:src|href)="(/app/assets/[^"]+)"', html)
    assert assets, "index.html 应引用 /app/assets 下的构建产物"
    for asset in assets:
        assert client.get(asset).status_code == 200, asset


def test_legacy_schedule_page_redirects_to_calendar(tmp_path: Path):
    client = _client(tmp_path)

    response = client.get("/schedule.html", follow_redirects=False)

    assert response.status_code == 307
    assert response.headers["location"] == "/calendar"


def test_api_routes_are_not_shadowed_by_pages(tmp_path: Path):
    client = _client(tmp_path)

    response = client.get("/api/imports")

    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_built_app_is_committed():
    # 运行时不依赖 Node：构建产物随 Python 包一起分发
    assert (APP_DIR / "index.html").is_file()
    assert list((APP_DIR / "assets").glob("*.js"))
