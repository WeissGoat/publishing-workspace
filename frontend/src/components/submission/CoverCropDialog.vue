<script setup lang="ts">
import { NButton, NModal, NSlider } from "naive-ui";
import { computed, ref, watch } from "vue";
import { previewUrl } from "@/api";
import { cropImageStyle, cropInfo, effectiveCrop } from "@/utils/crop";

const props = defineProps<{
  assetId: string;
  width: number;
  height: number;
  cropX: number | null;
  cropY: number | null;
}>();
const show = defineModel<boolean>("show", { required: true });
const emit = defineEmits<{ apply: [cropX: number, cropY: number] }>();

const STAGE = 280;
const info = computed(() => cropInfo(props.width, props.height));
const value = ref(0);

watch(
  () => show.value,
  (open) => {
    if (open) value.value = effectiveCrop(info.value, props.cropX, props.cropY);
  },
  { immediate: true },
);

const sliderValue = computed({
  get: () => (info.value.max > 0 ? Math.round((value.value / info.value.max) * 1000) : 0),
  set: (v: number) => {
    value.value = (v / 1000) * info.value.max;
  },
});

const src = computed(() => previewUrl(props.assetId));
const imgStyle = computed(() => cropImageStyle(info.value, value.value));
const labels = computed(() =>
  info.value.orientation === "horizontal"
    ? { start: "置左", end: "置右", hint: "按住图片左右拖动" }
    : { start: "置顶", end: "置底", hint: "按住图片上下拖动" },
);
const subtitle = computed(() => {
  const { width: w, height: h } = props;
  if (info.value.orientation === "horizontal") return `横图 ${w}×${h}：正方形边长 ${h}px，可左右调整`;
  if (info.value.orientation === "vertical") return `竖图 ${w}×${h}：正方形边长 ${w}px，可上下调整`;
  return `正方形图片 ${w}×${h}：全图填充，无需裁剪`;
});

let drag: { x: number; y: number; start: number } | null = null;

function onDown(e: PointerEvent) {
  if (info.value.orientation === "square") return;
  drag = { x: e.clientX, y: e.clientY, start: value.value };
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}

function onMove(e: PointerEvent) {
  if (!drag) return;
  const { width: w, height: h } = props;
  let next = drag.start;
  if (info.value.orientation === "horizontal") next = drag.start - (e.clientX - drag.x) / (STAGE * (w / h));
  else next = drag.start - (e.clientY - drag.y) / (STAGE * (h / w));
  value.value = Math.max(0, Math.min(info.value.max, next));
}

function onUp() {
  drag = null;
}

function apply() {
  const o = info.value.orientation;
  emit("apply", o === "horizontal" ? value.value : 0, o === "vertical" ? value.value : 0);
  show.value = false;
}
</script>

<template>
  <NModal v-model:show="show" preset="card" title="调整 Pixiv 缩略图" class="crop-modal" :style="{ width: '640px' }" :bordered="false">
    <p class="muted subtitle">{{ subtitle }}</p>
    <div class="body">
      <div class="stage-col">
        <div
          class="stage"
          :class="{ draggable: info.orientation !== 'square' }"
          :style="{ width: `${STAGE}px`, height: `${STAGE}px` }"
          @pointerdown="onDown"
          @pointermove="onMove"
          @pointerup="onUp"
          @pointercancel="onUp"
        >
          <img :src="src" alt="" draggable="false" :style="imgStyle" />
        </div>
        <p v-if="info.orientation !== 'square'" class="faint hint">{{ labels.hint }}</p>
        <NSlider v-if="info.orientation !== 'square'" v-model:value="sliderValue" :min="0" :max="1000" :tooltip="false" class="slider" />
      </div>
      <div class="side">
        <div class="section-title">实时预览</div>
        <div class="previews">
          <div class="preview-item">
            <div class="frame" style="width: 120px; height: 120px">
              <img :src="src" alt="" :style="imgStyle" />
            </div>
            <span class="faint">作品列表 120px</span>
          </div>
          <div class="preview-item">
            <div class="frame" style="width: 80px; height: 80px">
              <img :src="src" alt="" :style="imgStyle" />
            </div>
            <span class="faint">搜索 / 推荐 80px</span>
          </div>
        </div>
        <template v-if="info.orientation !== 'square'">
          <div class="section-title">快速对齐</div>
          <div class="presets">
            <NButton size="small" @click="value = 0">{{ labels.start }}</NButton>
            <NButton size="small" @click="value = info.max / 2">居中</NButton>
            <NButton size="small" @click="value = info.max">{{ labels.end }}</NButton>
          </div>
        </template>
        <code class="mono faint coords">
          crop_x={{ (info.orientation === "horizontal" ? value : 0).toFixed(4) }}, crop_y={{ (info.orientation === "vertical" ? value : 0).toFixed(4) }}
        </code>
      </div>
    </div>
    <template #footer>
      <div class="footer">
        <NButton @click="show = false">取消</NButton>
        <NButton type="primary" @click="apply">应用</NButton>
      </div>
    </template>
  </NModal>
</template>

<style scoped>
.subtitle {
  margin: 0 0 14px;
}

.body {
  display: flex;
  gap: 24px;
}

.stage-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.stage,
.frame {
  position: relative;
  overflow: hidden;
  border-radius: 8px;
  background: var(--image-bg);
}

.stage.draggable {
  cursor: grab;
  touch-action: none;
}

.stage.draggable:active {
  cursor: grabbing;
}

.stage img,
.frame img {
  position: absolute;
  top: 0;
  left: 0;
  user-select: none;
}

.stage::after {
  content: "";
  position: absolute;
  inset: 0;
  border: 2px solid var(--primary);
  border-radius: 8px;
  pointer-events: none;
}

.hint {
  margin: 0;
  font-size: 12px;
}

.slider {
  width: 280px;
}

.side {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.previews {
  display: flex;
  align-items: flex-end;
  gap: 16px;
}

.preview-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
}

.presets {
  display: flex;
  gap: 6px;
}

.coords {
  font-size: 11px;
}

.footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
