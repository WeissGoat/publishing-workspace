from __future__ import annotations

import json


ALL_IMPORTS = "__all__"


def parse_id_list(raw: str | None) -> list[str]:
    """解析查询参数中的 ID 列表：JSON 数组、JSON 字符串或逗号分隔文本均可，去除空白项并保持顺序。"""
    if not raw:
        return []
    try:
        value = json.loads(raw)
    except ValueError:
        value = raw
    if isinstance(value, list):
        items = [str(item).strip() for item in value]
    elif isinstance(value, str):
        items = [item.strip() for item in value.split(",")]
    else:
        # 纯数字等 JSON 标量按原文本处理，避免把形如数字的 ID 丢掉
        items = [item.strip() for item in raw.split(",")]
    return [item for item in items if item]


def parse_import_ids(import_ids: str | None, import_id: str | None = None) -> list[str] | None:
    """解析快照选择：优先 import_ids 列表，其次单个 import_id；"__all__" 表示全部快照（返回空或 None）。"""
    if import_ids:
        return [item for item in parse_id_list(import_ids) if item != ALL_IMPORTS]
    if import_id and import_id.strip() and import_id.strip() != ALL_IMPORTS:
        return [import_id.strip()]
    return None
