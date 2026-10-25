<script setup lang="ts">
import { Redo2, Save, Undo2 } from "@lucide/vue";
import { onKeyStroke } from "@vueuse/core";
import { NButton, NSlider } from "naive-ui";
import { computed, nextTick, onMounted, ref, shallowRef } from "vue";
import { api, type BuildImage, type SetName } from "@/api";
import { errorText, notify } from "@/composables/notify";
import { loadImage, useFitCanvas } from "@/composables/useFitCanvas";
import { useLightboxStore } from "@/stores/lightbox";
import { useSubmissionStore } from "@/stores/submission";

const props = defineProps<{
  image: BuildImage;
  context: { taskId: string; selection: SetName };
}>();

const lb = useLightboxStore();
const sub = useSubmissionStore();

const area = ref<HTMLElement | null>(null);
const mainCanvas = ref<HTMLCanvasElement | null>(null);
const cursorCanvas = ref<HTMLCanvasElement | null>(null);
const { box, setImageSize, toImage } = useFitCanvas(area, 24, false);

const brushSize = ref(28);
const blockSize = ref(12);
const loaded = ref(false);
const saving = ref(false);
const undoStack = shallowRef<ImageData[]>([]);
const redoStack = shallowRef<ImageData[]>([]);
let original: ImageData | null = null;
let imgW = 0;
let imgH = 0;
let painting = false;

const canvasStyle = computed(() => ({
  width: `${box.width}px`,
  height: `${box.height}px`,
  left: `${box.offsetX}px`,
  top: `${box.offsetY}px`,
}));

function ctx() {
  return mainCanvas.value!.getContext("2d", { willReadFrequently: true })!;
}

function pushUndo() {
  const next = [...undoStack.value, ctx().getImageData(0, 0, imgW, imgH)];
  if (next.length > 30) next.shift();
  undoStack.value = next;
  redoStack.value = [];
}

/** 以画笔圆心为中心打码：方块对齐全局网格，颜色取自原图，重复涂抹不会累积偏色。 */
function mosaicAt(cx: number, cy: number) {
  if (!original) return;
  const r = Math.round(brushSize.value / box.scale);
  const bs = blockSize.value;
  const x0 = Math.max(0, cx - r);
  const y0 = Math.max(0, cy - r);
  const x1 = Math.min(imgW, cx + r);
  const y1 = Math.min(imgH, cy + r);
  if (x1 <= x0 || y1 <= y0) return;
  const regionW = x1 - x0;
  const regionH = y1 - y0;
  const region = ctx().getImageData(x0, y0, regionW, regionH);
  const out = region.data;
  const src = original.data;
  for (let gy = Math.floor(y0 / bs) * bs; gy < y1; gy += bs) {
    for (let gx = Math.floor(x0 / bs) * bs; gx < x1; gx += bs) {
      const bx0 = Math.max(gx, 0);
      const by0 = Math.max(gy, 0);
      const bx1 = Math.min(gx + bs, imgW);
      const by1 = Math.min(gy + bs, imgH);
      const dx = (bx0 + bx1) / 2 - cx;
      const dy = (by0 + by1) / 2 - cy;
      if (dx * dx + dy * dy > r * r) continue;
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let n = 0;
      for (let py = by0; py < by1; py++) {
        for (let px = bx0; px < bx1; px++) {
          const i = (py * imgW + px) * 4;
          sr += src[i];
          sg += src[i + 1];
          sb += src[i + 2];
          n++;
        }
      }
      const ar = Math.round(sr / n);
      const ag = Math.round(sg / n);
      const ab = Math.round(sb / n);
      for (let py = by0; py < by1; py++) {
        const ly = py - y0;
        if (ly < 0 || ly >= regionH) continue;
        for (let px = bx0; px < bx1; px++) {
          const lx = px - x0;
          if (lx < 0 || lx >= regionW) continue;
          const i = (ly * regionW + lx) * 4;
          out[i] = ar;
          out[i + 1] = ag;
          out[i + 2] = ab;
        }
      }
    }
  }
  ctx().putImageData(region, x0, y0);
}

function drawCursor(x: number, y: number) {
  const c = cursorCanvas.value!.getContext("2d")!;
  c.clearRect(0, 0, imgW, imgH);
  c.beginPath();
  c.arc(x, y, Math.round(brushSize.value / box.scale), 0, Math.PI * 2);
  c.strokeStyle = "rgba(88, 166, 255, 0.9)";
  c.lineWidth = Math.max(1, 2 / box.scale);
  c.stroke();
  c.fillStyle = "rgba(88, 166, 255, 0.08)";
  c.fill();
}

function onDown(e: PointerEvent) {
  if (!loaded.value || e.button !== 0) return;
  painting = true;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  const p = toImage(e.clientX, e.clientY);
  mosaicAt(p.x, p.y);
}

function onMove(e: PointerEvent) {
  if (!loaded.value) return;
  const p = toImage(e.clientX, e.clientY);
  drawCursor(p.x, p.y);
  if (painting) mosaicAt(p.x, p.y);
}

function onUp() {
  if (!painting) return;
  painting = false;
  pushUndo();
}

function undo() {
  if (undoStack.value.length <= 1) return;
  const stack = [...undoStack.value];
  redoStack.value = [...redoStack.value, stack.pop()!];
  undoStack.value = stack;
  ctx().putImageData(stack[stack.length - 1], 0, 0);
}

function redo() {
  if (!redoStack.value.length) return;
  const redoList = [...redoStack.value];
  const snap = redoList.pop()!;
  redoStack.value = redoList;
  undoStack.value = [...undoStack.value, snap];
  ctx().putImageData(snap, 0, 0);
}

onKeyStroke(["z", "y"], (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  e.preventDefault();
  if (e.key === "z") undo();
  else redo();
});

async function save() {
  if (!loaded.value) return;
  saving.value = true;
  try {
    const blob = await new Promise<Blob | null>((resolve) => mainCanvas.value!.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("导出画布失败");
    await api.saveBuildImage(props.context.taskId, props.context.selection, props.image.filename, blob);
    lb.updateBuildImage(props.image.filename, blob.size);
    void sub.loadLatestBuild();
    notify.success("手动打码已保存到发布包");
    lb.mode = "view";
  } catch (err) {
    notify.error(`保存失败：${errorText(err)}`);
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  await nextTick();
  const img = await loadImage(props.image.preview_url).catch(() => null);
  if (!img || !mainCanvas.value || !cursorCanvas.value) {
    notify.error("加载图片到编辑器失败");
    return;
  }
  imgW = img.naturalWidth;
  imgH = img.naturalHeight;
  for (const c of [mainCanvas.value, cursorCanvas.value]) {
    c.width = imgW;
    c.height = imgH;
  }
  ctx().drawImage(img, 0, 0, imgW, imgH);
  original = ctx().getImageData(0, 0, imgW, imgH);
  undoStack.value = [original];
  setImageSize(imgW, imgH);
  loaded.value = true;
});
</script>

<template>
  <div class="editor">
    <div class="toolbar">
      <div class="control">
        <span class="muted">画笔</span>
        <NSlider v-model:value="brushSize" :min="8" :max="80" class="slider" />
        <span class="mono faint">{{ brushSize }}</span>
      </div>
      <div class="control">
        <span class="muted">马赛克强度</span>
        <NSlider v-model:value="blockSize" :min="4" :max="32" class="slider" />
        <span class="mono faint">{{ blockSize }}</span>
      </div>
      <NButton size="small" quaternary :disabled="undoStack.length <= 1" @click="undo">
        <template #icon><Undo2 :size="15" /></template>撤销
      </NButton>
      <NButton size="small" quaternary :disabled="!redoStack.length" @click="redo">
        <template #icon><Redo2 :size="15" /></template>重做
      </NButton>
      <NButton size="small" type="primary" :loading="saving" :disabled="!loaded" class="save" @click="save">
        <template #icon><Save :size="15" /></template>保存到发布包
      </NButton>
    </div>
    <div ref="area" class="area" @pointerdown="onDown" @pointermove="onMove" @pointerup="onUp" @pointercancel="onUp">
      <canvas ref="mainCanvas" class="canvas" :style="canvasStyle" />
      <canvas ref="cursorCanvas" class="canvas cursor" :style="canvasStyle" />
    </div>
  </div>
</template>

<style scoped>
.editor {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--image-bg);
}

.toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  min-height: 48px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}

.control {
  display: flex;
  align-items: center;
  gap: 8px;
}

.slider {
  width: 120px;
}

.save {
  margin-left: auto;
}

.area {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  cursor: none;
  touch-action: none;
}

.canvas {
  position: absolute;
}

.cursor {
  pointer-events: none;
}
</style>
