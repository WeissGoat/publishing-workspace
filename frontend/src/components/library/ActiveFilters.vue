<script setup lang="ts">
import { NButton, NTag } from "naive-ui";
import { computed } from "vue";
import { NODE_ROLES } from "@/api";
import { useLibraryStore } from "@/stores/library";
import { FACET_LABELS, ROLE_LABELS } from "./constants";

const lib = useLibraryStore();

interface Chip {
  key: string;
  label: string;
  value: string;
  clear: () => void;
}

const chips = computed<Chip[]>(() => {
  const f = lib.filters;
  const list: Chip[] = [];
  if (f.text) {
    list.push({ key: "text", label: "关键词", value: f.text, clear: () => ((f.text = ""), lib.applyFilters()) });
  }
  for (const role of NODE_ROLES) {
    if (f[role]) {
      list.push({ key: role, label: ROLE_LABELS[role], value: f[role], clear: () => lib.setNodeFilter(role, "") });
    }
  }
  for (const [field, values] of Object.entries(f.facets)) {
    for (const value of values) {
      list.push({
        key: `facet:${field}:${value}`,
        label: FACET_LABELS[field] ?? field,
        value,
        clear: () => lib.toggleFacet(field, value),
      });
    }
  }
  for (const tag of f.tags) {
    list.push({ key: `tag:${tag}`, label: "标签", value: tag, clear: () => lib.toggleTag(tag) });
  }
  if (f.favoriteMode !== "all") {
    list.push({
      key: "fav",
      label: "收藏",
      value: f.favoriteMode === "favorited" ? "仅已收藏" : "仅未收藏",
      clear: () => ((f.favoriteMode = "all"), lib.applyFilters()),
    });
  }
  if (f.postedMode !== "all") {
    list.push({
      key: "posted",
      label: "投稿",
      value: f.postedMode === "posted" ? "仅已投稿" : "仅未投稿",
      clear: () => ((f.postedMode = "all"), lib.applyFilters()),
    });
  }
  return list;
});
</script>

<template>
  <div v-if="chips.length" class="active">
    <NTag v-for="chip in chips" :key="chip.key" size="small" closable round @close="chip.clear()">
      <span class="muted">{{ chip.label }}：</span>{{ chip.value }}
    </NTag>
    <NButton size="tiny" text type="primary" @click="lib.resetFilters()">全部清除</NButton>
  </div>
</template>

<style scoped>
.active {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}
</style>
