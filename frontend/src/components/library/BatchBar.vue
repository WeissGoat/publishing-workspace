<script setup lang="ts">
import { Copy, FolderPlus, MailCheck, MailX, Plus, Star, StarOff, Tags, X } from "@lucide/vue";
import { NButton, NInput, NModal } from "naive-ui";
import { ref } from "vue";
import { useLibraryStore } from "@/stores/library";
import { useSubmissionStore } from "@/stores/submission";

const lib = useLibraryStore();
const sub = useSubmissionStore();

const tagDialog = ref(false);
const tagInput = ref("");

function sourceImportId(): string | null {
  return lib.importIds.length === 1 && !lib.isGlobal ? lib.importIds[0] : null;
}

async function newSubmission() {
  if (await sub.newFromSelection(lib.selectedList, sourceImportId())) lib.clearSelection();
}

function addToSet() {
  sub.addToSet(lib.selectedList);
  lib.clearSelection();
}

function submitTags() {
  const tags = tagInput.value
    .split(/[,，\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (!tags.length) return;
  tagDialog.value = false;
  tagInput.value = "";
  void lib.batchAction("add_tags", tags);
}
</script>

<template>
  <Transition name="bar">
    <div v-if="lib.selected.size" class="bar" role="toolbar" aria-label="批量操作">
      <span class="count"><strong>{{ lib.selected.size }}</strong> 张已选</span>
      <span class="divider" />
      <NButton size="small" quaternary @click="lib.batchAction('favorite')">
        <template #icon><Star :size="15" /></template>收藏
      </NButton>
      <NButton size="small" quaternary @click="lib.batchAction('unfavorite')">
        <template #icon><StarOff :size="15" /></template>取消收藏
      </NButton>
      <NButton size="small" quaternary @click="lib.batchAction('mark_posted')">
        <template #icon><MailCheck :size="15" /></template>标记已投稿
      </NButton>
      <NButton size="small" quaternary @click="lib.batchAction('unmark_posted')">
        <template #icon><MailX :size="15" /></template>取消已投稿
      </NButton>
      <NButton size="small" quaternary @click="tagDialog = true">
        <template #icon><Tags :size="15" /></template>打标签
      </NButton>
      <NButton size="small" quaternary @click="lib.copySelectedPaths()">
        <template #icon><Copy :size="15" /></template>复制路径
      </NButton>
      <span class="divider" />
      <NButton size="small" secondary @click="addToSet">
        <template #icon><FolderPlus :size="15" /></template>加入「{{ sub.activeSet }}」
      </NButton>
      <NButton size="small" type="primary" @click="newSubmission">
        <template #icon><Plus :size="15" /></template>新建投稿
      </NButton>
      <NButton size="small" quaternary circle aria-label="取消选择 (Esc)" @click="lib.clearSelection()">
        <template #icon><X :size="16" /></template>
      </NButton>
    </div>
  </Transition>

  <NModal
    v-model:show="tagDialog"
    preset="dialog"
    title="批量打标签"
    positive-text="追加标签"
    negative-text="取消"
    :show-icon="false"
    @positive-click="submitTags"
  >
    <p class="muted hint">为选中的 {{ lib.selected.size }} 张图片追加标签，多个标签用逗号或空格分隔。</p>
    <NInput v-model:value="tagInput" placeholder="例如：精选 待修" autofocus @keyup.enter="submitTags" />
  </NModal>
</template>

<style scoped>
.bar {
  position: fixed;
  left: 50%;
  bottom: 20px;
  z-index: 60;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 2px;
  max-width: calc(100vw - 32px);
  padding: 6px 8px 6px 14px;
  border: 1px solid var(--border-strong);
  border-radius: 12px;
  background: var(--surface-2);
  box-shadow: var(--shadow);
  flex-wrap: wrap;
}

.count {
  margin-right: 6px;
  white-space: nowrap;
}

.count strong {
  color: var(--primary);
  font-variant-numeric: tabular-nums;
}

.divider {
  width: 1px;
  height: 20px;
  margin: 0 6px;
  background: var(--border-strong);
}

.hint {
  margin: 0 0 10px;
}

.bar-enter-active,
.bar-leave-active {
  transition: opacity 0.15s, transform 0.15s;
}

.bar-enter-from,
.bar-leave-to {
  opacity: 0;
  transform: translate(-50%, 12px);
}
</style>
