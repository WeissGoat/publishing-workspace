<script setup lang="ts">
import { AlarmClock, AlarmClockOff, Download, ExternalLink, FolderOpen, Send, Trash2 } from "@lucide/vue";
import { NButton, NInputNumber, NSkeleton, NSwitch } from "naive-ui";
import { computed, ref, watch } from "vue";
import { api, previewUrl, SET_NAMES, thumbUrl, type SetName } from "@/api";
import { errorText, notify } from "@/composables/notify";
import { useCalendarStore } from "@/stores/calendar";
import { formatBytes, formatDateTime, formatScheduleWindow } from "@/utils/format";
import ImagePreview from "./ImagePreview.vue";
import type { PreviewItem } from "./shared";

const cal = useCalendarStore();

const setTab = ref<SetName>("all");
const buildTab = ref<SetName>("all");
const allowDelay = ref(false);
const delayMinutes = ref(240);

const d = computed(() => cal.detail);
const task = computed(() => (d.value?.kind === "task" ? d.value.data : null));
const build = computed(() => (d.value?.kind === "task" ? d.value.build : null));
const sets = computed(() => (d.value?.kind === "task" ? d.value.data.sets : d.value?.sets) ?? { all: [], post: [], cover: [] });
const title = computed(() => (d.value?.kind === "task" ? d.value.data.title || d.value.data.task_id : d.value?.title || "旧格式散图投稿"));
const libraryLink = computed(() => {
  if (d.value?.kind === "task") return { path: "/library", query: { submission_id: d.value.data.task_id } };
  if (d.value?.kind === "inline") return { path: "/library", query: { plan_id: cal.month, entry_id: d.value.entryId } };
  return null;
});

watch(
  task,
  (t) => {
    allowDelay.value = Boolean(t?.allow_delay);
    delayMinutes.value = t?.allow_delay ? t.max_delay_minutes || 240 : 240;
  },
  { immediate: true },
);

const scheduleText = computed(() => {
  const t = task.value;
  if (!t?.scheduled_publish) return "";
  const window = formatScheduleWindow(t.scheduled_at, Boolean(t.allow_delay), t.max_delay_minutes ?? 0);
  return `定时发布中${t.allow_delay && t.max_delay_minutes ? "" : "（准时）"}：将于 ${window} 自动发布`;
});

// ---- 大图预览 ----
const preview = ref<{ kind: "set" | "build"; set: SetName } | null>(null);
const previewIndex = ref<number | null>(null);

const previewItems = computed<PreviewItem[]>(() => {
  if (!preview.value) return [];
  if (preview.value.kind === "set") {
    return sets.value[preview.value.set].map((id) => ({ src: previewUrl(id), caption: `${title.value} · ${id}` }));
  }
  return (build.value?.images?.[preview.value.set] ?? []).map((img) => ({
    src: img.preview_url,
    caption: `[成品] ${img.filename}（${formatBytes(img.size_bytes)}）`,
  }));
});

const previewLabel = computed(() => (preview.value?.kind === "build" ? `导出成品 · ${preview.value.set}` : `选集素材 · ${preview.value?.set}`));

function openPreview(kind: "set" | "build", set: SetName, index: number) {
  preview.value = { kind, set };
  previewIndex.value = index;
}

async function reveal(index: number) {
  const p = preview.value;
  if (!p) return;
  try {
    if (p.kind === "set") {
      await api.revealAsset(sets.value[p.set][index]);
      notify.info("已在资源管理器中定位素材原图");
    } else if (task.value) {
      const img = build.value?.images?.[p.set]?.[index];
      if (!img) return;
      await api.revealBuildImage(task.value.task_id, p.set, img.filename);
      notify.info("已在资源管理器中定位导出成品");
    }
  } catch (err) {
    notify.error(`打开文件夹失败：${errorText(err)}`);
  }
}
</script>

<template>
  <section v-if="d || cal.detailLoading" class="detail">
    <NSkeleton v-if="!d" :height="200" :sharp="false" />
    <template v-else>
      <div class="head">
        <div class="title-group">
          <h3 class="truncate" :title="title">{{ title }}</h3>
          <span class="mono faint id">{{ task ? task.task_id : `entry: ${d.kind === "inline" ? d.entryId : ""}` }}</span>
        </div>
        <span class="status" :class="{ ok: build }">
          {{ build ? `已导出（${build.build_id || "latest"}）` : d.kind === "inline" ? "未转换" : "未导出" }}
        </span>
      </div>

      <div class="actions">
        <RouterLink v-if="libraryLink" :to="libraryLink" class="link-btn">
          <ExternalLink :size="13" />{{ d.kind === "inline" ? "转换为正式投稿" : "在素材库中打开" }}
        </RouterLink>
        <NButton v-if="task" size="tiny" quaternary type="error" @click="cal.deleteSubmission()">
          <template #icon><Trash2 :size="12" /></template>删除投稿
        </NButton>
      </div>

      <div v-if="task" class="block">
        <div v-if="task.pixiv?.illust_id" class="pixiv ok">
          <a :href="`https://www.pixiv.net/artworks/${task.pixiv.illust_id}`" target="_blank" rel="noopener">
            已发布 · PID {{ task.pixiv.illust_id }} <ExternalLink :size="11" />
          </a>
          <span v-if="task.pixiv.published_at" class="faint">{{ formatDateTime(task.pixiv.published_at) }}</span>
        </div>
        <div class="row">
          <NButton
            size="small"
            type="primary"
            :disabled="Boolean(task.pixiv?.illust_id)"
            :loading="cal.busy.publishing"
            @click="cal.publishNow()"
          >
            <template #icon><Send :size="14" /></template>
            {{ task.pixiv?.illust_id ? "已发布" : "立即发布" }}
          </NButton>
          <NButton
            size="small"
            :type="task.scheduled_publish ? 'warning' : 'default'"
            secondary
            :loading="cal.busy.scheduling"
            @click="cal.toggleSchedulePublish(allowDelay, delayMinutes)"
          >
            <template #icon>
              <AlarmClockOff v-if="task.scheduled_publish" :size="14" />
              <AlarmClock v-else :size="14" />
            </template>
            {{ task.scheduled_publish ? "取消定时发布" : "开启定时发布" }}
          </NButton>
        </div>
        <div class="row">
          <label class="switch-row">
            <NSwitch v-model:value="allowDelay" size="small" :disabled="task.scheduled_publish" />
            <span>允许延迟补发</span>
          </label>
          <template v-if="allowDelay">
            <NInputNumber
              v-model:value="delayMinutes"
              :min="1"
              :max="1440"
              :step="30"
              size="tiny"
              class="minutes"
              :disabled="task.scheduled_publish"
            />
            <span class="muted">分钟</span>
          </template>
        </div>
        <p v-if="scheduleText" class="schedule-on">{{ scheduleText }}</p>
      </div>

      <div class="block">
        <div class="tabs" role="tablist">
          <span class="section-title">选集</span>
          <button
            v-for="s in SET_NAMES"
            :key="s"
            type="button"
            class="tab"
            :class="{ active: setTab === s }"
            @click="setTab = s"
          >
            {{ s }} <span class="faint">{{ sets[s]?.length ?? 0 }}</span>
          </button>
        </div>
        <p v-if="!sets[setTab]?.length" class="faint empty">{{ setTab }} 集合暂无图片</p>
        <div v-else class="thumbs">
          <button
            v-for="(id, i) in sets[setTab]"
            :key="`${id}-${i}`"
            type="button"
            class="thumb"
            :title="`查看原素材 #${i + 1}`"
            @click="openPreview('set', setTab, i)"
          >
            <span class="num">{{ i + 1 }}</span>
            <img :src="thumbUrl(id, 120)" alt="" loading="lazy" />
          </button>
        </div>
      </div>

      <div v-if="task" class="block">
        <div class="tabs" role="tablist">
          <span class="section-title">导出成品</span>
          <template v-if="build">
            <button
              v-for="s in SET_NAMES"
              :key="s"
              type="button"
              class="tab"
              :class="{ active: buildTab === s }"
              @click="buildTab = s"
            >
              {{ s }} <span class="faint">{{ build.images?.[s]?.length ?? 0 }}</span>
            </button>
          </template>
        </div>
        <p v-if="!build" class="faint empty">尚未导出，可在素材库的投稿篮中导出发布包</p>
        <template v-else>
          <p v-if="build.exported_at" class="faint empty">导出于 {{ formatDateTime(build.exported_at, true) }}</p>
          <p v-if="!build.images?.[buildTab]?.length" class="faint empty">{{ buildTab }} 集合暂无成品</p>
          <div v-else class="thumbs">
            <button
              v-for="(img, i) in build.images[buildTab]"
              :key="img.filename"
              type="button"
              class="thumb"
              :title="`${img.filename}（${formatBytes(img.size_bytes)}）`"
              @click="openPreview('build', buildTab, i)"
            >
              <span class="num">{{ i + 1 }}</span>
              <img :src="img.preview_url" alt="" loading="lazy" />
            </button>
          </div>
          <div class="downloads">
            <NButton size="tiny" secondary @click="cal.openBuildDir(task.task_id)">
              <template #icon><FolderOpen :size="12" /></template>打开导出目录
            </NButton>
            <a v-for="a in build.archives ?? []" :key="a.filename" :href="a.download_url" :download="a.filename" class="archive">
              <Download :size="12" />
              <span class="truncate">{{ a.filename }}</span>
              <span class="faint">{{ formatBytes(a.size_bytes) }}</span>
            </a>
          </div>
        </template>
      </div>
    </template>

    <ImagePreview v-model:index="previewIndex" :items="previewItems" :label="previewLabel" @reveal="reveal" />
  </section>
</template>

<style scoped>
.detail {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.title-group {
  min-width: 0;
}

h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.id {
  font-size: 11px;
}

.status {
  flex: none;
  padding: 0 6px;
  border-radius: 4px;
  background: var(--surface-3);
  color: var(--text-muted);
  font-size: 11px;
  line-height: 18px;
}

.status.ok {
  background: var(--success-soft);
  color: var(--success);
}

.actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.link-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
}

.block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface-2);
}

.pixiv {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.pixiv a {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  color: var(--success);
}

.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.switch-row {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.minutes {
  width: 100px;
}

.schedule-on {
  margin: 0;
  font-size: 12px;
  color: var(--primary);
}

.tabs {
  display: flex;
  align-items: center;
  gap: 4px;
}

.tabs .section-title {
  margin-right: auto;
}

.tab {
  height: 22px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 11px;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.tab.active {
  border-color: var(--primary);
  background: var(--primary-soft);
  color: var(--text);
}

.empty {
  margin: 0;
  font-size: 12px;
}

.thumbs {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
  gap: 6px;
  max-height: 260px;
  overflow-y: auto;
}

.thumb {
  position: relative;
  aspect-ratio: 3 / 4;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
  background: var(--image-bg);
  cursor: zoom-in;
}

.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.num {
  position: absolute;
  top: 3px;
  left: 3px;
  padding: 0 4px;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 10px;
  line-height: 14px;
}

.downloads {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.archive {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  height: 22px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  font-size: 11px;
}
</style>
