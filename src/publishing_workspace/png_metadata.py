from __future__ import annotations

import struct
import zlib
from pathlib import Path


PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


import io
from PIL import Image
from PIL.PngImagePlugin import PngInfo


def read_png_text_chunks(path_or_data: str | Path | bytes) -> dict[str, str]:
    """读取 PNG 的 tEXt、zTXt 和 iTXt 文本块。"""
    if isinstance(path_or_data, bytes):
        data = path_or_data
    else:
        data = Path(path_or_data).read_bytes()
    if not data.startswith(PNG_SIGNATURE):
        raise ValueError("不是 PNG 数据")

    chunks: dict[str, str] = {}
    offset = len(PNG_SIGNATURE)
    while offset + 12 <= len(data):
        length = struct.unpack(">I", data[offset : offset + 4])[0]
        chunk_type = data[offset + 4 : offset + 8]
        chunk_data = data[offset + 8 : offset + 8 + length]
        offset += 12 + length
        if chunk_type == b"tEXt":
            key, value = _split_keyword_text(chunk_data)
            chunks[key] = value
        elif chunk_type == b"zTXt":
            key, value = _decode_ztxt(chunk_data)
            chunks[key] = value
        elif chunk_type == b"iTXt":
            key, value = _decode_itxt(chunk_data)
            chunks[key] = value
        elif chunk_type == b"IEND":
            break
    return chunks


def embed_png_text_chunks(image_bytes: bytes, chunks: dict[str, str]) -> bytes:
    """将文本元数据字典完整塞回 PNG 图片中，保留原图所有 ComfyUI/WebUI/NAI 参数。"""
    if not chunks:
        return image_bytes
    try:
        im = Image.open(io.BytesIO(image_bytes))
        png_info = PngInfo()
        for k, v in chunks.items():
            if isinstance(k, str) and isinstance(v, str):
                png_info.add_text(k, v)
        
        buf = io.BytesIO()
        im.save(buf, format="PNG", pnginfo=png_info)
        return buf.getvalue()
    except Exception:
        return image_bytes


def _split_keyword_text(chunk_data: bytes) -> tuple[str, str]:
    if b"\x00" not in chunk_data:
        raise ValueError("PNG tEXt 块缺少 keyword 分隔符")
    raw_key, raw_value = chunk_data.split(b"\x00", 1)
    return _decode_text(raw_key), _decode_text(raw_value)


def _decode_ztxt(chunk_data: bytes) -> tuple[str, str]:
    if b"\x00" not in chunk_data:
        raise ValueError("PNG zTXt 块缺少 keyword 分隔符")
    raw_key, rest = chunk_data.split(b"\x00", 1)
    if not rest or rest[0] != 0:
        raise ValueError("PNG zTXt 使用了不支持的压缩方式")
    return _decode_text(raw_key), _decode_text(zlib.decompress(rest[1:]))


def _decode_itxt(chunk_data: bytes) -> tuple[str, str]:
    parts = chunk_data.split(b"\x00", 4)
    if len(parts) < 5:
        raise ValueError("PNG iTXt 块格式无效")
    raw_key, compression_flag, compression_method, _language_tag, rest = parts
    _translated_keyword, raw_text = (
        rest.split(b"\x00", 1) if b"\x00" in rest else (b"", rest)
    )
    if compression_flag == b"\x01":
        if compression_method != b"\x00":
            raise ValueError("PNG iTXt 使用了不支持的压缩方式")
        raw_text = zlib.decompress(raw_text)
    return _decode_text(raw_key), _decode_text(raw_text)


def _decode_text(value: bytes) -> str:
    for encoding in ("utf-8", "latin-1"):
        try:
            return value.decode(encoding)
        except UnicodeDecodeError:
            continue
    return value.decode("utf-8", errors="replace")
