from __future__ import annotations

import os
import sqlite3
import threading
from pathlib import Path

from publishing_workspace.catalog.repository import CatalogRepository, clear_catalog_init_cache
from publishing_workspace.metadata.registry import ImageNodeReaderRegistry
from publishing_workspace.models import ImportedItem, SelectionSet
from publishing_workspace.plans import search as search_module
from publishing_workspace.plans.search import AssetSearchFilter, AssetSearchService

from test_plan_search import StaticNodeReader, png, seed_catalog


def _entries(root: Path, import_id: str | list[str] = "import-1"):
    service = AssetSearchService()
    paths, config = search_module._load_workspace_cached(root)
    return service._get_search_entries(
        paths, config, import_id, catalog=CatalogRepository(paths.catalog)
    )


def _import_third(paths) -> None:
    third = png(paths.root / "images" / "third.png", "green")
    action_root = paths.root / "design" / "动作改2" / "st_foot" / "foot_detail"
    CatalogRepository(paths.catalog).import_selection(
        SelectionSet(
            id="import-2",
            source_type="directory",
            source_ref="test-images-2",
            items=[
                ImportedItem(
                    source_path=str(third),
                    resolved_path=str(third),
                    source_type="directory",
                    source_ref="test-images-2",
                    source_order=0,
                    display_name=third.name,
                )
            ],
        ),
        readers=ImageNodeReaderRegistry([StaticNodeReader(action_root, "mami_tomoe")]),
        enrichers=[],
    )


def test_revision_triggers_separate_asset_and_mark_writes(tmp_path: Path):
    paths, _, assets = seed_catalog(tmp_path)
    catalog = CatalogRepository(paths.catalog)
    before = catalog.revisions()

    catalog.set_asset_marks([assets[0].asset_id], mark="favorite")
    after_mark = catalog.revisions()
    assert after_mark.assets == before.assets
    assert after_mark.marks > before.marks

    # 导入进度计数更新不应让检索索引失效
    with catalog.connection() as connection:
        connection.execute("UPDATE imports SET processed_items = processed_items + 1")
    assert catalog.revisions().assets == before.assets

    with catalog.connection() as connection:
        connection.execute("UPDATE asset_paths SET last_seen_at = 'touched'")
    assert catalog.revisions().assets > before.assets


def test_mark_writes_keep_search_index_cached(tmp_path: Path):
    paths, _, assets = seed_catalog(tmp_path)
    first = _entries(tmp_path)

    CatalogRepository(paths.catalog).set_asset_marks([assets[0].asset_id], mark="favorite")

    assert _entries(tmp_path) is first


def test_asset_writes_invalidate_search_index(tmp_path: Path):
    paths, _, _ = seed_catalog(tmp_path)
    first = _entries(tmp_path)

    _import_third(paths)

    assert _entries(tmp_path) is not first
    combined = _entries(tmp_path, ["import-1", "import-2"])
    assert sorted(entry.asset.display_name for entry in combined) == [
        "first.png",
        "second.png",
        "third.png",
    ]


def test_favorited_mode_defaults_to_catalog_marks(tmp_path: Path):
    paths, _, assets = seed_catalog(tmp_path)
    service = AssetSearchService()
    favorited = AssetSearchFilter(import_id="import-1", favorite_mode="favorited")

    assert service.search(tmp_path, favorited) == []

    CatalogRepository(paths.catalog).set_asset_marks([assets[1].asset_id], mark="favorite")

    assert [item.asset_id for item in service.search(tmp_path, favorited)] == [assets[1].asset_id]
    unfavorited = service.search(
        tmp_path, AssetSearchFilter(import_id="import-1", favorite_mode="unfavorited")
    )
    assert [item.asset_id for item in unfavorited] == [assets[0].asset_id]
    # 显式传入的收藏 ID 仍然优先，兼容旧前端
    explicit = service.search(
        tmp_path,
        AssetSearchFilter(
            import_id="import-1", favorite_mode="favorited", favorite_ids={assets[0].asset_id}
        ),
    )
    assert [item.asset_id for item in explicit] == [assets[0].asset_id]


def test_tag_filter_uses_fresh_marks(tmp_path: Path):
    paths, _, assets = seed_catalog(tmp_path)
    service = AssetSearchService()
    tagged = AssetSearchFilter(import_id="import-1", tags={"pick"})
    assert service.search(tmp_path, tagged) == []

    CatalogRepository(paths.catalog).set_asset_tags([assets[0].asset_id], tags=["pick"])

    result = service.search(tmp_path, tagged)
    assert [item.asset_id for item in result] == [assets[0].asset_id]
    assert result[0].tags == ["pick"]


def test_sorted_pages_match_full_ordering(tmp_path: Path):
    paths, _, _ = seed_catalog(tmp_path)
    _import_third(paths)
    service = AssetSearchService()

    both = ["import-1", "import-2"]
    for sort_by in ("order_asc", "order_desc", "name_desc", "time_asc"):
        full = service.search(tmp_path, AssetSearchFilter(import_ids=both, sort_by=sort_by))
        paged = [
            item.asset_id
            for offset in range(3)
            for item in service.search_page(
                tmp_path,
                AssetSearchFilter(import_ids=both, sort_by=sort_by, offset=offset, limit=1),
            ).items
        ]
        assert paged == [item.asset_id for item in full]
    names = [
        item.display_name
        for item in service.search(
            tmp_path, AssetSearchFilter(import_ids=both, sort_by="name_desc")
        )
    ]
    assert names == ["third.png", "second.png", "first.png"]


def test_classify_changes_are_picked_up(tmp_path: Path, monkeypatch):
    paths, _, _ = seed_catalog(tmp_path)
    service = AssetSearchService()
    assert service.facets(tmp_path, import_id="import-1")["clothing"] == ["nude"]

    classify = paths.root / "design" / "动作改2" / "st_foot" / "foot_detail" / "classify.yaml"
    classify.write_text("phase: core\nclothing: swimsuit\n", encoding="utf-8")
    stat = classify.stat()
    os.utime(classify, ns=(stat.st_atime_ns, stat.st_mtime_ns + 1_000_000_000))
    monkeypatch.setattr(search_module, "_classify_last_check", 0.0)

    assert service.facets(tmp_path, import_id="import-1")["clothing"] == ["swimsuit"]


def test_concurrent_requests_build_snapshot_once(tmp_path: Path, monkeypatch):
    seed_catalog(tmp_path)
    calls: list[str] = []
    original = AssetSearchService._build_snapshot_entries

    def counting(self, config, catalog, import_id, resolver_sig):
        calls.append(import_id)
        return original(self, config, catalog, import_id, resolver_sig)

    monkeypatch.setattr(AssetSearchService, "_build_snapshot_entries", counting)
    barrier = threading.Barrier(4)
    errors: list[BaseException] = []

    def worker(index: int) -> None:
        try:
            barrier.wait()
            service = AssetSearchService()
            if index % 2:
                service.facets(tmp_path, import_id="import-1")
            else:
                service.search_page(tmp_path, AssetSearchFilter(import_id="import-1"))
        except BaseException as exc:  # pragma: no cover - surfaced below
            errors.append(exc)

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert errors == []
    assert calls == ["import-1"]


def test_legacy_catalog_gains_revision_tracking(tmp_path: Path):
    paths, _, assets = seed_catalog(tmp_path)
    with sqlite3.connect(paths.catalog) as connection:
        triggers = [
            row[0]
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type='trigger'")
        ]
        for name in triggers:
            connection.execute(f"DROP TRIGGER {name}")
        connection.execute("DROP TABLE catalog_revisions")
    clear_catalog_init_cache()

    catalog = CatalogRepository(paths.catalog)
    before = catalog.revisions()
    catalog.set_asset_marks([assets[0].asset_id], mark="favorite")
    assert catalog.revisions().marks == before.marks + 1


def test_search_rows_match_assets_for_import(tmp_path: Path):
    paths, _, _ = seed_catalog(tmp_path)
    catalog = CatalogRepository(paths.catalog)
    records = catalog.assets_for_import("import-1")
    rows = catalog.search_rows_for_import("import-1")
    earliest = catalog.get_earliest_asset_times_ns([record.asset_id for record in records])

    assert [row.asset_id for row in rows] == [record.asset_id for record in records]
    for row, record in zip(rows, records):
        assert row.path == record.path
        assert row.display_name == record.display_name
        assert (row.width, row.height, row.image_format) == (
            record.image.width,
            record.image.height,
            record.image.format,
        )
        assert row.earliest_time_ns == earliest.get(record.asset_id, record.fingerprint.modified_ns)
        assert row.to_record().node_info == record.node_info
