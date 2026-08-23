from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from publishing_workspace.config import PublishingWorkspaceConfig, WorkspacePaths, init_workspace
from publishing_workspace.submissions.models import PixivMetadata, Submission
from publishing_workspace.submissions.pixiv_uploader import (
    PixivUploadService,
    build_pixiv_payload,
    collect_publishable_images,
    generate_image_order,
)
from publishing_workspace.submissions.repository import SubmissionRepository
from publishing_workspace.tasks.paths import TaskPaths
from publishing_workspace.tasks.repository import TaskRepository


def test_generate_image_order():
    payload = {"captionTranslations[en]": "", "title": "Test"}
    result = generate_image_order(3, payload)
    assert result["imageOrder[0][fileKey]"] == "0"
    assert result["imageOrder[0][type]"] == "newFile"
    assert result["imageOrder[1][fileKey]"] == "1"
    assert result["imageOrder[2][fileKey]"] == "2"


def test_build_pixiv_payload():
    pixiv_meta = PixivMetadata(
        title="暁美ほむら / akemi homura",
        caption="测试简介",
        tags=["AIイラスト", "魔法少女まどか☆マギカ"],
        r18=True,
        allow_tag_edit=True,
        ai_type=True,
    )
    payload = build_pixiv_payload(pixiv_meta, 2)
    assert payload["title"] == "暁美ほむら / akemi homura"
    assert payload["caption"] == "测试简介"
    assert payload["tags[]"] == ["AIイラスト", "魔法少女まどか☆マギカ"]
    assert payload["xRestrict"] == "r18"
    assert payload["aiType"] == "aiGenerated"
    assert payload["allowTagEdit"] == "true"
    assert payload["imageOrder[0][fileKey]"] == "0"
    assert payload["imageOrder[1][fileKey]"] == "1"


def test_build_pixiv_payload_general_age():
    pixiv_meta = PixivMetadata(
        title="全年龄标题",
        r18=False,
        ai_type=False,
    )
    payload = build_pixiv_payload(pixiv_meta, 1)
    assert payload["xRestrict"] == "general"
    assert payload["sexual"] == "false"
    assert payload["aiType"] == "notAiGenerated"


def test_collect_publishable_images(tmp_path: Path):
    ws_paths = WorkspacePaths.from_root(tmp_path)
    task_paths = TaskPaths.from_workspace(ws_paths, "sub-001")
    post_dir = task_paths.builds_root / "latest" / "post"
    post_dir.mkdir(parents=True)
    (post_dir / "0002_b.png").write_bytes(b"png2")
    (post_dir / "0001_a.png").write_bytes(b"png1")
    (post_dir / "note.txt").write_text("not an image")

    images = collect_publishable_images(task_paths)
    assert len(images) == 2
    assert images[0].name == "0001_a.png"
    assert images[1].name == "0002_b.png"


def test_upload_service_missing_cookie(tmp_path: Path):
    paths, _, _ = init_workspace(tmp_path)
    task_paths = TaskPaths.from_workspace(paths, "sub-001")
    task_paths.ensure_layout()
    task_paths.task_yaml.write_text("schema: publishing-workspace.task/v1\ntask_id: sub-001\n", encoding="utf-8")
    post_dir = task_paths.builds_root / "latest" / "post"
    post_dir.mkdir(parents=True)
    (post_dir / "0001.png").write_bytes(b"fake_png_data")

    submission = Submission(
        submission_id="sub-001",
        task_id="sub-001",
        title="Test Sub",
        sets={"all": ["asset1"]},
    )
    SubmissionRepository.save(task_paths, submission)

    service = PixivUploadService()
    res = service.publish_task(tmp_path, "sub-001")
    assert not res.success
    assert res.error_code == "cookie_missing"


@patch("requests.post")
@patch("requests.get")
def test_upload_service_success(mock_get, mock_post, tmp_path: Path, monkeypatch):
    paths, _, _ = init_workspace(tmp_path)
    task_paths = TaskPaths.from_workspace(paths, "sub-001")
    task_paths.ensure_layout()
    task_paths.task_yaml.write_text("schema: publishing-workspace.task/v1\ntask_id: sub-001\n", encoding="utf-8")
    post_dir = task_paths.builds_root / "latest" / "post"
    post_dir.mkdir(parents=True)
    (post_dir / "0001.png").write_bytes(b"fake_png_data")

    submission = Submission(
        submission_id="sub-001",
        task_id="sub-001",
        title="暁美ほむら",
        sets={"all": ["asset1"]},
        pixiv=PixivMetadata(title="暁美ほむら", tags=["AIイラスト"]),
    )
    SubmissionRepository.save(task_paths, submission)

    monkeypatch.setenv("PIXIV_COOKIE", "PHPSESSID=test_session_id")
    monkeypatch.setenv("PIXIV_TOKEN", "csrf_token_123")

    # Mock POST /ajax/work/create/illustration response
    mock_post_resp = MagicMock()
    mock_post_resp.status_code = 200
    mock_post_resp.json.return_value = {"error": False, "body": {"convertKey": "key_xyz"}}
    mock_post.return_value = mock_post_resp

    # Mock GET /progress response
    mock_get_resp = MagicMock()
    mock_get_resp.status_code = 200
    mock_get_resp.json.return_value = {"error": False, "body": {"status": "COMPLETE", "illustId": 987654321}}
    mock_get.return_value = mock_get_resp

    service = PixivUploadService()
    res = service.publish_task(tmp_path, "sub-001")

    assert res.success
    assert res.illust_id == "987654321"
    assert res.pixiv_url == "https://www.pixiv.net/artworks/987654321"
    assert res.published_at is not None

    # Verify saved submission.yaml
    saved_sub = SubmissionRepository.load(task_paths)
    assert saved_sub is not None
    assert saved_sub.pixiv.illust_id == "987654321"
    assert saved_sub.pixiv.last_publish_status == "success"


@patch("requests.post")
def test_upload_service_captcha_error(mock_post, tmp_path: Path, monkeypatch):
    paths, _, _ = init_workspace(tmp_path)
    task_paths = TaskPaths.from_workspace(paths, "sub-001")
    task_paths.ensure_layout()
    task_paths.task_yaml.write_text("schema: publishing-workspace.task/v1\ntask_id: sub-001\n", encoding="utf-8")
    post_dir = task_paths.builds_root / "latest" / "post"
    post_dir.mkdir(parents=True)
    (post_dir / "0001.png").write_bytes(b"fake_png_data")

    submission = Submission(
        submission_id="sub-001",
        task_id="sub-001",
        title="Test Sub",
        sets={"all": ["asset1"]},
    )
    SubmissionRepository.save(task_paths, submission)

    monkeypatch.setenv("PIXIV_COOKIE", "PHPSESSID=test_session_id")

    mock_post_resp = MagicMock()
    mock_post_resp.status_code = 200
    mock_post_resp.json.return_value = {
        "error": True,
        "body": {"errors": {"gRecaptchaResponse": "Invalid"}},
        "message": "captcha error",
    }
    mock_post.return_value = mock_post_resp

    service = PixivUploadService()
    res = service.publish_task(tmp_path, "sub-001")

    assert not res.success
    assert res.error_code == "captcha_required"
    assert "安全验证码" in res.error

