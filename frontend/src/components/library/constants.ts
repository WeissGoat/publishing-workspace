import type { NodeRole, SortBy } from "@/api";

export const FACETS: { key: string; label: string }[] = [
  { key: "clothing", label: "服装" },
  { key: "phase", label: "阶段" },
  { key: "subtype", label: "子分类" },
  { key: "cast", label: "角色类型" },
  { key: "pose", label: "体态姿势" },
  { key: "environment", label: "环境背景" },
  { key: "tone", label: "基调风格" },
  { key: "flags", label: "标记" },
  { key: "species", label: "种族" },
  { key: "domain", label: "领域" },
];

export const FACET_LABELS: Record<string, string> = Object.fromEntries(FACETS.map((f) => [f.key, f.label]));

export const NODE_FIELDS: { role: NodeRole; label: string; placeholder: string }[] = [
  { role: "artist", label: "画风", placeholder: "浏览或搜索画风" },
  { role: "character", label: "角色", placeholder: "浏览或搜索角色" },
  { role: "action_group", label: "动作组", placeholder: "浏览或搜索动作组" },
  { role: "action", label: "动作", placeholder: "浏览或搜索动作" },
];

export const ROLE_LABELS: Record<string, string> = {
  artist: "画风",
  character: "角色",
  action_group: "动作组",
  action: "动作",
};

export const SORT_OPTIONS: { label: string; value: SortBy }[] = [
  { label: "原始顺序", value: "order_asc" },
  { label: "原始顺序（倒序）", value: "order_desc" },
  { label: "生成时间（最新优先）", value: "time_desc" },
  { label: "生成时间（最早优先）", value: "time_asc" },
  { label: "文件名 A → Z", value: "name_asc" },
  { label: "文件名 Z → A", value: "name_desc" },
];
