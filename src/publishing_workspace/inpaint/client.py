from __future__ import annotations

import ast
import asyncio
import io
import json
import logging
import os
import random
import zipfile
from pathlib import Path
from typing import Any

import httpx
from PIL import Image

from .mask import mask_to_novelai_png_bytes

logger = logging.getLogger(__name__)

DEFAULT_NAI_CLIENT_PATH = Path(r"F:\my_project\new\tags_machine\novelai\client.py")
NOVELAI_IMAGE_URL = "https://image.novelai.net/ai/generate-image"


def _usable_token(value: str | None) -> str | None:
    if not value:
        return None
    token = str(value).strip()
    if not token or (token.startswith("${") and token.endswith("}")):
        return None
    return token


def _extract_token_from_file(path: Path) -> str | None:
    if not path.is_file():
        return None
    try:
        source = path.read_text(encoding="utf-8")
        module = ast.parse(source)
        for node in module.body:
            if isinstance(node, ast.ClassDef) and node.name == "NAIClient":
                for child in node.body:
                    if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)) and child.name == "get_access_token":
                        for stmt in ast.walk(child):
                            if isinstance(stmt, ast.Return) and isinstance(stmt.value, ast.Constant):
                                if isinstance(stmt.value.value, str):
                                    return _usable_token(stmt.value.value)
        for node in module.body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == "get_access_token":
                for stmt in ast.walk(node):
                    if isinstance(stmt, ast.Return) and isinstance(stmt.value, ast.Constant):
                        if isinstance(stmt.value.value, str):
                            return _usable_token(stmt.value.value)
    except Exception as exc:
        logger.warning("解析 NAI Token 异常: %s", exc)
    return None


def resolve_novelai_token(
    configured_token: str | None = None,
    client_py_path: Path | str | None = None,
) -> str | None:
    """Resolve NovelAI access token from config, env, or client.py helper."""
    token = _usable_token(configured_token)
    if token:
        return token

    token = _usable_token(os.environ.get("NAI_ACCESS_TOKEN"))
    if token:
        return token

    path = Path(client_py_path or os.environ.get("NAI_CLIENT_PY") or DEFAULT_NAI_CLIENT_PATH)
    return _extract_token_from_file(path)


def _novelai_inpaint_model(model: str) -> str:
    m = model.strip()
    if m.endswith("-inpainting") or "nai-diffusion-2" in m:
        return m
    if m == "nai-diffusion-4-curated-preview":
        return "nai-diffusion-4-curated-inpainting"
    return f"{m}-inpainting"


def _extract_images_from_response(content: bytes) -> list[bytes]:
    """Extract PNG image bytes from NovelAI zip response or direct image bytes."""
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return [content]

    results: list[bytes] = []
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            for name in zf.namelist():
                if name.casefold().endswith((".png", ".jpg", ".webp")):
                    data = zf.read(name)
                    if data.startswith(b"\x89PNG\r\n\x1a\n") or len(data) > 100:
                        results.append(data)
    except Exception as exc:
        logger.warning("解压 NovelAI 响应 Zip 失败: %s, 尝试直接作为图片数据", exc)
        if len(content) > 100:
            results.append(content)

    return results


class NovelAIInpaintClient:
    def __init__(self, token: str | None = None, timeout_seconds: float = 120.0):
        self.token = token or resolve_novelai_token()
        self.timeout_seconds = timeout_seconds

    def build_parameters(
        self,
        *,
        width: int,
        height: int,
        prompt: str,
        negative_prompt: str,
        strength: float = 0.7,
        seed: int | None = None,
        steps: int = 28,
        scale: float = 6.0,
        sampler: str = "k_euler_ancestral",
        noise_schedule: str = "karras",
        model: str = "nai-diffusion-4-5-full",
        cfg_rescale: float = 0.7,
        inpaint_img2img_strength: float = 1.0,
    ) -> dict[str, Any]:
        is_v4 = "4" in model
        actual_seed = seed if seed is not None else random.randint(0, 2**32 - 1)

        params: dict[str, Any] = {
            "params_version": 4 if is_v4 else 1,
            "width": width,
            "height": height,
            "scale": scale,
            "sampler": sampler,
            "steps": steps,
            "seed": actual_seed,
            "n_samples": 1,
            "strength": strength,
            "noise": 0.0,
            "ucPresetId": "none",
            "qualityPresetId": "none",
            "autoSmea": False,
            "dynamic_thresholding": False,
            "controlnet_strength": 1.0,
            "legacy": False,
            "add_original_image": False,
            "cfg_rescale": cfg_rescale,
            "noise_schedule": noise_schedule,
            "legacy_v3_extend": False,
            "skip_cfg_above_sigma": int((width * height / 1011712) ** 0.5 * 19),
            "use_coords": False,
            "normalize_reference_strength_multiple": True,
            "inpaintImg2ImgStrength": inpaint_img2img_strength,
            "image": "image",
            "mask": "mask",
            "v4_prompt": {
                "caption": {
                    "base_caption": prompt,
                    "char_captions": [],
                },
                "use_coords": False,
                "use_order": True,
            },
            "v4_negative_prompt": {
                "caption": {
                    "base_caption": negative_prompt,
                    "char_captions": [],
                },
            },
        }
        return params

    async def generate_single(
        self,
        *,
        image_bytes: bytes,
        mask_bytes: bytes,
        prompt: str,
        negative_prompt: str,
        strength: float = 0.7,
        seed: int | None = None,
        model: str = "nai-diffusion-4-5-full",
        steps: int = 28,
        scale: float = 6.0,
        sampler: str = "k_euler_ancestral",
        noise_schedule: str = "karras",
        cfg_rescale: float = 0.7,
    ) -> tuple[bytes, int]:
        """Generate a single inpaint image result. Returns (image_bytes, seed)."""
        token = self.token or resolve_novelai_token()
        if not token:
            raise ValueError("未检测到有效的 NovelAI Access Token，请配置 NAI_ACCESS_TOKEN 或检查 client.py")

        with Image.open(io.BytesIO(image_bytes)) as img:
            width, height = img.size

        is_v4 = "4" in model
        inpaint_mask_bytes = mask_to_novelai_png_bytes(mask_bytes, (width, height), is_v4=is_v4)
        api_model = _novelai_inpaint_model(model)
        actual_seed = seed if seed is not None else random.randint(0, 2**32 - 1)

        params = self.build_parameters(
            width=width,
            height=height,
            prompt=prompt,
            negative_prompt=negative_prompt,
            strength=strength,
            seed=actual_seed,
            steps=steps,
            scale=scale,
            sampler=sampler,
            noise_schedule=noise_schedule,
            model=model,
            cfg_rescale=cfg_rescale,
        )

        request_json = {
            "input": prompt,
            "model": api_model,
            "action": "infill",
            "parameters": params,
        }

        # 构造 multipart/form-data，完全对齐 NovelAI 官方规范
        files = {
            "image": ("blob", image_bytes, "image/png"),
            "mask": ("blob", inpaint_mask_bytes, "image/png"),
            "request": ("blob", json.dumps(request_json, ensure_ascii=False), "application/json"),
        }

        headers = {
            "Authorization": f"Bearer {token}",
            "User-Agent": "NovelAI-Workspace/1.0",
        }

        max_retries = 3
        for attempt in range(max_retries + 1):
            async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
                resp = await client.post(NOVELAI_IMAGE_URL, headers=headers, files=files)
                if resp.status_code == 429:
                    if attempt < max_retries:
                        retry_after = 2.0 * (2**attempt)
                        logger.warning(
                            "NovelAI 接口返回 429 限流，等待 %.1f 秒后进行第 %d/%d 次重试...",
                            retry_after,
                            attempt + 1,
                            max_retries,
                        )
                        await asyncio.sleep(retry_after)
                        continue
                    else:
                        error_msg = f"NovelAI Inpaint 请求遭遇 429 限流且已达最大重试次数: {resp.text[:300]}"
                        logger.error(error_msg)
                        raise RuntimeError(error_msg)

                if resp.status_code != 200:
                    error_msg = f"NovelAI Inpaint 请求失败 (HTTP {resp.status_code}): {resp.text[:300]}"
                    logger.error(error_msg)
                    raise RuntimeError(error_msg)

                images = _extract_images_from_response(resp.content)
                if not images:
                    raise RuntimeError("NovelAI 响应中未找到生成的图片数据")

                return images[0], actual_seed

        raise RuntimeError("NovelAI Inpaint 重试耗尽未获取到结果")
