<script setup lang="ts">
import { FilePlus2, Info, Save, Trash2, X } from "@lucide/vue";
import { useLocalStorage } from "@vueuse/core";
import { NButton, NInput, NSelect, NTooltip } from "naive-ui";
import { computed } from "vue";
import { confirmDialog } from "@/composables/notify";
import { useLibraryStore } from "@/stores/library";
import { useSubmissionStore } from "@/stores/submission";
import ExportPanel from "./ExportPanel.vue";
import PixivPanel from "./PixivPanel.vue";
import PublishPanel from "./PublishPanel.vue";
import SetList from "./SetList.vue";

type Tab = "images" | "pixiv" | "publish" | "export";

const sub = useSubmissionStore();
const lib = useLibraryStore();
const tab = useLocalStorage<Tab>("pw_basket_tab", "images");

const TABS = computed<{ key: Tab; label: string; badge?: string | number }[]>(() => [
  { key: "images", label: "图片", badge: sub.totalCount || undefined },
  { key: "pixiv", label: "Pixiv", badge: sub.current.pixiv.tags.length ? `${sub.current.pixiv.tags.length}` : undefined },
  { key: "publish", label: "发布" },
  { key: "export", label: "导出" },
]);

const historyOptions = computed(() =>
  sub.history.map((h) => {
    const pid = h.pixiv?.illust_id ? ` · PID ${h.pixiv.illust_id}` : "";
    return { value: h.task_id, label: `${h.title || h.task_id} · ${h.counts?.all ?? 0} 张${pid}` };
  }),
);

const pixivBadge = computed(() => {
  const p = sub.current.pixiv;
  if (p.illust_id) return { text: "已发布", cls: "ok" };
  if (p.last_publish_status === "failed" || p.last_publish_error) return { text: "发布失败", cls: "bad" };
  if (sub.current.scheduled_publish) return { text: "定时发布", cls: "info" };
  return null;
});

async function startNew() {
  if (sub.hasContent) {
    const ok = await confirmDialog({ title: "新建投稿", content: "确定放弃当前编辑内容，开始一个空白投稿吗？" });
    if (!ok) return;
  }
  sub.reset(lib.importIds.length === 1 && !lib.isGlobal ? lib.importIds[0] : null);
  tab.value = "images";
}

async function onPickHistory(taskId: string | null) {
  if (!taskId || taskId === sub.current.task_id) return;
  await sub.load(taskId);
}

async function remove() {
  const unmarked = await sub.remove();
  for (const id of unmarked) lib.postedOverride.set(id, false);
}
</script>

<template>
  <aside class="drawer" aria-label="投稿篮">
    <header class="head">
      <div class="head-row">
        <h2>投稿篮</h2>
        <div class="badges">
          <span v-if="sub.current.task_id" class="badge mono" :title="`任务 ${sub.current.task_id}`">
            {{ sub.current.task_id }}
          </span>
          <span v-if="sub.current.task_id" class="badge">Rev {{ sub.current.revision }}</span>
          <span v-else class="badge new">未保存</span>
          <span v-if="pixivBadge" class="badge" :class="pixivBadge.cls">{{ pixivBadge.text }}</span>
        </div>
        <NTooltip>
          <template #trigger>
            <NButton quaternary circle size="small" aria-label="收起投稿篮" @click="sub.drawerOpen = false">
              <template #icon><X :size="16" /></template>
            </NButton>
          </template>
          收起投稿篮
        </NTooltip>
      </div>
      <div class="head-row">
        <NSelect
          :value="sub.current.task_id"
          :options="historyOptions"
          filterable
          clearable
          size="small"
          placeholder="载入历史投稿…"
          class="history"
          @update:value="onPickHistory"
          @focus="sub.loadHistory()"
        />
        <NButton size="small" secondary @click="startNew">
          <template #icon><FilePlus2 :size="14" /></template>新建
        </NButton>
      </div>
    </header>

    <div v-if="sub.current.legacySource" class="legacy">
      <Info :size="14" />
      <span>这是月度计划中的旧格式散图（{{ sub.current.legacySource.entry_id }}），保存后会创建正式投稿并自动关联回计划。</span>
    </div>

    <div class="title-row">
      <NInput v-model:value="sub.current.title" placeholder="投稿标题（必填）" />
    </div>

    <nav class="tabs" role="tablist">
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
        {{ t.label }}
        <span v-if="t.badge" class="tab-badge">{{ t.badge }}</span>
      </button>
    </nav>

    <div class="body">
      <SetList v-if="tab === 'images'" />
      <PixivPanel v-else-if="tab === 'pixiv'" />
      <PublishPanel v-else-if="tab === 'publish'" />
      <ExportPanel v-else />
    </div>

    <footer class="foot">
      <NButton v-if="sub.current.task_id" quaternary type="error" @click="remove">
        <template #icon><Trash2 :size="15" /></template>删除
      </NButton>
      <span class="spacer" />
      <NButton type="primary" :loading="sub.busy.saving" :disabled="!sub.totalCount" @click="sub.save()">
        <template #icon><Save :size="15" /></template>
        {{ sub.current.task_id ? "保存修改" : "保存投稿" }}
      </NButton>
    </footer>
  </aside>
</template>

<style scoped>
.drawer {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  border-left: 1px solid var(--border);
  background: var(--surface);
}

.head {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px 10px;
  border-bottom: 1px solid var(--border);
}

.head-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.badges {
  flex: 1;
  min-width: 0;
  display: flex;
  gap: 4px;
  overflow: hidden;
}

.badge {
  flex: none;
  max-width: 140px;
  padding: 0 6px;
  border-radius: 4px;
  background: var(--surface-3);
  color: var(--text-muted);
  font-size: 11px;
  line-height: 18px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.badge.new {
  background: var(--warning-soft);
  color: var(--warning);
}

.badge.ok {
  background: var(--success-soft);
  color: var(--success);
}

.badge.bad {
  background: var(--danger-soft);
  color: var(--danger);
}

.badge.info {
  background: var(--primary-soft);
  color: var(--primary);
}

.history {
  flex: 1;
  min-width: 0;
}

.legacy {
  display: flex;
  gap: 6px;
  margin: 10px 14px 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--warning-soft);
  color: var(--warning);
  font-size: 12px;
}

.legacy :deep(svg) {
  flex: none;
  margin-top: 2px;
}

.title-row {
  padding: 12px 14px 0;
}

.tabs {
  display: flex;
  gap: 2px;
  padding: 10px 14px 0;
  border-bottom: 1px solid var(--border);
}

.tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 34px;
  padding: 0 12px;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-weight: 500;
  cursor: pointer;
  margin-bottom: -1px;
}

.tab:hover {
  color: var(--text);
}

.tab.active {
  border-bottom-color: var(--primary);
  color: var(--text);
}

.tab-badge {
  min-width: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--surface-3);
  font-size: 11px;
  line-height: 16px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px;
}

.foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid var(--border);
  background: var(--surface);
}

.spacer {
  flex: 1;
}
</style>
