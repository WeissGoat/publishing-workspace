import { defineStore } from "pinia";
import { computed, reactive, ref } from "vue";
import {
  api,
  ApiError,
  type LatestBuild,
  type MonthlyPlan,
  type ScheduleEntry,
  type Sets,
  type SubmissionDetail,
  type SubmissionSummary,
} from "@/api";
import { confirmDialog, errorText, notify } from "@/composables/notify";
import { currentMonth, splitScheduledAt, toScheduledAt } from "@/utils/format";

export interface EntryForm {
  entry_id: string | null;
  title: string;
  date: string;
  time: string;
  task_id: string | null;
  publish: boolean;
  allow_delay: boolean;
  max_delay_minutes: number;
}

/** 右侧详情卡：正式投稿任务，或月度计划中的旧格式散图。 */
export type DetailCard =
  | { kind: "task"; data: SubmissionDetail; build: LatestBuild | null }
  | { kind: "inline"; entryId: string; title: string; sets: Sets };

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function conflictText(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.status === 409) return "计划已被更新（revision 冲突），请刷新后重试";
  return `${fallback}：${errorText(err)}`;
}

export const useCalendarStore = defineStore("calendar", () => {
  const month = ref(currentMonth());
  const plan = ref<MonthlyPlan | null>(null);
  const submissions = ref<SubmissionSummary[]>([]);
  const loading = ref(false);
  const selectedEntryId = ref<string | null>(null);
  const selectedTaskId = ref<string | null>(null);
  const search = ref("");
  const form = reactive<EntryForm>(emptyForm());
  const detail = ref<DetailCard | null>(null);
  const detailLoading = ref(false);
  const busy = reactive({ saving: false, publishing: false, scheduling: false });

  const locked = computed(() => plan.value?.status === "locked");
  const submissionIndex = computed(() => new Map(submissions.value.map((s) => [s.task_id, s])));
  const unscheduled = computed(() => {
    const q = search.value.trim().toLowerCase();
    return submissions.value.filter((s) => {
      if (s.scheduled_entries?.length) return false;
      if (!q) return true;
      return (s.title || "").toLowerCase().includes(q) || s.task_id.toLowerCase().includes(q);
    });
  });
  const unscheduledTotal = computed(() => submissions.value.filter((s) => !s.scheduled_entries?.length).length);
  const entriesByDate = computed(() => {
    const map = new Map<string, ScheduleEntry[]>();
    for (const e of plan.value?.entries ?? []) {
      if (!e.scheduled_at) continue;
      const key = e.scheduled_at.slice(0, 10);
      const list = map.get(key) ?? [];
      list.push(e);
      map.set(key, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
    return map;
  });
  const selectedEntry = computed(() => plan.value?.entries.find((e) => e.entry_id === selectedEntryId.value) ?? null);

  function emptyForm(date = ""): EntryForm {
    return {
      entry_id: null,
      title: "",
      date,
      time: "20:00",
      task_id: null,
      publish: false,
      allow_delay: false,
      max_delay_minutes: 240,
    };
  }

  async function loadSubmissions() {
    try {
      submissions.value = await api.submissions();
    } catch (err) {
      notify.error(`加载投稿列表失败：${errorText(err)}`);
    }
  }

  async function loadPlan(target: string, keepSelection = false) {
    if (!MONTH_RE.test(target)) return;
    loading.value = true;
    try {
      const data = await api.plan(target);
      month.value = target;
      plan.value = data;
      if (!keepSelection) resetForm();
    } catch (err) {
      notify.error(`加载计划失败：${errorText(err)}`);
    } finally {
      loading.value = false;
    }
  }

  async function refresh() {
    await Promise.all([loadPlan(month.value, true), loadSubmissions()]);
    if (detail.value?.kind === "task") void loadDetail(detail.value.data.task_id);
  }

  function resetForm(date?: string) {
    Object.assign(form, emptyForm(date ?? `${month.value}-01`));
    selectedEntryId.value = null;
    selectedTaskId.value = null;
    detail.value = null;
  }

  function selectEntry(entry: ScheduleEntry) {
    selectedEntryId.value = entry.entry_id;
    selectedTaskId.value = null;
    const { date, time } = splitScheduledAt(entry.scheduled_at);
    const exec = entry.execution;
    Object.assign(form, {
      entry_id: entry.entry_id,
      title: entry.title || "",
      date,
      time,
      task_id: entry.content.kind === "task" ? entry.content.task_id : null,
      publish: Boolean(exec?.publish),
      allow_delay: Boolean(exec?.allow_delay),
      max_delay_minutes: exec?.allow_delay ? exec.max_delay_minutes || 240 : 240,
    });
    if (entry.content.kind === "task") void loadDetail(entry.content.task_id);
    else detail.value = { kind: "inline", entryId: entry.entry_id, title: entry.title, sets: entry.content.sets };
  }

  function selectUnscheduled(sub: SubmissionSummary) {
    selectedEntryId.value = null;
    selectedTaskId.value = sub.task_id;
    Object.assign(form, {
      ...emptyForm(form.date || `${month.value}-01`),
      title: sub.title || sub.task_id,
      task_id: sub.task_id,
    });
    void loadDetail(sub.task_id);
  }

  function setFormTask(taskId: string | null) {
    form.task_id = taskId;
    if (!taskId) {
      detail.value = null;
      return;
    }
    if (!form.title.trim()) form.title = submissionIndex.value.get(taskId)?.title || taskId;
    void loadDetail(taskId);
  }

  async function loadDetail(taskId: string) {
    detailLoading.value = true;
    try {
      const [data, build] = await Promise.all([api.submission(taskId), api.latestBuild(taskId).catch(() => null)]);
      // 期间用户可能已切换到别的条目
      const stillWanted = form.task_id === taskId || selectedTaskId.value === taskId;
      if (stillWanted) detail.value = { kind: "task", data, build: build?.has_build ? build : null };
    } catch (err) {
      notify.error(`加载投稿详情失败：${errorText(err)}`);
      detail.value = null;
    } finally {
      detailLoading.value = false;
    }
  }

  async function afterPlanChange(result: MonthlyPlan, targetMonth: string, entryId: string | null) {
    if (targetMonth !== month.value) {
      await loadPlan(targetMonth, true);
    } else {
      plan.value = result;
    }
    const updated = entryId ? plan.value?.entries.find((e) => e.entry_id === entryId) : null;
    if (updated) selectEntry(updated);
    void loadSubmissions();
  }

  async function saveForm() {
    if (!plan.value || locked.value) return;
    const title = form.title.trim();
    if (!title || !form.date) {
      notify.warning("请填写标题和日期");
      return;
    }
    const isEdit = Boolean(form.entry_id);
    const entry: ScheduleEntry = {
      entry_id: form.entry_id ?? `entry-${Date.now().toString(36)}`,
      scheduled_at: toScheduledAt(form.date, form.time),
      title,
      content: form.task_id
        ? { kind: "task", task_id: form.task_id }
        : selectedEntry.value?.content.kind === "inline_selection"
          ? selectedEntry.value.content
          : { kind: "inline_selection", sets: { all: [], post: [], cover: [] } },
      execution: {
        build_on_due: true,
        notify_on_complete: true,
        publish: form.publish,
        allow_delay: form.allow_delay,
        max_delay_minutes: form.max_delay_minutes || 240,
      },
    };
    busy.saving = true;
    try {
      const result = isEdit
        ? await api.updateEntry(month.value, plan.value.revision, entry)
        : await api.createEntry(month.value, plan.value.revision, entry);
      notify.success(isEdit ? "排期已更新" : "排期已创建");
      await afterPlanChange(result, form.date.slice(0, 7), entry.entry_id);
    } catch (err) {
      notify.error(conflictText(err, "保存排期失败"));
    } finally {
      busy.saving = false;
    }
  }

  async function deleteEntry() {
    if (!plan.value || !form.entry_id || locked.value) return;
    const ok = await confirmDialog({ title: "删除排期", content: `确定删除排期「${form.title}」吗？`, positiveText: "删除", danger: true });
    if (!ok) return;
    try {
      plan.value = await api.deleteEntry(month.value, form.entry_id, plan.value.revision);
      notify.success("排期已删除");
      resetForm();
      void loadSubmissions();
    } catch (err) {
      notify.error(conflictText(err, "删除排期失败"));
    }
  }

  async function moveEntry(entryId: string, targetDate: string) {
    if (!plan.value || locked.value) return;
    const entry = plan.value.entries.find((e) => e.entry_id === entryId);
    if (!entry || entry.scheduled_at.startsWith(targetDate)) return;
    try {
      const result = await api.moveEntry(month.value, entryId, plan.value.revision, targetDate);
      notify.info(`已将排期移动至 ${targetDate}`);
      await afterPlanChange(result, targetDate.slice(0, 7), selectedEntryId.value === entryId ? entryId : null);
    } catch (err) {
      notify.error(conflictText(err, "移动排期失败"));
    }
  }

  /** 把待排期投稿拖到某天：默认 20:00、不自动发布。 */
  async function scheduleTask(taskId: string, date: string) {
    const sub = submissionIndex.value.get(taskId);
    if (!sub || !plan.value || locked.value) return;
    const entry: ScheduleEntry = {
      entry_id: `entry-${taskId}`,
      scheduled_at: toScheduledAt(date, "20:00"),
      title: sub.title || taskId,
      content: { kind: "task", task_id: taskId },
      execution: { build_on_due: true, notify_on_complete: true, publish: false },
    };
    try {
      const result = await api.createEntry(month.value, plan.value.revision, entry);
      notify.success(`已将「${sub.title || taskId}」安排在 ${date} 20:00`);
      await afterPlanChange(result, date.slice(0, 7), entry.entry_id);
    } catch (err) {
      notify.error(conflictText(err, "排期失败"));
    }
  }

  async function deleteSubmission() {
    const d = detail.value;
    if (d?.kind !== "task") return;
    const title = d.data.title || d.data.task_id;
    const ok = await confirmDialog({
      title: "删除投稿",
      content: `确定删除投稿「${title}」吗？\n将彻底移除该投稿任务及月度排期，并清理不再被引用的图片的「已投稿」标记。`,
      positiveText: "删除",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteSubmission(d.data.task_id);
      notify.success(`已删除投稿「${title}」`);
      resetForm();
      await Promise.all([loadPlan(month.value, true), loadSubmissions()]);
    } catch (err) {
      notify.error(`删除投稿失败：${errorText(err)}`);
    }
  }

  async function publishNow() {
    const d = detail.value;
    if (d?.kind !== "task") return;
    const title = d.data.title || d.data.task_id;
    const ok = await confirmDialog({ title: "立即发布", content: `确定立即将「${title}」发布到 Pixiv 吗？` });
    if (!ok) return;
    busy.publishing = true;
    try {
      const result = await api.publishPixiv(d.data.task_id, false);
      notify.success(result.message || "发布成功");
      await Promise.all([loadDetail(d.data.task_id), loadSubmissions()]);
    } catch (err) {
      notify.error(`发布失败：${errorText(err)}`);
    } finally {
      busy.publishing = false;
    }
  }

  async function toggleSchedulePublish(allowDelay: boolean, maxDelayMinutes: number) {
    const d = detail.value;
    if (d?.kind !== "task") return;
    const enabling = !d.data.scheduled_publish;
    let scheduledAt = d.data.scheduled_at ?? null;
    if (enabling && !scheduledAt) {
      if (!form.date) {
        notify.warning("请先设置排期日期和时间后再开启定时发布");
        return;
      }
      scheduledAt = toScheduledAt(form.date, form.time);
    }
    busy.scheduling = true;
    try {
      const result = await api.schedulePublish(d.data.task_id, {
        enable: enabling,
        scheduled_at: scheduledAt,
        allow_delay: allowDelay,
        max_delay_minutes: maxDelayMinutes || 240,
      });
      notify.success(result.message || (enabling ? "已开启定时发布" : "已取消定时发布"));
      await loadPlan(month.value, true);
      const entry = selectedEntryId.value ? plan.value?.entries.find((e) => e.entry_id === selectedEntryId.value) : null;
      if (entry) selectEntry(entry);
      else await loadDetail(d.data.task_id);
      void loadSubmissions();
    } catch (err) {
      notify.error(`定时发布设置失败：${errorText(err)}`);
    } finally {
      busy.scheduling = false;
    }
  }

  async function openBuildDir(taskId: string) {
    try {
      await api.openLatestBuild(taskId);
      notify.info("已在资源管理器中打开导出目录");
    } catch (err) {
      notify.error(`打开导出目录失败：${errorText(err)}`);
    }
  }

  return {
    month,
    plan,
    submissions,
    loading,
    selectedEntryId,
    selectedTaskId,
    search,
    form,
    detail,
    detailLoading,
    busy,
    locked,
    submissionIndex,
    unscheduled,
    unscheduledTotal,
    entriesByDate,
    selectedEntry,
    loadSubmissions,
    loadPlan,
    refresh,
    resetForm,
    selectEntry,
    selectUnscheduled,
    setFormTask,
    loadDetail,
    saveForm,
    deleteEntry,
    moveEntry,
    scheduleTask,
    deleteSubmission,
    publishNow,
    toggleSchedulePublish,
    openBuildDir,
  };
});
