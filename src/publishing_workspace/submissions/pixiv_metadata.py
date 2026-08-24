from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ..config import PixivAutoConfig
from ..logging import get_logger
from ..models import AssetRecord

logger = get_logger(__name__)

# CJK character range: Hiragana, Katakana, Han / Kanji
CJK_PATTERN = re.compile(r"[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff]")
SHORTCUT_SUFFIX_PATTERN = re.compile(r"\s*-\s*(?:快捷方式|副本|\d+)+.*$", re.IGNORECASE)
DANBOORU_PREFIX_PATTERN = re.compile(r"^\d*[a-zA-Z]*danbooru_(\d+_)?", re.IGNORECASE)
ACTION_PREFIX_PATTERN = re.compile(r"^(?:pn_)?act_", re.IGNORECASE)
ACTION_DATE_PATTERN = re.compile(r"^\d+_start_\d+_", re.IGNORECASE)
STAR_RATING_PATTERN = re.compile(r"_\d+star$", re.IGNORECASE)


@dataclass
class CharacterName:
    japanese_name: str = ""
    roman_name: str = ""
    display_name: str = ""
    extra_tags: list[str] = field(default_factory=list)


def parse_character_name(node_id: str) -> CharacterName | None:
    """从 Catalog 的 character node_id 中提取日文名、罗马音及附属标签。"""
    raw = str(node_id or "").strip()
    if not raw:
        return None

    # 1. 剔除 Windows 快捷方式及副本后缀
    clean = SHORTCUT_SUFFIX_PATTERN.sub("", raw).strip()
    if not clean:
        return None

    # 2. 如果包含 danbooru 前缀，剥离前缀
    is_danbooru = "danbooru_" in clean.lower()
    if is_danbooru:
        body = DANBOORU_PREFIX_PATTERN.sub("", clean).strip()
    else:
        # 去除开头纯数字
        body = re.sub(r"^\d+", "", clean).strip()

    if not body:
        return None

    # 3. 寻找 CJK 起始位置
    cjk_match = CJK_PATTERN.search(body)
    if cjk_match:
        idx = cjk_match.start()
        roman_raw = body[:idx].strip("_ ").strip()
        cjk_raw = body[idx:].strip("_ ").strip()

        # 分解 CJK 部分为主要名称与附加修饰 (如 `暁美ほむら _魔法少女` 或 `フェイト_テスタロッサ`)
        # 如果是 Katakana 之间用 _ 连接 (如 `フェイト_テスタロッサ`)，转换为日文标准间隔点 `・`
        parts = [p.strip() for p in re.split(r"[\s_]+", cjk_raw) if p.strip()]
        
        # 判断 parts 是否包含日文姓名复合词
        if len(parts) >= 2 and all(re.fullmatch(r"[\u30a0-\u30ff]+", p) for p in parts[:2]):
            # 片假名复合名
            primary_jp = "・".join(parts[:2])
            extra_tags = parts[2:]
        else:
            primary_jp = parts[0] if parts else cjk_raw
            extra_tags = parts[1:] if len(parts) > 1 else []

        roman_clean = roman_raw.replace("_", " ").strip()
        # 清理 roman 中的多余括号空格 (如 `plana (blue archive)`)
        roman_clean = re.sub(r"\s+", " ", roman_clean)

        if roman_clean and primary_jp:
            display_name = f"{primary_jp} / {roman_clean}"
        elif primary_jp:
            display_name = primary_jp
        else:
            display_name = roman_clean

        return CharacterName(
            japanese_name=primary_jp,
            roman_name=roman_clean,
            display_name=display_name,
            extra_tags=extra_tags,
        )
    else:
        # 纯 ASCII / 罗马音
        roman_clean = body.replace("_", " ").strip()
        roman_clean = re.sub(r"\s+", " ", roman_clean)
        return CharacterName(
            japanese_name="",
            roman_name=roman_clean,
            display_name=roman_clean,
            extra_tags=[],
        )


def generate_title(assets: list[AssetRecord]) -> str:
    """基于投稿集合中资产的 character 节点自动生成标题。格式：`角色1 [ / roman] & 角色2 [ / roman]`。"""
    seen_displays: set[str] = set()
    characters: list[CharacterName] = []

    for asset in assets:
        for node in asset.node_info.nodes:
            if node.role == "character":
                val = node.id or node.ref or ""
                parsed = parse_character_name(val)
                if parsed and parsed.display_name and parsed.display_name.casefold() not in seen_displays:
                    seen_displays.add(parsed.display_name.casefold())
                    characters.append(parsed)

    if not characters:
        return ""

    return " & ".join(c.display_name for c in characters)


def generate_caption(config: PixivAutoConfig) -> str:
    """基于配置生成 Pixiv 描述模板。"""
    return config.caption_prefix or ""


def suggest_tags_from_assets(
    assets: list[AssetRecord],
    config: PixivAutoConfig,
) -> dict[str, list[str]]:
    """从投稿集合中提取推荐标签，分为 preset, character, action 三类。"""
    # 1. 预设标签
    preset_tags: list[str] = []
    seen_preset: set[str] = set()
    for tag in config.default_tags:
        cleaned = str(tag).strip()
        if cleaned and cleaned.casefold() not in seen_preset:
            seen_preset.add(cleaned.casefold())
            preset_tags.append(cleaned)

    # 2. 角色标签
    char_tags: list[str] = []
    seen_char: set[str] = set()

    def add_char_tag(t: str) -> None:
        c = str(t).strip()
        if c and c.casefold() not in seen_char:
            seen_char.add(c.casefold())
            char_tags.append(c)

    for asset in assets:
        for node in asset.node_info.nodes:
            if node.role == "character":
                val = node.id or node.ref or ""
                parsed = parse_character_name(val)
                if parsed:
                    if parsed.japanese_name:
                        add_char_tag(parsed.japanese_name)
                    if parsed.roman_name:
                        # 兼容带空格与带下划线的形式
                        add_char_tag(parsed.roman_name)
                    for extra in parsed.extra_tags:
                        add_char_tag(extra)

    # 3. 动作 / 场景标签
    action_tags: list[str] = []
    seen_action: set[str] = set()

    def add_action_tag(t: str) -> None:
        c = str(t).strip()
        if c and c.casefold() not in seen_action:
            seen_action.add(c.casefold())
            action_tags.append(c)

    for asset in assets:
        for node in asset.node_info.nodes:
            if node.role in ("action_group", "action"):
                val = node.id or node.ref or ""
                if not val:
                    continue
                # 清洗动作前缀
                clean_act = SHORTCUT_SUFFIX_PATTERN.sub("", val).strip()
                clean_act = ACTION_PREFIX_PATTERN.sub("", clean_act)
                clean_act = ACTION_DATE_PATTERN.sub("", clean_act)
                clean_act = STAR_RATING_PATTERN.sub("", clean_act)
                clean_act = clean_act.strip("_ ").strip()

                if not clean_act or clean_act.lower() in ("none", "new"):
                    continue

                if not CJK_PATTERN.search(clean_act):
                    clean_act = clean_act.replace("_", " ")

                add_action_tag(clean_act)

    return {
        "preset": preset_tags,
        "character": char_tags,
        "action": action_tags,
    }


def resolve_proxies(proxy: str | None = None) -> dict[str, str] | None:
    """解析 HTTP/HTTPS 代理配置，优先使用显式传入的代理，否则自动读取系统代理。"""
    if proxy and str(proxy).strip() and str(proxy).strip() != "xxx:xxx":
        p = str(proxy).strip()
        if not (p.startswith("http://") or p.startswith("https://") or p.startswith("socks5://")):
            p = f"http://{p}"
        return {"http": p, "https": p}

    try:
        from urllib.request import getproxies
        sys_p = getproxies()
        if sys_p.get("http") or sys_p.get("https"):
            http_val = sys_p.get("http") or sys_p.get("https")
            https_val = sys_p.get("https") or sys_p.get("http")
            return {"http": http_val, "https": https_val}
    except Exception:
        pass
    return None


def prepare_image_for_suggest(image_path: Path) -> tuple[str, bytes, str]:
    """生成用于 Pixiv 识别的小尺寸预览图字节（<=1024px, JPEG），极大缩短上传时间与代理超时几率。"""
    try:
        import io
        from PIL import Image

        with Image.open(image_path) as im:
            im.thumbnail((1024, 1024))
            buf = io.BytesIO()
            im.convert("RGB").save(buf, format="JPEG", quality=85)
            return "preview.jpg", buf.getvalue(), "image/jpeg"
    except Exception:
        ext = image_path.suffix.lower()
        mime = "image/png" if ext == ".png" else "image/jpeg"
        with open(image_path, "rb") as f:
            return image_path.name, f.read(), mime


def create_pixiv_session(proxies: dict[str, str] | None = None, max_retries: int = 5) -> Any:
    """创建配置了智能重试与代理的 Pixiv 请求 Session。"""
    import requests
    from requests.adapters import HTTPAdapter
    from urllib3.util import Retry

    session = requests.Session()
    retry_strategy = Retry(
        total=max_retries,
        connect=max_retries,
        read=max_retries,
        backoff_factor=0.5,
        status_forcelist=[500, 502, 503, 504],
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retry_strategy, pool_connections=5, pool_maxsize=5)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    if proxies:
        session.proxies.update(proxies)
    return session


def suggest_tags_from_pixiv_sync(
    image_path: str | Path,
    *,
    cookie: str = "",
    token: str = "",
    proxy: str | None = None,
    timeout: int = 30,
) -> list[str]:
    """通过 Pixiv 官方 suggest_tags_by_image API 推荐标签（带自动重试与图像压缩）。"""
    path = Path(image_path)
    if not path.is_file():
        logger.warning("Pixiv suggest_tags: 文件不存在：%s", image_path)
        return []

    url = "https://www.pixiv.net/rpc/suggest_tags_by_image.php"
    headers = {
        "accept": "application/json",
        "accept-language": "ja,en-US;q=0.9,en;q=0.8,zh-CN;q=0.7,zh;q=0.6",
        "dnt": "1",
        "origin": "https://www.pixiv.net",
        "referer": "https://www.pixiv.net/illustration/create",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "sentry-trace": f"{uuid.uuid4().hex}-{uuid.uuid4().hex[:16]}-0",
    }
    if cookie:
        headers["cookie"] = cookie
    if token:
        headers["x-csrf-token"] = token

    proxies = resolve_proxies(proxy)
    filename, file_bytes, mime = prepare_image_for_suggest(path)
    session = create_pixiv_session(proxies, max_retries=5)

    try:
        files = {"image": (filename, file_bytes, mime)}
        resp = session.post(url, files=files, headers=headers, timeout=timeout)
        if resp.status_code == 200:
            data = resp.json()
            if isinstance(data, dict) and "body" in data and isinstance(data["body"], dict):
                tags = data["body"].get("tags", [])
                if isinstance(tags, list):
                    logger.info("Pixiv suggest_tags 识别成功，获取到 %d 个推荐标签: %s", len(tags), tags)
                    return [str(t).strip() for t in tags if str(t).strip()]
        logger.warning("Pixiv suggest_tags 响应异常：%s %s", resp.status_code, resp.text[:200])
        return []
    except Exception as exc:
        logger.warning("Pixiv suggest_tags 发生错误：%s", exc)
        return []


def fetch_pixiv_past_tags_sync(
    cookie: str,
    *,
    proxy: str | None = None,
    timeout: int = 30,
) -> list[str]:
    """从 Pixiv 投稿页面 SSR 数据包中获取用户账号的历史常用标签。"""
    import json

    clean_cookie = str(cookie or "").strip()
    if not clean_cookie:
        logger.warning("Pixiv fetch_past_tags: 未提供 cookie")
        return []

    url = "https://www.pixiv.net/illustration/create"
    headers = {
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "accept-language": "ja,en-US;q=0.9,en;q=0.8,zh-CN;q=0.7,zh;q=0.6",
        "cookie": clean_cookie,
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    }

    proxies = resolve_proxies(proxy)
    session = create_pixiv_session(proxies, max_retries=5)

    try:
        resp = session.get(url, headers=headers, timeout=timeout)
        if resp.status_code == 200:
            m = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', resp.text)
            if m:
                data = json.loads(m.group(1))
                past_tags = data.get("props", {}).get("pageProps", {}).get("pastTags", [])
                if isinstance(past_tags, list):
                    logger.info("Pixiv fetch_past_tags 抓取成功，获取到 %d 个常用标签", len(past_tags))
                    return [str(t).strip() for t in past_tags if str(t).strip()]
        logger.warning("Pixiv fetch_past_tags 响应异常：%s %s", resp.status_code, resp.text[:200])
        return []
    except Exception as exc:
        logger.warning("Pixiv fetch_past_tags 发生错误：%s", exc)
        return []

