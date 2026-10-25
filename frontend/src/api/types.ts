// 后端 API 响应类型（与 publishing_workspace.web 下的 FastAPI 路由保持一致）

export type SetName = "all" | "post" | "cover";
export const SET_NAMES: SetName[] = ["all", "post", "cover"];
export type Sets = Record<SetName, string[]>;

export type SortBy = "order_asc" | "order_desc" | "time_desc" | "time_asc" | "name_asc" | "name_desc";
export type FavoriteMode = "all" | "favorited" | "unfavorited";
export type PostedMode = "all" | "posted" | "unposted";
export type NodeRole = "artist" | "character" | "action_group" | "action";
export const NODE_ROLES: NodeRole[] = ["artist", "character", "action_group", "action"];

export interface ImportSource {
  import_id: string;
  source_type: string;
  source_ref: string;
  total_items: number;
  tags: string[];
  created_at: string;
  status: string;
  import_count: number;
}

export interface AssetItem {
  asset_id: string;
  path: string;
  display_name: string;
  width: number;
  height: number;
  image_format: string;
  values: Record<string, string[]>;
  facets: Record<string, string[]>;
  tags: string[];
  warnings: string[];
  usage: string[];
}

export interface AssetPage {
  items: AssetItem[];
  offset: number;
  limit: number;
  total: number;
  has_more: boolean;
  next_offset: number | null;
}

export type FacetMap = Record<string, string[]>;

export interface TagCount {
  name: string;
  count: number;
}

export interface NodeOption {
  role: string;
  name: string;
  ref: string | null;
}

export interface NodeList {
  nodes: NodeOption[];
  has_more: boolean;
}

export interface GenerationInfo {
  file_size: number;
  file_size_human: string;
  modified_at: string;
  width: number;
  height: number;
  image_format: string;
  prompt: string;
  negative_prompt: string;
  seed: number | string | null;
  model: string;
  sampler: string;
  steps: number | string | null;
  scale: number | string | null;
  noise_schedule: string;
  raw_parameters: string;
  all_chunks: Record<string, string>;
}

export interface AssetSnapshotRef {
  import_id: string;
  name: string;
  source_type: string;
  source_ref: string;
  source_order: number;
  total_items: number;
  created_at?: string;
  tags?: string[];
}

export interface AssetDetails {
  asset_id: string;
  path: string;
  display_name: string;
  width: number;
  height: number;
  image_format: string;
  is_favorited: boolean;
  is_posted: boolean;
  marks: string[];
  tags: string[];
  snapshots: AssetSnapshotRef[];
  generation_info: GenerationInfo;
}

export interface BuildImageDetails {
  width: number;
  height: number;
  image_format: string;
  generation_info: GenerationInfo;
}

export type RelatedDimensionKey = "same_batch" | "same_seed" | "time_adjacent";

export interface RelatedItem {
  asset_id: string;
  display_name: string;
  relation_type: RelatedDimensionKey;
  relation_label: string;
  width: number | null;
  height: number | null;
  snapshots: AssetSnapshotRef[];
}

export interface RelatedDimension {
  label: string;
  total: number;
  displayed_count?: number;
  items: RelatedItem[];
}

export interface RelatedResult {
  asset_id: string;
  dimensions: Record<RelatedDimensionKey, RelatedDimension>;
}

export interface PixivMetadata {
  title: string;
  caption: string;
  tags: string[];
  suggested_tags: string[];
  r18: boolean;
  allow_tag_edit: boolean;
  ai_type?: boolean;
  crop_x: number | null;
  crop_y: number | null;
  illust_id: string | null;
  published_at: string | null;
  last_publish_status: string | null;
  last_publish_error: string | null;
}

export interface ScheduleRef {
  plan_id: string;
  entry_id: string;
  scheduled_at: string;
  publish: boolean;
}

export interface SubmissionSummary {
  submission_id: string;
  task_id: string;
  title: string;
  counts: Partial<Record<SetName, number>>;
  pixiv: PixivMetadata | null;
  updated_at: string;
  scheduled_entries: ScheduleRef[];
  last_export: Record<string, unknown> | null;
  warnings: string[];
}

export interface SubmissionDetail {
  submission_id: string;
  task_id: string;
  title: string;
  revision: number;
  source_import_id: string | null;
  sets: Sets;
  pixiv: PixivMetadata | null;
  created_at: string;
  updated_at: string;
  warnings: string[];
  unresolved_files: string[];
  scheduled_at?: string | null;
  scheduled_publish?: boolean;
  allow_delay?: boolean;
  max_delay_minutes?: number;
}

export interface SubmissionMutation {
  title: string;
  revision: number | null;
  source_import_id: string | null;
  sets: Sets;
  pixiv: PixivMetadata;
  scheduled_at: string | null;
}

export interface GeneratedMetadata {
  title?: string;
  caption?: string;
  tag_suggestions?: {
    preset?: string[];
    character?: string[];
    action?: string[];
  };
}

export interface BuildImage {
  filename: string;
  preview_url: string;
  size_bytes: number;
}

export interface BuildArchive {
  filename: string;
  download_url: string;
  size_bytes: number;
}

export interface PipelineOperation {
  name: string;
  title: string;
  enabled: boolean;
  description: string;
}

export interface LatestBuild {
  has_build: boolean;
  build_id?: string;
  output_dir?: string;
  exported_at?: string | null;
  operations?: PipelineOperation[];
  mosaic_options?: { enabled: boolean; pixel_size: number } | null;
  images?: Record<SetName, BuildImage[]>;
  archives?: BuildArchive[];
}

export interface ExportJob {
  job_id: string;
  task_id: string;
  status: "queued" | "running" | "completed" | "failed" | "interrupted";
  phase: string | null;
  processed: number;
  total: number;
  percent: number;
  current_selection: SetName | null;
  current_filename: string | null;
  build_id: string | null;
  output_dir: string | null;
  error: string | null;
}

export interface SchedulePublishResult {
  scheduled_publish: boolean;
  allow_delay: boolean;
  max_delay_minutes: number;
  message?: string;
}

export interface PublishResult {
  illust_id: string;
  published_at: string;
  message?: string;
}

export interface InpaintCandidate {
  candidate_id: string;
  filename: string;
  preview_url: string;
  seed: number;
  width: number;
  height: number;
  size_bytes: number;
}

export interface InpaintGenerateResult {
  session_id: string;
  candidates: InpaintCandidate[];
}

export interface InpaintApplyResult {
  new_asset_id?: string;
  size_bytes?: number;
  width?: number;
  height?: number;
}

// ---- 月度计划 ----

export interface TaskContent {
  kind: "task";
  task_id: string;
}

export interface InlineContent {
  kind: "inline_selection";
  source_import_id?: string | null;
  sets: Sets;
}

export interface ExecutionPolicy {
  build_on_due: boolean;
  notify_on_complete: boolean;
  publish: boolean;
  allow_delay?: boolean;
  max_delay_minutes?: number;
}

export interface ScheduleEntry {
  entry_id: string;
  scheduled_at: string;
  title: string;
  content: TaskContent | InlineContent;
  execution?: ExecutionPolicy;
}

export interface MonthlyPlan {
  plan_id: string;
  month: string;
  timezone: string;
  status: "draft" | "locked";
  revision: number;
  entries: ScheduleEntry[];
}
