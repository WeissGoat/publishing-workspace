import { defineStore } from "pinia";
import { computed, ref, shallowRef } from "vue";
import {
  api,
  type AssetDetails,
  type AssetSnapshotRef,
  type BuildImage,
  type BuildImageDetails,
  type RelatedResult,
  type SetName,
} from "@/api";

export type LightboxMode = "view" | "inpaint" | "mosaic";

interface HistoryEntry {
  assetId: string;
  list: string[];
  index: number;
  name: string;
}

interface BuildContext {
  taskId: string;
  selection: SetName;
  images: BuildImage[];
  outputDir: string;
}

export const useLightboxStore = defineStore("lightbox", () => {
  const isOpen = ref(false);
  const mode = ref<LightboxMode>("view");
  const list = ref<string[]>([]);
  const index = ref(0);
  const history = ref<HistoryEntry[]>([]);
  const build = shallowRef<BuildContext | null>(null);
  // 图片加载时间戳：局部重绘、手动打码保存后刷新大图
  const bust = ref(Date.now());

  const details = shallowRef<AssetDetails | null>(null);
  const snapshots = shallowRef<AssetSnapshotRef[] | null>(null);
  const related = shallowRef<RelatedResult | null>(null);
  const buildDetails = shallowRef<BuildImageDetails | null>(null);
  const loadError = ref<string | null>(null);

  const isBuild = computed(() => build.value !== null);
  const activeId = computed(() => (isBuild.value ? null : (list.value[index.value] ?? null)));
  const buildImage = computed(() => (build.value ? (build.value.images[index.value] ?? null) : null));
  const count = computed(() => (build.value ? build.value.images.length : list.value.length));

  async function loadAsset(assetId: string) {
    details.value = null;
    snapshots.value = null;
    related.value = null;
    loadError.value = null;
    api
      .assetDetails(assetId)
      .then((d) => {
        if (activeId.value === assetId) details.value = d;
      })
      .catch((err) => {
        if (activeId.value === assetId) loadError.value = String(err?.message ?? err);
      });
    api
      .assetSnapshots(assetId)
      .then((d) => {
        if (activeId.value === assetId) snapshots.value = d.snapshots ?? [];
      })
      .catch(() => {
        if (activeId.value === assetId) snapshots.value = [];
      });
    api
      .assetRelated(assetId)
      .then((d) => {
        if (activeId.value === assetId) related.value = d;
      })
      .catch(() => {
        if (activeId.value === assetId) related.value = null;
      });
  }

  async function loadBuildImage() {
    const ctx = build.value;
    const image = buildImage.value;
    buildDetails.value = null;
    if (!ctx || !image) return;
    try {
      const d = await api.buildImageDetails(ctx.taskId, ctx.selection, image.filename);
      if (buildImage.value?.filename === image.filename) buildDetails.value = d;
    } catch {
      buildDetails.value = null;
    }
  }

  function currentName(): string {
    return details.value?.display_name ?? list.value[index.value] ?? "";
  }

  /** 打开素材大图。pushHistory 用于从关联图片跳转，可通过「返回」回到上一张。 */
  function openAsset(assetId: string, assetList: string[], options: { pushHistory?: boolean } = {}) {
    if (options.pushHistory && isOpen.value && activeId.value && activeId.value !== assetId) {
      history.value.push({ assetId: activeId.value, list: [...list.value], index: index.value, name: currentName() });
    } else if (!options.pushHistory) {
      history.value = [];
    }
    build.value = null;
    const nextList = assetList.length ? [...assetList] : [assetId];
    let i = nextList.indexOf(assetId);
    if (i === -1) {
      nextList.splice(0, nextList.length, assetId);
      i = 0;
    }
    list.value = nextList;
    index.value = i;
    mode.value = "view";
    isOpen.value = true;
    void loadAsset(assetId);
  }

  function openBuild(images: BuildImage[], start: number, selection: SetName, taskId: string, outputDir = "") {
    history.value = [];
    list.value = [];
    build.value = { taskId, selection, images, outputDir };
    index.value = Math.max(0, Math.min(start, images.length - 1));
    mode.value = "view";
    isOpen.value = true;
    void loadBuildImage();
  }

  function step(delta: number) {
    const total = count.value;
    if (!total) return;
    if (build.value) {
      const next = index.value + delta;
      if (next < 0 || next >= total) return;
      index.value = next;
      void loadBuildImage();
      return;
    }
    index.value = (index.value + delta + total) % total;
    mode.value = "view";
    if (activeId.value) void loadAsset(activeId.value);
  }

  function back() {
    const prev = history.value.pop();
    if (!prev) return;
    list.value = prev.list;
    index.value = prev.index >= 0 ? prev.index : prev.list.indexOf(prev.assetId);
    mode.value = "view";
    void loadAsset(prev.assetId);
  }

  function close() {
    isOpen.value = false;
    history.value = [];
    mode.value = "view";
  }

  /** 局部重绘覆盖后素材 ID 变化：替换列表与历史中的旧 ID 并重新加载详情。 */
  function renameAsset(oldId: string, newId: string) {
    list.value = list.value.map((id) => (id === oldId ? newId : id));
    for (const entry of history.value) {
      entry.list = entry.list.map((id) => (id === oldId ? newId : id));
      if (entry.assetId === oldId) entry.assetId = newId;
    }
    bust.value = Date.now();
    if (activeId.value === newId) void loadAsset(newId);
  }

  function updateBuildImage(filename: string, sizeBytes: number) {
    const ctx = build.value;
    if (!ctx) return;
    const t = Date.now();
    const images = ctx.images.map((img) =>
      img.filename === filename ? { ...img, preview_url: `${img.preview_url.split("?")[0]}?t=${t}`, size_bytes: sizeBytes } : img,
    );
    build.value = { ...ctx, images };
  }

  return {
    isOpen,
    mode,
    list,
    index,
    history,
    build,
    bust,
    details,
    snapshots,
    related,
    buildDetails,
    loadError,
    isBuild,
    activeId,
    buildImage,
    count,
    openAsset,
    openBuild,
    step,
    back,
    close,
    renameAsset,
    updateBuildImage,
    reloadDetails: () => activeId.value && loadAsset(activeId.value),
  };
});
