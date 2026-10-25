<script setup lang="ts">
import { Check, GripVertical, RefreshCw, Search } from "@lucide/vue";
import { NButton, NInput } from "naive-ui";
import type { SubmissionSummary } from "@/api";
import { useCalendarStore } from "@/stores/calendar";
import { TASK_MIME } from "./shared";

const cal = useCalendarStore();

function onDragStart(e: DragEvent, sub: SubmissionSummary) {
  if (cal.locked || !e.dataTransfer) return;
  e.dataTransfer.effectAllowed = "copyMove";
  e.dataTransfer.setData(TASK_MIME, sub.task_id);
  e.dataTransfer.setData("text/plain", sub.title || sub.task_id);
}
</script>

<template>
  <aside class="unscheduled" aria-label="待排期投稿">
    <div class="head">
      <h3>待排期投稿 <span class="count">{{ cal.unscheduledTotal }}</span></h3>
      <NButton quaternary circle size="tiny" aria-label="刷新" @click="cal.loadSubmissions()">
        <template #icon><RefreshCw :size="14" /></template>
      </NButton>
    </div>
    <NInput v-model:value="cal.search" size="small" clearable placeholder="搜索标题或任务 ID">
      <template #prefix><Search :size="14" /></template>
    </NInput>
    <p class="faint hint">拖到右侧日历即可排期（默认 20:00），点击载入排期表单</p>

    <div class="list">
      <div v-if="!cal.unscheduled.length" class="empty faint">
        {{ cal.search ? "未找到匹配的待排期投稿" : "所有投稿均已安排排期" }}
      </div>
      <div
        v-for="sub in cal.unscheduled"
        :key="sub.task_id"
        class="card"
        :class="{ active: cal.selectedTaskId === sub.task_id }"
        :draggable="!cal.locked"
        role="button"
        tabindex="0"
        @dragstart="onDragStart($event, sub)"
        @click="cal.selectUnscheduled(sub)"
        @keydown.enter="cal.selectUnscheduled(sub)"
      >
        <GripVertical :size="14" class="grip faint" />
        <div class="body">
          <div class="title truncate" :title="sub.title || sub.task_id">{{ sub.title || sub.task_id }}</div>
          <div class="meta">
            <span class="tag">{{ sub.counts?.all ?? 0 }} 图</span>
            <span v-if="sub.pixiv?.illust_id" class="tag ok" :title="`PID ${sub.pixiv.illust_id}`"><Check :size="10" />Pixiv</span>
            <span v-else class="tag">未发布</span>
          </div>
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.unscheduled {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  padding: 12px;
  border-right: 1px solid var(--border);
  background: var(--surface);
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

h3 {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}

.count {
  min-width: 20px;
  padding: 0 6px;
  border-radius: 10px;
  background: var(--surface-3);
  color: var(--text-muted);
  font-size: 11px;
  line-height: 18px;
  text-align: center;
}

.hint {
  margin: 0;
  font-size: 11px;
}

.list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.empty {
  padding: 24px 8px;
  text-align: center;
  font-size: 12px;
}

.card {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-2);
  cursor: grab;
}

.card:hover {
  border-color: var(--border-strong);
}

.card.active {
  border-color: var(--primary);
  background: var(--primary-soft);
}

.grip {
  flex: none;
}

.body {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.title {
  font-size: 12px;
  font-weight: 500;
}

.meta {
  display: flex;
  gap: 4px;
  font-size: 10px;
  color: var(--text-muted);
}

.tag {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  padding: 0 4px;
  border-radius: 3px;
  background: var(--surface-3);
  line-height: 15px;
}

.tag.ok {
  background: var(--success-soft);
  color: var(--success);
}
</style>
