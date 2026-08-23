import pytest
from publishing_workspace.config import PixivAutoConfig
from publishing_workspace.models import (
    AssetFingerprint,
    AssetImageInfo,
    AssetRecord,
    ImageNodeInfo,
    ImageNodeRef,
)
from publishing_workspace.submissions.pixiv_metadata import (
    CharacterName,
    generate_caption,
    generate_title,
    parse_character_name,
    suggest_tags_from_assets,
)


def make_asset(
    asset_id: str,
    character_nodes: list[str] = (),
    action_group_nodes: list[str] = (),
    action_nodes: list[str] = (),
) -> AssetRecord:
    nodes = []
    for c in character_nodes:
        nodes.append(ImageNodeRef(role="character", id=c, ref=c))
    for ag in action_group_nodes:
        nodes.append(ImageNodeRef(role="action_group", id=ag, ref=ag))
    for a in action_nodes:
        nodes.append(ImageNodeRef(role="action", id=a, ref=a))

    return AssetRecord(
        asset_id=asset_id,
        path=f"/path/to/{asset_id}.png",
        fingerprint=AssetFingerprint(size=1024, modified_ns=1, sha256="0" * 64),
        image=AssetImageInfo(width=1024, height=1024, format="png"),
        node_info=ImageNodeInfo(nodes=nodes),
        display_name=f"{asset_id}.png",
    )


def test_parse_character_name_danbooru_with_japanese_and_tags():
    res = parse_character_name("1adanbooru_akemi_homura_暁美ほむら _魔法少女 - 快捷方式")
    assert res is not None
    assert res.roman_name == "akemi homura"
    assert res.japanese_name == "暁美ほむら"
    assert res.display_name == "暁美ほむら / akemi homura"
    assert "魔法少女" in res.extra_tags


def test_parse_character_name_katakana_compound():
    res = parse_character_name("2danbooru_fate_testarossa_フェイト_テスタロッサ - 快捷方式")
    assert res is not None
    assert res.roman_name == "fate testarossa"
    assert res.japanese_name in ("フェイト・テスタロッサ", "フェイト_テスタロッサ", "フェイト テスタロッサ")
    assert "fate testarossa" in res.display_name


def test_parse_character_name_with_subseries():
    res = parse_character_name("danbooru_523_plana_(blue_archive)_黒アロナ")
    assert res is not None
    assert res.roman_name == "plana (blue archive)"
    assert res.japanese_name == "黒アロナ"
    assert res.display_name == "黒アロナ / plana (blue archive)"


def test_parse_character_name_chinese_kanji_only():
    res = parse_character_name("八神疾风")
    assert res is not None
    assert res.japanese_name == "八神疾风"
    assert res.display_name == "八神疾风"


def test_parse_character_name_english_only():
    res = parse_character_name("akuma_homura")
    assert res is not None
    assert res.roman_name == "akuma homura"
    assert res.display_name == "akuma homura"


def test_parse_character_name_shortcut_numbers():
    res = parse_character_name("10yuni - 快捷方式")
    assert res is not None
    assert res.roman_name == "yuni"
    assert res.display_name == "yuni"


def test_generate_title():
    asset1 = make_asset("a1", character_nodes=["1adanbooru_akemi_homura_暁美ほむら _魔法少女 - 快捷方式"])
    asset2 = make_asset("a2", character_nodes=["1adanbooru_kaname_madoka_鹿目まどか_魔法少女 - 快捷方式"])
    
    # Single character
    title1 = generate_title([asset1])
    assert title1 == "暁美ほむら / akemi homura"

    # Multi character deduplication & join
    title2 = generate_title([asset1, asset2, asset1])
    assert title2 == "暁美ほむら / akemi homura & 鹿目まどか / kaname madoka"


def test_generate_caption():
    cfg = PixivAutoConfig(caption_prefix="Hi there! 欢迎关注~")
    caption = generate_caption(cfg)
    assert caption == "Hi there! 欢迎关注~"


def test_suggest_tags_from_assets():
    cfg = PixivAutoConfig(
        default_tags=["AIイラスト", "NovelAI"],
    )
    asset = make_asset(
        "a1",
        character_nodes=["1adanbooru_akemi_homura_暁美ほむら _魔法少女 - 快捷方式"],
        action_group_nodes=["act_foreplay_oral"],
        action_nodes=["00_start_20260504_水着_3star"],
    )

    tags = suggest_tags_from_assets([asset], cfg)
    assert "preset" in tags
    assert "character" in tags
    assert "action" in tags

    assert tags["preset"] == ["AIイラスト", "NovelAI"]
    assert "暁美ほむら" in tags["character"]
    assert any("homura" in t for t in tags["character"])
    assert "魔法少女" in tags["character"]
    assert any("foreplay" in a or "oral" in a for a in tags["action"])
    assert any("水着" in a for a in tags["action"])
