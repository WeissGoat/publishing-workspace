from __future__ import annotations

from pathlib import Path

from PIL import Image

from publishing_workspace.catalog.repository import CatalogRepository
from publishing_workspace.metadata import default_image_node_reader_registry
from publishing_workspace.models import ImportedItem, SelectionSet


def _png(path: Path, color: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (4, 4), color).save(path)
    return path


def test_assets_by_ids_preserves_requested_order_and_import_scope(tmp_path: Path):
    first = _png(tmp_path / "images" / "first.png", "red")
    second = _png(tmp_path / "images" / "second.png", "blue")
    selection = SelectionSet(
        id="import-a",
        source_type="directory",
        source_ref=str(tmp_path / "images"),
        items=[
            ImportedItem(
                source_path=str(first),
                resolved_path=str(first),
                source_type="directory",
                source_ref=str(tmp_path / "images"),
                source_order=0,
                display_name=first.name,
            ),
            ImportedItem(
                source_path=str(second),
                resolved_path=str(second),
                source_type="directory",
                source_ref=str(tmp_path / "images"),
                source_order=1,
                display_name=second.name,
            ),
        ],
    )
    repository = CatalogRepository(tmp_path / "catalog.sqlite")
    repository.import_selection(
        selection,
        readers=default_image_node_reader_registry(),
        enrichers=[],
    )
    imported = repository.assets_for_import("import-a")

    result = repository.assets_by_ids(
        [imported[1].asset_id, "sha256:missing", imported[0].asset_id, imported[1].asset_id],
        import_id="import-a",
    )

    assert list(result) == [imported[1].asset_id, imported[0].asset_id]
    assert result[imported[1].asset_id].display_name == "second.png"
    assert result[imported[0].asset_id].source_order == 0
    assert repository.assets_by_ids(
        [imported[0].asset_id],
        import_id="missing-import",
    ) == {}


def test_snapshots_for_asset_returns_all_occurrences(tmp_path: Path):
    img1 = _png(tmp_path / "set1" / "common.png", "red")
    img2 = _png(tmp_path / "set1" / "unique.png", "blue")
    img3 = _png(tmp_path / "set2" / "common_copy.png", "red")  # same content as img1

    selection1 = SelectionSet(
        id="import-1",
        source_type="directory",
        source_ref=str(tmp_path / "set1"),
        items=[
            ImportedItem(
                source_path=str(img1),
                resolved_path=str(img1),
                source_type="directory",
                source_ref=str(tmp_path / "set1"),
                source_order=0,
                display_name=img1.name,
            ),
            ImportedItem(
                source_path=str(img2),
                resolved_path=str(img2),
                source_type="directory",
                source_ref=str(tmp_path / "set1"),
                source_order=1,
                display_name=img2.name,
            ),
        ],
    )
    selection2 = SelectionSet(
        id="import-2",
        source_type="neev_playlist",
        source_ref=str(tmp_path / "playlist.nvpls"),
        items=[
            ImportedItem(
                source_path=str(img3),
                resolved_path=str(img3),
                source_type="neev_playlist",
                source_ref=str(tmp_path / "playlist.nvpls"),
                source_order=5,
                display_name="custom_title.png",
            ),
        ],
    )
    repository = CatalogRepository(tmp_path / "catalog.sqlite")
    repository.import_selection(
        selection1,
        readers=default_image_node_reader_registry(),
        enrichers=[],
    )
    repository.import_selection(
        selection2,
        readers=default_image_node_reader_registry(),
        enrichers=[],
    )

    imported = repository.assets_for_import("import-1")
    common_asset_id = imported[0].asset_id

    snapshots = repository.snapshots_for_asset(common_asset_id)
    assert len(snapshots) == 2
    import_ids = [s["import_id"] for s in snapshots]
    assert "import-1" in import_ids
    assert "import-2" in import_ids

    snap2 = next(s for s in snapshots if s["import_id"] == "import-2")
    assert snap2["source_type"] == "neev_playlist"
    assert snap2["source_order"] == 5
    assert snap2["display_name"] == "custom_title.png"
    assert snap2["name"] == "playlist.nvpls"


def test_related_batch_assets_by_prefix(tmp_path: Path):
    img0 = _png(tmp_path / "batch" / "comm_seed_123_456_0.png", "red")
    img1 = _png(tmp_path / "batch" / "comm_seed_123_456_1.png", "green")
    img2 = _png(tmp_path / "batch" / "comm_seed_123_456_2.png", "blue")
    img_other = _png(tmp_path / "batch" / "other_image.png", "yellow")

    selection = SelectionSet(
        id="import-batch",
        source_type="directory",
        source_ref=str(tmp_path / "batch"),
        items=[
            ImportedItem(
                source_path=str(img0),
                resolved_path=str(img0),
                source_type="directory",
                source_ref=str(tmp_path / "batch"),
                source_order=0,
                display_name=img0.name,
            ),
            ImportedItem(
                source_path=str(img1),
                resolved_path=str(img1),
                source_type="directory",
                source_ref=str(tmp_path / "batch"),
                source_order=1,
                display_name=img1.name,
            ),
            ImportedItem(
                source_path=str(img2),
                resolved_path=str(img2),
                source_type="directory",
                source_ref=str(tmp_path / "batch"),
                source_order=2,
                display_name=img2.name,
            ),
            ImportedItem(
                source_path=str(img_other),
                resolved_path=str(img_other),
                source_type="directory",
                source_ref=str(tmp_path / "batch"),
                source_order=3,
                display_name=img_other.name,
            ),
        ],
    )
    repository = CatalogRepository(tmp_path / "catalog.sqlite")
    repository.import_selection(
        selection,
        readers=default_image_node_reader_registry(),
        enrichers=[],
    )

    imported = repository.assets_for_import("import-batch")
    asset0 = imported[0]  # comm_seed_123_456_0.png

    related = repository.related_assets_for_asset(asset0.asset_id)
    same_batch = related.get("dimensions", {}).get("same_batch", {})
    assert same_batch.get("total") == 2
    sibling_names = [item["display_name"] for item in same_batch.get("items", [])]
    assert "comm_seed_123_456_1.png" in sibling_names
    assert "comm_seed_123_456_2.png" in sibling_names
    assert "comm_seed_123_456_0.png" not in sibling_names


