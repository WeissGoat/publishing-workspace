<script setup lang="ts">
import { ExternalLink, Info, RotateCcw, Save, Trash2 } from "@lucide/vue";
import { NButton, NDatePicker, NInput, NInputNumber, NSelect, NSwitch, NTimePicker } from "naive-ui";
import { computed } from "vue";
import { useCalendarStore } from "@/stores/calendar";

const cal = useCalendarStore();

const heading = computed(() => {
  if (cal.form.entry_id) return "编辑排期";
  if (cal.selectedTaskId) return "新建排期（关联投稿）";
  return "新建排期";
});

const taskOptions = computed(() =>
  cal.submissions.map((s) => ({ value: s.task_id, label: `${s.title || s.task_id}（${s.counts?.all ?? 0} 图）` })),
);

const isLegacy = computed(() => cal.selectedEntry?.content.kind === "inline_selection" && !cal.form.task_id);

const legacyLink = computed(() =>
  cal.form.entry_id ? { path: "/library", query: { plan_id: cal.month, entry_id: cal.form.entry_id } } : null,
);

// 日期 / 时间选择器不接受空字符串
const dateModel = computed({
  get: () => cal.form.date || null,
  set: (v: string | null) => {
    cal.form.date = v ?? "";
  },
});
const timeModel = computed({
  get: () => cal.form.time || "20:00",
  set: (v: string | null) => {
    cal.form.time = v || "20:00";
  },
});
</script>

<template>
  <form class="entry-form" @submit.prevent="cal.saveForm()">
    <div class="head">
      <h3>{{ heading }}</h3>
      <NButton quaternary size="tiny" @click="cal.resetForm()">
        <template #icon><RotateCcw :size="12" /></template>清空
      </NButton>
    </div>

    <label class="field">
      <span class="label">标题</span>
      <NInput v-model:value="cal.form.title" size="small" placeholder="排期标题" :disabled="cal.locked" />
    </label>

    <div class="row">
      <label class="field grow">
        <span class="label">日期</span>
        <NDatePicker
          v-model:formatted-value="dateModel"
          type="date"
          value-format="yyyy-MM-dd"
          size="small"
          :disabled="cal.locked"
        />
      </label>
      <label class="field time">
        <span class="label">时间</span>
        <NTimePicker
          v-model:formatted-value="timeModel"
          value-format="HH:mm"
          format="HH:mm"
          size="small"
          :clearable="false"
          :disabled="cal.locked"
        />
      </label>
    </div>

    <label class="field">
      <span class="label">关联投稿</span>
      <NSelect
        :value="cal.form.task_id"
        :options="taskOptions"
        filterable
        clearable
        size="small"
        placeholder="选择已有投稿任务"
        :disabled="cal.locked"
        @update:value="cal.setFormTask"
      />
    </label>

    <div v-if="isLegacy" class="notice warn">
      <Info :size="14" />
      <span>
        这是旧格式散图排期。
        <RouterLink v-if="legacyLink" :to="legacyLink">在素材库中转换为正式投稿 <ExternalLink :size="11" /></RouterLink>
      </span>
    </div>
    <RouterLink
      v-else-if="cal.form.task_id"
      class="lib-link"
      :to="{ path: '/library', query: { submission_id: cal.form.task_id } }"
    >
      在素材库中编辑此投稿 <ExternalLink :size="11" />
    </RouterLink>

    <div class="switches">
      <label class="switch-row">
        <NSwitch v-model:value="cal.form.publish" size="small" :disabled="cal.locked" />
        <span>到期自动发布到 Pixiv</span>
      </label>
      <template v-if="cal.form.publish">
        <label class="switch-row">
          <NSwitch v-model:value="cal.form.allow_delay" size="small" :disabled="cal.locked" />
          <span>允许延迟补发</span>
        </label>
        <div v-if="cal.form.allow_delay" class="row delay">
          <span class="muted">最多延迟</span>
          <NInputNumber
            v-model:value="cal.form.max_delay_minutes"
            :min="1"
            :max="1440"
            :step="30"
            size="small"
            class="minutes"
            :disabled="cal.locked"
          />
          <span class="muted">分钟</span>
        </div>
      </template>
    </div>

    <div class="actions">
      <NButton v-if="cal.form.entry_id" quaternary type="error" size="small" :disabled="cal.locked" @click="cal.deleteEntry()">
        <template #icon><Trash2 :size="14" /></template>删除
      </NButton>
      <span class="spacer" />
      <NButton type="primary" size="small" attr-type="submit" :loading="cal.busy.saving" :disabled="cal.locked || !cal.plan">
        <template #icon><Save :size="14" /></template>
        {{ cal.form.entry_id ? "保存修改" : "创建排期" }}
      </NButton>
    </div>
  </form>
</template>

<style scoped>
.entry-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.label {
  font-size: 12px;
  color: var(--text-muted);
}

.row {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}

.grow {
  flex: 1;
}

.time {
  width: 110px;
}

.notice {
  display: flex;
  gap: 6px;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 12px;
}

.notice.warn {
  background: var(--warning-soft);
  color: var(--warning);
}

.notice :deep(svg) {
  flex: none;
  margin-top: 2px;
}

.notice a,
.lib-link {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 12px;
}

.switches {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.switch-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.delay {
  align-items: center;
}

.minutes {
  width: 120px;
}

.actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.spacer {
  flex: 1;
}
</style>
