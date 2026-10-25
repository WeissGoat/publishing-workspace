<script setup lang="ts">
import { ChevronLeft, ChevronRight, FolderSearch, X } from "@lucide/vue";
import { onKeyStroke } from "@vueuse/core";
import { NButton } from "naive-ui";
import { computed } from "vue";
import type { PreviewItem } from "./shared";

const props = defineProps<{ items: PreviewItem[]; label: string }>();
const index = defineModel<number | null>("index", { required: true });
const emit = defineEmits<{ reveal: [index: number] }>();

const current = computed(() => (index.value === null ? null : props.items[index.value] ?? null));

function step(delta: number) {
  if (index.value === null) return;
  const next = index.value + delta;
  if (next >= 0 && next < props.items.length) index.value = next;
}

onKeyStroke(["ArrowLeft", "ArrowRight", "Escape"], (e) => {
  if (index.value === null) return;
  e.preventDefault();
  if (e.key === "Escape") index.value = null;
  else step(e.key === "ArrowLeft" ? -1 : 1);
});
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="current && index !== null" class="preview" role="dialog" aria-modal="true" @click.self="index = null">
        <header class="top">
          <div class="caption truncate" :title="current.caption">{{ current.caption }}</div>
          <span class="counter">{{ index + 1 }} / {{ items.length }}（{{ label }}）</span>
          <NButton size="small" secondary @click="emit('reveal', index)">
            <template #icon><FolderSearch :size="14" /></template>打开所在文件夹
          </NButton>
          <NButton quaternary circle aria-label="关闭" @click="index = null">
            <template #icon><X :size="18" /></template>
          </NButton>
        </header>
        <div class="stage" @click.self="index = null">
          <button type="button" class="nav prev" :disabled="index <= 0" aria-label="上一张" @click="step(-1)">
            <ChevronLeft :size="22" />
          </button>
          <img :key="current.src" :src="current.src" :alt="current.caption" />
          <button type="button" class="nav next" :disabled="index >= items.length - 1" aria-label="下一张" @click="step(1)">
            <ChevronRight :size="22" />
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.preview {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  flex-direction: column;
  background: var(--overlay);
  backdrop-filter: blur(4px);
}

.top {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 52px;
  padding: 0 12px 0 16px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}

.caption {
  flex: 1;
  min-width: 0;
  font-weight: 600;
}

.counter {
  font-size: 12px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.stage {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px 72px;
}

.stage img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.4);
}

.nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  display: inline-grid;
  place-items: center;
  width: 40px;
  height: 64px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
}

.nav:disabled {
  opacity: 0.3;
  cursor: default;
}

.prev {
  left: 16px;
}

.next {
  right: 16px;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
