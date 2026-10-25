<script setup lang="ts">
import { ChevronDown, FolderOpen, Globe, Search, X } from "@lucide/vue";
import { NButton, NCheckbox, NEmpty, NInput, NPopover, NTag } from "naive-ui";
import { computed, ref } from "vue";
import { ALL_IMPORTS, snapshotName, useLibraryStore } from "@/stores/library";
import { formatShortTime } from "@/utils/format";

const lib = useLibraryStore();
const open = ref(false);
const query = ref("");

const selectedSet = computed(() => new Set(lib.importIds));

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return lib.imports;
  return lib.imports.filter(
    (item) =>
      item.source_ref.toLowerCase().includes(q) ||
      item.import_id.toLowerCase().includes(q) ||
      item.tags.join(" ").toLowerCase().includes(q),
  );
});

const summary = computed(() => {
  const ids = lib.importIds;
  if (!ids.length) return { title: "选择导入快照", meta: "" };
  if (lib.isGlobal) return { title: "全部导入素材", meta: "全量浏览" };
  if (ids.length === 1) {
    const item = lib.imports.find((imp) => imp.import_id === ids[0]);
    return {
      title: item ? snapshotName(item) : ids[0],
      meta: item?.total_items ? `${item.total_items.toLocaleString()} 张` : "",
    };
  }
  const totalImages = ids.reduce((sum, id) => sum + (lib.imports.find((imp) => imp.import_id === id)?.total_items ?? 0), 0);
  return { title: `已选 ${ids.length} 个快照`, meta: totalImages ? `${totalImages.toLocaleString()} 张` : "" };
});

function toggle(id: string) {
  const current = new Set(lib.importIds.filter((x) => x !== ALL_IMPORTS));
  if (current.has(id)) current.delete(id);
  else current.add(id);
  void lib.switchSnapshot([...current]);
}

function only(id: string) {
  void lib.switchSnapshot([id]);
  open.value = false;
}

function selectGlobal() {
  void lib.switchSnapshot([ALL_IMPORTS]);
  open.value = false;
}
</script>

<template>
  <NPopover
    v-model:show="open"
    trigger="click"
    placement="bottom-start"
    :show-arrow="false"
    raw
    style="padding: 0"
  >
    <template #trigger>
      <button type="button" class="picker-trigger" :class="{ active: open }" aria-haspopup="listbox">
        <component :is="lib.isGlobal ? Globe : FolderOpen" :size="16" class="picker-icon" />
        <span class="picker-text">
          <span class="picker-title truncate" :class="{ placeholder: !lib.importIds.length }">{{ summary.title }}</span>
          <span v-if="summary.meta" class="picker-meta">{{ summary.meta }}</span>
        </span>
        <span
          v-if="lib.importIds.length"
          class="picker-clear"
          role="button"
          aria-label="清空快照选择"
          @click.stop="lib.switchSnapshot([])"
        >
          <X :size="14" />
        </span>
        <ChevronDown :size="16" class="picker-chevron" />
      </button>
    </template>

    <div class="picker-panel">
      <div class="picker-search">
        <NInput v-model:value="query" size="small" placeholder="搜索快照名称 / ID / 标签" clearable autofocus>
          <template #prefix><Search :size="14" /></template>
        </NInput>
      </div>
      <div class="picker-quick">
        <NButton size="tiny" secondary @click="lib.switchSnapshot(lib.imports.map((i) => i.import_id))">全选</NButton>
        <NButton size="tiny" secondary @click="lib.switchSnapshot([])">清空</NButton>
        <NButton size="tiny" type="primary" secondary @click="selectGlobal">
          <template #icon><Globe :size="13" /></template>
          全量浏览
        </NButton>
      </div>
      <div class="picker-list" role="listbox" aria-multiselectable="true">
        <NEmpty v-if="!filtered.length" size="small" description="未找到匹配的快照" class="picker-empty" />
        <div
          v-for="item in filtered"
          :key="item.import_id"
          class="picker-item"
          :class="{ selected: lib.isGlobal || selectedSet.has(item.import_id) }"
          role="option"
          :aria-selected="lib.isGlobal || selectedSet.has(item.import_id)"
          @click="toggle(item.import_id)"
        >
          <NCheckbox :checked="lib.isGlobal || selectedSet.has(item.import_id)" size="small" @click.stop="toggle(item.import_id)" />
          <div class="picker-item-body">
            <div class="picker-item-title truncate" :title="item.source_ref || item.import_id">{{ snapshotName(item) }}</div>
            <div class="picker-item-meta">
              <span>{{ item.total_items.toLocaleString() }} 张</span>
              <span v-if="item.import_count > 1">· 归并 {{ item.import_count }} 次</span>
              <span v-if="item.created_at">· {{ formatShortTime(item.created_at) }}</span>
            </div>
            <div v-if="item.tags.length" class="picker-item-tags">
              <NTag v-for="tag in item.tags" :key="tag" size="tiny" :bordered="false">{{ tag }}</NTag>
            </div>
          </div>
          <NButton size="tiny" quaternary class="picker-only" @click.stop="only(item.import_id)">仅此项</NButton>
        </div>
      </div>
    </div>
  </NPopover>
</template>

<style scoped>
.picker-trigger {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 6px 8px 6px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-2);
  color: var(--text);
  cursor: pointer;
  text-align: left;
  font: inherit;
  transition: border-color 0.15s;
}

.picker-trigger:hover,
.picker-trigger.active {
  border-color: var(--primary);
}

.picker-icon {
  flex: none;
  color: var(--primary);
}

.picker-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  line-height: 1.3;
}

.picker-title {
  font-weight: 600;
}

.picker-title.placeholder {
  color: var(--text-muted);
  font-weight: 500;
}

.picker-meta {
  font-size: 11px;
  color: var(--text-muted);
}

.picker-clear {
  display: inline-grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  color: var(--text-muted);
}

.picker-clear:hover {
  background: var(--surface-3);
  color: var(--text);
}

.picker-chevron {
  flex: none;
  color: var(--text-muted);
}

.picker-panel {
  width: 340px;
  max-width: calc(100vw - 32px);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: var(--shadow);
  overflow: hidden;
}

.picker-search {
  padding: 10px 10px 6px;
}

.picker-quick {
  display: flex;
  gap: 6px;
  padding: 0 10px 8px;
  border-bottom: 1px solid var(--border);
}

.picker-list {
  max-height: 360px;
  overflow-y: auto;
  padding: 4px;
}

.picker-empty {
  padding: 20px 0;
}

.picker-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px;
  border-radius: 6px;
  cursor: pointer;
}

.picker-item:hover {
  background: var(--surface-3);
}

.picker-item.selected {
  background: var(--primary-soft);
}

.picker-item-body {
  flex: 1;
  min-width: 0;
}

.picker-item-title {
  font-weight: 500;
}

.picker-item-meta {
  font-size: 11px;
  color: var(--text-muted);
  display: flex;
  gap: 4px;
}

.picker-item-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}

.picker-only {
  opacity: 0;
  transition: opacity 0.15s;
}

.picker-item:hover .picker-only {
  opacity: 1;
}
</style>
