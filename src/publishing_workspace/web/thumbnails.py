from __future__ import annotations

import os
import re
import uuid
from pathlib import Path

from PIL import Image, ImageOps, features

from ..logging import get_logger


logger = get_logger(__name__)

# 固定几档宽度，避免任意尺寸请求把缓存目录撑大；前端按卡片尺寸 × devicePixelRatio 选档
THUMBNAIL_WIDTHS = (320, 640, 960)
_FORMAT = ("WEBP", ".webp", "image/webp") if features.check("webp") else ("JPEG", ".jpg", "image/jpeg")
THUMBNAIL_MEDIA_TYPE = _FORMAT[2]
_UNSAFE_CHARS = re.compile(r"[^0-9A-Za-z_-]")


def thumbnail_width(requested: int) -> int:
    for width in THUMBNAIL_WIDTHS:
        if requested <= width:
            return width
    return THUMBNAIL_WIDTHS[-1]


def thumbnail_path(cache_root: Path, asset_id: str, width: int) -> Path:
    safe_id = _UNSAFE_CHARS.sub("_", asset_id)
    return cache_root / str(width) / safe_id[-2:] / f"{safe_id}{_FORMAT[1]}"


def ensure_thumbnail(source: Path, cache_root: Path, asset_id: str, width: int) -> Path:
    """返回磁盘缓存的缩略图；缓存缺失或原图更新（如局部重绘覆盖写入）时重新生成。"""
    target = thumbnail_path(cache_root, asset_id, width)
    source_mtime = source.stat().st_mtime_ns
    try:
        if target.stat().st_mtime_ns >= source_mtime:
            return target
    except OSError:
        pass

    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_name(f"{target.name}.{uuid.uuid4().hex}.tmp")
    try:
        with Image.open(source) as image:
            image.draft("RGB", (width, width * 4))
            image = ImageOps.exif_transpose(image)
            if image.width > width:
                image.thumbnail((width, width * 8), Image.Resampling.LANCZOS)
            has_alpha = image.mode in ("RGBA", "LA", "PA") or "transparency" in image.info
            if _FORMAT[0] == "JPEG" or not has_alpha:
                image = image.convert("RGB")
            elif image.mode != "RGBA":
                image = image.convert("RGBA")
            if _FORMAT[0] == "WEBP":
                image.save(tmp, "WEBP", quality=82, method=2)
            else:
                image.save(tmp, "JPEG", quality=85, optimize=True)
        try:
            os.replace(tmp, target)
        except OSError:
            # Windows 上目标文件正被其他请求读取时无法替换；已有并发生成的结果即可直接使用
            if not target.is_file():
                raise
    finally:
        tmp.unlink(missing_ok=True)
    return target
