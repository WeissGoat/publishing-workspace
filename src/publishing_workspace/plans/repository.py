from __future__ import annotations

import json
import os
from pathlib import Path
from uuid import uuid4

import yaml

from ..config import WorkspacePaths
from ..logging import get_logger
from .models import ExecutionRecord, MonthlyPlan
from .paths import PlanPaths


logger = get_logger(__name__)


class PlanRevisionConflictError(RuntimeError):
    """计划被其他编辑器保存后，当前页面仍使用旧 revision。"""


class PlanRepository:
    def create(
        self,
        paths: PlanPaths,
        *,
        default_import_id: str | None = None,
    ) -> MonthlyPlan:
        paths.ensure_layout()
        if paths.plan_yaml.exists():
            raise FileExistsError(f"月度计划已存在：{paths.month}")
        plan = MonthlyPlan(
            plan_id=paths.month,
            month=paths.month,
            default_import_id=default_import_id,
        )
        self._write_yaml(paths.plan_yaml, plan.model_dump(mode="json"))
        return plan

    def load(self, paths: PlanPaths, *, auto_heal: bool = True) -> MonthlyPlan:
        if not paths.plan_yaml.is_file():
            raise FileNotFoundError(f"月度计划不存在：{paths.plan_yaml}")
        try:
            data = yaml.safe_load(paths.plan_yaml.read_text(encoding="utf-8-sig")) or {}
        except (OSError, UnicodeError, yaml.YAMLError) as exc:
            raise ValueError(f"无法读取月度计划：{paths.plan_yaml}：{exc}") from exc
        if not isinstance(data, dict):
            raise ValueError(f"月度计划顶层必须是对象：{paths.plan_yaml}")

        try:
            plan = MonthlyPlan.model_validate(data)
        except Exception as exc:
            if not auto_heal:
                raise
            logger.warning("月度计划加载校验未通过，尝试自愈修复：%s - %s", paths.plan_yaml, exc)
            cleaned_data = self._heal_plan_data(paths.month, data)
            plan = MonthlyPlan.model_validate(cleaned_data)
            try:
                self._write_yaml(paths.plan_yaml, plan.model_dump(mode="json"))
                logger.info("已完成月度计划自愈并写回：%s (有效条目数: %d)", paths.plan_yaml, len(plan.entries))
            except Exception as w_exc:
                logger.warning("写回自愈月度计划失败：%s", w_exc)

        if plan.month != paths.month or plan.plan_id != paths.month:
            raise ValueError("月度计划内容与目录月份不一致")
        return plan

    @staticmethod
    def _heal_plan_data(month: str, data: dict) -> dict:
        """清洗自愈计划字典，过滤掉不属于本月的条目或修复损坏结构。"""
        import datetime
        from zoneinfo import ZoneInfo

        cleaned = dict(data)
        cleaned["month"] = month
        cleaned["plan_id"] = month
        tz_name = str(cleaned.get("timezone") or "").strip() or "Asia/Shanghai"
        try:
            tz = ZoneInfo(tz_name)
        except Exception:
            tz = ZoneInfo("Asia/Shanghai")
            cleaned["timezone"] = "Asia/Shanghai"

        raw_entries = cleaned.get("entries")
        if not isinstance(raw_entries, list):
            cleaned["entries"] = []
            return cleaned

        valid_entries = []
        seen_entry_ids = set()
        for item in raw_entries:
            if not isinstance(item, dict):
                continue
            entry_id = str(item.get("entry_id") or "").strip()
            if not entry_id or entry_id in seen_entry_ids:
                continue
            sched_raw = item.get("scheduled_at")
            if not sched_raw:
                continue
            try:
                if isinstance(sched_raw, datetime.datetime):
                    dt = sched_raw
                else:
                    dt = datetime.datetime.fromisoformat(str(sched_raw).strip())
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=tz)
                local_month = dt.astimezone(tz).strftime("%Y-%m")
                if local_month != month:
                    logger.warning(
                        "自愈清洗剔除跨月条目：%s (scheduled_at=%s, target_month=%s)",
                        entry_id,
                        sched_raw,
                        month,
                    )
                    continue
            except Exception:
                continue

            seen_entry_ids.add(entry_id)
            valid_entries.append(item)

        cleaned["entries"] = valid_entries
        return cleaned

    def save(
        self,
        paths: PlanPaths,
        plan: MonthlyPlan,
        *,
        expected_revision: int | None = None,
    ) -> MonthlyPlan:
        current = self.load(paths)
        if expected_revision is not None and current.revision != expected_revision:
            raise PlanRevisionConflictError(
                f"月度计划 revision 已变化：expected={expected_revision} actual={current.revision}"
            )
        if plan.month != paths.month or plan.plan_id != paths.month:
            raise ValueError("月度计划内容与目录月份不一致")
        next_plan = plan.model_copy(update={"revision": current.revision + 1})
        # 显式验证保证写入的数据 100% 结构合法
        validated = MonthlyPlan.model_validate(next_plan.model_dump(mode="json"))
        self._write_yaml(paths.plan_yaml, validated.model_dump(mode="json"))
        return validated

    def load_execution(self, paths: PlanPaths, execution_id: str) -> ExecutionRecord:
        path = paths.execution_path(execution_id)
        if not path.is_file():
            raise FileNotFoundError(f"执行记录不存在：{path}")
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise ValueError(f"无法读取执行记录：{path}：{exc}") from exc
        return ExecutionRecord.model_validate(data)

    def save_execution(self, paths: PlanPaths, record: ExecutionRecord) -> Path:
        paths.ensure_layout()
        path = paths.execution_path(record.execution_id)
        self._write_json(path, record.model_dump(mode="json"))
        return path

    def list_executions(
        self,
        paths: PlanPaths,
        entry_id: str | None = None,
    ) -> list[ExecutionRecord]:
        if not paths.executions_dir.is_dir():
            return []
        records: list[ExecutionRecord] = []
        for path in sorted(paths.executions_dir.glob("*.json"), key=lambda item: item.name):
            record = self.load_execution(paths, path.stem)
            if entry_id is None or record.entry_id == entry_id:
                records.append(record)
        return records

    @staticmethod
    def _write_yaml(path: Path, data: dict) -> None:
        _write_atomic(
            path,
            yaml.safe_dump(data, allow_unicode=True, sort_keys=False),
        )

    @staticmethod
    def _write_json(path: Path, data: dict) -> None:
        _write_atomic(
            path,
            json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        )


def _write_atomic(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
    temporary.write_text(content, encoding="utf-8")
    os.replace(temporary, path)
