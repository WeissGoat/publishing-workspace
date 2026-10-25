import { defineStore } from "pinia";
import { computed, markRaw, reactive, ref, shallowRef } from "vue";
import {
  api,
  type AssetItem,
  type FacetMap,
  type FavoriteMode,
  type ImportSource,
  type NodeRole,
  type PostedMode,
  type SortBy,
  type TagCount,
} from "@/api";
import { errorText, notify } from "@/composables/notify";
import { readStorage, writeStorage } from "@/utils/storage";

export const ALL_IMPORTS = "__all__";
const PAGE_SIZE = 60;
const SNAPSHOT_FILTERS_PREFIX = "pw_snapshot_filters_";
const LAST_IMPORTS_KEY = "pw_last_selected_imports";
const LAST_IMPORT_KEY = "pw_last_selected_import";
const SORT_KEY = "library_sort_by";

export interface Filters {
  text: string;
  artist: string;
  character: string;
  action_group: string;
  action: string;
  facets: Record<string, string[]>;
  tags: string[];
  favoriteMode: FavoriteMode;
  postedMode: PostedMode;
  sortBy: SortBy;
}

function defaultFilters(): Filters {
  return {
    text: "",
    artist: "",
    character: "",
    action_group: "",
    action: "",
    facets: {},
    tags: [],
    favoriteMode: "all",
    postedMode: "all",
    sortBy: readStorage<SortBy>(SORT_KEY, "order_asc", true),
  };
}

/** 快照组合的记忆键：与旧前端一致（排序后逗号拼接；全部快照为 __all__）。 */
export function importKey(ids: string[]): string {
  if (!ids.length) return "";
  if (ids.includes(ALL_IMPORTS)) return ALL_IMPORTS;
  return [...ids].sort().join(",");
}

function loadSnapshotFilters(key: string): Filters {
  const base = defaultFilters();
  if (!key) return base;
  const saved = readStorage<Partial<Filters> & { favorite_mode?: FavoriteMode; posted_mode?: PostedMode; sort_by?: SortBy } | null>(
    SNAPSHOT_FILTERS_PREFIX + key,
    null,
  );
  if (!saved) return base;
  return {
    ...base,
    text: saved.text ?? "",
    artist: saved.artist ?? "",
    character: saved.character ?? "",
    action_group: saved.action_group ?? "",
    action: saved.action ?? "",
    facets: saved.facets ?? {},
    tags: Array.isArray(saved.tags) ? saved.tags : [],
    favoriteMode: saved.favoriteMode ?? saved.favorite_mode ?? "all",
    postedMode: saved.postedMode ?? saved.posted_mode ?? "all",
    sortBy: saved.sortBy ?? saved.sort_by ?? base.sortBy,
  };
}

function saveSnapshotFilters(key: string, f: Filters) {
  if (!key) return;
  // 字段名沿用旧前端，切换前后记忆的筛选条件互通
  writeStorage(SNAPSHOT_FILTERS_PREFIX + key, {
    text: f.text,
    artist: f.artist,
    character: f.character,
    action_group: f.action_group,
    action: f.action,
    facets: f.facets,
    tags: f.tags,
    favorite_mode: f.favoriteMode,
    posted_mode: f.postedMode,
    sort_by: f.sortBy,
  });
}

export function snapshotName(item: Pick<ImportSource, "source_ref" | "import_id">): string {
  return item.source_ref?.split(/[/\\]/).filter(Boolean).pop() || item.import_id;
}

export const useLibraryStore = defineStore("library", () => {
  const imports = ref<ImportSource[]>([]);
  const importIds = ref<string[]>([]);
  const filters = reactive<Filters>(defaultFilters());
  const availableFacets = ref<FacetMap>({});
  const availableTags = ref<TagCount[]>([]);

  // 素材列表可达上万条：shallowRef + markRaw，避免逐项深度代理
  const assets = shallowRef<AssetItem[]>([]);
  const assetIndex = new Map<string, number>();
  const total = ref(0);
  const hasMore = ref(false);
  const loading = ref(false);
  let requestToken = 0;
  let nextOffset = 0;
  let favoriteChain: Promise<unknown> = Promise.resolve();

  const favorites = reactive(new Set<string>());
  // 本地标记的已投稿状态覆盖（灯箱 / 批量操作后无需重新拉取整页）
  const postedOverride = reactive(new Map<string, boolean>());
  const hiddenIds = reactive(new Set<string>());

  const selected = reactive(new Set<string>());
  const focusedId = ref<string | null>(null);
  const lastSelectedId = ref<string | null>(null);
  const batchMode = ref(false);
  // 定位动画：设置后由图片墙滚动到对应卡片并高亮
  const spotlight = ref<{ id: string; tick: number } | null>(null);

  const hasSelection = computed(() => importIds.value.length > 0);
  const currentKey = computed(() => importKey(importIds.value));
  const isGlobal = computed(() => importIds.value.includes(ALL_IMPORTS));
  const visibleAssets = computed(() =>
    hiddenIds.size ? assets.value.filter((a) => !hiddenIds.has(a.asset_id)) : assets.value,
  );
  const selectedList = computed(() => [...selected]);

  function getAsset(id: string): AssetItem | undefined {
    const idx = assetIndex.get(id);
    return idx === undefined ? undefined : assets.value[idx];
  }

  function isPosted(item: AssetItem): boolean {
    const override = postedOverride.get(item.asset_id);
    if (override !== undefined) return override;
    return item.usage.some((u) => u !== "favorite");
  }

  async function loadImports() {
    try {
      imports.value = await api.imports();
    } catch (err) {
      notify.error(`加载快照列表失败：${errorText(err)}`);
    }
  }

  async function loadTags() {
    try {
      availableTags.value = await api.libraryTags();
    } catch {
      availableTags.value = [];
    }
  }

  async function loadFavorites() {
    try {
      const data = await api.favorites();
      favorites.clear();
      for (const id of data.favorites) favorites.add(id);
    } catch {
      // 收藏同步失败不影响浏览
    }
  }

  async function loadFacets() {
    if (!hasSelection.value) {
      availableFacets.value = {};
      return;
    }
    try {
      availableFacets.value = await api.facets(importIds.value);
    } catch {
      availableFacets.value = {};
    }
  }

  function resetResults() {
    requestToken += 1;
    assets.value = [];
    assetIndex.clear();
    hiddenIds.clear();
    total.value = 0;
    hasMore.value = hasSelection.value;
    nextOffset = 0;
    loading.value = false;
  }

  async function loadPage(reset = false): Promise<void> {
    if (!hasSelection.value) return;
    if (reset) resetResults();
    if (loading.value || !hasMore.value) return;
    loading.value = true;
    const token = requestToken;
    try {
      if (filters.favoriteMode !== "all") await favoriteChain;
      const page = await api.searchAssets({
        offset: nextOffset,
        limit: PAGE_SIZE,
        importIds: importIds.value,
        text: filters.text,
        artist: filters.artist,
        character: filters.character,
        action_group: filters.action_group,
        action: filters.action,
        facets: filters.facets,
        tags: filters.tags,
        posted: filters.postedMode === "all" ? null : filters.postedMode === "posted",
        favoriteMode: filters.favoriteMode,
        sortBy: filters.sortBy,
      });
      if (token !== requestToken) return;
      // 每次生成新数组：下游 computed 依赖数组引用变化来更新（原地 push 不会触发）
      const list = assets.value.slice();
      for (const item of page.items) {
        if (assetIndex.has(item.asset_id)) continue;
        assetIndex.set(item.asset_id, list.length);
        list.push(markRaw(item));
      }
      assets.value = list;
      total.value = page.total;
      hasMore.value = page.has_more;
      nextOffset = page.next_offset ?? nextOffset + page.items.length;
    } catch (err) {
      if (token === requestToken) notify.error(`加载素材失败：${errorText(err)}`);
      hasMore.value = false;
    } finally {
      if (token === requestToken) loading.value = false;
    }
  }

  function persistFilters() {
    saveSnapshotFilters(currentKey.value, filters);
  }

  /** 筛选条件变化：保存到当前快照组合并从第一页重新加载。 */
  function applyFilters() {
    persistFilters();
    void loadPage(true);
  }

  async function switchSnapshot(ids: string[]) {
    const clean = ids.filter(Boolean);
    const nextIds = clean.includes(ALL_IMPORTS) ? [ALL_IMPORTS] : clean;
    const oldKey = currentKey.value;
    const newKey = importKey(nextIds);
    if (oldKey && oldKey !== newKey) persistFilters();

    if (newKey) {
      writeStorage(LAST_IMPORTS_KEY, nextIds);
      localStorage.setItem(LAST_IMPORT_KEY, nextIds[0] ?? "");
    } else {
      localStorage.removeItem(LAST_IMPORTS_KEY);
      localStorage.removeItem(LAST_IMPORT_KEY);
    }

    importIds.value = nextIds;
    Object.assign(filters, loadSnapshotFilters(newKey));
    selected.clear();
    focusedId.value = null;
    void loadFavorites();
    if (!nextIds.length) {
      resetResults();
      hasMore.value = false;
      availableFacets.value = {};
      return;
    }
    void loadFacets();
    await loadPage(true);
  }

  async function init() {
    await Promise.all([loadImports(), loadTags()]);
    let restored = readStorage<string[] | null>(LAST_IMPORTS_KEY, null);
    if (!Array.isArray(restored) || !restored.length) {
      const single = localStorage.getItem(LAST_IMPORT_KEY);
      restored = single ? [single] : [];
    }
    await switchSnapshot(restored);
  }

  async function refreshAll() {
    await Promise.all([loadImports(), loadTags()]);
    await switchSnapshot([...importIds.value]);
  }

  function resetFilters() {
    const sortBy = filters.sortBy;
    Object.assign(filters, defaultFilters(), { sortBy });
    applyFilters();
  }

  function setNodeFilter(role: NodeRole, value: string) {
    if (filters[role] === value) return;
    filters[role] = value;
    applyFilters();
  }

  function toggleFacet(field: string, value: string) {
    const current = filters.facets[field] ?? [];
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    const facets = { ...filters.facets };
    if (next.length) facets[field] = next;
    else delete facets[field];
    filters.facets = facets;
    applyFilters();
  }

  function toggleTag(tag: string) {
    filters.tags = filters.tags.includes(tag) ? filters.tags.filter((t) => t !== tag) : [...filters.tags, tag];
    applyFilters();
  }

  function setSort(sortBy: SortBy) {
    filters.sortBy = sortBy;
    writeStorage(SORT_KEY, sortBy, true);
    applyFilters();
  }

  // ---- 收藏 ----

  function setFavorite(id: string, favorited: boolean) {
    if (favorited) favorites.add(id);
    else favorites.delete(id);
    // 收藏写入串行化；收藏筛选分页前会等待写入落库（服务端以 Catalog 收藏标记为准）
    favoriteChain = favoriteChain
      .then(() => api.toggleFavorite(id, favorited))
      .catch((err) => notify.error(`更新收藏失败：${errorText(err)}`));
    if (filters.favoriteMode !== "all") {
      const keep = filters.favoriteMode === "favorited" ? favorited : !favorited;
      if (keep) hiddenIds.delete(id);
      else hiddenIds.add(id);
    }
  }

  function toggleFavorite(id: string): boolean {
    const next = !favorites.has(id);
    setFavorite(id, next);
    return next;
  }

  // ---- 选择与聚焦 ----

  function setSelected(id: string, on: boolean) {
    if (on) {
      selected.add(id);
      lastSelectedId.value = id;
    } else {
      selected.delete(id);
    }
  }

  function selectRange(targetId: string) {
    const list = visibleAssets.value;
    const from = lastSelectedId.value ? list.findIndex((a) => a.asset_id === lastSelectedId.value) : -1;
    const to = list.findIndex((a) => a.asset_id === targetId);
    if (from === -1 || to === -1) {
      setSelected(targetId, true);
      return;
    }
    const [start, end] = from < to ? [from, to] : [to, from];
    for (let i = start; i <= end; i++) selected.add(list[i].asset_id);
    lastSelectedId.value = targetId;
  }

  function selectAllLoaded() {
    for (const item of visibleAssets.value) selected.add(item.asset_id);
  }

  function clearSelection() {
    selected.clear();
    lastSelectedId.value = null;
  }

  function focus(id: string | null) {
    focusedId.value = id;
  }

  async function batchAction(action: "favorite" | "unfavorite" | "mark_posted" | "unmark_posted" | "add_tags", tags?: string[]) {
    const ids = selectedList.value;
    if (!ids.length) {
      notify.info("请先选择图片");
      return;
    }
    try {
      await api.batchAction(ids, action, tags);
    } catch (err) {
      notify.error(`批量操作失败：${errorText(err)}`);
      return;
    }
    if (action === "favorite" || action === "unfavorite") {
      const on = action === "favorite";
      for (const id of ids) {
        if (on) favorites.add(id);
        else favorites.delete(id);
      }
      notify.success(on ? `已收藏 ${ids.length} 张图片` : `已取消收藏 ${ids.length} 张图片`);
    } else if (action === "mark_posted" || action === "unmark_posted") {
      const on = action === "mark_posted";
      for (const id of ids) postedOverride.set(id, on);
      notify.success(on ? `已将 ${ids.length} 张图片标记为已投稿` : `已取消 ${ids.length} 张图片的已投稿标记`);
    } else {
      const list = assets.value.slice();
      for (const id of ids) {
        const idx = assetIndex.get(id);
        if (idx === undefined) continue;
        const item = list[idx];
        list[idx] = markRaw({ ...item, tags: [...new Set([...item.tags, ...(tags ?? [])])] });
      }
      assets.value = list;
      notify.success(`已为 ${ids.length} 张图片追加标签`);
      void loadTags();
    }
  }

  async function copySelectedPaths() {
    const paths = selectedList.value.map((id) => getAsset(id)?.path).filter((p): p is string => Boolean(p));
    if (!paths.length) {
      notify.warning("未获取到选中图片的文件路径");
      return;
    }
    try {
      await navigator.clipboard.writeText(paths.join("\n"));
      notify.success(`已复制 ${paths.length} 个文件路径`);
    } catch {
      notify.error("复制到剪贴板失败");
    }
  }

  /** 局部重绘覆盖原图后，素材 ID 随内容变化：同步列表、选择与收藏。 */
  function renameAsset(oldId: string, newId: string, patch: Partial<AssetItem> = {}) {
    const idx = assetIndex.get(oldId);
    if (idx !== undefined) {
      const list = assets.value.slice();
      list[idx] = markRaw({ ...list[idx], ...patch, asset_id: newId });
      assets.value = list;
      assetIndex.delete(oldId);
      assetIndex.set(newId, idx);
    }
    if (selected.has(oldId)) {
      selected.delete(oldId);
      selected.add(newId);
    }
    if (favorites.has(oldId)) {
      favorites.delete(oldId);
      favorites.add(newId);
    }
    if (focusedId.value === oldId) focusedId.value = newId;
  }

  /** 跳转到快照并定位素材：必要时切换快照、重置会隐藏目标的筛选并逐页加载。 */
  async function locate(targetImportId: string, assetId: string): Promise<boolean> {
    const alreadySelected = importIds.value.length === 1 && importIds.value[0] === targetImportId;
    if (!alreadySelected) await switchSnapshot([targetImportId]);
    let changed = false;
    if (filters.text) {
      filters.text = "";
      changed = true;
    }
    if (filters.sortBy !== "order_asc") {
      filters.sortBy = "order_asc";
      changed = true;
    }
    if (filters.postedMode !== "all") {
      filters.postedMode = "all";
      changed = true;
    }
    if (filters.favoriteMode !== "all") {
      filters.favoriteMode = "all";
      changed = true;
    }
    if (changed) {
      persistFilters();
      await loadPage(true);
    }
    let tries = 40;
    while (!assetIndex.has(assetId) && hasMore.value && tries-- > 0) {
      await loadPage(false);
    }
    if (!assetIndex.has(assetId)) return false;
    focusedId.value = assetId;
    spotlight.value = { id: assetId, tick: Date.now() };
    return true;
  }

  return {
    imports,
    importIds,
    filters,
    availableFacets,
    availableTags,
    assets,
    visibleAssets,
    total,
    hasMore,
    loading,
    favorites,
    hiddenIds,
    selected,
    selectedList,
    focusedId,
    lastSelectedId,
    batchMode,
    spotlight,
    hasSelection,
    currentKey,
    isGlobal,
    getAsset,
    isPosted,
    postedOverride,
    init,
    refreshAll,
    loadImports,
    loadTags,
    loadFacets,
    loadPage,
    applyFilters,
    switchSnapshot,
    resetFilters,
    setNodeFilter,
    toggleFacet,
    toggleTag,
    setSort,
    setFavorite,
    toggleFavorite,
    favoriteSettled: () => favoriteChain,
    setSelected,
    selectRange,
    selectAllLoaded,
    clearSelection,
    focus,
    batchAction,
    copySelectedPaths,
    renameAsset,
    locate,
  };
});
