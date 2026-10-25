from __future__ import annotations

import pytest

from publishing_workspace.web.query_params import parse_id_list, parse_import_ids


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        (None, []),
        ("", []),
        ('["a", " b ", ""]', ["a", "b"]),
        ('"a, b"', ["a", "b"]),
        ("a, b,,c", ["a", "b", "c"]),
        ("[not json", ["[not json"]),
        ("12345", ["12345"]),
    ],
)
def test_parse_id_list_accepts_json_and_comma_forms(raw, expected):
    assert parse_id_list(raw) == expected


def test_parse_import_ids_prefers_list_and_drops_all_marker():
    assert parse_import_ids('["imp-1", "__all__", "imp-2"]', "ignored") == ["imp-1", "imp-2"]
    assert parse_import_ids('["__all__"]') == []
    assert parse_import_ids(None, " imp-3 ") == ["imp-3"]
    assert parse_import_ids(None, "__all__") is None
    assert parse_import_ids(None, None) is None
