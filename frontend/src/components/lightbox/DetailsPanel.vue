<script setup lang="ts">
import { Copy, FolderSearch, LocateFixed, MailCheck, Send, Star } from "@lucide/vue";
import { useClipboard } from "@vueuse/core";
import { NButton, NCollapse, NCollapseItem, NSkeleton, NTag } from "naive-ui";
import { computed, watch } from "vue";
import { api, type AssetSnapshotRef } from "@/api";
import { FACET_LABELS } from "@/components/library/constants";
import { errorText, notify } from "@/composables/notify";
import { useLibraryStore } from "@/stores/library";
import { useLightboxStore } from "@/stores/lightbox";
import { formatDateTime } from "@/utils/format";
import RelatedImages from "./RelatedImages.vue";

const emit = defineEmits<{ peek: [target: { id: string; name: string }]; requestClose: [] }>();

const lb = useLightboxStore();
const lib = useLibraryStore();
const { copy } = useClipboard({ legacy: true });

const id = computed(() => lb.activeId ?? "");
const item = computed(() => lib.getAsset(id.value));
const gen = computed(() => lb.details?.generation_info);
const favorite = computed(() => lib.favorites.has(id.value));
const posted = computed(() => {
  const override = lib.postedOverride.get(id.value);
  if (override !== undefined) return override;
  if (lb.details) return lb.details.is_posted;
  return item.value ? lib.isPosted(item.value) : false;
});

// 详情接口返回的收藏状态为准（素材可能不在当前已加载列表中）
watch(
  () => lb.details,
  (d) => {
    if (!d || d.asset_id !== id.value) return;
    if (d.is_favorited) lib.favorites.add(d.asset_id);
    else lib.favorites.delete(d.asset_id);
  },
);

const values = computed(() => item.value?.values ?? {});
const facets = computed(() => {
  const source = item.value?.facets ?? {};
  return Object.entries(source).flatMap(([field, vals]) => vals.map((v) => ({ field: FACET_LABELS[field] ?? field, value: v })));
});
const tags = computed(() => lb.details?.tags ?? item.value?.tags ?? []);

const meta = computed(() => {
  const d = lb.details;
  const g = gen.value;
  return [
    ["尺寸", d ? `${d.width} × ${d.height} · ${d.image_format || "PNG"}` : item.value ? `${item.value.width} × ${item.value.height}` : "-"],
    ["文件大小", g?.file_size_human || "-"],
    ["修改时间", g?.modified_at || "-"],
    ["Seed", g?.seed ?? "-"],
    ["Model", g?.model || "-"],
    ["Sampler", g?.sampler || "-"],
    ["Steps", g?.steps ?? "-"],
    ["Scale", g?.scale ?? "-"],
    ["Noise", g?.noise_schedule || "-"],
  ] as [string, string | number][];
});

const nodes = computed(() => [
  ["画风", values.value.artist],
  ["角色", values.value.character],
  ["动作组", values.value.action_group],
  ["动作", values.value.action],
] as [string, string[] | undefined][]);

const rawParameters = computed(() => {
  const g = gen.value;
  if (!g) return "";
  if (g.raw_parameters) return g.raw_parameters;
  return Object.keys(g.all_chunks ?? {}).length ? JSON.stringify(g.all_chunks, null, 2) : "";
});

function toggleFavorite() {
  lib.toggleFavorite(id.value);
}

async function togglePosted() {
  const next = !posted.value;
  try {
    await api.togglePosted(id.value, next);
    lib.postedOverride.set(id.value, next);
    notify.info(next ? "已标记为已投稿" : "已取消已投稿标记");
  } catch (err) {
    notify.error(`更新投稿标记失败：${errorText(err)}`);
  }
}

async function reveal() {
  try {
    await api.revealAsset(id.value);
    notify.info("已在资源管理器中定位文件");
  } catch (err) {
    notify.error(`打开文件夹失败：${errorText(err)}`);
  }
}

async function copyText(text: string | undefined, label: string) {
  if (!text) return;
  await copy(text);
  notify.info(`已复制 ${label}`);
}

function isCurrentSnapshot(s: AssetSnapshotRef): boolean {
  return lib.importIds.includes(s.import_id);
}

async function locate(s: AssetSnapshotRef, assetId = id.value) {
  emit("requestClose");
  const found = await lib.locate(s.import_id, assetId);
  if (found) notify.success(`已定位到快照「${s.name || s.import_id}」第 ${s.source_order + 1} 张`);
  else notify.info(`已切换到快照「${s.name || s.import_id}」`);
}
</script>

<template>
  <div class="panel">
    <div class="actions">
      <NButton size="small" :type="favorite ? 'warning' : 'default'" :secondary="favorite" @click="toggleFavorite">
        <template #icon><Star :size="15" :fill="favorite ? 'currentColor' : 'none'" /></template>
        {{ favorite ? "已收藏" : "收藏" }}
      </NButton>
      <NButton size="small" :type="posted ? 'success' : 'default'" :secondary="posted" @click="togglePosted">
        <template #icon><component :is="posted ? MailCheck : Send" :size="15" /></template>
        {{ posted ? "已投稿" : "标记已投稿" }}
      </NButton>
      <NButton size="small" @click="reveal">
        <template #icon><FolderSearch :size="15" /></template>
        打开所在文件夹
      </NButton>
    </div>

    <section class="section">
      <h4 class="section-title">图像与生成参数</h4>
      <dl class="meta">
        <template v-for="[k, v] in meta" :key="k">
          <dt>{{ k }}</dt>
          <dd :title="String(v)">{{ v }}</dd>
        </template>
      </dl>
    </section>

    <section class="section">
      <h4 class="section-title">业务节点</h4>
      <dl class="meta nodes">
        <template v-for="[k, v] in nodes" :key="k">
          <dt>{{ k }}</dt>
          <dd>{{ v?.length ? v.join("、") : "未指定" }}</dd>
        </template>
      </dl>
    </section>

    <section class="section">
      <h4 class="section-title">
        所属快照
        <span v-if="lb.snapshots" class="faint">{{ lb.snapshots.length }}</span>
      </h4>
      <NSkeleton v-if="lb.snapshots === null" :height="56" :sharp="false" />
      <div v-else-if="!lb.snapshots.length" class="faint empty">此图片未关联任何快照</div>
      <div v-else class="snapshots">
        <div v-for="s in lb.snapshots" :key="s.import_id" class="snapshot" :class="{ current: isCurrentSnapshot(s) }">
          <div class="snapshot-main">
            <div class="snapshot-name truncate" :title="s.source_ref || s.name">{{ s.name || s.import_id }}</div>
            <div class="snapshot-meta faint">
              第 {{ s.source_order + 1 }}<template v-if="s.total_items"> / {{ s.total_items }}</template> 张
              <template v-if="s.created_at"> · {{ formatDateTime(s.created_at) }}</template>
            </div>
          </div>
          <NButton size="tiny" :type="isCurrentSnapshot(s) ? 'primary' : 'default'" secondary @click="locate(s)">
            <template #icon><LocateFixed :size="13" /></template>
            {{ isCurrentSnapshot(s) ? "定位" : "跳转" }}
          </NButton>
        </div>
      </div>
    </section>

    <RelatedImages @peek="(t) => emit('peek', t)" @locate="(s, assetId) => locate(s, assetId)" />

    <section v-if="tags.length" class="section">
      <h4 class="section-title">标签</h4>
      <div class="chips">
        <NTag v-for="t in tags" :key="t" size="small" type="info" :bordered="false">{{ t }}</NTag>
      </div>
    </section>

    <section v-if="facets.length" class="section">
      <h4 class="section-title">Classify 属性</h4>
      <div class="chips">
        <NTag v-for="f in facets" :key="`${f.field}:${f.value}`" size="small" :bordered="false">
          <span class="faint">{{ f.field }}</span> {{ f.value }}
        </NTag>
      </div>
    </section>

    <section class="section">
      <div class="section-head">
        <h4 class="section-title">Prompt</h4>
        <NButton size="tiny" text :disabled="!gen?.prompt" @click="copyText(gen?.prompt, 'Prompt')">
          <template #icon><Copy :size="13" /></template>复制
        </NButton>
      </div>
      <div class="textbox">{{ gen ? gen.prompt || "无 Prompt 记录" : "读取中…" }}</div>
    </section>

    <section class="section">
      <div class="section-head">
        <h4 class="section-title">Negative</h4>
        <NButton size="tiny" text :disabled="!gen?.negative_prompt" @click="copyText(gen?.negative_prompt, 'Negative Prompt')">
          <template #icon><Copy :size="13" /></template>复制
        </NButton>
      </div>
      <div class="textbox">{{ gen ? gen.negative_prompt || "无 Negative 记录" : "读取中…" }}</div>
    </section>

    <NCollapse v-if="rawParameters" class="section raw">
      <NCollapseItem title="完整 PNG 参数" name="raw">
        <pre class="mono raw-pre">{{ rawParameters }}</pre>
      </NCollapseItem>
    </NCollapse>
  </div>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 14px 16px 28px;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section .section-title {
  display: flex;
  align-items: center;
  gap: 6px;
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
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.nodes dd {
  white-space: normal;
  word-break: break-all;
}

.empty {
  font-size: 12px;
}

.snapshots {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.snapshot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-2);
}

.snapshot.current {
  border-color: var(--primary);
  background: var(--primary-soft);
}

.snapshot-main {
  flex: 1;
  min-width: 0;
}

.snapshot-name {
  font-weight: 500;
}

.snapshot-meta {
  font-size: 11px;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.textbox {
  max-height: 140px;
  overflow-y: auto;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}

.raw-pre {
  margin: 0;
  max-height: 240px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
