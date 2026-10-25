<script setup lang="ts">
import { ChevronDown, Eye, LayoutGrid, List, LocateFixed, Search } from "@lucide/vue";
import { useLocalStorage } from "@vueuse/core";
import { NButton, NDropdown, NSkeleton } from "naive-ui";
import { computed, ref, watch } from "vue";
import { previewUrl, thumbUrl, type AssetSnapshotRef, type RelatedDimensionKey, type RelatedItem } from "@/api";
import { useLibraryStore } from "@/stores/library";
import { useLightboxStore } from "@/stores/lightbox";

const emit = defineEmits<{
  peek: [target: { id: string; name: string }];
  locate: [snapshot: AssetSnapshotRef, assetId: string];
}>();

const lb = useLightboxStore();
const lib = useLibraryStore();
const viewMode = useLocalStorage<"grid" | "list">("pw_related_view_mode", "grid");
const tab = ref<RelatedDimensionKey>("same_batch");

const TABS: { key: RelatedDimensionKey; label: string }[] = [
  { key: "same_batch", label: "同批生成" },
  { key: "same_seed", label: "同 Seed" },
  { key: "time_adjacent", label: "邻近生图" },
];

const dims = computed(() => lb.related?.dimensions);
const totalAll = computed(() => TABS.reduce((sum, t) => sum + (dims.value?.[t.key]?.total ?? 0), 0));
const current = computed(() => dims.value?.[tab.value]);
const items = computed<RelatedItem[]>(() => current.value?.items ?? []);

// 新图片加载后自动选择首个有数据的维度
watch(
  () => lb.related,
  (rel) => {
    if (!rel) return;
    tab.value = TABS.find((t) => (rel.dimensions[t.key]?.total ?? 0) > 0)?.key ?? "same_batch";
  },
);

function view(target: RelatedItem) {
  lb.openAsset(
    target.asset_id,
    items.value.map((i) => i.asset_id),
    { pushHistory: true },
  );
}

function isCurrent(s: AssetSnapshotRef) {
  return lib.importIds.includes(s.import_id);
}

function jumpOptions(target: RelatedItem) {
  return target.snapshots.map((s) => ({ key: s.import_id, label: `${s.name || s.import_id} #${s.source_order + 1}` }));
}

function onJump(target: RelatedItem, importId: string) {
  const s = target.snapshots.find((x) => x.import_id === importId);
  if (s) emit("locate", s, target.asset_id);
}

// 悬浮放大预览
const hover = ref<{ id: string; x: number; y: number } | null>(null);
const peeking = ref(false);

function onHover(e: MouseEvent, target: RelatedItem) {
  if (peeking.value) return;
  const size = 320;
  let x = e.clientX - size - 16;
  if (x < 16) x = e.clientX + 16;
  const y = Math.min(Math.max(16, e.clientY - size / 2), window.innerHeight - size - 16);
  hover.value = { id: target.asset_id, x, y };
}

function startPeek(target: RelatedItem) {
  hover.value = null;
  peeking.value = true;
  emit("peek", { id: target.asset_id, name: target.display_name });
  const stop = () => {
    peeking.value = false;
    window.removeEventListener("mouseup", stop);
    window.removeEventListener("touchend", stop);
  };
  window.addEventListener("mouseup", stop);
  window.addEventListener("touchend", stop);
}
</script>

<template>
  <section class="related">
    <div class="head">
      <h4 class="section-title">
        关联图片 <span v-if="lb.related" class="faint">{{ totalAll }}</span>
      </h4>
      <div class="view-toggle">
        <button type="button" :class="{ active: viewMode === 'grid' }" aria-label="网格" @click="viewMode = 'grid'">
          <LayoutGrid :size="14" />
        </button>
        <button type="button" :class="{ active: viewMode === 'list' }" aria-label="列表" @click="viewMode = 'list'">
          <List :size="14" />
        </button>
      </div>
    </div>

    <NSkeleton v-if="!lb.related" :height="120" :sharp="false" />
    <template v-else>
      <div class="tabs" role="tablist">
        <button
          v-for="t in TABS"
          :key="t.key"
          type="button"
          role="tab"
          class="tab"
          :class="{ active: tab === t.key }"
          :aria-selected="tab === t.key"
          @click="tab = t.key"
        >
          {{ t.label }} <span class="faint">{{ dims?.[t.key]?.total ?? 0 }}</span>
        </button>
      </div>

      <div v-if="!items.length" class="faint empty">暂无该维度的关联图片</div>
      <div v-else class="rel-list" :class="`mode-${viewMode}`">
        <div v-for="it in items" :key="it.asset_id" class="item">
          <div
            class="thumb"
            :title="`查看 ${it.display_name}`"
            @click="view(it)"
            @mousemove="onHover($event, it)"
            @mouseleave="hover = null"
          >
            <img :src="thumbUrl(it.asset_id, 200)" :alt="it.display_name" loading="lazy" />
            <button
              type="button"
              class="peek"
              title="按住在左侧大图临时对比"
              @mousedown.prevent.stop="startPeek(it)"
              @touchstart.prevent.stop="startPeek(it)"
              @click.stop
            >
              <Eye :size="13" /> 对比
            </button>
          </div>
          <div class="info">
            <div class="name truncate" :title="it.display_name" @click="view(it)">{{ it.display_name }}</div>
            <div class="meta faint">
              <span>{{ it.relation_label }}</span>
              <span v-if="it.width && it.height">{{ it.width }}×{{ it.height }}</span>
            </div>
            <div class="item-actions">
              <NButton size="tiny" secondary @click="view(it)">
                <template #icon><Search :size="12" /></template>查看
              </NButton>
              <NButton
                v-if="it.snapshots.length === 1"
                size="tiny"
                :type="isCurrent(it.snapshots[0]) ? 'primary' : 'default'"
                secondary
                @click="emit('locate', it.snapshots[0], it.asset_id)"
              >
                <template #icon><LocateFixed :size="12" /></template>
                {{ isCurrent(it.snapshots[0]) ? "定位" : "跳转" }}
              </NButton>
              <NDropdown
                v-else-if="it.snapshots.length > 1"
                trigger="click"
                :options="jumpOptions(it)"
                size="small"
                @select="(key: string) => onJump(it, key)"
              >
                <NButton size="tiny" secondary>
                  跳转 {{ it.snapshots.length }}
                  <ChevronDown :size="12" />
                </NButton>
              </NDropdown>
            </div>
          </div>
        </div>
      </div>
      <div v-if="tab === 'time_adjacent' && current && current.total > items.length" class="faint hint">
        共 {{ current.total }} 张，已展示时间最近的 {{ items.length }} 张
      </div>
    </template>

    <Teleport to="body">
      <div v-if="hover" class="hover-preview" :style="{ left: `${hover.x}px`, top: `${hover.y}px` }">
        <img :src="previewUrl(hover.id)" alt="" />
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.related {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.head .section-title {
  display: flex;
  gap: 6px;
}

.view-toggle {
  display: flex;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}

.view-toggle button {
  display: inline-grid;
  place-items: center;
  width: 26px;
  height: 22px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.view-toggle button.active {
  background: var(--surface-3);
  color: var(--text);
}

.tabs {
  display: flex;
  gap: 4px;
}

.tab {
  flex: 1;
  height: 28px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.tab.active {
  border-color: var(--primary);
  background: var(--primary-soft);
  color: var(--text);
}

.empty,
.hint {
  font-size: 12px;
}

.rel-list {
  max-height: 420px;
  overflow-y: auto;
  display: grid;
  gap: 8px;
}

.rel-list.mode-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.mode-grid .item {
  display: flex;
  flex-direction: column;
}

.mode-list .item {
  display: flex;
  gap: 8px;
}

.mode-list .thumb {
  width: 72px;
  height: 96px;
  flex: none;
}

.item {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-2);
  overflow: hidden;
}

.thumb {
  position: relative;
  height: 130px;
  background: var(--image-bg);
  cursor: zoom-in;
}

.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.peek {
  position: absolute;
  right: 4px;
  bottom: 4px;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 6px;
  border: none;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 11px;
  cursor: pointer;
  user-select: none;
}

.info {
  min-width: 0;
  padding: 6px 8px 8px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.name {
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}

.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 11px;
}

.item-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 2px;
}

.hover-preview {
  position: fixed;
  z-index: 200;
  width: 320px;
  height: 320px;
  padding: 4px;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  background: var(--surface-2);
  box-shadow: var(--shadow);
  pointer-events: none;
}

.hover-preview img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
</style>
