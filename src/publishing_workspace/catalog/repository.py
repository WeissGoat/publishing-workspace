from __future__ import annotations

import hashlib
import json
import os
import sqlite3
from collections.abc import Collection, Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Literal

from PIL import Image
from pydantic import BaseModel

from ..metadata.registry import ImageNodeReaderRegistry
from ..metadata.enrichers import ImageNodeInfoEnricher
from ..logging import get_logger
from ..models import (
    AssetFingerprint,
    AssetImageInfo,
    AssetRecord,
    ImageNodeInfo,
    ImageNodeRef,
    ImportedItem,
    SelectionSet,
    utc_now_iso,
)
from ..png_metadata import read_png_text_chunks
from .migrations import migrate_catalog_v1_to_v2
from .schema import SCHEMA_ID, SCHEMA_SQL, SCHEMA_VERSION


logger = get_logger(__name__)


class AssetChangedAfterPlanningError(RuntimeError):
    pass


class CatalogIngestResult(BaseModel):
    asset: AssetRecord
    outcome: Literal["reused_path", "reused_content", "parsed_new"]


_INITIALIZED_CATALOGS: set[str] = set()
_GLOBAL_ASSET_PATH_CACHE: dict[str, str] = {}


def clear_catalog_init_cache() -> None:
    """清理 Catalog 初始化与路径内存缓存，用于单元测试重置。"""
    _INITIALIZED_CATALOGS.clear()
    _GLOBAL_ASSET_PATH_CACHE.clear()


class CatalogRepository:
    def __init__(self, path: str | Path, *, backups_dir: str | Path | None = None):
        self.path = Path(path)
        self.backups_dir = (
            Path(backups_dir) if backups_dir is not None else self.path.parent / "backups"
        )
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.initialize()

    @contextmanager
    def connection(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.path, timeout=30.0)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode = WAL")
        connection.execute("PRAGMA busy_timeout = 30000")
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA temp_store = MEMORY")
        connection.execute("PRAGMA cache_size = -131072")
        connection.execute("PRAGMA mmap_size = 268435456")
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def initialize(self) -> None:
        resolved_key = str(self.path.resolve()).casefold()
        if resolved_key in _INITIALIZED_CATALOGS and self.path.exists():
            return

        version = self._read_version()
        if version is None:
            with self.connection() as connection:
                connection.executescript(SCHEMA_SQL)
                connection.execute(
                    "INSERT INTO schema_meta(schema_id, version) VALUES (?, ?)",
                    (SCHEMA_ID, SCHEMA_VERSION),
                )
            _INITIALIZED_CATALOGS.add(resolved_key)
            return
        if version == 1:
            backup = migrate_catalog_v1_to_v2(self.path, self.backups_dir)
            logger.warning("Publishing Catalog 已从 v1 升级到 v2，备份：%s", backup)
            _INITIALIZED_CATALOGS.add(resolved_key)
            return
        if version != SCHEMA_VERSION:
            raise RuntimeError(f"不支持的 Publishing Catalog schema version：{version}")

        with self.connection() as connection:
            self._ensure_imports_tags_column(connection)

        _INITIALIZED_CATALOGS.add(resolved_key)

    def _read_version(self) -> int | None:
        if not self.path.exists():
            return None
        with sqlite3.connect(self.path, timeout=30.0) as connection:
            connection.execute("PRAGMA busy_timeout = 30000")
            columns = {
                row[1] for row in connection.execute("PRAGMA table_info(schema_meta)").fetchall()
            }
            if not columns:
                return None
            if "version" not in columns:
                raise RuntimeError("无法识别的 Publishing Catalog schema_meta")
            row = connection.execute("SELECT version FROM schema_meta LIMIT 1").fetchone()
            if row is None:
                return None
            return int(row[0])

    def _migrate_legacy_schema_meta(self, connection: sqlite3.Connection) -> None:
        columns = {
            row["name"]
            for row in connection.execute("PRAGMA table_info(schema_meta)").fetchall()
        }
        if "schema_id" in columns:
            rows = connection.execute(
                "SELECT schema_id, version FROM schema_meta"
            ).fetchall()
            if rows and any(row["schema_id"] is None for row in rows):
                recoverable = all(
                    row["schema_id"] is None and int(row["version"]) == SCHEMA_VERSION
                    for row in rows
                )
                if not recoverable:
                    raise RuntimeError("Publishing Catalog schema 迁移中间态无法恢复")
                connection.execute(
                    "UPDATE schema_meta SET schema_id=? WHERE schema_id IS NULL",
                    (SCHEMA_ID,),
                )
                logger.warning("Publishing Catalog schema 迁移已恢复：%s", self.path)
            return
        if columns != {"version"}:
            raise RuntimeError(f"无法识别的 Publishing Catalog schema_meta：{sorted(columns)}")
        rows = connection.execute("SELECT version FROM schema_meta").fetchall()
        if any(int(row["version"]) != SCHEMA_VERSION for row in rows):
            versions = sorted({int(row["version"]) for row in rows})
            raise RuntimeError(
                f"不支持的旧 Publishing Catalog schema version：{versions}"
            )
        connection.execute("ALTER TABLE schema_meta ADD COLUMN schema_id TEXT")
        if rows:
            connection.execute(
                "UPDATE schema_meta SET schema_id=?",
                (SCHEMA_ID,),
            )
        else:
            connection.execute(
                "INSERT INTO schema_meta(version, schema_id) VALUES (?, ?)",
                (SCHEMA_VERSION, SCHEMA_ID),
            )
        logger.warning("Publishing Catalog schema 已升级：%s", self.path)

    def import_selection(
        self,
        selection: SelectionSet,
        *,
        readers: ImageNodeReaderRegistry,
        enrichers: list[ImageNodeInfoEnricher] | None = None,
        strict: bool = False,
    ) -> dict[str, Any]:
        stats: dict[str, Any] = {
            "imported": 0,
            "missing": 0,
            "failed": 0,
            "asset_ids": set(),
            "reader_counts": {},
            "warnings": list(selection.warnings),
            "items": [],
        }
        with self.connection() as connection:
            connection.execute(
                "INSERT INTO imports(import_id, source_type, source_ref, source_fingerprint, mode, strict, "
                "status, pipeline_stage, total_items, warnings_json, created_at, started_at, updated_at) "
                "VALUES (?, ?, ?, NULL, 'import', ?, 'running', 'execution', ?, ?, ?, ?, ?)",
                (
                    selection.id,
                    selection.source_type,
                    selection.source_ref,
                    int(strict),
                    len(selection.items),
                    _json(selection.warnings),
                    selection.created_at,
                    selection.created_at,
                    selection.created_at,
                ),
            )
            for item in selection.items:
                self._import_item(
                    connection,
                    selection.id,
                    item,
                    readers,
                    enrichers or [],
                    strict,
                    stats,
                )
            connection.execute(
                "UPDATE imports SET status=?, pipeline_stage='completed', processed_items=?, "
                "planned_items=?, reused_path_items=0, reused_content_items=0, "
                "parsed_new_items=?, missing_items=?, failed_items=?, warnings_json=?, "
                "updated_at=?, completed_at=? WHERE import_id=?",
                (
                    "completed_with_errors" if stats["failed"] or stats["missing"] else "completed",
                    stats["imported"] + stats["missing"] + stats["failed"],
                    len(selection.items),
                    stats["imported"],
                    stats["missing"],
                    stats["failed"],
                    _json(stats["warnings"]),
                    utc_now_iso(),
                    utc_now_iso(),
                    selection.id,
                ),
            )
        return stats

    def _import_item(
        self,
        connection: sqlite3.Connection,
        import_id: str,
        item: ImportedItem,
        readers: ImageNodeReaderRegistry,
        enrichers: list[ImageNodeInfoEnricher],
        strict: bool,
        stats: dict[str, Any],
    ) -> None:
        if not item.resolved_path:
            stats["missing"] += 1
            self._insert_import_item(connection, import_id, item, status="missing", asset_id=None)
            stats["items"].append(_snapshot_item(item, status="missing", asset_id=None))
            return

        path = Path(item.resolved_path)
        try:
            asset = self._read_or_reuse_asset(connection, path, readers, enrichers)
        except Exception as exc:
            if strict:
                raise
            warning = f"图片导入失败：{path}：{exc}"
            failed_item = item.model_copy(update={"warnings": [*item.warnings, warning]})
            stats["failed"] += 1
            stats["warnings"].append(warning)
            self._insert_import_item(
                connection,
                import_id,
                failed_item,
                status="failed",
                asset_id=None,
            )
            stats["items"].append(
                _snapshot_item(failed_item, status="failed", asset_id=None)
            )
            return

        stats["imported"] += 1
        stats["asset_ids"].add(asset.asset_id)
        counts = stats["reader_counts"]
        counts[asset.node_info.reader] = counts.get(asset.node_info.reader, 0) + 1
        stats["warnings"].extend(asset.warnings)
        self._insert_import_item(
            connection,
            import_id,
            item,
            status="imported",
            asset_id=asset.asset_id,
        )
        stats["items"].append(
            _snapshot_item(item, status="imported", asset_id=asset.asset_id)
        )

    def _read_or_reuse_asset(
        self,
        connection: sqlite3.Connection,
        path: Path,
        readers: ImageNodeReaderRegistry,
        enrichers: list[ImageNodeInfoEnricher],
    ) -> AssetRecord:
        stat = path.resolve(strict=True).stat()
        return self.ingest_asset(
            connection,
            path,
            expected_size=stat.st_size,
            expected_modified_ns=stat.st_mtime_ns,
            readers=readers,
            enrichers=enrichers,
        ).asset

    def ingest_asset(
        self,
        connection: sqlite3.Connection,
        path: Path,
        *,
        expected_size: int,
        expected_modified_ns: int,
        readers: ImageNodeReaderRegistry,
        enrichers: list[ImageNodeInfoEnricher],
    ) -> CatalogIngestResult:
        resolved = path.resolve(strict=True)
        stat = resolved.stat()
        if stat.st_size != expected_size or stat.st_mtime_ns != expected_modified_ns:
            raise AssetChangedAfterPlanningError(
                f"图片在规划后发生变化：{resolved}"
            )
        path_key = normalize_path_key(resolved)
        cached_asset_id = self.lookup_path_asset(
            connection, path_key, stat.st_size, stat.st_mtime_ns
        )
        if cached_asset_id is not None:
            connection.execute(
                "UPDATE asset_paths SET available=1, last_seen_at=? WHERE path_key=?",
                (utc_now_iso(), path_key),
            )
            return CatalogIngestResult(
                asset=self._asset_from_db(
                    connection, cached_asset_id, preferred_path=resolved
                ),
                outcome="reused_path",
            )

        digest = _sha256_file(resolved)
        asset_id = f"sha256:{digest}"
        existing = connection.execute(
            "SELECT asset_id FROM assets WHERE sha256=?", (digest,)
        ).fetchone()
        if existing is None:
            with Image.open(resolved) as image:
                width, height = image.size
                image_format = image.format or resolved.suffix.lstrip(".").upper()
                metadata = dict(image.info)
            if image_format.casefold() == "png":
                # core 的兼容文本块可能位于 IDAT 之后，Pillow 延迟加载时不会出现在 image.info。
                metadata.update(read_png_text_chunks(resolved))
            node_info = readers.read(resolved, metadata)
            for enricher in enrichers:
                node_info = enricher.enrich(resolved, node_info)
            now = utc_now_iso()
            connection.execute(
                "INSERT INTO assets(asset_id, sha256, size, width, height, image_format, "
                "metadata_format, reader, warnings_json, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    asset_id,
                    digest,
                    stat.st_size,
                    width,
                    height,
                    image_format,
                    node_info.format,
                    node_info.reader,
                    _json(node_info.warnings),
                    now,
                    now,
                ),
            )
            self._replace_nodes(connection, asset_id, node_info)
            outcome: Literal["reused_content", "parsed_new"] = "parsed_new"
        else:
            asset_id = existing["asset_id"]
            outcome = "reused_content"

        connection.execute(
            "INSERT INTO asset_paths(path_key, path, asset_id, size, modified_ns, available, last_seen_at) "
            "VALUES (?, ?, ?, ?, ?, 1, ?) "
            "ON CONFLICT(path_key) DO UPDATE SET path=excluded.path, asset_id=excluded.asset_id, "
            "size=excluded.size, modified_ns=excluded.modified_ns, available=1, "
            "last_seen_at=excluded.last_seen_at",
            (path_key, str(resolved), asset_id, stat.st_size, stat.st_mtime_ns, utc_now_iso()),
        )
        return CatalogIngestResult(
            asset=self._asset_from_db(connection, asset_id, preferred_path=resolved),
            outcome=outcome,
        )

    def _replace_nodes(
        self,
        connection: sqlite3.Connection,
        asset_id: str,
        node_info: ImageNodeInfo,
    ) -> None:
        connection.execute("DELETE FROM asset_nodes WHERE asset_id=?", (asset_id,))
        for node in node_info.nodes:
            connection.execute(
                "INSERT OR IGNORE INTO asset_nodes(asset_id, role, node_index, node_id, ref) "
                "VALUES (?, ?, ?, ?, ?)",
                (asset_id, node.role, node.index, node.id or "", node.ref or ""),
            )

    def lookup_path_asset(
        self,
        connection: sqlite3.Connection,
        path_key: str,
        size: int,
        modified_ns: int,
    ) -> str | None:
        row = connection.execute(
            "SELECT asset_id FROM asset_paths WHERE path_key=? AND size=? AND modified_ns=? "
            "AND available=1",
            (path_key, size, modified_ns),
        ).fetchone()
        return str(row["asset_id"]) if row is not None else None

    def _insert_import_item(
        self,
        connection: sqlite3.Connection,
        import_id: str,
        item: ImportedItem,
        *,
        status: str,
        asset_id: str | None,
    ) -> None:
        connection.execute(
            "INSERT INTO import_items(import_id, source_order, source_path, resolved_path, "
            "display_name, decision, status, attempts, asset_id, warnings_json, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)",
            (
                import_id,
                item.source_order,
                item.source_path,
                item.resolved_path,
                item.display_name,
                "legacy" if status == "imported" else ("missing_path" if status == "missing" else "parse"),
                status,
                asset_id,
                _json(item.warnings),
                utc_now_iso(),
                utc_now_iso(),
            ),
        )

    def assets_for_import(self, import_id: str | None = None) -> list[AssetRecord]:
        with self.connection() as connection:
            if import_id:
                rows = connection.execute(
                    "SELECT ii.asset_id, ii.resolved_path, ii.source_order, ii.display_name "
                    "FROM import_items ii WHERE ii.import_id=? AND ii.asset_id IS NOT NULL "
                    "ORDER BY ii.source_order",
                    (import_id,),
                ).fetchall()
            else:
                rows = connection.execute(
                    "SELECT ii.asset_id, ii.resolved_path, ii.source_order, ii.display_name "
                    "FROM import_items ii JOIN imports i ON i.import_id=ii.import_id "
                    "WHERE ii.asset_id IS NOT NULL ORDER BY i.rowid DESC, ii.source_order ASC"
                ).fetchall()
            unique_rows: dict[str, sqlite3.Row] = {}
            for row in rows:
                unique_rows.setdefault(row["asset_id"], row)
            if not unique_rows:
                return []

            if import_id:
                asset_rows = connection.execute(
                    "SELECT a.* FROM assets a "
                    "JOIN import_items ii ON ii.asset_id=a.asset_id "
                    "WHERE ii.import_id=?",
                    (import_id,),
                ).fetchall()
                assets = {row["asset_id"]: row for row in asset_rows}

                path_rows = connection.execute(
                    "SELECT ap.* FROM asset_paths ap "
                    "JOIN import_items ii ON ii.asset_id=ap.asset_id "
                    "WHERE ii.import_id=? "
                    "ORDER BY ap.asset_id, ap.available DESC, ap.rowid",
                    (import_id,),
                ).fetchall()
                paths: dict[str, list[sqlite3.Row]] = {}
                for r in path_rows:
                    paths.setdefault(r["asset_id"], []).append(r)

                node_rows = connection.execute(
                    "SELECT an.* FROM asset_nodes an "
                    "JOIN import_items ii ON ii.asset_id=an.asset_id "
                    "WHERE ii.import_id=? "
                    "ORDER BY an.asset_id, an.role, an.node_index, an.rowid",
                    (import_id,),
                ).fetchall()
                nodes: dict[str, list[sqlite3.Row]] = {}
                for r in node_rows:
                    nodes.setdefault(r["asset_id"], []).append(r)
            else:
                asset_rows = connection.execute("SELECT * FROM assets").fetchall()
                assets = {row["asset_id"]: row for row in asset_rows}
                path_rows = connection.execute(
                    "SELECT rowid, * FROM asset_paths ORDER BY asset_id, available DESC, rowid"
                ).fetchall()
                paths: dict[str, list[sqlite3.Row]] = {}
                for r in path_rows:
                    paths.setdefault(r["asset_id"], []).append(r)
                node_rows = connection.execute(
                    "SELECT rowid, * FROM asset_nodes ORDER BY asset_id, role, node_index, rowid"
                ).fetchall()
                nodes: dict[str, list[sqlite3.Row]] = {}
                for r in node_rows:
                    nodes.setdefault(r["asset_id"], []).append(r)

            records: list[AssetRecord] = []
            for asset_id, source_row in unique_rows.items():
                asset = assets.get(asset_id)
                if asset is None:
                    raise KeyError(f"Catalog 中找不到资产：{asset_id}")
                preferred_path = str(source_row["resolved_path"]).casefold()
                path_rows = paths.get(asset_id, [])
                path_row = next(
                    (row for row in path_rows if str(row["path"]).casefold() == preferred_path),
                    path_rows[0] if path_rows else None,
                )
                if path_row is None:
                    raise KeyError(f"Catalog 中找不到资产路径：{asset_id}")
                node_rows = nodes.get(asset_id, [])
                node_info = ImageNodeInfo(
                    format=asset["metadata_format"],
                    reader=asset["reader"],
                    nodes=[
                        ImageNodeRef(
                            role=row["role"],
                            id=row["node_id"] or None,
                            ref=row["ref"] or None,
                            index=row["node_index"],
                        )
                        for row in node_rows
                    ],
                    warnings=json.loads(asset["warnings_json"]),
                )
                records.append(
                    AssetRecord(
                        asset_id=asset_id,
                        path=path_row["path"],
                        fingerprint=AssetFingerprint(
                            size=path_row["size"],
                            modified_ns=path_row["modified_ns"],
                            sha256=asset["sha256"],
                        ),
                        image=AssetImageInfo(
                            width=asset["width"],
                            height=asset["height"],
                            format=asset["image_format"],
                        ),
                        node_info=node_info,
                        display_name=source_row["display_name"],
                        source_order=source_row["source_order"],
                        warnings=list(node_info.warnings),
                    )
                )
            for r in records:
                if r.path:
                    _GLOBAL_ASSET_PATH_CACHE[r.asset_id] = str(r.path)
            return records

    def snapshots_for_asset(self, asset_id: str) -> list[dict[str, Any]]:
        """查询指定素材出现过的所有快照（按快照导入时间降序、快照内序号升序排列）。"""
        if not asset_id:
            return []
        with self.connection() as connection:
            rows = connection.execute(
                "SELECT "
                "  i.import_id, i.source_type, i.source_ref, i.mode, i.status AS import_status, "
                "  i.total_items, i.tags_json, i.created_at AS import_created_at, "
                "  ii.source_order, ii.source_path, ii.resolved_path, ii.display_name, "
                "  ii.decision, ii.status AS item_status "
                "FROM import_items ii "
                "JOIN imports i ON i.import_id = ii.import_id "
                "WHERE ii.asset_id = ? "
                "   OR ii.resolved_path = (SELECT path FROM asset_paths WHERE asset_id = ?) "
                "ORDER BY i.created_at DESC, ii.source_order ASC",
                (asset_id, asset_id),
            ).fetchall()

        results: list[dict[str, Any]] = []
        for r in rows:
            ref = r["source_ref"] or ""
            name = Path(ref).name if ref else r["import_id"]
            tags = []
            try:
                tags = json.loads(r["tags_json"] or "[]")
            except Exception:
                pass
            results.append({
                "import_id": r["import_id"],
                "name": name,
                "source_type": r["source_type"],
                "source_ref": r["source_ref"],
                "source_order": r["source_order"],
                "total_items": r["total_items"],
                "tags": tags,
                "display_name": r["display_name"],
                "source_path": r["source_path"],
                "resolved_path": r["resolved_path"],
                "decision": r["decision"],
                "status": r["item_status"],
                "created_at": r["import_created_at"],
            })
        return results

    def record_asset_alias(self, old_asset_id: str, new_asset_id: str, path: str = "") -> None:
        """记录资产别名映射（如重绘后原 SHA256 映射至新 SHA256）。"""
        if not old_asset_id or not new_asset_id or old_asset_id == new_asset_id:
            return
        now = utc_now_iso()
        with self.connection() as connection:
            self._ensure_asset_aliases_table(connection)
            # 更新已有将其他 ID 映射到 old_asset_id 的链路，指向最新的 new_asset_id
            connection.execute(
                "UPDATE asset_aliases SET new_asset_id=? WHERE new_asset_id=?",
                (new_asset_id, old_asset_id),
            )
            connection.execute(
                "INSERT INTO asset_aliases(old_asset_id, new_asset_id, path, created_at) "
                "VALUES (?, ?, ?, ?) "
                "ON CONFLICT(old_asset_id) DO UPDATE SET new_asset_id=excluded.new_asset_id, "
                "path=excluded.path, created_at=excluded.created_at",
                (old_asset_id, new_asset_id, path, now),
            )

    def resolve_asset_id(self, asset_id: str) -> str:
        """解析资产别名，若存在重命名/重绘映射链则返回最新生效的 asset_id。"""
        if not asset_id:
            return asset_id
        with self.connection() as connection:
            self._ensure_asset_aliases_table(connection)
            current = asset_id
            visited = {current}
            while True:
                row = connection.execute(
                    "SELECT new_asset_id FROM asset_aliases WHERE old_asset_id=?",
                    (current,),
                ).fetchone()
                if row and row["new_asset_id"]:
                    nxt = str(row["new_asset_id"])
                    if nxt in visited:
                        break
                    visited.add(nxt)
                    current = nxt
                else:
                    break
            return current

    def _ensure_asset_aliases_table(self, connection: sqlite3.Connection) -> None:
        connection.execute(
            "CREATE TABLE IF NOT EXISTS asset_aliases ("
            "    old_asset_id TEXT PRIMARY KEY,"
            "    new_asset_id TEXT NOT NULL,"
            "    path TEXT NOT NULL DEFAULT '',"
            "    created_at TEXT NOT NULL"
            ")"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_asset_aliases_new ON asset_aliases(new_asset_id)"
        )

    def assets_by_ids(
        self,
        asset_ids: Collection[str],
        *,
        import_id: str | None = None,
    ) -> dict[str, AssetRecord]:
        """按资产 ID 批量读取记录；返回值仅包含当前作用域内存在的资产。"""
        requested = _ordered_unique_text(asset_ids)
        if not requested:
            return {}

        with self.connection() as connection:
            self._ensure_asset_aliases_table(connection)
            # 解析所有请求 ID 的最新别名
            id_mapping: dict[str, str] = {aid: self.resolve_asset_id(aid) for aid in requested}
            all_lookup_ids = list(dict.fromkeys(list(requested) + list(id_mapping.values())))

            source_rows: dict[str, sqlite3.Row] = {}
            for chunk in _chunks(all_lookup_ids):
                placeholders = ",".join("?" for _ in chunk)
                if import_id is not None:
                    rows = connection.execute(
                        "SELECT asset_id, resolved_path, source_order, display_name "
                        "FROM import_items "
                        f"WHERE import_id=? AND asset_id IN ({placeholders}) "
                        "ORDER BY source_order, rowid",
                        [import_id, *chunk],
                    ).fetchall()
                else:
                    rows = connection.execute(
                        "SELECT asset_id, path AS resolved_path, 0 AS source_order, "
                        "path AS display_name FROM asset_paths "
                        f"WHERE asset_id IN ({placeholders}) "
                        "ORDER BY available DESC, rowid",
                        chunk,
                    ).fetchall()
                for row in rows:
                    source_rows.setdefault(str(row["asset_id"]), row)

            # 容错降级：在全局查询模式 (import_id is None) 下，对于在 asset_paths 中未命中的 asset_id，尝试从 import_items 查找其历史关联路径
            if import_id is None:
                missing_ids = [aid for aid in all_lookup_ids if aid not in source_rows]
                if missing_ids:
                    for chunk in _chunks(missing_ids):
                        placeholders = ",".join("?" for _ in chunk)
                        fallback_rows = connection.execute(
                            "SELECT asset_id, resolved_path, source_order, display_name "
                            "FROM import_items "
                            f"WHERE asset_id IN ({placeholders}) "
                            "ORDER BY rowid DESC",
                            chunk,
                        ).fetchall()
                        for row in fallback_rows:
                            source_rows.setdefault(str(row["asset_id"]), row)

            result: dict[str, AssetRecord] = {}
            for asset_id in requested:
                resolved_id = id_mapping.get(asset_id, asset_id)
                source_row = source_rows.get(resolved_id) or source_rows.get(asset_id)
                if source_row is None:
                    continue
                p_path = Path(source_row["resolved_path"]) if source_row["resolved_path"] else None
                active_asset_id = resolved_id

                # 若当前 active_asset_id 在 assets 表已不存在，尝试通过物理路径获取最新的 asset_id
                if p_path and p_path.is_file():
                    asset_exists = connection.execute(
                        "SELECT 1 FROM assets WHERE asset_id=?", (active_asset_id,)
                    ).fetchone()
                    if asset_exists is None:
                        path_key = normalize_path_key(p_path)
                        cur_row = connection.execute(
                            "SELECT asset_id FROM asset_paths WHERE path_key=? OR path=?",
                            (path_key, str(p_path)),
                        ).fetchone()
                        if cur_row:
                            active_asset_id = cur_row["asset_id"]

                try:
                    record = self._asset_from_db(
                        connection,
                        active_asset_id,
                        preferred_path=p_path,
                    )
                    if import_id is not None:
                        record = record.model_copy(
                            update={
                                "source_order": int(source_row["source_order"]),
                                "display_name": str(source_row["display_name"]),
                            }
                        )
                    result[asset_id] = record
                except Exception as exc:
                    logger.debug("按 ID 读取资产记录失败 (asset_id=%s): %s", asset_id, exc)

            for aid, r in result.items():
                if r.path:
                    _GLOBAL_ASSET_PATH_CACHE[aid] = str(r.path)
            return result

    def _rows_by_asset_id(
        self,
        connection: sqlite3.Connection,
        table: str,
        asset_ids: list[str],
    ) -> dict[str, sqlite3.Row]:
        result: dict[str, sqlite3.Row] = {}
        for chunk in _chunks(asset_ids):
            placeholders = ",".join("?" for _ in chunk)
            rows = connection.execute(
                f"SELECT * FROM {table} WHERE asset_id IN ({placeholders})",
                chunk,
            ).fetchall()
            result.update({row["asset_id"]: row for row in rows})
        return result

    def _group_rows_by_asset_id(
        self,
        connection: sqlite3.Connection,
        table: str,
        asset_ids: list[str],
        *,
        order_by: str,
    ) -> dict[str, list[sqlite3.Row]]:
        result: dict[str, list[sqlite3.Row]] = {}
        for chunk in _chunks(asset_ids):
            placeholders = ",".join("?" for _ in chunk)
            rows = connection.execute(
                f"SELECT rowid, * FROM {table} WHERE asset_id IN ({placeholders}) "
                f"ORDER BY {order_by}",
                chunk,
            ).fetchall()
            for row in rows:
                result.setdefault(row["asset_id"], []).append(row)
        return result

    def latest_import_id(self, connection: sqlite3.Connection | None = None) -> str | None:
        if connection is None:
            with self.connection() as own_connection:
                return self.latest_import_id(own_connection)
        row = connection.execute(
            "SELECT import_id FROM imports ORDER BY rowid DESC LIMIT 1"
        ).fetchone()
        return row["import_id"] if row else None

    def _ensure_imports_tags_column(self, connection: sqlite3.Connection) -> None:
        columns = {
            row["name"]
            for row in connection.execute("PRAGMA table_info(imports)").fetchall()
        }
        if "tags_json" not in columns:
            connection.execute("ALTER TABLE imports ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]'")

    def list_imports_summary(self, *, deduplicate_sources: bool = True) -> list[dict[str, Any]]:
        """返回已导入快照详情列表（按创建时间倒序排），默认按同源图集归并，供前端与 API 交互选择使用。"""
        with self.connection() as connection:
            self._ensure_imports_tags_column(connection)
            rows = connection.execute(
                "SELECT import_id, source_type, source_ref, total_items, tags_json, created_at, status "
                "FROM imports ORDER BY rowid DESC"
            ).fetchall()

        if not deduplicate_sources:
            raw_result: list[dict[str, Any]] = []
            for row in rows:
                tags = _parse_tags_json(row["tags_json"] if "tags_json" in row.keys() else None)
                raw_result.append(
                    {
                        "import_id": str(row["import_id"]),
                        "source_type": str(row["source_type"]),
                        "source_ref": str(row["source_ref"]),
                        "total_items": int(row["total_items"] or 0),
                        "tags": tags,
                        "created_at": str(row["created_at"] or ""),
                        "status": str(row["status"] or ""),
                        "import_count": 1,
                    }
                )
            return raw_result

        grouped: dict[str, dict[str, Any]] = {}
        for row in rows:
            ref = str(row["source_ref"] or "")
            key = os.path.normpath(ref).casefold()
            tags = _parse_tags_json(row["tags_json"] if "tags_json" in row.keys() else None)
            total = int(row["total_items"] or 0)
            status = str(row["status"] or "")

            if key not in grouped:
                grouped[key] = {
                    "import_id": str(row["import_id"]),
                    "source_type": str(row["source_type"]),
                    "source_ref": ref,
                    "total_items": total,
                    "tags": list(dict.fromkeys(tags)),
                    "created_at": str(row["created_at"] or ""),
                    "status": status,
                    "import_count": 1,
                }
            else:
                grouped[key]["import_count"] += 1
                for t in tags:
                    if t not in grouped[key]["tags"]:
                        grouped[key]["tags"].append(t)
                # 若最新一条记录为 0 张且失败，而历史某次成功有张数，则优先继承有张数的有效代表
                if grouped[key]["total_items"] == 0 and total > 0:
                    grouped[key]["total_items"] = total
                    grouped[key]["import_id"] = str(row["import_id"])
                    grouped[key]["status"] = status

        return list(grouped.values())

    def import_sources(self) -> list[tuple[str, str]]:
        """返回已导入来源，用于生成稳定的用户可读导出目录名。"""
        with self.connection() as connection:
            rows = connection.execute(
                "SELECT import_id, source_ref FROM imports ORDER BY rowid DESC"
            ).fetchall()
        return [(str(row["import_id"]), str(row["source_ref"])) for row in rows]

    def node_candidates(
        self,
        role: str,
        import_id: str | None = None,
        import_ids: Collection[str] | None = None,
    ) -> list[tuple[str, str | None]]:
        """直接从节点索引读取候选，供交互式节点选择使用。"""
        normalized_role = str(role).strip()
        if not normalized_role:
            raise ValueError("节点 role 不能为空")

        clean_ids: list[str] = []
        if import_ids:
            clean_ids = [str(x).strip() for x in import_ids if str(x).strip() and str(x).strip() != "__all__"]
        elif import_id and import_id.strip() and import_id.strip() != "__all__":
            clean_ids = [import_id.strip()]

        with self.connection() as connection:
            if clean_ids:
                placeholders = ",".join("?" for _ in clean_ids)
                rows = connection.execute(
                    "SELECT DISTINCT n.node_id, n.ref "
                    "FROM asset_nodes n "
                    "JOIN import_items ii ON ii.asset_id=n.asset_id "
                    f"WHERE ii.import_id IN ({placeholders}) AND ii.asset_id IS NOT NULL AND n.role=? "
                    "ORDER BY LOWER(n.node_id), n.node_id, n.ref",
                    [*clean_ids, normalized_role],
                ).fetchall()
            else:
                rows = connection.execute(
                    "SELECT DISTINCT node_id, ref "
                    "FROM asset_nodes "
                    "WHERE role=? "
                    "ORDER BY LOWER(node_id), node_id, ref",
                    (normalized_role,),
                ).fetchall()
        return [
            (str(row["node_id"] or ""), str(row["ref"]) if row["ref"] else None)
            for row in rows
        ]

    def get_asset_path(self, asset_id: str) -> str | None:
        """快速获取资产文件绝对路径，优先命中内存缓存，极速响应预览流。"""
        cached = _GLOBAL_ASSET_PATH_CACHE.get(asset_id)
        if cached is not None and Path(cached).is_file():
            return cached
        with self.connection() as connection:
            row = connection.execute(
                "SELECT path FROM asset_paths WHERE asset_id=? ORDER BY available DESC, rowid LIMIT 1",
                (asset_id,),
            ).fetchone()
            if row and row["path"]:
                path_str = str(row["path"])
                if Path(path_str).is_file():
                    _GLOBAL_ASSET_PATH_CACHE[asset_id] = path_str
                    return path_str

            # 容错降级：若 asset_paths 中无此历史 hash，尝试从 import_items 历史查找路径
            row = connection.execute(
                "SELECT resolved_path FROM import_items WHERE asset_id=? ORDER BY rowid DESC LIMIT 1",
                (asset_id,),
            ).fetchone()
            if row and row["resolved_path"]:
                path_str = str(row["resolved_path"])
                if Path(path_str).is_file():
                    _GLOBAL_ASSET_PATH_CACHE[asset_id] = path_str
                    return path_str
        return None

    def set_asset_marks(
        self,
        asset_ids: list[str],
        mark: str,
        note: str = "",
    ) -> int:
        """为一组资产打上特定标记（如 'posted' 或 'posted:20260322'）。"""
        clean_mark = str(mark or "").strip()
        if not clean_mark:
            raise ValueError("mark 不能为空")
        now = utc_now_iso()
        count = 0
        with self.connection() as connection:
            self.initialize()
            for aid in asset_ids:
                clean_aid = str(aid or "").strip()
                if not clean_aid:
                    continue
                connection.execute(
                    "INSERT INTO asset_marks (asset_id, mark, note, created_at) "
                    "VALUES (?, ?, ?, ?) "
                    "ON CONFLICT(asset_id, mark) DO UPDATE SET note=excluded.note, created_at=excluded.created_at",
                    (clean_aid, clean_mark, str(note or "").strip(), now),
                )
                count += 1
        return count

    def remove_asset_marks(
        self,
        asset_ids: list[str],
        mark: str | None = None,
    ) -> int:
        """移除资产的标记。"""
        with self.connection() as connection:
            self.initialize()
            if mark:
                clean_mark = str(mark).strip()
                cursor = connection.executemany(
                    "DELETE FROM asset_marks WHERE asset_id=? AND mark=?",
                    [(str(aid).strip(), clean_mark) for aid in asset_ids if str(aid).strip()],
                )
            else:
                cursor = connection.executemany(
                    "DELETE FROM asset_marks WHERE asset_id=?",
                    [(str(aid).strip(),) for aid in asset_ids if str(aid).strip()],
                )
            return cursor.rowcount

    def remove_posted_marks(self, asset_ids: list[str]) -> int:
        """移除指定资产的所有 posted 标记（包含 'posted'、'published' 和以 'posted:' 开头的所有标记）。"""
        clean_aids = [str(aid).strip() for aid in asset_ids if str(aid).strip()]
        if not clean_aids:
            return 0
        with self.connection() as connection:
            self.initialize()
            cursor = connection.executemany(
                "DELETE FROM asset_marks WHERE asset_id=? AND (mark='posted' OR mark='published' OR mark LIKE 'posted:%')",
                [(aid,) for aid in clean_aids],
            )
            return cursor.rowcount

    def all_asset_marks(self) -> dict[str, list[str]]:
        """获取所有资产的标记映射 {asset_id: [mark1, mark2, ...]}。"""
        result: dict[str, list[str]] = {}
        with self.connection() as connection:
            self.initialize()
            rows = connection.execute(
                "SELECT asset_id, mark FROM asset_marks ORDER BY created_at"
            ).fetchall()
            for row in rows:
                aid = str(row["asset_id"])
                m = str(row["mark"])
                result.setdefault(aid, []).append(m)
        return result

    def set_asset_tags(
        self,
        asset_ids: list[str],
        tags: list[str],
        note: str = "Import tag",
    ) -> int:
        """为一组资产批量打上导入/筛选标签（以 'tag:<tag_name>' 存储）。"""
        clean_tags = [str(t).strip() for t in tags if str(t).strip()]
        if not clean_tags:
            return 0
        count = 0
        for tag in clean_tags:
            count += self.set_asset_marks(asset_ids, mark=f"tag:{tag}", note=note)
        return count

    def get_all_tags(self) -> list[dict[str, Any]]:
        """获取当前工作区中所有已打上的标签及其关联的资产数量。"""
        with self.connection() as connection:
            self.initialize()
            rows = connection.execute(
                "SELECT mark, COUNT(DISTINCT asset_id) as count FROM asset_marks "
                "WHERE mark LIKE 'tag:%' GROUP BY mark ORDER BY count DESC, mark ASC"
            ).fetchall()
        return [
            {"name": str(row["mark"])[4:], "count": int(row["count"])}
            for row in rows
        ]

    def _asset_from_db(
        self,
        connection: sqlite3.Connection,
        asset_id: str,
        *,
        preferred_path: Path,
    ) -> AssetRecord:
        asset = connection.execute(
            "SELECT * FROM assets WHERE asset_id=?", (asset_id,)
        ).fetchone()
        if asset is None:
            raise KeyError(f"Catalog 中找不到资产：{asset_id}")
        path_row = connection.execute(
            "SELECT * FROM asset_paths WHERE path_key=? AND asset_id=?",
            (normalize_path_key(preferred_path), asset_id),
        ).fetchone()
        if path_row is None:
            path_row = connection.execute(
                "SELECT * FROM asset_paths WHERE asset_id=? ORDER BY available DESC, rowid LIMIT 1",
                (asset_id,),
            ).fetchone()
        node_rows = connection.execute(
            "SELECT role, node_index, node_id, ref FROM asset_nodes "
            "WHERE asset_id=? ORDER BY role, node_index, rowid",
            (asset_id,),
        ).fetchall()
        node_info = ImageNodeInfo(
            format=asset["metadata_format"],
            reader=asset["reader"],
            nodes=[
                ImageNodeRef(
                    role=row["role"],
                    id=row["node_id"] or None,
                    ref=row["ref"] or None,
                    index=row["node_index"],
                )
                for row in node_rows
            ],
            warnings=json.loads(asset["warnings_json"]),
        )
        return AssetRecord(
            asset_id=asset_id,
            path=path_row["path"],
            fingerprint=AssetFingerprint(
                size=path_row["size"],
                modified_ns=path_row["modified_ns"],
                sha256=asset["sha256"],
            ),
            image=AssetImageInfo(
                width=asset["width"],
                height=asset["height"],
                format=asset["image_format"],
            ),
            node_info=node_info,
            display_name=Path(path_row["path"]).name,
            warnings=list(node_info.warnings),
        )

    def read_export_states(self, exporter: str) -> dict[str, dict[str, Any]]:
        with self.connection() as connection:
            rows = connection.execute(
                "SELECT view_key, content_hash, outputs_json FROM export_states WHERE exporter=?",
                (exporter,),
            ).fetchall()
        return {
            row["view_key"]: {
                "content_hash": row["content_hash"],
                "outputs": json.loads(row["outputs_json"]),
            }
            for row in rows
        }

    def replace_export_states(
        self,
        exporter: str,
        states: dict[str, dict[str, Any]],
    ) -> None:
        with self.connection() as connection:
            connection.execute("DELETE FROM export_states WHERE exporter=?", (exporter,))
            for view_key, state in states.items():
                connection.execute(
                    "INSERT INTO export_states(exporter, view_key, content_hash, outputs_json, updated_at) "
                    "VALUES (?, ?, ?, ?, ?)",
                    (
                        exporter,
                        view_key,
                        state["content_hash"],
                        _json(state.get("outputs", [])),
                        utc_now_iso(),
                    ),
                )


def _chunks(values: list[str], size: int = 800) -> Iterator[list[str]]:
    for start in range(0, len(values), size):
        yield values[start : start + size]


def _ordered_unique_text(values: Collection[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        text = str(value or "").strip()
        if not text or text in seen:
            continue
        seen.add(text)
        result.append(text)
    return result


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalize_path_key(path: Path) -> str:
    return str(path.expanduser().resolve()).casefold()


_path_key = normalize_path_key


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _parse_tags_json(raw: str | None) -> list[str]:
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            return [str(t).strip() for t in parsed if str(t).strip()]
    except Exception:
        pass
    return []


def _snapshot_item(item: ImportedItem, *, status: str, asset_id: str | None) -> dict[str, Any]:
    return {
        **item.model_dump(mode="json"),
        "status": status,
        "asset_id": asset_id,
    }
