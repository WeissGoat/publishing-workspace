from __future__ import annotations

import os
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..config import load_workspace
from ..logging import get_logger
from ..models import utc_now_iso
from ..packages.builder import PackageBuilder
from ..tasks.paths import TaskPaths
from .models import PixivMetadata
from .pixiv_metadata import create_pixiv_session, resolve_proxies
from .repository import SubmissionRepository

logger = get_logger(__name__)

PIXIV_CREATE_URL = "https://www.pixiv.net/ajax/work/create/illustration"
PIXIV_PROGRESS_URL = "https://www.pixiv.net/ajax/work/create/illustration/progress"


@dataclass
class PixivUploadResult:
    """Pixiv 上传结果。"""

    success: bool
    task_id: str
    illust_id: str | None = None
    pixiv_url: str | None = None
    published_at: str | None = None
    error: str | None = None
    error_code: str | None = None


def generate_image_order(file_count: int, payload: dict[str, Any]) -> dict[str, Any]:
    """生成符合 Pixiv 顺序规范的 imageOrder 字典字段。"""
    image_order: dict[str, Any] = {}
    for index in range(file_count):
        image_order[f"imageOrder[{index}][fileKey]"] = str(index)
        image_order[f"imageOrder[{index}][type]"] = "newFile"

    # 寻找 'captionTranslations[en]' 字段的位置注入，保持与官方行为一致
    new_payload = {}
    inserted = False
    for k, v in payload.items():
        new_payload[k] = v
        if k == "captionTranslations[en]":
            new_payload.update(image_order)
            inserted = True

    if not inserted:
        new_payload.update(image_order)

    return new_payload


def build_pixiv_payload(
    pixiv_meta: PixivMetadata,
    file_count: int,
    *,
    fallback_title: str = "",
    default_tags: list[str] | None = None,
) -> dict[str, Any]:
    """组装符合 Pixiv AJAX 接口规范的表单 payload。"""
    title = (pixiv_meta.title or "").strip() or fallback_title.strip() or "Untitled"
    caption = pixiv_meta.caption or ""

    # 标签清洗与兜底：Pixiv 限制 1~10 个标签
    tags = [str(t).strip() for t in (pixiv_meta.tags or []) if str(t).strip()]
    if not tags and default_tags:
        tags = [str(t).strip() for t in default_tags if str(t).strip()]
    if not tags:
        tags = ["AIイラスト", "オリジナル"] if pixiv_meta.ai_type else ["イラスト", "オリジナル"]

    # 确保标签去重且不超过 10 个
    seen = set()
    cleaned_tags = []
    for t in tags:
        if t.casefold() not in seen:
            seen.add(t.casefold())
            cleaned_tags.append(t)
    tags = cleaned_tags[:10]

    is_r18 = bool(pixiv_meta.r18)
    allow_tag_edit = bool(pixiv_meta.allow_tag_edit)
    ai_type = "aiGenerated" if pixiv_meta.ai_type else "notAiGenerated"

    suggested_tags = [str(t).strip() for t in (pixiv_meta.suggested_tags or []) if str(t).strip()]

    payload: dict[str, Any] = {
        "aiType": ai_type,
        "allowComment": "true",
        "allowTagEdit": "true" if allow_tag_edit else "false",
        "attributes[bl]": "false",
        "attributes[furry]": "false",
        "attributes[lo]": "false",
        "attributes[yuri]": "false",
        "caption": caption,
        "captionTranslations[en]": "",
        "original": "true",
        "ratings[antisocial]": "false",
        "ratings[drug]": "false",
        "ratings[religion]": "false",
        "ratings[thoughts]": "false",
        "ratings[violent]": "false",
        "responseAutoAccept": "false",
        "restrict": "public",
        "suggestedTags[]": suggested_tags,
        "tags[]": tags,
        "title": title,
        "titleTranslations[en]": "",
        "xRestrict": "r18" if is_r18 else "general",
    }

    if not is_r18:
        payload["sexual"] = "false"

    return generate_image_order(file_count, payload)


def collect_publishable_images(task_paths: TaskPaths) -> list[Path]:
    """从投稿任务构建产物目录中提取待上传图片列表（按文件名自然排序）。"""
    latest_build = task_paths.builds_root / "latest"
    if not latest_build.is_dir():
        return []

    # 优先检查 latest/output/post 与 latest/output/all，向下兼容 latest/post 与 latest/all
    candidates = [
        latest_build / "output" / "post",
        latest_build / "output" / "all",
        latest_build / "post",
        latest_build / "all",
    ]

    target_dir = None
    for cand in candidates:
        if cand.is_dir() and any(cand.iterdir()):
            target_dir = cand
            break

    if target_dir is None:
        return []

    valid_exts = {".png", ".jpg", ".jpeg", ".webp"}
    images = [p for p in target_dir.iterdir() if p.is_file() and p.suffix.lower() in valid_exts]
    images.sort(key=lambda p: p.name)
    return images


class PixivUploadService:
    """Pixiv 自动上传调度服务。"""

    def __init__(self, builder: PackageBuilder | None = None) -> None:
        self.builder = builder or PackageBuilder()

    def upload_images_to_pixiv(
        self,
        image_paths: list[Path],
        pixiv_meta: PixivMetadata,
        *,
        cookie: str,
        token: str = "",
        proxy: str | None = None,
        poll_timeout_seconds: int = 60,
        title_fallback: str = "",
        default_tags: list[str] | None = None,
    ) -> str:
        """执行 Pixiv 上传与转码轮询，成功返回作品 PID (illust_id)，失败抛出异常。"""
        clean_cookie = cookie.strip()
        if not clean_cookie:
            raise ValueError("未配置 Pixiv Cookie，请在 workspace.yaml 中配置 pixiv.pixiv_cookie")

        if not image_paths:
            raise ValueError("待上传图片列表为空")

        headers = {
            "accept": "application/json",
            "accept-language": "ja,en-US;q=0.9,en;q=0.8,zh-CN;q=0.7,zh;q=0.6",
            "cookie": clean_cookie,
            "dnt": "1",
            "origin": "https://www.pixiv.net",
            "referer": "https://www.pixiv.net/illustration/create",
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "same-origin",
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "sentry-trace": f"{uuid.uuid4().hex}-{uuid.uuid4().hex[:16]}-0",
        }
        if token and token.strip():
            headers["x-csrf-token"] = token.strip()

        proxies = resolve_proxies(proxy)
        session = create_pixiv_session(proxies=proxies, max_retries=5)

        payload = build_pixiv_payload(
            pixiv_meta,
            len(image_paths),
            fallback_title=title_fallback,
            default_tags=default_tags,
        )

        files = []
        file_handles = []
        try:
            for p in image_paths:
                fh = open(p, "rb")
                file_handles.append(fh)
                ext = p.suffix.lower()
                mime = "image/png" if ext == ".png" else "image/jpeg"
                files.append(("files[]", (p.name, fh, mime)))

            resp = session.post(
                PIXIV_CREATE_URL,
                headers=headers,
                data=payload,
                files=files,
                timeout=45,
            )
        finally:
            for fh in file_handles:
                fh.close()

        if resp.status_code != 200:
            logger.warning("Pixiv 投稿接口返回状态码异常：%s %s", resp.status_code, resp.text[:300])
            raise RuntimeError(f"Pixiv 服务器返回异常 (HTTP {resp.status_code})：{resp.text[:200]}")

        res_data = resp.json()
        if res_data.get("error"):
            msg = res_data.get("message") or ""
            err_dict = res_data.get("body", {}).get("errors", {}) if isinstance(res_data.get("body"), dict) else {}
            if "gRecaptchaResponse" in err_dict:
                raise RuntimeError("captcha_required: Pixiv 触发了安全验证码，请在浏览器中完成一次手动投稿以解除限制。")
            raise RuntimeError(f"Pixiv 上传被拒绝：{msg or err_dict or resp.text[:200]}")

        body = res_data.get("body", {})
        convert_key = body.get("convertKey")
        if not convert_key:
            raise RuntimeError(f"Pixiv 未返回 convertKey：{resp.text[:200]}")

        logger.info("Pixiv 上传请求已接受，convertKey=%s，开始轮询转码进度...", convert_key)

        # 轮询转码状态
        progress_url = f"{PIXIV_PROGRESS_URL}?convertKey={convert_key}&lang=zh"
        start_time = time.time()
        while time.time() - start_time < poll_timeout_seconds:
            try:
                poll_resp = session.get(
                    progress_url,
                    headers=headers,
                    timeout=15,
                )
                if poll_resp.status_code == 200:
                    poll_data = poll_resp.json()
                    poll_body = poll_data.get("body", {})
                    status = poll_body.get("status")
                    if status == "COMPLETE":
                        illust_id = poll_body.get("illustId")
                        if not illust_id:
                            raise RuntimeError("转码完成但未获取到 illustId")
                        logger.info("Pixiv 投稿成功发布！illustId=%s", illust_id)
                        return str(illust_id)
                    elif status == "FAILED":
                        raise RuntimeError(f"Pixiv 服务端转码失败：{poll_body}")
            except requests.exceptions.RequestException as e:
                logger.warning("轮询 Pixiv 转码进度遇到暂时性重试：%s", e)
            time.sleep(1)

        raise TimeoutError(f"Pixiv 转码轮询超时 ({poll_timeout_seconds}s)")

    def publish_task(
        self,
        root: str | Path,
        task_id: str,
        *,
        force_rebuild: bool = False,
        force_republish: bool = False,
        poll_timeout_seconds: int = 60,
    ) -> PixivUploadResult:
        """主入口：为指定 Task 执行导出检查、上传 Pixiv 并持久化结果。"""
        paths, config = load_workspace(root)
        task_paths = TaskPaths.from_workspace(paths, task_id)
        if not task_paths.task_yaml.is_file():
            return PixivUploadResult(
                success=False,
                task_id=task_id,
                error=f"投稿任务不存在：{task_id}",
                error_code="task_not_found",
            )

        submission = SubmissionRepository.load(task_paths)
        if submission is None:
            return PixivUploadResult(
                success=False,
                task_id=task_id,
                error="未能读取投稿配置",
                error_code="submission_not_found",
            )

        pixiv_meta = submission.pixiv or PixivMetadata()

        # 防重复发布校验
        if pixiv_meta.illust_id and not force_republish:
            return PixivUploadResult(
                success=False,
                task_id=task_id,
                illust_id=pixiv_meta.illust_id,
                pixiv_url=f"https://www.pixiv.net/artworks/{pixiv_meta.illust_id}",
                published_at=pixiv_meta.published_at,
                error=f"该投稿已发布过 (PID: {pixiv_meta.illust_id})，若需重新发布请确认",
                error_code="already_published",
            )

        # 提前校验 Cookie 配置
        cookie = config.pixiv.pixiv_cookie or os.environ.get("PIXIV_COOKIE", "")
        token = config.pixiv.pixiv_token or os.environ.get("PIXIV_TOKEN", "")

        if not cookie:
            return PixivUploadResult(
                success=False,
                task_id=task_id,
                error="未配置 Pixiv Cookie，请在 workspace.yaml 中配置 pixiv.pixiv_cookie",
                error_code="cookie_missing",
            )

        # 检查/获取导出产物
        images = collect_publishable_images(task_paths)
        if not images or force_rebuild:
            logger.info("未找到可用构建产物或要求强制重构，开始构建投稿包：%s", task_id)
            try:
                self.builder.build(root, task_id)
            except Exception as exc:
                return PixivUploadResult(
                    success=False,
                    task_id=task_id,
                    error=f"导出构建失败：{exc}",
                    error_code="build_failed",
                )
            images = collect_publishable_images(task_paths)

        if not images:
            return PixivUploadResult(
                success=False,
                task_id=task_id,
                error="投稿中没有任何图片素材可供发布",
                error_code="no_images",
            )

        try:
            illust_id = self.upload_images_to_pixiv(
                images,
                pixiv_meta,
                cookie=cookie,
                token=token,
                poll_timeout_seconds=poll_timeout_seconds,
                title_fallback=submission.title,
                default_tags=config.pixiv.default_tags,
            )

            # 回写持久化
            now_iso = utc_now_iso()
            pixiv_meta.illust_id = illust_id
            pixiv_meta.published_at = now_iso
            pixiv_meta.last_publish_status = "success"
            pixiv_meta.last_publish_error = None
            submission.pixiv = pixiv_meta
            SubmissionRepository.save(task_paths, submission)

            return PixivUploadResult(
                success=True,
                task_id=task_id,
                illust_id=illust_id,
                pixiv_url=f"https://www.pixiv.net/artworks/{illust_id}",
                published_at=now_iso,
            )
        except Exception as exc:
            err_msg = str(exc)
            err_code = "captcha_required" if "captcha_required" in err_msg else "upload_failed"
            logger.error("Pixiv 发布失败：%s", err_msg)

            # 记录失败状态
            pixiv_meta.last_publish_status = err_code
            pixiv_meta.last_publish_error = err_msg
            submission.pixiv = pixiv_meta
            SubmissionRepository.save(task_paths, submission)

            return PixivUploadResult(
                success=False,
                task_id=task_id,
                error=err_msg,
                error_code=err_code,
            )
