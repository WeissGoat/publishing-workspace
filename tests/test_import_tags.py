from __future__ import annotations

import json
from pathlib import Path

from PIL import Image

from publishing_workspace.catalog.repository import CatalogRepository
from publishing_workspace.cli import main
from publishing_workspace.config import load_workspace
from publishing_workspace.plans.search import AssetSearchFilter, AssetSearchService
from publishing_workspace.service import PublishingService


def _create_sample_image(path: Path, color: str = "blue") -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    img = Image.new("RGB", (100, 100), color)
    img.save(path)
    return path


def test_default_import_has_no_tags(tmp_path: Path, capsys):
    root = tmp_path / "workspace"
    source = tmp_path / "images"
    source.mkdir()
    _create_sample_image(source / "img1.png", "red")

    assert main(["init", str(root)]) == 0
    capsys.readouterr()

    # 默认 import 不打任何标签（纯净模式）
    assert main(["import", str(root), str(source), "--input-type", "directory"]) == 0
    imported = json.loads(capsys.readouterr().out)
    assert imported["tags"] == []

    paths, _ = load_workspace(root)
    cat = CatalogRepository(paths.catalog, backups_dir=paths.backups)
    summaries = cat.list_imports_summary()
    assert len(summaries) == 1
    assert summaries[0]["tags"] == []

    marks = cat.all_asset_marks()
    # 不应该有任何 tag:* 标记
    for asset_id, mark_list in marks.items():
        assert not any(m.startswith("tag:") for m in mark_list)

    assert cat.get_all_tags() == []


def test_import_with_explicit_tags(tmp_path: Path, capsys):
    root = tmp_path / "workspace"
    source = tmp_path / "images"
    source.mkdir()
    _create_sample_image(source / "img1.png", "green")

    assert main(["init", str(root)]) == 0
    capsys.readouterr()

    assert main([
        "import",
        str(root),
        str(source),
        "--input-type",
        "directory",
        "--tag",
        "批次A",
        "--tags",
        "初筛,待定",
    ]) == 0
    imported = json.loads(capsys.readouterr().out)
    assert set(imported["tags"]) == {"批次A", "初筛", "待定"}

    paths, _ = load_workspace(root)
    cat = CatalogRepository(paths.catalog, backups_dir=paths.backups)
    summaries = cat.list_imports_summary()
    assert len(summaries) == 1
    assert set(summaries[0]["tags"]) == {"批次A", "初筛", "待定"}

    tags = cat.get_all_tags()
    tag_names = {t["name"] for t in tags}
    assert tag_names == {"批次A", "初筛", "待定"}
    for t in tags:
        assert t["count"] == 1


def test_import_secondary_default_and_custom_tag(tmp_path: Path, capsys):
    root = tmp_path / "workspace"
    source1 = tmp_path / "dir1"
    source1.mkdir()
    _create_sample_image(source1 / "img1.png", "purple")

    source2 = tmp_path / "dir2"
    source2.mkdir()
    _create_sample_image(source2 / "img2.png", "yellow")

    assert main(["init", str(root)]) == 0
    capsys.readouterr()

    # 1. 默认 import-secondary：标签默认为 "二次筛选"
    assert main(["import-secondary", str(root), str(source1), "--input-type", "directory"]) == 0
    imported1 = json.loads(capsys.readouterr().out)
    assert imported1["tags"] == ["二次筛选"]

    # 2. 自定义 import-secondary 标签
    assert main([
        "import-secondary",
        str(root),
        str(source2),
        "--input-type",
        "directory",
        "--tag",
        "终选精品",
    ]) == 0
    imported2 = json.loads(capsys.readouterr().out)
    assert imported2["tags"] == ["终选精品"]

    paths, _ = load_workspace(root)
    cat = CatalogRepository(paths.catalog, backups_dir=paths.backups)
    all_tags = {t["name"]: t["count"] for t in cat.get_all_tags()}
    assert all_tags == {"二次筛选": 1, "终选精品": 1}


def test_search_and_filter_by_tags(tmp_path: Path):
    root = tmp_path / "workspace"
    PublishingService().initialize(root)

    # 第一次导入：全量图库 (imgA, imgB)，不带 tag
    full_dir = tmp_path / "full"
    _create_sample_image(full_dir / "imgA.png", "black")
    _create_sample_image(full_dir / "imgB.png", "white")
    PublishingService().import_source(root, full_dir, input_type="directory")

    # 第二次导入：二次筛选子集 (仅 imgB)
    sec_dir = tmp_path / "secondary"
    _create_sample_image(sec_dir / "imgB.png", "white")  # 相同内容，产生相同 asset_id
    PublishingService().import_secondary(root, sec_dir, input_type="directory")

    search_svc = AssetSearchService()

    # 1. 全量搜索（不过滤 tag）应该有 2 张
    res_all = search_svc.search(root, AssetSearchFilter())
    assert len(res_all) == 2

    # 2. 筛选 "二次筛选" 标签：只有 imgB 命中
    res_sec = search_svc.search(root, AssetSearchFilter(tags={"二次筛选"}))
    assert len(res_sec) == 1
    assert res_sec[0].tags == ["二次筛选"]

    # 3. 筛选不存在的标签：命中 0
    res_none = search_svc.search(root, AssetSearchFilter(tags={"不存在标签"}))
    assert len(res_none) == 0

    # 4. list_tags 统计验证
    tags_list = search_svc.list_tags(root)
    assert len(tags_list) == 1
    assert tags_list[0]["name"] == "二次筛选"
    assert tags_list[0]["count"] == 1


def test_list_imports_summary_deduplication(tmp_path: Path):
    root = tmp_path / "workspace"
    PublishingService().initialize(root)

    source_dir = tmp_path / "my_album"
    _create_sample_image(source_dir / "pic1.png", "red")

    # 第一次导入：无 tag
    s1 = PublishingService().import_source(root, source_dir, input_type="directory")

    # 第二次导入同一目录：带 tag "二次筛选"
    _create_sample_image(source_dir / "pic2.png", "green")
    s2 = PublishingService().import_secondary(root, source_dir, input_type="directory")

    paths, _ = load_workspace(root)
    cat = CatalogRepository(paths.catalog, backups_dir=paths.backups)

    # 1. 默认归并模式：只有 1 项，取最新快照，且合并 tags
    grouped = cat.list_imports_summary(deduplicate_sources=True)
    assert len(grouped) == 1
    assert grouped[0]["import_id"] == s2.run_id
    assert grouped[0]["total_items"] == 2
    assert grouped[0]["tags"] == ["二次筛选"]
    assert grouped[0]["import_count"] == 2

    # 2. 原始日志模式：保留 2 条历史
    raw = cat.list_imports_summary(deduplicate_sources=False)
    assert len(raw) == 2
    assert {r["import_id"] for r in raw} == {s1.run_id, s2.run_id}

