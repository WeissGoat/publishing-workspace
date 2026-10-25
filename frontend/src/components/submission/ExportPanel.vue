<script setup lang="ts">
import { CircleAlert, CircleCheck, Download, FolderOpen, Package, ShieldCheck } from "@lucide/vue";
import { NButton, NProgress, NSlider, NSwitch } from "naive-ui";
import { computed } from "vue";
import { SET_NAMES } from "@/api";
import { useLightboxStore } from "@/stores/lightbox";
import { useSubmissionStore } from "@/stores/submission";
import { formatBytes, formatDateTime } from "@/utils/format";

const sub = useSubmissionStore();
const lb = useLightboxStore();

const job = computed(() => sub.exportJob);
const build = computed(() => sub.latestBuild);
const failed = computed(() => job.value?.status === "failed" || job.value?.status === "interrupted");
const images = computed(() => build.value?.images?.[sub.exportTab] ?? []);

function openBuildImage(index: number) {
  const taskId = sub.current.task_id;
  if (!taskId) return;
  lb.openBuild(images.value, index, sub.exportTab, taskId, build.value?.output_dir ?? "");
}
</script>

<template>
  <div class="export">
    <p v-if="!sub.current.task_id" class="muted empty">保存投稿后即可导出发布包</p>
    <template v-else>
      <section class="block">
        <label class="switch-row" title="自动检测敏感部位并执行像素打码">
          <NSwitch v-model:value="sub.mosaicEnabled" size="small" :disabled="sub.exporting" />
          <ShieldCheck :size="15" />
          <span>AI 自动打码（YOLO + Pixel）</span>
        </label>
        <div v-if="sub.mosaicEnabled" class="slider-row">
          <span class="muted" title="像素马赛克方块大小（832×1216 / 1024×1024 推荐 10px）">马赛克强度</span>
          <NSlider v-model:value="sub.mosaicPixelSize" :min="4" :max="32" :step="1" :disabled="sub.exporting" class="slider" />
          <span class="mono value">{{ sub.mosaicPixelSize }}px</span>
        </div>
        <NButton type="primary" block :loading="sub.exporting" @click="sub.startExport()">
          <template #icon><Package :size="15" /></template>
          {{ build ? "重新导出" : "开始导出" }}
        </NButton>
      </section>

      <section v-if="job && sub.exporting" class="block">
        <NProgress type="line" :percentage="job.percent || 0" :height="6" :show-indicator="false" processing />
        <div class="progress-meta">
          <span>{{ job.phase || job.status }}（{{ job.processed || 0 }}/{{ job.total || 0 }}）</span>
          <span class="mono">{{ job.percent || 0 }}%</span>
        </div>
        <div v-if="job.current_filename" class="faint truncate file">{{ job.current_selection }} / {{ job.current_filename }}</div>
      </section>

      <section v-else-if="failed && job" class="block error">
        <CircleAlert :size="15" />
        <span>导出失败：{{ job.error || "任务中断" }}</span>
      </section>

      <section v-if="build" class="block">
        <div class="ready">
          <CircleCheck :size="15" />
          <span>导出已就绪（latest）</span>
          <span v-if="build.exported_at" class="faint push-right">{{ formatDateTime(build.exported_at) }}</span>
        </div>

        <div v-if="build.operations?.length" class="ops">
          <div class="section-title">处理流水线</div>
          <ul>
            <li v-for="op in build.operations" :key="op.name" :class="{ off: !op.enabled }" :title="op.description">
              <span class="dot" />
              <span>{{ op.title }}</span>
              <span class="faint">{{ op.enabled ? "已启用" : "未启用" }}</span>
            </li>
          </ul>
        </div>

        <div class="actions">
          <NButton size="small" secondary @click="sub.openExportDir()">
            <template #icon><FolderOpen :size="14" /></template>打开导出目录
          </NButton>
          <a v-for="a in build.archives ?? []" :key="a.filename" :href="a.download_url" class="archive" download>
            <Download :size="13" />
            <span class="truncate">{{ a.filename }}</span>
            <span class="faint">{{ formatBytes(a.size_bytes) }}</span>
          </a>
        </div>

        <div class="gallery">
          <div class="tabs" role="tablist">
            <button
              v-for="s in SET_NAMES"
              :key="s"
              type="button"
              role="tab"
              class="tab"
              :class="{ active: sub.exportTab === s }"
              :aria-selected="sub.exportTab === s"
              @click="sub.exportTab = s"
            >
              {{ s }} <span class="faint">{{ build.images?.[s]?.length ?? 0 }}</span>
            </button>
          </div>
          <p v-if="!images.length" class="faint empty">该集合没有成品图</p>
          <div v-else class="thumbs">
            <button
              v-for="(img, i) in images"
              :key="img.filename"
              type="button"
              class="thumb"
              :title="`${img.filename}（${formatBytes(img.size_bytes)}）· 点击查看 / 手动打码`"
              @click="openBuildImage(i)"
            >
              <img :src="img.preview_url" :alt="img.filename" loading="lazy" />
            </button>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.export {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.empty {
  margin: 0;
  font-size: 12px;
}

.block {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface-2);
}

.block.error {
  flex-direction: row;
  align-items: center;
  gap: 6px;
  border-color: var(--danger);
  background: var(--danger-soft);
  color: var(--danger);
}

.switch-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.slider-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
}

.slider {
  flex: 1;
}

.value {
  width: 36px;
  text-align: right;
}

.progress-meta {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-muted);
}

.file {
  font-size: 11px;
}

.ready {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--success);
  font-weight: 500;
}

.push-right {
  margin-left: auto;
  font-weight: 400;
  font-size: 12px;
}

.ops ul {
  margin: 4px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
}

.ops li {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ops .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--success);
}

.ops li.off .dot {
  background: var(--text-faint);
}

.ops li.off {
  color: var(--text-faint);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.archive {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-size: 12px;
}

.archive:hover {
  border-color: var(--primary);
}

.gallery {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tabs {
  display: flex;
  gap: 4px;
}

.tab {
  flex: 1;
  height: 26px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.tab.active {
  border-color: var(--primary);
  background: var(--primary-soft);
  color: var(--text);
}

.thumbs {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
  gap: 6px;
}

.thumb {
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
</style>
