import { useLocalStorage } from "@vueuse/core";
import { defineStore } from "pinia";
import { computed, reactive, ref } from "vue";
import {
  api,
  ApiError,
  SET_NAMES,
  type ExportJob,
  type LatestBuild,
  type PixivMetadata,
  type SetName,
  type Sets,
  type SubmissionDetail,
  type SubmissionMutation,
  type SubmissionSummary,
} from "@/api";
import { confirmDialog, errorText, notify } from "@/composables/notify";
import { splitScheduledAt, toScheduledAt } from "@/utils/format";

const MAX_TAGS = 10;

interface LegacySource {
  plan_id: string;
  entry_id: string;
  plan_revision: number;
}

export interface EditingSubmission {
  task_id: string | null;
  title: string;
  source_import_id: string | null;
  revision: number;
  sets: Sets;
  pixiv: PixivMetadata;
  scheduled_at: string | null;
  scheduled_publish: boolean;
  allow_delay: boolean;
  max_delay_minutes: number;
  legacySource: LegacySource | null;
}

function emptyPixiv(title = ""): PixivMetadata {
  return {
    title,
    caption: "",
    tags: [],
    suggested_tags: [],
    r18: true,
    allow_tag_edit: true,
    crop_x: null,
    crop_y: null,
    illust_id: null,
    published_at: null,
    last_publish_status: null,
    last_publish_error: null,
  };
}

function emptySubmission(sourceImportId: string | null = null): EditingSubmission {
  return {
    task_id: null,
    title: "",
    source_import_id: sourceImportId,
    revision: 1,
    sets: { all: [], post: [], cover: [] },
    pixiv: emptyPixiv(),
    scheduled_at: null,
    scheduled_publish: false,
    allow_delay: false,
    max_delay_minutes: 240,
    legacySource: null,
  };
}

function fromDetail(data: SubmissionDetail, keepSchedule?: Partial<EditingSubmission>): EditingSubmission {
  const pixiv = data.pixiv
    ? {
        ...emptyPixiv(data.title),
        ...data.pixiv,
        title: data.pixiv.title || data.title,
        tags: [...(data.pixiv.tags ?? [])],
        suggested_tags: [...(data.pixiv.suggested_tags ?? [])],
        r18: data.pixiv.r18 !== false,
        allow_tag_edit: data.pixiv.allow_tag_edit !== false,
        crop_x: data.pixiv.crop_x ?? null,
        crop_y: data.pixiv.crop_y ?? null,
      }
    : emptyPixiv(data.title);
  return {
    task_id: data.task_id,
    title: data.title ?? "",
    source_import_id: data.source_import_id ?? null,
    revision: data.revision ?? 1,
    sets: { all: [...(data.sets?.all ?? [])], post: [...(data.sets?.post ?? [])], cover: [...(data.sets?.cover ?? [])] },
    pixiv,
    scheduled_at: data.scheduled_at ?? keepSchedule?.scheduled_at ?? null,
    scheduled_publish: data.scheduled_publish ?? keepSchedule?.scheduled_publish ?? false,
    allow_delay: data.allow_delay ?? keepSchedule?.allow_delay ?? false,
    max_delay_minutes: Number(data.max_delay_minutes ?? keepSchedule?.max_delay_minutes ?? 240),
    legacySource: null,
  };
}

export const useSubmissionStore = defineStore("submission", () => {
  const drawerOpen = useLocalStorage("pw_basket_open", false);
  const history = ref<SubmissionSummary[]>([]);
  const current = ref<EditingSubmission>(emptySubmission());
  const activeSet = ref<SetName>("all");
  const scheduleDate = ref("");
  const scheduleTime = ref("20:00");
  const suggestions = reactive({ preset: [] as string[], character: [] as string[], action: [] as string[], pixiv: [] as string[] });
  const busy = reactive({ saving: false, publishing: false, scheduling: false, suggesting: false, syncingTags: false });

  const exportJob = ref<ExportJob | null>(null);
  const latestBuild = ref<LatestBuild | null>(null);
  const exportTab = ref<SetName>("all");
  const mosaicEnabled = ref(true);
  const mosaicPixelSize = useLocalStorage("export_mosaic_pixel_size", 10);
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  const isEditing = computed(() => Boolean(current.value.task_id));
  const totalCount = computed(() => current.value.sets.all.length);
  const coverAssetId = computed(
    () => current.value.sets.cover[0] ?? current.value.sets.all[0] ?? current.value.sets.post[0] ?? null,
  );
  const exporting = computed(() => exportJob.value?.status === "queued" || exportJob.value?.status === "running");
  const hasContent = computed(
    () => Boolean(current.value.task_id) || (current.value.sets.all.length > 0 && current.value.title.trim().length > 0),
  );

  function applySchedule() {
    const { date, time } = splitScheduledAt(current.value.scheduled_at);
    scheduleDate.value = date;
    scheduleTime.value = time;
  }

  function scheduledAtFromForm(): string | null {
    return scheduleDate.value ? toScheduledAt(scheduleDate.value, scheduleTime.value) : null;
  }

  async function loadHistory() {
    try {
      history.value = await api.submissions();
    } catch (err) {
      notify.error(`加载历史投稿失败：${errorText(err)}`);
    }
  }

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  function reset(sourceImportId: string | null = null) {
    stopPolling();
    current.value = emptySubmission(sourceImportId);
    activeSet.value = "all";
    applySchedule();
    Object.assign(suggestions, { preset: [], character: [], action: [], pixiv: [] });
    exportJob.value = null;
    latestBuild.value = null;
    mosaicEnabled.value = true;
  }

  async function load(taskId: string) {
    try {
      const data = await api.submission(taskId);
      stopPolling();
      current.value = fromDetail(data);
      activeSet.value = "all";
      applySchedule();
      suggestions.pixiv = [...current.value.pixiv.suggested_tags];
      exportJob.value = null;
      drawerOpen.value = true;
      void loadLatestBuild();
      void fetchSuggestions(current.value.sets.all, false);
    } catch (err) {
      notify.error(`加载投稿失败：${errorText(err)}`);
    }
  }

  /** 从月度计划的旧格式散图载入，保存时创建正式任务并关联回计划。 */
  async function loadLegacyFromPlan(planId: string, entryId: string) {
    try {
      const plan = await api.plan(planId);
      const entry = plan.entries.find((e) => e.entry_id === entryId);
      if (!entry || entry.content.kind !== "inline_selection") return;
      reset(entry.content.source_import_id ?? null);
      current.value.title = entry.title || "从计划导入的散图";
      current.value.sets = {
        all: [...(entry.content.sets.all ?? [])],
        post: [...(entry.content.sets.post ?? [])],
        cover: [...(entry.content.sets.cover ?? [])],
      };
      current.value.legacySource = { plan_id: planId, entry_id: entryId, plan_revision: plan.revision };
      drawerOpen.value = true;
    } catch (err) {
      notify.error(`从计划加载散图失败：${errorText(err)}`);
    }
  }

  async function newFromSelection(ids: string[], sourceImportId: string | null): Promise<boolean> {
    if (!ids.length) {
      notify.warning("请先选择要投稿的素材");
      return false;
    }
    if (hasContent.value) {
      const ok = await confirmDialog({
        title: "新建投稿",
        content: "当前正在编辑投稿，确定以选中的素材重新开始一个新投稿吗？",
      });
      if (!ok) return false;
    }
    reset(sourceImportId);
    current.value.sets.all = [...ids];
    current.value.sets.post = [...ids];
    drawerOpen.value = true;
    notify.success(`已用 ${ids.length} 张素材创建新投稿`);
    void fetchSuggestions(ids, true);
    return true;
  }

  function addToSet(ids: string[]): number {
    const list = current.value.sets[activeSet.value];
    let added = 0;
    for (const id of ids) {
      if (!list.includes(id)) {
        list.push(id);
        added += 1;
      }
    }
    drawerOpen.value = true;
    notify.info(`已将 ${added} 张素材加入「${activeSet.value}」集合`);
    if (!current.value.task_id) void fetchSuggestions(current.value.sets.all, true);
    return added;
  }

  function removeAt(set: SetName, index: number) {
    current.value.sets[set].splice(index, 1);
  }

  function move(set: SetName, from: number, to: number) {
    const list = current.value.sets[set];
    if (to < 0 || to >= list.length || from === to) return;
    const [item] = list.splice(from, 1);
    list.splice(to, 0, item);
  }

  function clearSet(set: SetName) {
    current.value.sets[set] = [];
    notify.info(`已清空「${set}」集合`);
  }

  async function fetchSuggestions(ids: string[], isNew: boolean) {
    if (!ids.length) {
      Object.assign(suggestions, { preset: [], character: [], action: [] });
      return;
    }
    busy.suggesting = true;
    try {
      const data = await api.generateMetadata(ids, current.value.source_import_id);
      if (isNew && !current.value.title.trim() && data.title) current.value.title = data.title;
      if (isNew && !current.value.pixiv.caption.trim() && data.caption) current.value.pixiv.caption = data.caption;
      suggestions.preset = data.tag_suggestions?.preset ?? [];
      suggestions.character = data.tag_suggestions?.character ?? [];
      suggestions.action = data.tag_suggestions?.action ?? [];
    } catch {
      // 推荐失败不影响编辑
    } finally {
      busy.suggesting = false;
    }
  }

  function addTag(tag: string) {
    const text = tag.trim();
    const tags = current.value.pixiv.tags;
    if (!text || tags.includes(text)) return;
    if (tags.length >= MAX_TAGS) {
      notify.warning("Pixiv 投稿最多支持 10 个标签");
      return;
    }
    tags.push(text);
  }

  function removeTag(tag: string) {
    current.value.pixiv.tags = current.value.pixiv.tags.filter((t) => t !== tag);
  }

  function buildPayload(): SubmissionMutation {
    const sub = current.value;
    const title = sub.title.trim();
    return {
      title,
      revision: sub.task_id ? sub.revision : null,
      source_import_id: sub.source_import_id,
      sets: sub.sets,
      pixiv: { ...sub.pixiv, title, suggested_tags: sub.pixiv.suggested_tags.length ? sub.pixiv.suggested_tags : suggestions.pixiv },
      scheduled_at: scheduledAtFromForm(),
    };
  }

  async function associateLegacy(taskId: string, source: LegacySource) {
    try {
      const plan = await api.plan(source.plan_id);
      const entry = plan.entries.find((e) => e.entry_id === source.entry_id);
      if (!entry) return;
      await api.updateEntry(source.plan_id, plan.revision, {
        entry_id: entry.entry_id,
        scheduled_at: entry.scheduled_at,
        title: entry.title,
        content: { kind: "task", task_id: taskId },
        execution: entry.execution,
      });
      notify.info(`已将任务 ${taskId} 关联到月度计划 ${source.plan_id}`);
    } catch (err) {
      notify.warning(`关联月度计划失败：${errorText(err)}`);
    }
  }

  /** 保存投稿；校验失败或请求失败时提示并返回 null。 */
  async function save(successText?: string): Promise<SubmissionDetail | null> {
    const sub = current.value;
    if (!sub.title.trim()) {
      notify.warning("投稿标题不能为空");
      return null;
    }
    if (!sub.sets.all.length) {
      notify.warning("all 集合不能为空");
      return null;
    }
    busy.saving = true;
    try {
      const payload = buildPayload();
      const saved = sub.task_id ? await api.updateSubmission(sub.task_id, payload) : await api.createSubmission(payload);
      const legacy = sub.legacySource;
      current.value = fromDetail(saved, {
        scheduled_at: payload.scheduled_at,
        scheduled_publish: sub.scheduled_publish,
        allow_delay: sub.allow_delay,
        max_delay_minutes: sub.max_delay_minutes,
      });
      applySchedule();
      if (legacy) await associateLegacy(saved.task_id, legacy);
      notify.success(
        successText ??
          (payload.scheduled_at
            ? `投稿已保存，已同步排期到日历（${scheduleDate.value} ${scheduleTime.value}）`
            : `投稿已保存：${saved.task_id}`),
      );
      void loadHistory();
      return saved;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) notify.error("投稿已在别处更新（revision 冲突），请重新载入后再保存");
      else notify.error(`保存投稿失败：${errorText(err)}`);
      return null;
    } finally {
      busy.saving = false;
    }
  }

  async function remove(): Promise<string[]> {
    const sub = current.value;
    if (!sub.task_id) return [];
    const ok = await confirmDialog({
      title: "删除投稿",
      content: `确定删除投稿「${sub.title || sub.task_id}」吗？\n将移除该投稿的选集与导出产物，并清理不再被其他投稿引用的图片的「已投稿」标记。`,
      positiveText: "删除",
      danger: true,
    });
    if (!ok) return [];
    try {
      const result = await api.deleteSubmission(sub.task_id);
      notify.success(`已删除投稿「${sub.title || sub.task_id}」`);
      reset();
      void loadHistory();
      return result.unmarked_asset_ids ?? [];
    } catch (err) {
      notify.error(`删除投稿失败：${errorText(err)}`);
      return [];
    }
  }

  function ensureTags(): boolean {
    const pixiv = current.value.pixiv;
    if (pixiv.tags.length) return true;
    if (pixiv.suggested_tags.length) {
      pixiv.tags = pixiv.suggested_tags.slice(0, MAX_TAGS);
      notify.info("已自动应用推荐标签");
      return true;
    }
    return false;
  }

  async function publish(forceRepublish = false) {
    const sub = current.value;
    if (!sub.task_id) {
      notify.warning("请先保存投稿后再发布到 Pixiv");
      return;
    }
    if (!ensureTags()) {
      notify.warning("请至少添加 1 个 Pixiv 标签后再发布");
      return;
    }
    if (forceRepublish) {
      const ok = await confirmDialog({
        title: "重新发布",
        content: "该投稿已在 Pixiv 发布过，确定要再次上传并创建为新作品吗？",
      });
      if (!ok) return;
    }
    busy.publishing = true;
    try {
      // 发布前保存当前设置
      const saved = await save("已保存投稿，开始发布");
      if (!saved) return;
      const result = await api.publishPixiv(saved.task_id, forceRepublish);
      current.value.pixiv.illust_id = result.illust_id;
      current.value.pixiv.published_at = result.published_at;
      current.value.pixiv.last_publish_status = "success";
      notify.success(result.message || "发布成功");
      void loadHistory();
    } catch (err) {
      notify.error(`发布到 Pixiv 失败：${errorText(err)}`);
    } finally {
      busy.publishing = false;
    }
  }

  async function toggleSchedule() {
    const sub = current.value;
    if (!sub.task_id) {
      notify.warning("请先保存投稿后再开启定时发布");
      return;
    }
    const enabling = !sub.scheduled_publish;
    if (enabling) {
      if (!scheduleDate.value) {
        notify.warning("请先设置排期日期与时间");
        return;
      }
      if (!ensureTags()) {
        notify.warning("请至少添加 1 个 Pixiv 标签后再开启定时发布");
        return;
      }
      const saved = await save("已保存投稿与排期");
      if (!saved) return;
    }
    busy.scheduling = true;
    try {
      const result = await api.schedulePublish(sub.task_id, {
        enable: enabling,
        scheduled_at: scheduledAtFromForm() ?? sub.scheduled_at,
        allow_delay: sub.allow_delay,
        max_delay_minutes: sub.max_delay_minutes || 240,
      });
      current.value.scheduled_publish = result.scheduled_publish;
      current.value.allow_delay = result.allow_delay;
      current.value.max_delay_minutes = result.max_delay_minutes;
      current.value.scheduled_at = scheduledAtFromForm() ?? sub.scheduled_at;
      notify.success(result.message || (enabling ? "已开启定时发布" : "已取消定时发布"));
    } catch (err) {
      notify.error(`定时发布设置失败：${errorText(err)}`);
    } finally {
      busy.scheduling = false;
    }
  }

  async function suggestOnline() {
    const target = coverAssetId.value;
    if (!target) {
      notify.warning("当前集合中没有图片可供识别");
      return;
    }
    busy.suggesting = true;
    try {
      const data = await api.suggestPixivTags(target, current.value.source_import_id);
      suggestions.pixiv = data.tags ?? [];
      current.value.pixiv.suggested_tags = [...suggestions.pixiv];
      if (suggestions.pixiv.length) notify.success(`获取到 ${suggestions.pixiv.length} 个 Pixiv 识别标签`);
      else notify.warning("Pixiv 未返回识别标签（可能未配置 Cookie 或网络不可达）");
    } catch (err) {
      notify.error(`获取 Pixiv 识别标签失败：${errorText(err)}`);
    } finally {
      busy.suggesting = false;
    }
  }

  async function syncPastTags() {
    busy.syncingTags = true;
    try {
      const data = await api.syncPixivPastTags();
      suggestions.preset = data.tags ?? [];
      notify.success(`已从 Pixiv 同步 ${data.count} 个常用标签`);
    } catch (err) {
      notify.error(`同步常用标签失败：${errorText(err)}`);
    } finally {
      busy.syncingTags = false;
    }
  }

  async function setCrop(cropX: number | null, cropY: number | null) {
    current.value.pixiv.crop_x = cropX;
    current.value.pixiv.crop_y = cropY;
    if (current.value.task_id) {
      await save(cropX === null && cropY === null ? "已恢复 Pixiv 默认裁剪并保存" : "已保存 Pixiv 缩略图裁剪位置");
    } else {
      notify.info("裁剪位置已应用，保存投稿后生效");
    }
  }

  // ---- 导出 ----

  async function loadLatestBuild() {
    const taskId = current.value.task_id;
    if (!taskId) {
      latestBuild.value = null;
      return;
    }
    try {
      const build = await api.latestBuild(taskId);
      if (current.value.task_id !== taskId) return;
      latestBuild.value = build.has_build ? build : null;
      if (build.mosaic_options) {
        mosaicEnabled.value = Boolean(build.mosaic_options.enabled);
        if (build.mosaic_options.pixel_size) mosaicPixelSize.value = build.mosaic_options.pixel_size;
      }
    } catch {
      latestBuild.value = null;
    }
  }

  function handleJob(job: ExportJob) {
    exportJob.value = job;
    if (job.status === "queued" || job.status === "running") {
      if (!pollTimer) {
        pollTimer = setInterval(async () => {
          if (!exportJob.value) return;
          try {
            handleJob(await api.exportJob(exportJob.value.job_id));
          } catch {
            // 轮询失败时下次重试
          }
        }, 1000);
      }
      return;
    }
    stopPolling();
    if (job.status === "completed") {
      notify.success("导出完成");
      void loadLatestBuild();
    } else {
      notify.error(`导出失败：${job.error || "任务中断"}`);
    }
  }

  async function startExport() {
    const taskId = current.value.task_id;
    if (!taskId) return;
    try {
      handleJob(await api.startExport(taskId, mosaicEnabled.value, Number(mosaicPixelSize.value) || 10));
    } catch (err) {
      notify.error(`启动导出失败：${errorText(err)}`);
    }
  }

  async function openExportDir() {
    const taskId = current.value.task_id;
    if (!taskId) return;
    try {
      await api.openLatestBuild(taskId);
      notify.info("已在资源管理器中打开导出目录");
    } catch (err) {
      notify.error(`打开目录失败：${errorText(err)}`);
    }
  }

  /** 局部重绘覆盖原图后同步投稿集合；返回当前投稿是否包含该素材。 */
  function renameAsset(oldId: string, newId: string): boolean {
    let found = false;
    for (const name of SET_NAMES) {
      const list = current.value.sets[name];
      const idx = list.indexOf(oldId);
      if (idx !== -1) {
        list[idx] = newId;
        found = true;
      }
    }
    return found;
  }

  return {
    drawerOpen,
    history,
    current,
    activeSet,
    scheduleDate,
    scheduleTime,
    suggestions,
    busy,
    exportJob,
    latestBuild,
    exportTab,
    mosaicEnabled,
    mosaicPixelSize,
    isEditing,
    hasContent,
    totalCount,
    coverAssetId,
    exporting,
    loadHistory,
    reset,
    load,
    loadLegacyFromPlan,
    newFromSelection,
    addToSet,
    removeAt,
    move,
    clearSet,
    fetchSuggestions,
    addTag,
    removeTag,
    save,
    remove,
    publish,
    toggleSchedule,
    suggestOnline,
    syncPastTags,
    setCrop,
    loadLatestBuild,
    startExport,
    openExportDir,
    renameAsset,
  };
});
