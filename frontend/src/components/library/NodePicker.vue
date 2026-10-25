<script setup lang="ts">
import { useDebounceFn } from "@vueuse/core";
import { NAutoComplete } from "naive-ui";
import { h, ref, watch, type VNodeChild } from "vue";
import { api, type NodeOption, type NodeRole } from "@/api";
import { useLibraryStore } from "@/stores/library";

const props = defineProps<{ role: NodeRole; label: string; placeholder: string }>();

const lib = useLibraryStore();
const value = ref(lib.filters[props.role]);
const options = ref<{ label: string; value: string; ref: string | null }[]>([]);
let fetchToken = 0;

// 外部（重置筛选、切换快照、移除条件芯片）修改时同步输入框
watch(
  () => lib.filters[props.role],
  (next) => {
    if (next !== value.value) value.value = next;
  },
);

async function fetchOptions(query: string) {
  const token = ++fetchToken;
  try {
    const data = await api.nodes(props.role, query, lib.importIds);
    if (token !== fetchToken) return;
    options.value = data.nodes.map((n: NodeOption) => ({ label: n.name, value: n.name, ref: n.ref }));
  } catch {
    options.value = [];
  }
}

const debouncedFetch = useDebounceFn((q: string) => fetchOptions(q), 150);
const debouncedApply = useDebounceFn((q: string) => lib.setNodeFilter(props.role, q.trim()), 350);

function onInput(next: string) {
  value.value = next ?? "";
  void debouncedFetch(value.value.trim());
  void debouncedApply(value.value);
}

function onSelect(selected: string | number) {
  value.value = String(selected);
  lib.setNodeFilter(props.role, value.value);
}

function onEnter() {
  lib.setNodeFilter(props.role, value.value.trim());
}

function renderLabel(option: { label?: unknown; ref?: string | null }): VNodeChild {
  return h("div", { class: "node-option" }, [
    h("span", { class: "node-option-name" }, String(option.label ?? "")),
    option.ref ? h("span", { class: "node-option-ref" }, option.ref) : null,
  ]);
}
</script>

<template>
  <div class="node-picker">
    <label class="node-label">{{ label }}</label>
    <NAutoComplete
      :value="value"
      :options="options"
      :placeholder="placeholder"
      :get-show="() => true"
      :render-label="renderLabel"
      size="small"
      clearable
      blur-after-select
      @update:value="onInput"
      @select="onSelect"
      @focus="fetchOptions(value.trim())"
      @keyup.enter="onEnter"
      @clear="lib.setNodeFilter(role, '')"
    />
  </div>
</template>

<style scoped>
.node-picker {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.node-label {
  font-size: 12px;
  color: var(--text-muted);
}

:global(.node-option) {
  display: flex;
  flex-direction: column;
  line-height: 1.35;
  padding: 2px 0;
}

:global(.node-option-name) {
  font-weight: 500;
}

:global(.node-option-ref) {
  font-size: 11px;
  color: var(--text-faint);
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
