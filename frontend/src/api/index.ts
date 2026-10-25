import { enc, http } from "./client";
import type {
  AssetDetails,
  AssetPage,
  BuildImageDetails,
  ExportJob,
  FacetMap,
  GeneratedMetadata,
  ImportSource,
  InpaintApplyResult,
  InpaintGenerateResult,
  LatestBuild,
  MonthlyPlan,
  NodeList,
  NodeRole,
  PublishResult,
  RelatedResult,
  ScheduleEntry,
  SchedulePublishResult,
  SetName,
  SortBy,
  SubmissionDetail,
  SubmissionMutation,
  SubmissionSummary,
  TagCount,
} from "./types";

export { ApiError } from "./client";
export * from "./types";

// 后端缩略图档位，客户端先取档，保证同一档位只占一份浏览器缓存
export const THUMBNAIL_WIDTHS = [320, 640, 960];

export function thumbUrl(assetId: string, cssWidth = 200): string {
  const px = Math.ceil(cssWidth * (window.devicePixelRatio || 1));
  const width = THUMBNAIL_WIDTHS.find((w) => px <= w) ?? THUMBNAIL_WIDTHS[THUMBNAIL_WIDTHS.length - 1];
  return `/api/assets/${enc(assetId)}/thumbnail?w=${width}`;
}

export function previewUrl(assetId: string, bust?: string | number): string {
  return `/api/assets/${enc(assetId)}/preview${bust !== undefined ? `?v=${bust}` : ""}`;
}

/** 快照选择参数：空数组表示未选择；`__all__` 表示全部快照（不传 import_ids）。 */
export function importIdsParam(importIds: string[]): string | undefined {
  if (!importIds.length || importIds.includes("__all__")) return undefined;
  return JSON.stringify(importIds);
}

export interface AssetQuery {
  offset: number;
  limit: number;
  importIds: string[];
  text: string;
  artist: string;
  character: string;
  action_group: string;
  action: string;
  facets: Record<string, string[]>;
  tags: string[];
  posted: boolean | null;
  favoriteMode: "all" | "favorited" | "unfavorited";
  sortBy: SortBy;
}

export const api = {
  imports: () => http.get<ImportSource[]>("/api/imports"),
  libraryTags: () => http.get<TagCount[]>("/api/library/tags"),
  favorites: () => http.get<{ favorites: string[] }>("/api/favorites"),
  toggleFavorite: (assetId: string, favorited: boolean) =>
    http.post<{ asset_id: string; favorited: boolean }>("/api/favorites/toggle", { asset_id: assetId, favorited }),

  searchAssets: (q: AssetQuery) =>
    http.get<AssetPage>("/api/library/assets", {
      offset: q.offset,
      limit: q.limit,
      import_ids: importIdsParam(q.importIds),
      text: q.text,
      artist: q.artist,
      character: q.character,
      action_group: q.action_group,
      action: q.action,
      facets: Object.keys(q.facets).length ? JSON.stringify(q.facets) : undefined,
      tags: q.tags.length ? JSON.stringify(q.tags) : undefined,
      posted: q.posted === null ? undefined : q.posted,
      favorite_mode: q.favoriteMode === "all" ? undefined : q.favoriteMode,
      sort_by: q.sortBy,
    }),
  facets: (importIds: string[]) => http.get<FacetMap>("/api/library/facets", { import_ids: importIdsParam(importIds) }),
  nodes: (role: NodeRole, q: string, importIds: string[]) =>
    http.get<NodeList>("/api/nodes", { role, q, limit: 30, import_ids: importIdsParam(importIds) }),
  batchAction: (assetIds: string[], action: string, tags?: string[]) =>
    http.post<{ success: boolean; count: number }>("/api/library/batch-action", { asset_ids: assetIds, action, tags }),

  assetDetails: (assetId: string) => http.get<AssetDetails>(`/api/assets/${enc(assetId)}/details`, { v: Date.now() }),
  assetSnapshots: (assetId: string) =>
    http.get<{ snapshots: AssetDetails["snapshots"] }>(`/api/assets/${enc(assetId)}/snapshots`, { v: Date.now() }),
  assetRelated: (assetId: string) => http.get<RelatedResult>(`/api/assets/${enc(assetId)}/related`, { v: Date.now() }),
  revealAsset: (assetId: string) => http.post<unknown>(`/api/assets/${enc(assetId)}/reveal`),
  togglePosted: (assetId: string, posted: boolean) =>
    http.post<unknown>(`/api/assets/${enc(assetId)}/toggle-posted`, { posted }),

  inpaintGenerate: (
    assetId: string,
    body: { mask_base64: string; prompt: string; negative_prompt: string; strength: number; count: number },
  ) => http.post<InpaintGenerateResult>(`/api/assets/${enc(assetId)}/inpaint`, body),
  inpaintApply: (assetId: string, sessionId: string, candidateId: string) =>
    http.post<InpaintApplyResult>(`/api/assets/${enc(assetId)}/inpaint/apply`, {
      session_id: sessionId,
      candidate_id: candidateId,
    }),
  inpaintDiscard: (sessionId: string) => http.delete<unknown>(`/api/inpaint-cache/${enc(sessionId)}`),

  submissions: () => http.get<SubmissionSummary[]>("/api/submissions"),
  submission: (taskId: string) => http.get<SubmissionDetail>(`/api/submissions/${enc(taskId)}`),
  createSubmission: (body: SubmissionMutation) => http.post<SubmissionDetail>("/api/submissions", body),
  updateSubmission: (taskId: string, body: SubmissionMutation) =>
    http.put<SubmissionDetail>(`/api/submissions/${enc(taskId)}`, body),
  deleteSubmission: (taskId: string) =>
    http.delete<{ unmarked_asset_ids?: string[] }>(`/api/submissions/${enc(taskId)}`),
  generateMetadata: (assetIds: string[], importId: string | null) =>
    http.post<GeneratedMetadata>("/api/submissions/generate-metadata", { asset_ids: assetIds, import_id: importId }),
  suggestPixivTags: (assetId: string, importId: string | null) =>
    http.post<{ tags: string[] }>("/api/submissions/suggest-pixiv-tags", { asset_id: assetId, import_id: importId }),
  syncPixivPastTags: () => http.post<{ tags: string[]; count: number }>("/api/submissions/sync-pixiv-past-tags"),
  publishPixiv: (taskId: string, forceRepublish: boolean) =>
    http.post<PublishResult>(`/api/submissions/${enc(taskId)}/publish/pixiv`, {
      force_rebuild: false,
      force_republish: forceRepublish,
    }),
  schedulePublish: (
    taskId: string,
    body: { enable: boolean; scheduled_at: string | null; allow_delay: boolean; max_delay_minutes: number },
  ) => http.post<SchedulePublishResult>(`/api/submissions/${enc(taskId)}/schedule-publish`, body),

  startExport: (taskId: string, enableMosaic: boolean, pixelSize: number) =>
    http.post<ExportJob>(`/api/submissions/${enc(taskId)}/exports`, {
      enable_mosaic: enableMosaic,
      mosaic_pixel_size: pixelSize,
    }),
  exportJob: (jobId: string) => http.get<ExportJob>(`/api/export-jobs/${enc(jobId)}`),
  latestBuild: (taskId: string) => http.get<LatestBuild>(`/api/submissions/${enc(taskId)}/latest-build`),
  openLatestBuild: (taskId: string) => http.post<unknown>(`/api/submissions/${enc(taskId)}/open-latest-build`),
  buildImageDetails: (taskId: string, selection: SetName, filename: string) =>
    http.get<BuildImageDetails>(
      `/api/submissions/${enc(taskId)}/build-images/${enc(selection)}/${enc(filename)}/details`,
    ),
  revealBuildImage: (taskId: string, selection: SetName, filename: string) =>
    http.post<unknown>(`/api/submissions/${enc(taskId)}/build-images/${enc(selection)}/${enc(filename)}/reveal`),
  saveBuildImage: (taskId: string, selection: SetName, filename: string, png: Blob) =>
    http.putRaw<unknown>(
      `/api/submissions/${enc(taskId)}/build-images/${enc(selection)}/${enc(filename)}`,
      png,
      "image/png",
    ),

  plan: (month: string) => http.get<MonthlyPlan>(`/api/plans/${enc(month)}`),
  createEntry: (month: string, revision: number, entry: ScheduleEntry) =>
    http.post<MonthlyPlan>(`/api/plans/${enc(month)}/entries`, { revision, entry }),
  updateEntry: (month: string, revision: number, entry: ScheduleEntry) =>
    http.put<MonthlyPlan>(`/api/plans/${enc(month)}/entries/${enc(entry.entry_id)}`, { revision, entry }),
  moveEntry: (month: string, entryId: string, revision: number, targetDate: string) =>
    http.patch<MonthlyPlan>(`/api/plans/${enc(month)}/entries/${enc(entryId)}/date`, {
      revision,
      target_date: targetDate,
    }),
  deleteEntry: (month: string, entryId: string, revision: number) =>
    http.delete<MonthlyPlan>(`/api/plans/${enc(month)}/entries/${enc(entryId)}`, { revision }),
};
