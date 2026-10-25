<script setup lang="ts">
import { CalendarClock, ExternalLink, Send, X } from "@lucide/vue";
import { NButton, NDatePicker, NInputNumber, NSwitch, NTimePicker } from "naive-ui";
import { computed } from "vue";
import { useSubmissionStore } from "@/stores/submission";
import { formatDateTime, formatScheduleWindow, todayPlus, toScheduledAt } from "@/utils/format";

const sub = useSubmissionStore();
const pixiv = computed(() => sub.current.pixiv);

const PRESETS = [
  { label: "今天", days: 0 },
  { label: "明天", days: 1 },
  { label: "后天", days: 2 },
  { label: "下周", days: 7 },
];

// 日期选择器不接受空字符串，空排期以 null 表示
const dateModel = computed({
  get: () => sub.scheduleDate || null,
  set: (v: string | null) => {
    sub.scheduleDate = v ?? "";
  },
});
const timeModel = computed({
  get: () => sub.scheduleTime || "20:00",
  set: (v: string | null) => {
    sub.scheduleTime = v || "20:00";
  },
});

const published = computed(() => Boolean(pixiv.value.illust_id));
const failed = computed(() => pixiv.value.last_publish_status === "failed" || Boolean(pixiv.value.last_publish_error));

const scheduleWindow = computed(() =>
  sub.scheduleDate
    ? formatScheduleWindow(toScheduledAt(sub.scheduleDate, sub.scheduleTime), sub.current.allow_delay, sub.current.max_delay_minutes)
    : "",
);

const scheduleHint = computed(() => {
  if (!sub.current.task_id) return "保存投稿后可开启定时发布";
  if (!sub.scheduleDate) return "设置排期日期后可开启定时发布";
  if (sub.current.scheduled_publish) return `将在 ${scheduleWindow.value} 自动发布到 Pixiv`;
  return "开启后由后台调度在排期时间自动发布";
});

const scheduleChanged = computed(() => {
  const saved = sub.current.scheduled_at;
  const form = sub.scheduleDate ? toScheduledAt(sub.scheduleDate, sub.scheduleTime) : null;
  return (saved ?? null) !== form;
});
</script>

<template>
  <div class="publish">
    <section class="block">
      <div class="block-head">
        <CalendarClock :size="15" />
        <span class="section-title">排期</span>
        <span v-if="scheduleChanged && sub.current.task_id" class="dirty">未保存</span>
      </div>
      <div class="row">
        <NDatePicker
          v-model:formatted-value="dateModel"
          type="date"
          value-format="yyyy-MM-dd"
          clearable
          size="small"
          placeholder="未排期"
          class="date"
        />
        <NTimePicker
          v-model:formatted-value="timeModel"
          value-format="HH:mm"
          format="HH:mm"
          size="small"
          :clearable="false"
          class="time"
        />
      </div>
      <div class="presets">
        <span class="faint">快捷</span>
        <button v-for="p in PRESETS" :key="p.label" type="button" class="preset" @click="sub.scheduleDate = todayPlus(p.days)">
          {{ p.label }}
        </button>
        <button v-if="sub.scheduleDate" type="button" class="preset clear" @click="sub.scheduleDate = ''">
          <X :size="11" /> 清除排期
        </button>
      </div>
      <p class="faint hint">保存投稿时会把排期同步到日历中的月度计划</p>
    </section>

    <section class="block">
      <div class="block-head">
        <Send :size="15" />
        <span class="section-title">发布到 Pixiv</span>
      </div>
      <div class="status" :class="{ ok: published, bad: failed && !published }">
        <template v-if="published">
          已发布 ·
          <a :href="`https://www.pixiv.net/artworks/${pixiv.illust_id}`" target="_blank" rel="noopener">
            PID {{ pixiv.illust_id }} <ExternalLink :size="11" />
          </a>
          <span v-if="pixiv.published_at" class="faint">· {{ formatDateTime(pixiv.published_at) }}</span>
        </template>
        <template v-else-if="failed">上次发布失败：{{ pixiv.last_publish_error || pixiv.last_publish_status }}</template>
        <template v-else>尚未发布</template>
      </div>
      <NButton
        :type="published ? 'default' : 'primary'"
        :loading="sub.busy.publishing"
        :disabled="!sub.current.task_id"
        block
        @click="sub.publish(published)"
      >
        <template #icon><Send :size="15" /></template>
        {{ published ? "重新发布（创建新作品）" : "立即发布到 Pixiv" }}
      </NButton>
      <p v-if="!sub.current.task_id" class="faint hint">保存投稿后可发布</p>
      <p v-else class="faint hint">发布前会自动保存当前设置；未选标签时自动套用识别标签</p>
    </section>

    <section class="block">
      <div class="block-head">
        <span class="section-title">定时发布</span>
        <NSwitch
          :value="sub.current.scheduled_publish"
          :loading="sub.busy.scheduling"
          :disabled="!sub.current.task_id"
          size="small"
          class="push-right"
          @update:value="sub.toggleSchedule()"
        />
      </div>
      <p class="hint" :class="sub.current.scheduled_publish ? 'on' : 'muted'">{{ scheduleHint }}</p>
      <label class="switch-row">
        <NSwitch v-model:value="sub.current.allow_delay" size="small" :disabled="sub.current.scheduled_publish" />
        <span>允许延迟补发</span>
      </label>
      <div v-if="sub.current.allow_delay" class="row delay">
        <span class="muted">最多延迟</span>
        <NInputNumber
          v-model:value="sub.current.max_delay_minutes"
          :min="1"
          :max="1440"
          :step="30"
          size="small"
          :disabled="sub.current.scheduled_publish"
          class="minutes"
        />
        <span class="muted">分钟</span>
      </div>
      <p class="faint hint">错过排期（如电脑休眠）时，在容差范围内仍会补发；修改设置需先关闭定时发布</p>
    </section>
  </div>
</template>

<style scoped>
.publish {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface-2);
}

.block-head {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-muted);
}

.push-right {
  margin-left: auto;
}

.dirty {
  margin-left: auto;
  padding: 0 6px;
  border-radius: 4px;
  background: var(--warning-soft);
  color: var(--warning);
  font-size: 11px;
}

.row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.date {
  flex: 1;
}

.time {
  width: 110px;
}

.presets {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  font-size: 12px;
}

.preset {
  height: 22px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 11px;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.preset:hover {
  border-color: var(--primary);
  color: var(--text);
}

.preset.clear {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.hint {
  margin: 0;
  font-size: 12px;
}

.hint.on {
  color: var(--success);
}

.status {
  font-size: 12px;
  color: var(--text-muted);
}

.status.ok {
  color: var(--success);
}

.status.bad {
  color: var(--danger);
}

.status a {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.switch-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.minutes {
  width: 120px;
}
</style>
