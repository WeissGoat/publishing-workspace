<script setup lang="ts">
import { Crop, RefreshCw, RotateCcw, ScanSearch, Sparkles, X } from "@lucide/vue";
import { NButton, NInput, NSwitch, NTooltip } from "naive-ui";
import { computed, ref, watch } from "vue";
import { previewUrl } from "@/api";
import { loadImage } from "@/composables/useFitCanvas";
import { useSubmissionStore } from "@/stores/submission";
import { cropImageStyle, cropInfo, effectiveCrop } from "@/utils/crop";
import CoverCropDialog from "./CoverCropDialog.vue";

const MAX_TAGS = 10;

const sub = useSubmissionStore();
const pixiv = computed(() => sub.current.pixiv);

// ---- 封面缩略图 ----
const coverSize = ref<{ id: string; width: number; height: number } | null>(null);
const cropOpen = ref(false);

watch(
  () => sub.coverAssetId,
  async (id) => {
    if (!id) {
      coverSize.value = null;
      return;
    }
    try {
      const img = await loadImage(previewUrl(id));
      if (sub.coverAssetId === id) coverSize.value = { id, width: img.naturalWidth, height: img.naturalHeight };
    } catch {
      coverSize.value = null;
    }
  },
  { immediate: true },
);

const info = computed(() => (coverSize.value ? cropInfo(coverSize.value.width, coverSize.value.height) : null));
const cropValue = computed(() => (info.value ? effectiveCrop(info.value, pixiv.value.crop_x, pixiv.value.crop_y) : 0));
const coverStyle = computed(() => (info.value ? cropImageStyle(info.value, cropValue.value) : {}));
const isCustomCrop = computed(() => pixiv.value.crop_x !== null || pixiv.value.crop_y !== null);
const orientationLabel = computed(() =>
  info.value?.orientation === "horizontal" ? "横图" : info.value?.orientation === "vertical" ? "竖图" : "正方形",
);
const cropStatus = computed(() => {
  if (!info.value) return "";
  const pct = (cropValue.value * 100).toFixed(1);
  if (info.value.orientation === "horizontal") return isCustomCrop.value ? `自定义（X: ${pct}%）` : `官方居中（X: ${pct}%）`;
  if (info.value.orientation === "vertical") return isCustomCrop.value ? `自定义（Y: ${pct}%）` : "官方置顶（Y: 0.0%）";
  return "全图填充";
});

function applyCrop(cropX: number, cropY: number) {
  void sub.setCrop(cropX, cropY);
}

// ---- 标签 ----
const tagInput = ref("");

function addCustomTag() {
  for (const t of tagInput.value.split(/[,，\n]+/)) sub.addTag(t);
  tagInput.value = "";
}

function toggleTag(tag: string) {
  if (pixiv.value.tags.includes(tag)) sub.removeTag(tag);
  else sub.addTag(tag);
}

const pools = computed(() => [
  { key: "preset", label: "常用标签", tags: sub.suggestions.preset },
  { key: "character", label: "角色", tags: sub.suggestions.character },
  { key: "action", label: "动作 / 场景", tags: sub.suggestions.action },
  { key: "pixiv", label: "Pixiv 识别", tags: sub.suggestions.pixiv },
]);

function regenerate() {
  void sub.fetchSuggestions(sub.current.sets.all, true);
}
</script>

<template>
  <div class="pixiv">
    <section class="cover-block">
      <div class="cover-frame">
        <img v-if="sub.coverAssetId && info" :src="previewUrl(sub.coverAssetId)" alt="封面缩略图" :style="coverStyle" />
        <span v-else class="faint">无封面</span>
      </div>
      <div class="cover-info">
        <div class="section-title">Pixiv 缩略图（1:1）</div>
        <template v-if="coverSize && info">
          <div class="cover-meta">
            <span class="badge">{{ orientationLabel }}</span>
            <span class="faint">{{ coverSize.width }} × {{ coverSize.height }}</span>
          </div>
          <div class="muted crop-status">{{ cropStatus }}</div>
          <div class="cover-actions">
            <NButton size="tiny" secondary :disabled="info.orientation === 'square'" @click="cropOpen = true">
              <template #icon><Crop :size="12" /></template>调整裁剪
            </NButton>
            <NButton v-if="isCustomCrop" size="tiny" quaternary @click="sub.setCrop(null, null)">
              <template #icon><RotateCcw :size="12" /></template>恢复默认
            </NButton>
          </div>
        </template>
        <p v-else class="faint hint">封面取 cover 集合第一张，否则取 all 第一张</p>
      </div>
    </section>

    <section class="field">
      <div class="field-head">
        <label class="section-title" for="pixiv-caption">作品描述</label>
        <NButton size="tiny" quaternary :loading="sub.busy.suggesting" :disabled="!sub.current.sets.all.length" @click="regenerate">
          <template #icon><Sparkles :size="12" /></template>重新生成
        </NButton>
      </div>
      <NInput
        id="pixiv-caption"
        v-model:value="sub.current.pixiv.caption"
        type="textarea"
        :autosize="{ minRows: 3, maxRows: 8 }"
        placeholder="作品描述（可选）"
      />
    </section>

    <section class="switches">
      <label class="switch-row">
        <NSwitch v-model:value="sub.current.pixiv.r18" size="small" />
        <span>R-18</span>
      </label>
      <label class="switch-row">
        <NSwitch v-model:value="sub.current.pixiv.allow_tag_edit" size="small" />
        <span>允许他人编辑标签</span>
      </label>
    </section>

    <section class="field">
      <div class="field-head">
        <span class="section-title">
          已选标签 <span :class="pixiv.tags.length >= MAX_TAGS ? 'warn' : 'faint'">{{ pixiv.tags.length }} / {{ MAX_TAGS }}</span>
        </span>
        <NButton v-if="pixiv.tags.length" size="tiny" quaternary @click="sub.current.pixiv.tags = []">清空</NButton>
      </div>
      <div class="chips selected">
        <span v-if="!pixiv.tags.length" class="faint hint">从下方推荐池点击添加，或输入自定义标签；发布时为空会自动套用 Pixiv 识别标签</span>
        <span v-for="t in pixiv.tags" :key="t" class="chip on">
          {{ t }}
          <button type="button" :aria-label="`移除 ${t}`" @click="sub.removeTag(t)"><X :size="11" /></button>
        </span>
      </div>
      <NInput
        v-model:value="tagInput"
        size="small"
        placeholder="输入自定义标签，回车添加（逗号分隔多个）"
        :disabled="pixiv.tags.length >= MAX_TAGS"
        @keydown.enter.prevent="addCustomTag"
      />
    </section>

    <section class="pools">
      <div v-for="pool in pools" :key="pool.key" class="pool">
        <div class="field-head">
          <span class="section-title">{{ pool.label }} <span class="faint">{{ pool.tags.length }}</span></span>
          <NTooltip v-if="pool.key === 'preset'">
            <template #trigger>
              <NButton size="tiny" quaternary :loading="sub.busy.syncingTags" @click="sub.syncPastTags()">
                <template #icon><RefreshCw :size="12" /></template>从 Pixiv 同步
              </NButton>
            </template>
            读取 Pixiv 账号的历史常用标签
          </NTooltip>
          <NTooltip v-else-if="pool.key === 'pixiv'">
            <template #trigger>
              <NButton size="tiny" quaternary :loading="sub.busy.suggesting" :disabled="!sub.coverAssetId" @click="sub.suggestOnline()">
                <template #icon><ScanSearch :size="12" /></template>识别封面
              </NButton>
            </template>
            上传封面到 Pixiv 获取推荐标签（需配置 Cookie）
          </NTooltip>
        </div>
        <div class="chips">
          <span v-if="!pool.tags.length" class="faint hint">暂无</span>
          <button
            v-for="t in pool.tags"
            :key="t"
            type="button"
            class="chip"
            :class="{ on: pixiv.tags.includes(t) }"
            @click="toggleTag(t)"
          >
            {{ t }}
          </button>
        </div>
      </div>
    </section>

    <CoverCropDialog
      v-if="coverSize && sub.coverAssetId"
      v-model:show="cropOpen"
      :asset-id="sub.coverAssetId"
      :width="coverSize.width"
      :height="coverSize.height"
      :crop-x="pixiv.crop_x"
      :crop-y="pixiv.crop_y"
      @apply="applyCrop"
    />
  </div>
</template>

<style scoped>
.pixiv {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.cover-block {
  display: flex;
  gap: 12px;
}

.cover-frame {
  position: relative;
  flex: none;
  width: 96px;
  height: 96px;
  border-radius: 8px;
  overflow: hidden;
  background: var(--image-bg);
  display: grid;
  place-items: center;
  font-size: 11px;
}

.cover-frame img {
  position: absolute;
  top: 0;
  left: 0;
}

.cover-info {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.cover-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.badge {
  padding: 0 6px;
  border-radius: 4px;
  background: var(--surface-3);
  font-size: 11px;
}

.crop-status {
  font-size: 12px;
}

.cover-actions {
  display: flex;
  gap: 4px;
  margin-top: 2px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 22px;
}

.field-head .section-title {
  display: flex;
  gap: 6px;
}

.warn {
  color: var(--warning);
}

.switches {
  display: flex;
  gap: 20px;
}

.switch-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.hint {
  margin: 0;
  font-size: 12px;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.chips.selected {
  min-height: 28px;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-2);
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
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

.chip:hover {
  border-color: var(--border-strong);
  color: var(--text);
}

.chip.on {
  border-color: var(--primary);
  background: var(--primary-soft);
  color: var(--text);
}

.chip button {
  display: inline-grid;
  place-items: center;
  padding: 0;
  border: none;
  background: none;
  color: inherit;
  cursor: pointer;
}

.pools {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.pool {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
</style>
