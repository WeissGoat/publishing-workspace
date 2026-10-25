<script setup lang="ts">
import { FolderOpen, SearchX } from "@lucide/vue";
import { useVirtualizer } from "@tanstack/vue-virtual";
import { useResizeObserver } from "@vueuse/core";
import { NSpin } from "naive-ui";
import { computed, nextTick, ref, watch } from "vue";
import type { AssetItem } from "@/api";
import { useLibraryStore } from "@/stores/library";
import AssetCard from "./AssetCard.vue";

const props = defineProps<{ cardSize: number }>();
const emit = defineEmits<{ open: [assetId: string] }>();

const lib = useLibraryStore();
const scroller = ref<HTMLElement | null>(null);
const width = ref(0);
const GAP = 12;
const PADDING = 16;
// 卡片底部信息栏（文件名）高度，有标签时再加一行
const INFO_HEIGHT = 34;
const TAG_ROW_HEIGHT = 22;

useResizeObserver(scroller, (entries) => {
  width.value = Math.max(0, entries[0].contentRect.width - PADDING * 2);
});

const cols = computed(() => Math.max(1, Math.floor((width.value + GAP) / (props.cardSize + GAP))));
const colWidth = computed(() => (width.value - GAP * (cols.value - 1)) / cols.value);
const items = computed(() => lib.visibleAssets);
const rowCount = computed(() => Math.ceil(items.value.length / cols.value));

function rowItems(row: number): AssetItem[] {
  return items.value.slice(row * cols.value, (row + 1) * cols.value);
}

function estimateRow(row: number): number {
  let max = 0;
  for (const item of rowItems(row)) {
    const ratio = item.width && item.height ? item.height / item.width : 1;
    const h = colWidth.value * ratio + INFO_HEIGHT + (item.tags.length ? TAG_ROW_HEIGHT : 0);
    if (h > max) max = h;
  }
  return Math.ceil(max) + GAP;
}

const virtualizer = useVirtualizer(
  computed(() => ({
    count: rowCount.value,
    getScrollElement: () => scroller.value,
    estimateSize: estimateRow,
    overscan: 3,
    paddingStart: PADDING,
    paddingEnd: PADDING,
  })),
);

const virtualRows = computed(() => virtualizer.value.getVirtualItems());
const totalSize = computed(() => virtualizer.value.getTotalSize());

// 列数或列宽变化时行高全部失效，重新测量
watch([cols, colWidth], () => virtualizer.value.measure());

function measureRow(el: unknown) {
  if (el instanceof Element) virtualizer.value.measureElement(el);
}

// 接近底部时加载下一页；加载完成后若仍在底部附近会继续触发
watch(
  () => [virtualRows.value.at(-1)?.index ?? -1, rowCount.value, lib.loading, lib.hasMore] as const,
  ([lastIndex, count, loading, hasMore]) => {
    if (!loading && hasMore && lib.hasSelection && lastIndex >= count - 4) void lib.loadPage(false);
  },
);

const indexById = computed(() => {
  const map = new Map<string, number>();
  items.value.forEach((item, i) => map.set(item.asset_id, i));
  return map;
});

function scrollToAsset(id: string, align: "auto" | "center" = "auto") {
  const index = indexById.value.get(id);
  if (index === undefined) return;
  virtualizer.value.scrollToIndex(Math.floor(index / cols.value), { align });
}

const spotlightId = ref<string | null>(null);
let spotlightTimer: ReturnType<typeof setTimeout> | undefined;
watch(
  () => lib.spotlight,
  async (spot) => {
    if (!spot) return;
    await nextTick();
    scrollToAsset(spot.id, "center");
    spotlightId.value = spot.id;
    clearTimeout(spotlightTimer);
    spotlightTimer = setTimeout(() => (spotlightId.value = null), 1500);
  },
);

// 快照或筛选切换后回到顶部
watch(
  () => lib.assets.length === 0,
  (empty) => {
    if (empty && scroller.value) scroller.value.scrollTop = 0;
  },
);

const selectedOrder = computed(() => {
  const map = new Map<string, number>();
  let i = 0;
  for (const id of lib.selected) map.set(id, ++i);
  return map;
});

function onActivate(item: AssetItem, event: MouseEvent) {
  const id = item.asset_id;
  if (event.ctrlKey || event.metaKey) {
    lib.setSelected(id, !lib.selected.has(id));
    lib.focus(id);
    return;
  }
  if (event.shiftKey) {
    lib.selectRange(id);
    lib.focus(id);
    return;
  }
  if (lib.batchMode) {
    lib.setSelected(id, !lib.selected.has(id));
    lib.focus(id);
    return;
  }
  lib.focus(id);
  if ((event.target as HTMLElement).closest(".thumb")) emit("open", id);
}

function onSelect(item: AssetItem, event: MouseEvent) {
  if (event.shiftKey) lib.selectRange(item.asset_id);
  else lib.setSelected(item.asset_id, !lib.selected.has(item.asset_id));
}

/** 键盘导航：左右 ±1，上下 ±列数。 */
function moveFocus(key: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown") {
  const list = items.value;
  if (!list.length) return;
  const current = lib.focusedId ? indexById.value.get(lib.focusedId) : undefined;
  let next = 0;
  if (current !== undefined) {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols.value, ArrowDown: cols.value }[key];
    next = Math.min(list.length - 1, Math.max(0, current + step));
  }
  const id = list[next].asset_id;
  lib.focus(id);
  scrollToAsset(id);
}

defineExpose({ moveFocus, scrollToAsset });
</script>

<template>
  <div ref="scroller" class="scroller" :class="{ 'batch-mode': lib.batchMode }">
    <div v-if="!lib.hasSelection" class="empty">
      <FolderOpen :size="40" :stroke-width="1.4" />
      <h3>选择一个导入快照开始浏览</h3>
      <p>在左侧「筛选」中选择快照，可多选或全量浏览</p>
    </div>
    <div v-else-if="!items.length && !lib.loading && !lib.hasMore" class="empty">
      <SearchX :size="40" :stroke-width="1.4" />
      <h3>没有匹配的素材</h3>
      <p>调整关键词、节点或属性筛选条件后再试</p>
    </div>
    <div v-else class="canvas" :style="{ height: `${totalSize}px` }">
      <div
        v-for="row in virtualRows"
        :key="row.key as number"
        :ref="measureRow"
        :data-index="row.index"
        class="row"
        :style="{
          transform: `translateY(${row.start}px)`,
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        }"
      >
        <AssetCard
          v-for="item in rowItems(row.index)"
          :key="item.asset_id"
          :item="item"
          :width="colWidth"
          :order="selectedOrder.get(item.asset_id) ?? 0"
          :focused="lib.focusedId === item.asset_id"
          :favorite="lib.favorites.has(item.asset_id)"
          :posted="lib.isPosted(item)"
          :spotlight="spotlightId === item.asset_id"
          @activate="onActivate(item, $event)"
          @select="onSelect(item, $event)"
          @open="emit('open', item.asset_id)"
          @favorite="lib.toggleFavorite(item.asset_id)"
        />
      </div>
    </div>
    <div v-if="lib.hasSelection && (lib.loading || (!lib.hasMore && items.length))" class="footer">
      <NSpin v-if="lib.loading" :size="16" />
      <span v-else class="faint">已加载全部 {{ lib.total.toLocaleString() }} 张</span>
    </div>
  </div>
</template>

<style scoped>
.scroller {
  position: relative;
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  outline: none;
}

.canvas {
  position: relative;
  width: 100%;
}

.row {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: grid;
  align-items: start;
  gap: 12px;
  padding: 0 16px 12px;
}

.footer {
  display: flex;
  justify-content: center;
  padding: 12px 0 28px;
  font-size: 12px;
}

.empty {
  height: 100%;
  min-height: 360px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--text-faint);
  text-align: center;
}

.empty h3 {
  margin: 8px 0 0;
  color: var(--text);
  font-size: 15px;
  font-weight: 600;
}

.empty p {
  margin: 0;
  color: var(--text-muted);
}
</style>
