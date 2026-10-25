<script setup lang="ts">
import { Copy, FolderSearch, Paintbrush } from "@lucide/vue";
import { useClipboard } from "@vueuse/core";
import { NButton } from "naive-ui";
import { computed } from "vue";
import { api } from "@/api";
import { errorText, notify } from "@/composables/notify";
import { useLightboxStore } from "@/stores/lightbox";
import { formatBytes } from "@/utils/format";

const lb = useLightboxStore();
const { copy } = useClipboard({ legacy: true });

const gen = computed(() => lb.buildDetails?.generation_info);
const meta = computed(() => {
  const d = lb.buildDetails;
  const g = gen.value;
  return [
    ["尺寸", d ? `${d.width} × ${d.height} · ${d.image_format || "PNG"}` : "读取中…"],
    ["文件大小", g?.file_size_human || formatBytes(lb.buildImage?.size_bytes)],
    ["修改时间", g?.modified_at || "-"],
    ["Seed", g?.seed ?? "-"],
    ["Model", g?.model || "-"],
    ["Sampler", g?.sampler || "-"],
    ["Steps", g?.steps ?? "-"],
    ["Scale", g?.scale ?? "-"],
  ] as [string, string | number][];
});

async function reveal() {
  const ctx = lb.build;
  const image = lb.buildImage;
  if (!ctx || !image) return;
  try {
    await api.revealBuildImage(ctx.taskId, ctx.selection, image.filename);
    notify.info("已在资源管理器中定位导出成品");
  } catch (err) {
    notify.error(`打开文件夹失败：${errorText(err)}`);
  }
}

async function copyText(text: string | undefined, label: string) {
  if (!text) return;
  await copy(text);
  notify.info(`已复制 ${label}`);
}
</script>

<template>
  <div class="panel">
    <div class="actions">
      <NButton size="small" type="primary" secondary @click="lb.mode = 'mosaic'">
        <template #icon><Paintbrush :size="15" /></template>
        手动打码
      </NButton>
      <NButton size="small" @click="reveal">
        <template #icon><FolderSearch :size="15" /></template>
        打开所在文件夹
      </NButton>
    </div>
    <p class="faint note">这是导出发布包中的成品图，可在「手动打码」中修补后保存回发布包。</p>
    <section class="section">
      <h4 class="section-title">图像参数</h4>
      <dl class="meta">
        <template v-for="[k, v] in meta" :key="k">
          <dt>{{ k }}</dt>
          <dd>{{ v }}</dd>
        </template>
      </dl>
    </section>
    <section class="section">
      <div class="section-head">
        <h4 class="section-title">Prompt</h4>
        <NButton size="tiny" text :disabled="!gen?.prompt" @click="copyText(gen?.prompt, 'Prompt')">
          <template #icon><Copy :size="13" /></template>复制
        </NButton>
      </div>
      <div class="textbox">{{ gen ? gen.prompt || "无 Prompt 记录（导出时可能已清除元数据）" : "读取中…" }}</div>
    </section>
  </div>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 14px 16px 28px;
}

.actions {
  display: flex;
  gap: 6px;
}

.note {
  margin: 0;
  font-size: 12px;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.meta {
  display: grid;
  grid-template-columns: 76px minmax(0, 1fr);
  gap: 5px 10px;
  margin: 0;
  font-size: 12px;
}

.meta dt {
  color: var(--text-faint);
}

.meta dd {
  margin: 0;
}

.textbox {
  max-height: 160px;
  overflow-y: auto;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
