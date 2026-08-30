from __future__ import annotations

from pathlib import Path
from fastapi.testclient import TestClient

from publishing_workspace.config import init_workspace
from publishing_workspace.web.schedule_api import create_app


def test_calendar_page_contains_only_calendar_surface(tmp_path: Path):
    init_workspace(tmp_path)
    client = TestClient(create_app(tmp_path))

    response = client.get("/calendar")

    assert response.status_code == 200
    assert "月度投稿计划" in response.text
    assert "classify.yaml" not in response.text


def test_library_page_contains_filters_and_submission_editor(tmp_path: Path):
    init_workspace(tmp_path)
    client = TestClient(create_app(tmp_path))

    response = client.get("/library")

    assert response.status_code == 200
    assert "素材库" in response.text
    assert "Submission Editor" in response.text
    assert "classify.yaml" in response.text
    assert "pixiv-thumb-section" in response.text
    assert "pixiv-crop-dialog" in response.text



def test_root_serves_calendar_page(tmp_path: Path):
    init_workspace(tmp_path)
    client = TestClient(create_app(tmp_path))

    response = client.get("/")

    assert response.status_code == 200
    assert "月度投稿计划" in response.text


def test_legacy_schedule_page_accessible(tmp_path: Path):
    init_workspace(tmp_path)
    client = TestClient(create_app(tmp_path))

    response = client.get("/schedule.html")

    assert response.status_code == 200
    assert "Publishing Workspace" in response.text


def test_static_javascript_files_syntax():
    import shutil
    import subprocess

    node_bin = shutil.which("node")
    if not node_bin:
        return

    static_dir = Path(__file__).parent.parent / "src" / "publishing_workspace" / "web" / "static"
    js_files = list(static_dir.glob("*.js"))
    assert len(js_files) > 0

    for js_file in js_files:
        res = subprocess.run([node_bin, "--check", str(js_file)], capture_output=True, text=True)
        assert res.returncode == 0, f"JS Syntax Error in {js_file.name}:\n{res.stderr}"
