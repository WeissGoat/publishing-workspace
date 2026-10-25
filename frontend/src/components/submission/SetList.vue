<script setup lang="ts">
import { ArrowDown, ArrowUp, ImagePlus, Trash2, X } from "@lucide/vue";
import { NButton, NTooltip } from "naive-ui";
import { computed, ref } from "vue";
import { SET_NAMES, thumbUrl, type SetName } from "@/api";
import { useLibraryStore } from "@/stores/library";
import { useLightboxStore } from "@/stores/lightbox";
import { useSubmissionStore } from "@/stores/submission";

const sub = useSubmissionStore();
const lib = useLibraryStore();
const lb = useLightboxStore();

const SET_LABELS: Record<SetName, string> = { all: "全部", post: "投稿", cover: "封面" };

const list = computed(() => sub.current.sets[sub.activeSet]);

const dragFrom = ref<number | null>(null);
const dragOver = ref<number | null>(null);

function onDragStart(e: DragEvent, index: number) {
  dragFrom.value = index;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
  }
}

function onDragOver(index: number) {
  if (dragFrom.value !== null) dragOver.value = index;
}

function onDrop(index: number) {
  if (dragFrom.value !== null) sub.move(sub.activeSet, dragFrom.value, index);
  dragFrom.value = null;
  dragOver.value = null;
}

function onDragEnd() {
  dragFrom.value = null;
  dragOver.value = null;
}

function open(index: number) {
  lb.openAsset(list.value[index], [...list.value]);
}

function name(id: string): string {
  return lib.getAsset(id)?.display_name ?? id;
}
</script>

<template>
  <section class="sets">
    <div class="set-tabs" role="tablist">
      <button
        v-for="s in SET_NAMES"
        :key="s"
        type="button"
        role="tab"
        class="set-tab"
        :class="{ active: sub.activeSet === s }"
        :aria-selected="sub.activeSet === s"
        @click="sub.activeSet = s"
      >
        <span class="set-key">{{ s }}</span>
        <span class="set-label">{{ SET_LABELS[s] }}</span>
        <span class="set-count">{{ sub.current.sets[s].length }}</span>
      </button>
    </div>

    <div class="set-head">
      <span class="faint">拖拽调整顺序 · 点击查看大图</span>
      <NButton v-if="list.length" size="tiny" quaternary type="error" @click="sub.clearSet(sub.activeSet)">
        <template #icon><Trash2 :size="12" /></template>清空「{{ sub.activeSet }}」
      </NButton>
    </div>

    <div v-if="!list.length" class="empty">
      <ImagePlus :size="28" class="faint" />
      <p class="muted">「{{ sub.activeSet }}」集合还是空的</p>
      <p class="faint">在图库中选中图片后，点击底部的「加入「{{ sub.activeSet }}」」或「新建投稿」</p>
    </div>

    <ol v-else class="grid">
      <li
        v-for="(id, i) in list"
        :key="`${id}-${i}`"
        class="cell"
        :class="{ dragging: dragFrom === i, over: dragOver === i && dragFrom !== i }"
        draggable="true"
        @dragstart="onDragStart($event, i)"
        @dragover.prevent="onDragOver(i)"
        @dragleave="dragOver === i && (dragOver = null)"
        @drop.prevent="onDrop(i)"
        @dragend="onDragEnd"
      >
        <button type="button" class="thumb" :title="name(id)" @click="open(i)">
          <img :src="thumbUrl(id, 120)" :alt="name(id)" loading="lazy" draggable="false" />
          <span class="order">{{ i + 1 }}</span>
        </button>
        <div class="ops">
          <NTooltip>
            <template #trigger>
              <button type="button" :disabled="i === 0" aria-label="上移" @click="sub.move(sub.activeSet, i, i - 1)">
                <ArrowUp :size="12" />
              </button>
            </template>
            上移
          </NTooltip>
          <NTooltip>
            <template #trigger>
              <button
                type="button"
                :disabled="i === list.length - 1"
                aria-label="下移"
                @click="sub.move(sub.activeSet, i, i + 1)"
              >
                <ArrowDown :size="12" />
              </button>
            </template>
            下移
          </NTooltip>
          <NTooltip>
            <template #trigger>
              <button type="button" class="danger" aria-label="移除" @click="sub.removeAt(sub.activeSet, i)">
                <X :size="12" />
              </button>
            </template>
            从「{{ sub.activeSet }}」移除
          </NTooltip>
        </div>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.sets {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.set-tabs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.set-tab {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  cursor: pointer;
  text-align: left;
}

.set-tab.active {
  border-color: var(--primary);
  background: var(--primary-soft);
  color: var(--text);
}

.set-key {
  font-weight: 600;
}

.set-label {
  font-size: 11px;
  color: var(--text-faint);
}

.set-count {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}

.set-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 24px;
  font-size: 11px;
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 24px 12px;
  border: 1px dashed var(--border-strong);
  border-radius: 8px;
  text-align: center;
}

.empty p {
  margin: 0;
  font-size: 12px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.cell {
  position: relative;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--surface-2);
  cursor: grab;
}

.cell.dragging {
  opacity: 0.4;
}

.cell.over {
  border-color: var(--primary);
  box-shadow: 0 0 0 2px var(--primary-soft);
}

.thumb {
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 3 / 4;
  padding: 0;
  border: none;
  background: var(--image-bg);
  cursor: zoom-in;
}

.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.order {
  position: absolute;
  top: 4px;
  left: 4px;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  border-radius: 9px;
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
  font-size: 11px;
  line-height: 18px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.ops {
  position: absolute;
  top: 4px;
  right: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.12s;
}

.cell:hover .ops,
.cell:focus-within .ops {
  opacity: 1;
}

.ops button {
  display: inline-grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
  cursor: pointer;
}

.ops button:disabled {
  opacity: 0.35;
  cursor: default;
}

.ops button.danger:hover {
  background: var(--danger);
}
</style>
