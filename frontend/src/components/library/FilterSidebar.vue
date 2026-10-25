<script setup lang="ts">
import { PanelLeftClose, Search, Tag } from "@lucide/vue";
import { useDebounceFn } from "@vueuse/core";
import { NButton, NCollapse, NCollapseItem, NInput, NRadioButton, NRadioGroup, NTag } from "naive-ui";
import { computed, ref, watch } from "vue";
import { useLibraryStore } from "@/stores/library";
import { readStorage, writeStorage } from "@/utils/storage";
import { FACETS, NODE_FIELDS } from "./constants";
import NodePicker from "./NodePicker.vue";
import SnapshotPicker from "./SnapshotPicker.vue";

defineEmits<{ collapse: [] }>();

const lib = useLibraryStore();
const text = ref(lib.filters.text);

watch(
  () => lib.filters.text,
  (next) => {
    if (next !== text.value) text.value = next;
  },
);

const debouncedText = useDebounceFn(() => applyText(), 250);

function applyText() {
  const next = text.value.trim();
  if (lib.filters.text === next) return;
  lib.filters.text = next;
  lib.applyFilters();
}

function setFavoriteMode(mode: typeof lib.filters.favoriteMode) {
  lib.filters.favoriteMode = mode;
  lib.applyFilters();
}

function setPostedMode(mode: typeof lib.filters.postedMode) {
  lib.filters.postedMode = mode;
  lib.applyFilters();
}

const facetGroups = computed(() =>
  FACETS.map((f) => ({ ...f, values: lib.availableFacets[f.key] ?? [] })).filter((f) => f.values.length),
);
const hasFacetSelection = computed(() => Object.keys(lib.filters.facets).length > 0);

const expanded = ref<string[]>(readStorage<string[]>("pw_expanded_facets", ["clothing"]));
watch(expanded, (v) => writeStorage("pw_expanded_facets", v));

function clearFacets() {
  lib.filters.facets = {};
  lib.applyFilters();
}

function clearTags() {
  lib.filters.tags = [];
  lib.applyFilters();
}
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar-head">
      <span class="section-title">筛选</span>
      <div class="head-actions">
        <NButton size="tiny" quaternary @click="lib.resetFilters()">重置</NButton>
        <NButton size="tiny" quaternary circle aria-label="收起筛选栏" @click="$emit('collapse')">
          <template #icon><PanelLeftClose :size="15" /></template>
        </NButton>
      </div>
    </div>

    <div class="sidebar-body">
      <section class="block">
        <SnapshotPicker />
      </section>

      <section class="block">
        <NInput
          v-model:value="text"
          size="small"
          placeholder="搜索文件名或关键词"
          clearable
          @update:value="debouncedText"
          @keyup.enter="applyText"
          @clear="applyText"
        >
          <template #prefix><Search :size="14" /></template>
        </NInput>
      </section>

      <section class="block quick">
        <div class="quick-row">
          <span class="quick-label">收藏</span>
          <NRadioGroup :value="lib.filters.favoriteMode" size="small" @update:value="setFavoriteMode">
            <NRadioButton value="all">全部</NRadioButton>
            <NRadioButton value="favorited">已收藏</NRadioButton>
            <NRadioButton value="unfavorited">未收藏</NRadioButton>
          </NRadioGroup>
        </div>
        <div class="quick-row">
          <span class="quick-label">投稿</span>
          <NRadioGroup :value="lib.filters.postedMode" size="small" @update:value="setPostedMode">
            <NRadioButton value="all">全部</NRadioButton>
            <NRadioButton value="posted">已投稿</NRadioButton>
            <NRadioButton value="unposted">未投稿</NRadioButton>
          </NRadioGroup>
        </div>
      </section>

      <section v-if="lib.availableTags.length" class="block">
        <div class="block-head">
          <span class="section-title"><Tag :size="12" /> 标签</span>
          <NButton v-if="lib.filters.tags.length" size="tiny" text type="primary" @click="clearTags">清除</NButton>
        </div>
        <div class="chips">
          <NTag
            v-for="t in lib.availableTags"
            :key="t.name"
            size="small"
            checkable
            :checked="lib.filters.tags.includes(t.name)"
            @update:checked="lib.toggleTag(t.name)"
          >
            {{ t.name }}<span class="chip-count">{{ t.count }}</span>
          </NTag>
        </div>
      </section>

      <section class="block nodes">
        <NodePicker v-for="field in NODE_FIELDS" :key="field.role" v-bind="field" />
      </section>

      <section class="block">
        <div class="block-head">
          <span class="section-title">属性（classify）</span>
          <NButton v-if="hasFacetSelection" size="tiny" text type="primary" @click="clearFacets">清空</NButton>
        </div>
        <div v-if="!facetGroups.length" class="faint empty-hint">当前快照没有可用的 classify 属性</div>
        <NCollapse v-else v-model:expanded-names="expanded" class="facets" arrow-placement="right">
          <NCollapseItem v-for="group in facetGroups" :key="group.key" :name="group.key">
            <template #header>
              <span class="facet-title">
                {{ group.label }}
                <span class="faint mono">{{ group.key }}</span>
              </span>
            </template>
            <template #header-extra>
              <span v-if="lib.filters.facets[group.key]?.length" class="facet-badge">
                {{ lib.filters.facets[group.key].length }}
              </span>
            </template>
            <div class="chips">
              <NTag
                v-for="value in group.values"
                :key="value"
                size="small"
                checkable
                :checked="lib.filters.facets[group.key]?.includes(value) ?? false"
                @update:checked="lib.toggleFacet(group.key, value)"
              >
                {{ value }}
              </NTag>
            </div>
          </NCollapseItem>
        </NCollapse>
      </section>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--surface);
  border-right: 1px solid var(--border);
}

.sidebar-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 44px;
  padding: 0 8px 0 14px;
  border-bottom: 1px solid var(--border);
  flex: none;
}

.head-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.sidebar-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 14px 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.block-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.block-head .section-title {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.quick {
  gap: 6px;
}

.quick-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.quick-label {
  font-size: 12px;
  color: var(--text-muted);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chip-count {
  margin-left: 4px;
  font-size: 11px;
  opacity: 0.6;
}

.nodes {
  gap: 10px;
}

.empty-hint {
  font-size: 12px;
}

.facet-title {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  font-size: 13px;
}

.facet-title .mono {
  font-size: 11px;
}

.facet-badge {
  display: inline-grid;
  place-items: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--primary);
  color: var(--on-primary);
  font-size: 11px;
  font-weight: 600;
}

.facets :deep(.n-collapse-item) {
  margin-top: 4px !important;
}

.facets :deep(.n-collapse-item__content-inner) {
  padding-top: 8px !important;
}
</style>
