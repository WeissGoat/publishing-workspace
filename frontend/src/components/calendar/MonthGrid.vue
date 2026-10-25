<script setup lang="ts">
import { AlarmClock, Check } from "@lucide/vue";
import { computed, ref } from "vue";
import type { ScheduleEntry } from "@/api";
import { useCalendarStore } from "@/stores/calendar";
import { formatDateTime, localDateString } from "@/utils/format";
import { ENTRY_MIME, TASK_MIME } from "./shared";

const cal = useCalendarStore();

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

interface Cell {
  key: string;
  day: number;
  date: string | null;
  weekend: boolean;
  today: boolean;
}

const cells = computed<Cell[]>(() => {
  const [y, m] = cal.month.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const lead = (first.getDay() + 6) % 7; // 周一为第一列
  const days = new Date(y, m, 0).getDate();
  const prevDays = new Date(y, m - 1, 0).getDate();
  const today = localDateString(new Date());
  const out: Cell[] = [];
  for (let i = lead - 1; i >= 0; i--) out.push({ key: `p${i}`, day: prevDays - i, date: null, weekend: false, today: false });
  for (let d = 1; d <= days; d++) {
    const date = `${cal.month}-${String(d).padStart(2, "0")}`;
    const col = (lead + d - 1) % 7;
    out.push({ key: date, day: d, date, weekend: col >= 5, today: date === today });
  }
  const tail = (7 - (out.length % 7)) % 7;
  for (let i = 1; i <= tail; i++) out.push({ key: `n${i}`, day: i, date: null, weekend: false, today: false });
  return out;
});

type EntryState = "published" | "scheduled" | "legacy" | "draft";

function entryInfo(entry: ScheduleEntry): { state: EntryState; count: number | null; tip: string } {
  const time = entry.scheduled_at.slice(11, 16);
  if (entry.content.kind === "inline_selection") {
    const sets = entry.content.sets;
    return {
      state: entry.execution?.publish ? "scheduled" : "legacy",
      count: (sets.all?.length || sets.post?.length) ?? 0,
      tip: `${time} ${entry.title}（旧格式散图）`,
    };
  }
  const sub = cal.submissionIndex.get(entry.content.task_id);
  const count = sub?.counts ? (sub.counts.all ?? sub.counts.post ?? 0) : null;
  if (sub?.pixiv?.illust_id) {
    const at = sub.pixiv.published_at ? `\n实际发布：${formatDateTime(sub.pixiv.published_at)}` : "";
    return { state: "published", count, tip: `${time} ${entry.title}\n已发布到 Pixiv（PID ${sub.pixiv.illust_id}）${at}` };
  }
  if (entry.execution?.publish) return { state: "scheduled", count, tip: `${time} ${entry.title}\n已开启定时自动发布` };
  return { state: "draft", count, tip: `${time} ${entry.title}` };
}

const dropTarget = ref<string | null>(null);

function onDragStart(e: DragEvent, entry: ScheduleEntry) {
  if (cal.locked || !e.dataTransfer) return;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData(ENTRY_MIME, entry.entry_id);
  e.dataTransfer.setData("text/plain", entry.title);
}

function accepts(e: DragEvent): boolean {
  const types = e.dataTransfer?.types ?? [];
  return !cal.locked && (types.includes(ENTRY_MIME) || types.includes(TASK_MIME));
}

function onDragOver(e: DragEvent, date: string) {
  if (!accepts(e)) return;
  e.preventDefault();
  dropTarget.value = date;
}

function onDrop(e: DragEvent, date: string) {
  dropTarget.value = null;
  if (!accepts(e) || !e.dataTransfer) return;
  e.preventDefault();
  const entryId = e.dataTransfer.getData(ENTRY_MIME);
  const taskId = e.dataTransfer.getData(TASK_MIME);
  if (entryId) void cal.moveEntry(entryId, date);
  else if (taskId) void cal.scheduleTask(taskId, date);
}

function onDblClick(date: string) {
  if (!cal.locked) cal.resetForm(date);
}
</script>

<template>
  <div class="month">
    <div class="weekdays">
      <div v-for="(w, i) in WEEKDAYS" :key="w" class="weekday" :class="{ weekend: i >= 5 }">周{{ w }}</div>
    </div>
    <div class="days" :style="{ gridTemplateRows: `repeat(${cells.length / 7}, minmax(110px, 1fr))` }">
      <div
        v-for="c in cells"
        :key="c.key"
        class="cell"
        :class="{ other: !c.date, weekend: c.weekend, today: c.today, over: c.date && dropTarget === c.date }"
        @dragover="c.date && onDragOver($event, c.date)"
        @dragleave="dropTarget === c.date && (dropTarget = null)"
        @drop="c.date && onDrop($event, c.date)"
        @dblclick.self="c.date && onDblClick(c.date)"
      >
        <div class="cell-head" @dblclick="c.date && onDblClick(c.date)">
          <span class="day">{{ c.day }}</span>
          <span v-if="c.today" class="today-tag">今天</span>
        </div>
        <template v-if="c.date">
          <button
            v-for="entry in cal.entriesByDate.get(c.date) ?? []"
            :key="entry.entry_id"
            type="button"
            class="entry"
            :class="[entryInfo(entry).state, { selected: cal.selectedEntryId === entry.entry_id }]"
            :draggable="!cal.locked"
            :title="entryInfo(entry).tip"
            @dragstart="onDragStart($event, entry)"
            @click.stop="cal.selectEntry(entry)"
          >
            <span class="entry-title truncate">{{ entry.title }}</span>
            <span class="entry-meta">
              <span class="time">{{ entry.scheduled_at.slice(11, 16) }}</span>
              <span v-if="entry.content.kind === 'inline_selection'" class="tag legacy">散图</span>
              <span v-if="entryInfo(entry).count !== null" class="tag">{{ entryInfo(entry).count }} 图</span>
              <span v-if="entryInfo(entry).state === 'published'" class="tag ok"><Check :size="10" />Pixiv</span>
              <span v-else-if="entryInfo(entry).state === 'scheduled'" class="tag info"><AlarmClock :size="10" />定时</span>
            </span>
          </button>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.month {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}

.weekdays {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  border-bottom: 1px solid var(--border);
}

.weekday {
  padding: 6px 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
}

.weekday.weekend {
  color: var(--primary);
}

.days {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  min-height: 0;
  overflow-y: auto;
}

.cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 6px;
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  overflow: hidden;
  transition: background 0.1s;
}

.cell:nth-child(7n) {
  border-right: none;
}

.cell.weekend {
  background: color-mix(in srgb, var(--surface-2) 50%, transparent);
}

.cell.other {
  background: transparent;
  opacity: 0.35;
}

.cell.over {
  background: var(--primary-soft);
  box-shadow: inset 0 0 0 2px var(--primary);
}

.cell-head {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: default;
}

.day {
  display: inline-grid;
  place-items: center;
  min-width: 22px;
  height: 22px;
  border-radius: 11px;
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
}

.today .day {
  background: var(--primary);
  color: #fff;
}

.today-tag {
  font-size: 11px;
  color: var(--primary);
}

.entry {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-left: 3px solid var(--text-faint);
  border-radius: 6px;
  background: var(--surface-2);
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.entry:hover {
  border-color: var(--border-strong);
}

.entry.published {
  border-left-color: var(--success);
}

.entry.scheduled {
  border-left-color: var(--primary);
}

.entry.legacy {
  border-left-color: var(--warning);
}

.entry.selected {
  border-color: var(--primary);
  box-shadow: 0 0 0 2px var(--primary-soft);
}

.entry-title {
  font-size: 12px;
  font-weight: 500;
}

.entry-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  color: var(--text-muted);
}

.time {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
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

.tag.info {
  background: var(--primary-soft);
  color: var(--primary);
}

.tag.legacy {
  background: var(--warning-soft);
  color: var(--warning);
}
</style>
