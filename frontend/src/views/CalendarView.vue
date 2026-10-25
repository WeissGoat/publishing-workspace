<script setup lang="ts">
import { CalendarPlus, ChevronLeft, ChevronRight, Lock } from "@lucide/vue";
import { NButton, NDatePicker } from "naive-ui";
import { computed, onActivated, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import EntryForm from "@/components/calendar/EntryForm.vue";
import MonthGrid from "@/components/calendar/MonthGrid.vue";
import SubmissionDetailCard from "@/components/calendar/SubmissionDetailCard.vue";
import UnscheduledList from "@/components/calendar/UnscheduledList.vue";
import { useAppStore } from "@/stores/app";
import { useCalendarStore } from "@/stores/calendar";
import { currentMonth, shiftMonth } from "@/utils/format";

const cal = useCalendarStore();
const app = useAppStore();
const route = useRoute();
const router = useRouter();

function queryMonth(): string {
  const m = route.query.month;
  return typeof m === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(m) ? m : currentMonth();
}

const monthModel = computed({
  get: () => cal.month,
  set: (v: string | null) => {
    if (v) void go(v);
  },
});

async function go(month: string) {
  await cal.loadPlan(month);
}

// 月份写回地址栏，刷新页面后停留在当前月
watch(
  () => cal.month,
  (m) => {
    if (route.name === "calendar" && route.query.month !== m) void router.replace({ query: { ...route.query, month: m } });
  },
);

let mounted = false;

onMounted(async () => {
  await Promise.all([cal.loadPlan(queryMonth()), cal.loadSubmissions()]);
  mounted = true;
});

// KeepAlive 切回时，素材库中可能已新增 / 修改投稿
onActivated(() => {
  if (!mounted) return;
  const target = queryMonth();
  if (route.query.month && target !== cal.month) void cal.loadPlan(target);
  else void cal.refresh();
});

watch(
  () => app.refreshTick,
  () => {
    if (route.name === "calendar") void cal.refresh();
  },
);

const statusText = computed(() => (cal.locked ? "已锁定" : "草稿"));
const entryCount = computed(() => cal.plan?.entries.length ?? 0);
</script>

<template>
  <div class="calendar">
    <UnscheduledList class="left" />

    <main class="center">
      <div class="toolbar">
        <div class="month-nav">
          <NButton quaternary circle size="small" aria-label="上一月" @click="go(shiftMonth(cal.month, -1))">
            <template #icon><ChevronLeft :size="16" /></template>
          </NButton>
          <NDatePicker
            v-model:formatted-value="monthModel"
            type="month"
            value-format="yyyy-MM"
            format="yyyy 年 MM 月"
            size="small"
            :clearable="false"
            class="month-picker"
          />
          <NButton quaternary circle size="small" aria-label="下一月" @click="go(shiftMonth(cal.month, 1))">
            <template #icon><ChevronRight :size="16" /></template>
          </NButton>
          <NButton size="small" quaternary @click="go(currentMonth())">本月</NButton>
        </div>
        <div class="plan-meta">
          <span class="status" :class="{ locked: cal.locked }">
            <Lock v-if="cal.locked" :size="11" />{{ statusText }}
          </span>
          <span class="faint">{{ entryCount }} 个排期 · {{ cal.plan?.timezone || "Asia/Shanghai" }}</span>
        </div>
        <span class="spacer" />
        <span class="faint hint">双击日期新建 · 拖动条目改期</span>
        <NButton size="small" type="primary" :disabled="cal.locked || !cal.plan" @click="cal.resetForm()">
          <template #icon><CalendarPlus :size="14" /></template>新建排期
        </NButton>
      </div>
      <MonthGrid class="month-grid" />
    </main>

    <aside class="right">
      <EntryForm />
      <SubmissionDetailCard />
    </aside>
  </div>
</template>

<style scoped>
.calendar {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr) 380px;
  height: calc(100vh - 48px);
  overflow: hidden;
}

.left {
  min-height: 0;
}

.center {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 52px;
  padding: 0 14px;
  border-bottom: 1px solid var(--border);
}

.month-nav {
  display: flex;
  align-items: center;
  gap: 4px;
}

.month-picker {
  width: 150px;
}

.plan-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.status {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 0 6px;
  border-radius: 4px;
  background: var(--surface-3);
  color: var(--text-muted);
  font-size: 11px;
  line-height: 18px;
}

.status.locked {
  background: var(--warning-soft);
  color: var(--warning);
}

.spacer {
  flex: 1;
}

.hint {
  font-size: 11px;
}

.month-grid {
  flex: 1;
  min-height: 0;
}

.right {
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-height: 0;
  padding: 14px;
  overflow-y: auto;
  border-left: 1px solid var(--border);
  background: var(--surface);
}

@media (max-width: 1280px) {
  .calendar {
    grid-template-columns: 220px minmax(0, 1fr) 340px;
  }

  .hint {
    display: none;
  }
}

@media (max-width: 960px) {
  .calendar {
    grid-template-columns: minmax(0, 1fr);
    grid-auto-rows: auto;
    height: auto;
    overflow: visible;
  }

  .left {
    max-height: 280px;
    border-right: none;
    border-bottom: 1px solid var(--border);
  }

  .month-grid {
    min-height: 640px;
  }

  .right {
    border-left: none;
    border-top: 1px solid var(--border);
  }
}
</style>
