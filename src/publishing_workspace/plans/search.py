from __future__ import annotations

from collections import OrderedDict
from collections.abc import Collection
from dataclasses import dataclass
import hashlib
from pathlib import Path
import threading
import time
from typing import Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, field_validator

from ..action_resolution import ActionNodeValueResolver
from ..catalog.repository import CatalogRepository, SearchAssetRow
from ..config import WorkspacePaths, load_workspace
from ..logging import get_logger
from ..models import AssetRecord, ImageNodeRef
from ..identity import DEFAULT_NODE_IDENTITY_NORMALIZER
from ..tasks.paths import TaskPaths
from ..tasks.repository import TaskRepository
from ..tasks.scanner import CurrentSelectionScanner
from .models import InlineContent
from .paths import PlanPaths
from .repository import PlanRepository


logger = get_logger(__name__)

FACET_FIELDS = (
    "phase",
    "species",
    "cast",
    "domain",
    "subtype",
    "pose",
    "environment",
    "tone",
    "flags",
    "clothing",
)
NODE_FIELDS = ("artist", "character", "action_group", "action", "background")


class AssetSearchFilter(BaseModel):
    import_id: str | None = None
    import_ids: list[str] | None = None
    text: str = ""
    artist: str | None = None
    character: str | None = None
    action_group: str | None = None
    action: str | None = None
    facets: dict[str, set[str]] = Field(default_factory=dict)
    tags: set[str] = Field(default_factory=set)
    posted: bool | None = None
    favorite_mode: Literal["all", "favorited", "unfavorited"] = "all"
    favorite_ids: set[str] = Field(default_factory=set)
    sort_by: Literal["order_asc", "order_desc", "time_desc", "time_asc", "name_asc", "name_desc"] = "order_asc"
    offset: int = Field(default=0, ge=0)
    limit: int = Field(default=100, ge=1, le=1000)

    @field_validator("import_ids", mode="before")
    @classmethod
    def normalize_import_ids(cls, value: Any) -> list[str] | None:
        if value is None:
            return None
        if isinstance(value, str):
            clean = [x.strip() for x in value.split(",") if x.strip() and x.strip() != "__all__"]
            return clean or None
        if isinstance(value, (list, set, tuple)):
            clean = [str(x).strip() for x in value if str(x).strip() and str(x).strip() != "__all__"]
            return clean or None
        return None

    @field_validator("sort_by", mode="before")
    @classmethod
    def normalize_sort_by(cls, value: Any) -> str:
        valid_sorts = {"order_asc", "order_desc", "time_desc", "time_asc", "name_asc", "name_desc"}
        if isinstance(value, str) and value.strip() in valid_sorts:
            return value.strip()
        return "order_asc"

    @field_validator("tags", mode="before")
    @classmethod
    def normalize_tags(cls, value: Any) -> set[str]:
        if isinstance(value, str):
            return {x.strip() for x in value.split(",") if x.strip()}
        if isinstance(value, (list, set, tuple)):
            return {str(x).strip() for x in value if str(x).strip()}
        return set()

    @field_validator("import_id", "text", "artist", "character", "action_group", "action")
    @classmethod
    def normalize_text(cls, value: str | None) -> str | None:
        return value.strip() if value is not None else None

    @field_validator("facets")
    @classmethod
    def normalize_facets(cls, value: dict[str, set[str]]) -> dict[str, set[str]]:
        normalized: dict[str, set[str]] = {}
        for field, values in value.items():
            field_name = str(field).strip()
            if field_name not in FACET_FIELDS:
                raise ValueError(f"不支持的 classify facet：{field_name}")
            normalized[field_name] = {
                str(item).strip() for item in values if str(item).strip()
            }
        return normalized


class AssetSearchResult(BaseModel):
    asset_id: str
    path: str
    display_name: str
    width: int
    height: int
    image_format: str
    values: dict[str, list[str]]
    facets: dict[str, list[str]]
    tags: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    usage: list[str] = Field(default_factory=list)


class AssetPageResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    schema_id: Literal["publishing-workspace.asset-page/v1"] = Field(
        default="publishing-workspace.asset-page/v1",
        alias="schema",
    )
    items: list[AssetSearchResult]
    offset: int
    limit: int
    total: int = 0
    has_more: bool
    next_offset: int | None


class NodeOption(BaseModel):
    role: str
    name: str
    ref: str | None = None
    relative: str | None = None


class NodeListResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    schema_id: Literal["publishing-workspace.web.node-list/v1"] = Field(
        default="publishing-workspace.web.node-list/v1",
        alias="schema",
    )
    role: str
    nodes: list[NodeOption]
    offset: int
    limit: int
    has_more: bool


_GLOBAL_DIR_CLASSIFY_CACHE: dict[str, Path | None] = {}
_GLOBAL_CLASSIFY_YAML_CACHE: dict[str, tuple[int, dict[str, Any]]] = {}
# action ref -> classify.yaml，避免对每个素材重复构造 Path 和 is_dir 系统调用
_REF_CLASSIFY_CACHE: dict[str, Path | None] = {}
# action ref 组合 -> (facets, warnings)；同一动作目录下的素材共享同一份只读结果
_FACETS_BY_REFS: dict[tuple[str, ...], tuple[dict[str, list[str]], list[str]]] = {}
# id(facets) -> (facets, 小写集合)；保留 facets 引用，保证 id 不会被复用
_FOLDED_FACETS: dict[int, tuple[dict[str, list[str]], dict[str, frozenset[str]]]] = {}
# 已读取的 classify.yaml 与当时的 mtime，节流检测外部修改
_CLASSIFY_SEEN: dict[str, tuple[Path, int]] = {}
_CLASSIFY_CHECK_INTERVAL_S = 5.0
_classify_last_check = 0.0


class ClassifyFacetReader:
    """从 action 节点目录附近的 classify.yaml 读取检索字段。"""

    def read(self, asset: AssetRecord) -> tuple[dict[str, list[str]], list[str]]:
        refs = tuple(
            node.ref.strip()
            for node in asset.node_info.nodes
            if node.role == "action" and node.ref and node.ref.strip()
        )
        cached = _FACETS_BY_REFS.get(refs)
        if cached is None:
            cached = self._read_refs(refs)
            _FACETS_BY_REFS[refs] = cached
        return cached

    def _read_refs(self, refs: tuple[str, ...]) -> tuple[dict[str, list[str]], list[str]]:
        values: dict[str, list[str]] = {field: [] for field in FACET_FIELDS}
        warnings: list[str] = []
        seen_paths: set[Path] = set()
        for ref in refs:
            classify_path = self._find_classify_path_for_ref(ref)
            if classify_path is None or classify_path in seen_paths:
                continue
            seen_paths.add(classify_path)
            try:
                data = _load_classify_yaml(classify_path)
            except (OSError, UnicodeError, yaml.YAMLError) as exc:
                warnings.append(f"classify.yaml 读取失败：{classify_path}：{exc}")
                continue
            if not isinstance(data, dict):
                warnings.append(f"classify.yaml 顶层不是对象：{classify_path}")
                continue
            for field in FACET_FIELDS:
                values[field].extend(_flatten_facet_values(field, data.get(field)))
        return {field: _ordered_unique(items) for field, items in values.items()}, warnings

    def _find_classify_path(self, action: ImageNodeRef) -> Path | None:
        if not action.ref:
            return None
        return self._find_classify_path_for_ref(action.ref.strip())

    @staticmethod
    def _find_classify_path_for_ref(ref_key: str) -> Path | None:
        if ref_key in _REF_CLASSIFY_CACHE:
            return _REF_CLASSIFY_CACHE[ref_key]
        found: Path | None = None
        start = Path(ref_key).expanduser()
        if start.is_absolute():
            start_dir = start if start.is_dir() else start.parent
            dir_key = str(start_dir).casefold()
            if dir_key in _GLOBAL_DIR_CLASSIFY_CACHE:
                found = _GLOBAL_DIR_CLASSIFY_CACHE[dir_key]
            else:
                for directory in (start_dir, *start_dir.parents):
                    candidate = directory / "classify.yaml"
                    if candidate.is_file():
                        found = candidate
                        break
                _GLOBAL_DIR_CLASSIFY_CACHE[dir_key] = found
        _REF_CLASSIFY_CACHE[ref_key] = found
        return found


def _folded_facets(facets: dict[str, list[str]]) -> dict[str, frozenset[str]]:
    """facets 对象由同一动作目录的素材共享，小写集合按对象缓存一次即可。"""
    cached = _FOLDED_FACETS.get(id(facets))
    if cached is not None and cached[0] is facets:
        return cached[1]
    folded = {field: frozenset(v.casefold() for v in items) for field, items in facets.items()}
    _FOLDED_FACETS[id(facets)] = (facets, folded)
    return folded


def _load_classify_yaml(path: Path) -> Any:
    mtime_ns = path.stat().st_mtime_ns
    key = str(path).casefold()
    cached = _GLOBAL_CLASSIFY_YAML_CACHE.get(key)
    if cached is not None and cached[0] == mtime_ns:
        data = cached[1]
    else:
        data = yaml.safe_load(path.read_text(encoding="utf-8-sig")) or {}
        _GLOBAL_CLASSIFY_YAML_CACHE[key] = (mtime_ns, data)
    _CLASSIFY_SEEN[key] = (path, mtime_ns)
    return data


@dataclass(frozen=True, slots=True)
class _AssetDerived:
    """与快照无关的检索数据，按节点签名跨素材、跨快照、跨 revision 复用（只读共享）。"""

    values: dict[str, list[str]]
    values_folded: dict[str, tuple[str, ...]]
    facets: dict[str, list[str]]
    facets_folded: dict[str, frozenset[str]]
    facet_warnings: list[str]
    node_text: str


@dataclass(slots=True)
class _PrecomputedSearchEntry:
    asset: SearchAssetRow
    derived: _AssetDerived
    sort_key: tuple
    combined_text: str
    earliest_time_ns: int = 0

    @property
    def values(self) -> dict[str, list[str]]:
        return self.derived.values

    @property
    def facets(self) -> dict[str, list[str]]:
        return self.derived.facets

    @property
    def facet_warnings(self) -> list[str]:
        return self.derived.facet_warnings


# 检索缓存：
# - Key 为 (catalog, assets revision, 动作解析配置, 快照组合)。revision 由 Catalog 触发器维护，
#   收藏、标签等标记写入只改变 marks revision，不会让检索索引失效。
# - 构建过程持有 _BUILD_LOCK，同一快照的并发请求（素材分页 + facets）只构建一次。
# - 多快照组合按 LRU 保留最近 _MULTI_SNAPSHOT_CACHE_LIMIT 个，避免组合数增长导致内存膨胀。
_EntriesKey = tuple[str, int, tuple, str | tuple[str, ...] | None]
_BUILD_LOCK = threading.RLock()
_MULTI_SNAPSHOT_CACHE_LIMIT = 8
_ASSET_DERIVED_CACHE_LIMIT = 500_000
_SEARCH_ENTRIES_CACHE: OrderedDict[_EntriesKey, list[_PrecomputedSearchEntry]] = OrderedDict()
_SORTED_ENTRIES_CACHE: dict[tuple[_EntriesKey, str], list[_PrecomputedSearchEntry]] = {}
_FACET_SUMMARY_CACHE: dict[_EntriesKey, dict[str, list[str]]] = {}
_ASSET_DERIVED_CACHE: dict[tuple, _AssetDerived] = {}
_LATEST_ASSETS_REVISION: dict[str, int] = {}
_TASK_USAGE_CACHE: dict[tuple[str, tuple], dict[str, list[str]]] = {}
_WORKSPACE_USAGE_CACHE: dict[tuple[str, int, tuple, tuple], dict[str, list[str]]] = {}
_WORKSPACE_CONFIG_CACHE: dict[str, tuple[tuple[int, int], tuple[Any, Any]]] = {}
_CATALOG_KEY_CACHE: dict[str, str] = {}


def clear_search_caches() -> None:
    """清除内存中的检索、使用索引与候选节点缓存。"""
    with _BUILD_LOCK:
        _clear_index_caches()
        _TASK_USAGE_CACHE.clear()
        _WORKSPACE_USAGE_CACHE.clear()
        _NODE_CANDIDATES_CACHE.clear()
        _WORKSPACE_CONFIG_CACHE.clear()
        _LATEST_ASSETS_REVISION.clear()


def _clear_index_caches() -> None:
    _SEARCH_ENTRIES_CACHE.clear()
    _SORTED_ENTRIES_CACHE.clear()
    _FACET_SUMMARY_CACHE.clear()
    _ASSET_DERIVED_CACHE.clear()
    _FACETS_BY_REFS.clear()
    _FOLDED_FACETS.clear()
    _REF_CLASSIFY_CACHE.clear()
    _GLOBAL_DIR_CLASSIFY_CACHE.clear()
    _GLOBAL_CLASSIFY_YAML_CACHE.clear()
    _CLASSIFY_SEEN.clear()


def _drop_entries_key(key: _EntriesKey) -> None:
    _SEARCH_ENTRIES_CACHE.pop(key, None)
    _FACET_SUMMARY_CACHE.pop(key, None)
    for sorted_key in [k for k in _SORTED_ENTRIES_CACHE if k[0] == key]:
        del _SORTED_ENTRIES_CACHE[sorted_key]


def _invalidate_if_classify_changed() -> None:
    """节流检查已读取的 classify.yaml 是否被外部修改，变化时丢弃派生检索数据。"""
    global _classify_last_check
    now = time.monotonic()
    if now - _classify_last_check < _CLASSIFY_CHECK_INTERVAL_S:
        return
    _classify_last_check = now
    for path, mtime_ns in list(_CLASSIFY_SEEN.values()):
        try:
            current = path.stat().st_mtime_ns
        except OSError:
            current = -1
        if current != mtime_ns:
            logger.info("检测到 classify.yaml 变更，重建检索派生数据：%s", path)
            with _BUILD_LOCK:
                _clear_index_caches()
            return


def _load_workspace_cached(root: str | Path):
    """按 workspace.yaml 的 mtime/size 缓存配置，检索请求只读不改。"""
    paths = WorkspacePaths.from_root(root)
    try:
        stat = paths.config.stat()
    except OSError:
        return load_workspace(root)
    signature = (stat.st_mtime_ns, stat.st_size)
    key = str(paths.config)
    cached = _WORKSPACE_CONFIG_CACHE.get(key)
    if cached is not None and cached[0] == signature:
        return cached[1]
    result = load_workspace(root)
    _WORKSPACE_CONFIG_CACHE[key] = (signature, result)
    return result


def _catalog_key(catalog: CatalogRepository) -> str:
    raw = str(catalog.path)
    key = _CATALOG_KEY_CACHE.get(raw)
    if key is None:
        key = str(catalog.path.resolve()).casefold()
        _CATALOG_KEY_CACHE[raw] = key
    return key


def _normalize_import_key(
    import_ids: Collection[str] | str | None,
) -> str | tuple[str, ...] | None:
    """规范化快照组合：None | 单个 import_id | 排序去重的 tuple。"""
    if import_ids is None:
        return None
    if isinstance(import_ids, str):
        clean = import_ids.strip()
        return clean if clean and clean != "__all__" else None
    clean_list = sorted(
        {str(x).strip() for x in import_ids if str(x).strip() and str(x).strip() != "__all__"}
    )
    if not clean_list:
        return None
    if len(clean_list) == 1:
        return clean_list[0]
    return tuple(clean_list)


def _sort_entries(
    entries: list[_PrecomputedSearchEntry], sort_by: str
) -> list[_PrecomputedSearchEntry]:
    if sort_by == "order_desc":
        return entries[::-1]
    if sort_by == "time_desc":
        return sorted(entries, key=lambda e: (e.earliest_time_ns, e.asset.asset_id), reverse=True)
    if sort_by == "time_asc":
        return sorted(entries, key=lambda e: (e.earliest_time_ns, e.asset.asset_id))
    if sort_by == "name_asc":
        return sorted(entries, key=lambda e: (e.asset.display_name.casefold(), e.asset.asset_id))
    if sort_by == "name_desc":
        return sorted(
            entries,
            key=lambda e: (e.asset.display_name.casefold(), e.asset.asset_id),
            reverse=True,
        )
    return entries


class AssetSearchService:
    def __init__(self, *, facet_reader: ClassifyFacetReader | None = None):
        self.facet_reader = facet_reader or ClassifyFacetReader()

    def search(
        self,
        root: str | Path,
        filters: AssetSearchFilter,
        *,
        catalog: CatalogRepository | None = None,
    ) -> list[AssetSearchResult]:
        """保留旧数组接口，始终从匹配结果的第一条开始返回。"""
        matched, marks, usage = self._match_entries(root, filters, catalog=catalog)
        return [self._to_result(entry, marks, usage) for entry in matched[: filters.limit]]

    def search_page(
        self,
        root: str | Path,
        filters: AssetSearchFilter,
        *,
        catalog: CatalogRepository | None = None,
    ) -> AssetPageResult:
        """先完成全部过滤和稳定排序，再执行 offset/limit 分页；只为当前页构造返回对象。"""
        matched, marks, usage = self._match_entries(root, filters, catalog=catalog)
        start = filters.offset
        end = start + filters.limit
        items = [self._to_result(entry, marks, usage) for entry in matched[start:end]]
        next_offset = end if end < len(matched) else None
        return AssetPageResult(
            items=items,
            offset=filters.offset,
            limit=filters.limit,
            total=len(matched),
            has_more=next_offset is not None,
            next_offset=next_offset,
        )

    def preload_fast(
        self,
        root: str | Path,
        *,
        catalog: CatalogRepository | None = None,
    ) -> None:
        """在后端服务启动时轻量预热使用索引、最近1个活跃快照与节点候选（毫秒级瞬开）。"""
        paths, config = _load_workspace_cached(root)
        catalog_inst = catalog or CatalogRepository(paths.catalog, backups_dir=paths.backups)
        # 1. 预热使用索引（秒级构建并缓存）
        self._usage_index(paths, config.image_extensions, catalog=catalog_inst)
        # 2. 仅预热最新的 1 个活跃快照索引
        sources = catalog_inst.import_sources()
        if sources:
            self._get_search_entries(paths, config, sources[0][0], catalog=catalog_inst)
        # 3. 预热节点候选
        for role in NODE_FIELDS:
            NodeSearchService().search(root, role=role, limit=1)

    def preload_snapshot(
        self,
        root: str | Path,
        import_id: str,
        *,
        catalog: CatalogRepository | None = None,
    ) -> None:
        """后台低优先级预热指定单个快照，存入内存搜索索引缓存。"""
        if not import_id:
            return
        paths, config = _load_workspace_cached(root)
        catalog_inst = catalog or CatalogRepository(paths.catalog, backups_dir=paths.backups)
        self._get_search_entries(paths, config, import_id, catalog=catalog_inst)

    def preload_all_aggregated(
        self,
        root: str | Path,
        *,
        catalog: CatalogRepository | None = None,
    ) -> None:
        """在所有单快照已在内存中时，秒级无盘拼接出全量聚合（__all__）索引。"""
        paths, config = _load_workspace_cached(root)
        catalog_inst = catalog or CatalogRepository(paths.catalog, backups_dir=paths.backups)
        self._get_search_entries(paths, config, None, catalog=catalog_inst)

    def preload(
        self,
        root: str | Path,
        *,
        catalog: CatalogRepository | None = None,
    ) -> None:
        """默认快速预热（保持向后兼容）。"""
        self.preload_fast(root, catalog=catalog)

    def _get_search_entries(
        self,
        paths,
        config,
        import_ids: Collection[str] | str | None,
        *,
        catalog: CatalogRepository | None = None,
    ) -> list[_PrecomputedSearchEntry]:
        catalog_inst = catalog or CatalogRepository(paths.catalog, backups_dir=paths.backups)
        _, entries = self._resolve_entries(
            config, import_ids, catalog_inst, catalog_inst.revisions().assets
        )
        return entries

    def _resolve_entries(
        self,
        config,
        import_ids: Collection[str] | str | None,
        catalog: CatalogRepository,
        assets_revision: int,
    ) -> tuple[_EntriesKey, list[_PrecomputedSearchEntry]]:
        _invalidate_if_classify_changed()
        action_config = config.classification.action_resolution
        resolver_sig = (
            str(action_config.design_root) if action_config.design_root else None,
            action_config.action_root_name,
            bool(action_config.enabled),
        )
        key: _EntriesKey = (
            _catalog_key(catalog),
            assets_revision,
            resolver_sig,
            _normalize_import_key(import_ids),
        )
        cached = _SEARCH_ENTRIES_CACHE.get(key)
        if cached is not None:
            return key, cached
        with _BUILD_LOCK:
            self._purge_stale_revisions(key[0], assets_revision)
            return key, self._entries_for_key(config, catalog, key)

    @staticmethod
    def _purge_stale_revisions(catalog_key: str, assets_revision: int) -> None:
        previous = _LATEST_ASSETS_REVISION.get(catalog_key)
        if previous == assets_revision:
            return
        _LATEST_ASSETS_REVISION[catalog_key] = assets_revision
        for stale in [k for k in _SEARCH_ENTRIES_CACHE if k[0] == catalog_key and k[1] != assets_revision]:
            _drop_entries_key(stale)
        if previous is not None and assets_revision < previous:
            # 计数器回退说明 Catalog 被替换（如恢复备份），派生数据也不可信
            _clear_index_caches()

    def _entries_for_key(
        self,
        config,
        catalog: CatalogRepository,
        key: _EntriesKey,
    ) -> list[_PrecomputedSearchEntry]:
        """在 _BUILD_LOCK 内调用：命中缓存直接返回，否则构建并写入缓存。"""
        cached = _SEARCH_ENTRIES_CACHE.get(key)
        if cached is not None:
            _SEARCH_ENTRIES_CACHE.move_to_end(key)
            return cached

        norm_key = key[3]
        if norm_key is None or isinstance(norm_key, tuple):
            # 聚合多个单快照条目（复用各单快照缓存，无需从零全量扫描）
            import_ids = (
                [imp_id for imp_id, _ in catalog.import_sources()] if norm_key is None else norm_key
            )
            entries: list[_PrecomputedSearchEntry] = []
            seen_ids: set[str] = set()
            for imp_id in import_ids:
                for entry in self._entries_for_key(config, catalog, (*key[:3], imp_id)):
                    if entry.asset.asset_id not in seen_ids:
                        seen_ids.add(entry.asset.asset_id)
                        entries.append(entry)
        else:
            entries = self._build_snapshot_entries(config, catalog, norm_key, key[2])

        _SEARCH_ENTRIES_CACHE[key] = entries
        if isinstance(norm_key, tuple):
            multi_keys = [k for k in _SEARCH_ENTRIES_CACHE if isinstance(k[3], tuple)]
            for old in multi_keys[:-_MULTI_SNAPSHOT_CACHE_LIMIT]:
                _drop_entries_key(old)
        return entries

    def _build_snapshot_entries(
        self,
        config,
        catalog: CatalogRepository,
        import_id: str,
        resolver_sig: tuple,
    ) -> list[_PrecomputedSearchEntry]:
        rows = catalog.search_rows_for_import(import_id)
        action_config = config.classification.action_resolution
        action_resolver = ActionNodeValueResolver(
            design_root=action_config.design_root,
            action_root_name=action_config.action_root_name,
            enabled=action_config.enabled,
        )
        if len(_ASSET_DERIVED_CACHE) > _ASSET_DERIVED_CACHE_LIMIT:
            _ASSET_DERIVED_CACHE.clear()

        entries: list[_PrecomputedSearchEntry] = []
        for index, row in enumerate(rows):
            derived = self._derived_for(row, action_resolver, resolver_sig)
            folded_name = row.display_name.casefold()
            combined_text = (
                f"{folded_name} {derived.node_text}" if derived.node_text else folded_name
            )
            entries.append(
                _PrecomputedSearchEntry(
                    asset=row,
                    derived=derived,
                    sort_key=(index, folded_name, row.asset_id),
                    combined_text=combined_text,
                    earliest_time_ns=row.earliest_time_ns,
                )
            )
        return entries

    def _derived_for(
        self,
        row: SearchAssetRow,
        action_resolver: ActionNodeValueResolver,
        resolver_sig: tuple,
    ) -> _AssetDerived:
        # 派生数据只取决于节点，按节点签名缓存：重复导入、多快照共享的素材只计算一次
        key = (resolver_sig, row.nodes)
        cached = _ASSET_DERIVED_CACHE.get(key)
        if cached is not None:
            return cached
        asset = row.to_record()
        values = self._node_values(asset, action_resolver)
        facets, facet_warnings = self.facet_reader.read(asset)
        derived = _AssetDerived(
            values=values,
            values_folded={
                role: tuple(v.casefold() for v in items) for role, items in values.items()
            },
            facets=facets,
            facets_folded=_folded_facets(facets),
            facet_warnings=facet_warnings,
            node_text=" ".join(v for items in values.values() for v in items).casefold(),
        )
        _ASSET_DERIVED_CACHE[key] = derived
        return derived

    def _sorted_entries(
        self,
        key: _EntriesKey,
        entries: list[_PrecomputedSearchEntry],
        sort_by: str,
    ) -> list[_PrecomputedSearchEntry]:
        if sort_by == "order_asc":
            return entries
        sorted_key = (key, sort_by)
        cached = _SORTED_ENTRIES_CACHE.get(sorted_key)
        if cached is None:
            cached = _sort_entries(entries, sort_by)
            with _BUILD_LOCK:
                if key in _SEARCH_ENTRIES_CACHE:
                    _SORTED_ENTRIES_CACHE[sorted_key] = cached
        return cached

    def _match_entries(
        self,
        root: str | Path,
        filters: AssetSearchFilter,
        *,
        catalog: CatalogRepository | None = None,
    ) -> tuple[list[_PrecomputedSearchEntry], dict[str, list[str]], dict[str, list[str]]]:
        paths, config = _load_workspace_cached(root)
        catalog_inst = catalog or CatalogRepository(paths.catalog, backups_dir=paths.backups)
        revisions = catalog_inst.revisions()
        target_imports = filters.import_ids or (
            filters.import_id if filters.import_id and filters.import_id != "__all__" else None
        )
        key, entries = self._resolve_entries(config, target_imports, catalog_inst, revisions.assets)
        entries = self._sorted_entries(key, entries, filters.sort_by)
        all_marks = catalog_inst.cached_asset_marks(revisions.marks)
        usage = self._usage_index(
            paths, config.image_extensions, catalog=catalog_inst, marks_revision=revisions.marks
        )

        text_filter = filters.text.casefold() if filters.text else ""
        role_filters = [
            (role, expected.casefold())
            for role in ("artist", "character", "action_group", "action")
            if (expected := getattr(filters, role))
        ]
        facets_filter = [
            (field, {v.casefold() for v in vals}) for field, vals in filters.facets.items() if vals
        ]

        tagged_ids: set[str] | None = None
        if filters.tags:
            tag_marks = {f"tag:{tag}" for tag in filters.tags}
            tagged_ids = {
                asset_id
                for asset_id, marks in all_marks.items()
                if not tag_marks.isdisjoint(marks)
            }

        favorite_ids: set[str] | None = None
        if filters.favorite_mode != "all":
            # 未显式传入收藏 ID 时以 Catalog 中的 favorite 标记为准，避免前端在 URL 中携带大量 ID
            favorite_ids = filters.favorite_ids or {
                asset_id for asset_id, marks in all_marks.items() if "favorite" in marks
            }
            if filters.favorite_mode == "favorited" and not favorite_ids:
                return [], all_marks, usage
        want_favorited = filters.favorite_mode == "favorited"

        matched: list[_PrecomputedSearchEntry] = []
        for entry in entries:
            if text_filter and text_filter not in entry.combined_text:
                continue
            derived = entry.derived
            if role_filters and not all(
                any(expected in value for value in derived.values_folded[role])
                for role, expected in role_filters
            ):
                continue
            if facets_filter and not all(
                not derived.facets_folded.get(field, frozenset()).isdisjoint(expected)
                for field, expected in facets_filter
            ):
                continue
            asset_id = entry.asset.asset_id
            if tagged_ids is not None and asset_id not in tagged_ids:
                continue
            if favorite_ids is not None and (asset_id in favorite_ids) != want_favorited:
                continue
            if filters.posted is not None and bool(usage.get(asset_id)) != filters.posted:
                continue
            matched.append(entry)
        return matched, all_marks, usage

    @staticmethod
    def _to_result(
        entry: _PrecomputedSearchEntry,
        all_marks: dict[str, list[str]],
        usage: dict[str, list[str]],
    ) -> AssetSearchResult:
        asset = entry.asset
        marks = all_marks.get(asset.asset_id, [])
        return AssetSearchResult(
            asset_id=asset.asset_id,
            path=asset.path,
            display_name=asset.display_name,
            width=asset.width,
            height=asset.height,
            image_format=asset.image_format,
            values=entry.values,
            facets=entry.facets,
            tags=[m[4:] for m in marks if m.startswith("tag:")],
            warnings=[*asset.warnings, *entry.facet_warnings],
            usage=list(usage.get(asset.asset_id, [])),
        )

    def _search_matches(
        self,
        root: str | Path,
        filters: AssetSearchFilter,
        *,
        catalog: CatalogRepository | None = None,
    ) -> list[AssetSearchResult]:
        matched, marks, usage = self._match_entries(root, filters, catalog=catalog)
        return [self._to_result(entry, marks, usage) for entry in matched]

    def list_tags(
        self,
        root: str | Path,
        *,
        catalog: CatalogRepository | None = None,
    ) -> list[dict[str, Any]]:
        paths, _ = load_workspace(root)
        cat = catalog or CatalogRepository(paths.catalog, backups_dir=paths.backups)
        return cat.get_all_tags()

    def facets(
        self,
        root: str | Path,
        *,
        import_id: str | None = None,
        import_ids: Collection[str] | None = None,
        catalog: CatalogRepository | None = None,
    ) -> dict[str, list[str]]:
        paths, config = _load_workspace_cached(root)
        catalog_inst = catalog or CatalogRepository(paths.catalog, backups_dir=paths.backups)
        target_imports = import_ids or (import_id if import_id and import_id != "__all__" else None)
        key, entries = self._resolve_entries(
            config, target_imports, catalog_inst, catalog_inst.revisions().assets
        )
        summary = _FACET_SUMMARY_CACHE.get(key)
        if summary is None:
            collected: dict[str, set[str]] = {field: set() for field in FACET_FIELDS}
            seen_facets: set[int] = set()
            for entry in entries:
                facets = entry.facets
                # 同一动作目录的素材共享同一个 facets 对象，只需合并一次
                if id(facets) in seen_facets:
                    continue
                seen_facets.add(id(facets))
                for field, values in facets.items():
                    collected[field].update(values)
            summary = {
                field: sorted(values, key=str.casefold) for field, values in collected.items()
            }
            with _BUILD_LOCK:
                if key in _SEARCH_ENTRIES_CACHE:
                    _FACET_SUMMARY_CACHE[key] = summary
        return {field: list(values) for field, values in summary.items()}

    @staticmethod
    def _node_values(
        asset: AssetRecord,
        action_resolver: ActionNodeValueResolver,
    ) -> dict[str, list[str]]:
        return {
            role: action_resolver.values_for(asset, role)
            if role in {"action", "action_group"}
            else asset.node_values(role)
            for role in NODE_FIELDS
        }

    @staticmethod
    def _usage_index(
        paths,
        image_extensions: list[str],
        *,
        catalog: CatalogRepository | None = None,
        marks_revision: int | None = None,
    ) -> dict[str, list[str]]:
        catalog_inst = catalog or CatalogRepository(paths.catalog, backups_dir=paths.backups)
        if marks_revision is None:
            marks_revision = catalog_inst.revisions().marks

        tasks_signature: list[tuple[str, int]] = []
        if paths.tasks.is_dir():
            try:
                for item in paths.tasks.iterdir():
                    if item.is_dir():
                        tasks_signature.append((item.name, item.stat().st_mtime_ns))
            except OSError:
                pass
        tasks_sig = tuple(tasks_signature)

        plans_signature: list[tuple[str, int]] = []
        if paths.plans.is_dir():
            try:
                for item in paths.plans.iterdir():
                    if item.is_dir():
                        plans_signature.append((item.name, item.stat().st_mtime_ns))
            except OSError:
                pass
        plans_sig = tuple(plans_signature)

        workspace_key = (_catalog_key(catalog_inst), marks_revision, tasks_sig, plans_sig)
        cached_usage = _WORKSPACE_USAGE_CACHE.get(workspace_key)
        if cached_usage is not None:
            return cached_usage

        usage: dict[str, list[str]] = {}

        # 1. Catalog 资产独立标记 (仅将 posted/published 记为投稿使用，绝不计入 favorite)
        try:
            for asset_id, marks in catalog_inst.cached_asset_marks(marks_revision).items():
                for m in marks:
                    if m.startswith("posted") or m in {"posted", "published"}:
                        _append_usage(usage, asset_id, m)
        except Exception as exc:
            logger.warning("Catalog asset_marks 加载跳过：%s", exc)

        # 2. 月度计划
        repository = PlanRepository()
        if paths.plans.is_dir():
            for plan_yaml in sorted(paths.plans.glob("*/plan.yaml")):
                month = plan_yaml.parent.name
                try:
                    plan = repository.load(PlanPaths.from_workspace(paths, month))
                except (OSError, UnicodeError, ValueError) as exc:
                    logger.warning("月度计划使用索引跳过：%s：%s", plan_yaml, exc)
                    continue
                for entry in plan.entries:
                    if not isinstance(entry.content, InlineContent):
                        continue
                    for asset_ids in entry.content.sets.values():
                        for asset_id in asset_ids:
                            _append_usage(usage, asset_id, f"plan:{month}/{entry.entry_id}")

        # 3. 投稿任务 (带单个 task 缓存)
        extensions = {extension.casefold() for extension in image_extensions}
        if paths.tasks.is_dir():
            for task_root in sorted(paths.tasks.iterdir(), key=lambda item: item.name.casefold()):
                task_yaml = task_root / "task.yaml"
                if not task_yaml.is_file():
                    continue
                try:
                    task_paths = TaskPaths.from_workspace(paths, task_root.name)
                    task_stat = task_root.stat()
                    task_mtimes = [task_stat.st_mtime_ns]
                    for sel in ("all", "post", "cover"):
                        sel_dir = task_paths.selection_dirs[sel]
                        if sel_dir.is_dir():
                            task_mtimes.append(sel_dir.stat().st_mtime_ns)
                    task_cache_key = (str(task_root.resolve()), tuple(task_mtimes))
                    task_usage = _TASK_USAGE_CACHE.get(task_cache_key)
                    if task_usage is None:
                        task_usage = {}
                        TaskRepository.load(task_paths)
                        selections = CurrentSelectionScanner().scan(task_paths, extensions)
                        for selection, files in selections.items():
                            for item in files:
                                asset_id = f"sha256:{item.content_sha256}"
                                _append_usage(task_usage, asset_id, f"task:{task_root.name}/{selection}")
                        _TASK_USAGE_CACHE[task_cache_key] = task_usage

                    for asset_id, sources in task_usage.items():
                        for s in sources:
                            _append_usage(usage, asset_id, s)
                except (OSError, UnicodeError, ValueError) as exc:
                    logger.warning("投稿任务使用索引跳过：%s：%s", task_root, exc)
                    continue

        for stale in [k for k in _WORKSPACE_USAGE_CACHE if k[0] == workspace_key[0]]:
            del _WORKSPACE_USAGE_CACHE[stale]
        _WORKSPACE_USAGE_CACHE[workspace_key] = usage
        return usage


_NODE_CANDIDATES_CACHE: dict[tuple[str, int, str, str | None], list[NodeOption]] = {}


class NodeSearchService:
    """从 Catalog 推导节点候选，不把节点选择状态写回 Catalog。"""

    def search(
        self,
        root: str | Path,
        *,
        role: str,
        query: str = "",
        import_id: str | None = None,
        import_ids: Collection[str] | None = None,
        offset: int = 0,
        limit: int = 20,
    ) -> NodeListResult:
        normalized_role = str(role or "").strip()
        if normalized_role not in NODE_FIELDS:
            raise ValueError(f"不支持的节点 role：{normalized_role}")
        if offset < 0:
            raise ValueError("offset 不能小于 0")
        if not 1 <= limit <= 100:
            raise ValueError("limit 必须在 1 到 100 之间")

        # 规范化 import_ids 格式用于缓存 key
        norm_ids: tuple[str, ...] | str | None = None
        if import_ids:
            clean_list = sorted({str(x).strip() for x in import_ids if str(x).strip() and str(x).strip() != "__all__"})
            if len(clean_list) == 1:
                norm_ids = clean_list[0]
            elif len(clean_list) > 1:
                norm_ids = tuple(clean_list)
        elif import_id and import_id.strip() and import_id.strip() != "__all__":
            norm_ids = import_id.strip()

        paths, _ = _load_workspace_cached(root)
        catalog = CatalogRepository(paths.catalog, backups_dir=paths.backups)
        catalog_key = _catalog_key(catalog)
        assets_revision = catalog.revisions().assets
        cache_key = (catalog_key, assets_revision, normalized_role, norm_ids)

        if cache_key not in _NODE_CANDIDATES_CACHE:
            for stale in [
                k for k in _NODE_CANDIDATES_CACHE if k[0] == catalog_key and k[1] != assets_revision
            ]:
                _NODE_CANDIDATES_CACHE.pop(stale, None)
            options: dict[str, NodeOption] = {}
            for node_id, ref in catalog.node_candidates(normalized_role, import_id=import_id, import_ids=import_ids):
                raw_value = node_id or _name_from_ref(ref) or ""
                name = DEFAULT_NODE_IDENTITY_NORMALIZER.normalize(normalized_role, raw_value)
                if not name:
                    continue
                key = name.casefold()
                if key in options:
                    continue
                options[key] = NodeOption(role=normalized_role, name=name, ref=ref)
            _NODE_CANDIDATES_CACHE[cache_key] = sorted(
                options.values(), key=lambda item: (item.name.casefold(), item.name)
            )

        all_options = _NODE_CANDIDATES_CACHE[cache_key]
        expected = str(query or "").strip().casefold()
        if expected:
            matched = [opt for opt in all_options if expected in opt.name.casefold()]
        else:
            matched = all_options

        page = matched[offset : offset + limit]
        return NodeListResult(
            role=normalized_role,
            nodes=page,
            offset=offset,
            limit=limit,
            has_more=offset + limit < len(matched),
        )


def _name_from_ref(ref: str | None) -> str | None:
    if not ref:
        return None
    normalized = ref.replace("\\", "/").rstrip("/")
    return Path(normalized).name or None


def _flatten_values(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, (list, tuple, set)):
        result: list[str] = []
        for item in value:
            result.extend(_flatten_values(item))
        return result
    if isinstance(value, bool):
        return [str(value).casefold()]
    text = str(value).strip()
    return [text] if text else []


def _flatten_facet_values(field: str, value: Any) -> list[str]:
    """统一读取普通 facet 和 subtype 的分组映射值。"""
    if field == "subtype":
        return _flatten_subtype_values(value)
    return _flatten_values(value)


def _flatten_subtype_values(value: Any) -> list[str]:
    if isinstance(value, dict):
        result: list[str] = []
        for items in value.values():
            result.extend(_flatten_subtype_values(items))
        return result
    if isinstance(value, (list, tuple, set)):
        result: list[str] = []
        for item in value:
            result.extend(_flatten_subtype_values(item))
        return result
    return _flatten_values(value)


def _ordered_unique(values: list[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        key = value.casefold()
        if key not in seen:
            seen.add(key)
            result.append(value)
    return result


def _append_usage(index: dict[str, list[str]], asset_id: str, source: str) -> None:
    values = index.setdefault(asset_id, [])
    if source not in values:
        values.append(source)


_FILE_SHA256_CACHE: dict[tuple[str, int, int], str] = {}


def _cached_file_sha256(path: Path) -> str:
    try:
        stat = path.stat()
        key = (str(path.resolve()), stat.st_size, stat.st_mtime_ns)
        cached = _FILE_SHA256_CACHE.get(key)
        if cached is not None:
            return cached
        digest = _sha256(path)
        _FILE_SHA256_CACHE[key] = digest
        return digest
    except OSError:
        return _sha256(path)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
