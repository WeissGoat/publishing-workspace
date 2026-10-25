<script setup lang="ts">
import { Brush, Check, Eraser, Eye, Redo2, Rocket, SplitSquareHorizontal, Star, Trash2, Undo2, X } from "@lucide/vue";
import { onKeyStroke } from "@vueuse/core";
import { NButton, NInput, NProgress, NRadioButton, NRadioGroup, NSlider } from "naive-ui";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { api, previewUrl } from "@/api";
import { errorText, notify } from "@/composables/notify";
import { loadImage, useFitCanvas } from "@/composables/useFitCanvas";
import { useInpaintStore, type Batch, type Candidate } from "@/stores/inpaint";
import { useLibraryStore } from "@/stores/library";
import { useLightboxStore } from "@/stores/lightbox";
import { useSubmissionStore } from "@/stores/submission";

const props = defineProps<{ assetId: string }>();

const ip = useInpaintStore();
const lb = useLightboxStore();
const lib = useLibraryStore();
const sub = useSubmissionStore();

const area = ref<HTMLElement | null>(null);
const bgCanvas = ref<HTMLCanvasElement | null>(null);
const maskCanvas = ref<HTMLCanvasElement | null>(null);
const cursorCanvas = ref<HTMLCanvasElement | null>(null);
const { box, setImageSize, toImage } = useFitCanvas(area);

const loaded = ref(false);
const generating = ref(false);
const applying = ref(false);
const progress = ref(0);
const progressText = ref("");
const showOriginal = ref(false);
const slider = ref(50);
let imgW = 0;
let imgH = 0;
let painting = false;
let progressTimer: ReturnType<typeof setInterval> | undefined;

const MASK_COLOR = "rgba(236, 72, 153, 0.65)";
const canUndo = computed(() => ip.undoStack.length > 1);
const canRedo = computed(() => ip.redoStack.length > 0);
const totalCandidates = computed(() => ip.activeCandidates.length);
const canvasStyle = computed(() => ({
  width: `${box.width}px`,
  height: `${box.height}px`,
  left: `${box.offsetX}px`,
  top: `${box.offsetY}px`,
}));

function maskCtx() {
  return maskCanvas.value!.getContext("2d", { willReadFrequently: true })!;
}

function snapshot(): ImageData {
  return maskCtx().getImageData(0, 0, imgW, imgH);
}

async function setup() {
  if (ip.assetId !== props.assetId) {
    await ip.discardIfPending();
    const g = lb.details?.asset_id === props.assetId ? lb.details.generation_info : undefined;
    ip.reset(props.assetId, { prompt: g?.prompt, negative: g?.negative_prompt });
  }
  loaded.value = false;
  const img = await loadImage(previewUrl(props.assetId, lb.bust)).catch(() => null);
  if (!img || !bgCanvas.value || !maskCanvas.value || !cursorCanvas.value) {
    notify.error("加载原图到局部重绘编辑器失败");
    return;
  }
  imgW = img.naturalWidth;
  imgH = img.naturalHeight;
  for (const c of [bgCanvas.value, maskCanvas.value, cursorCanvas.value]) {
    c.width = imgW;
    c.height = imgH;
  }
  bgCanvas.value.getContext("2d")!.drawImage(img, 0, 0, imgW, imgH);
  const top = ip.undoStack[ip.undoStack.length - 1];
  if (top && top.width === imgW && top.height === imgH) maskCtx().putImageData(top, 0, 0);
  else ip.pushUndo(snapshot());
  setImageSize(imgW, imgH);
  loaded.value = true;
}

// 详情晚于编辑器加载时补齐原图提示词
watch(
  () => lb.details,
  (d) => {
    if (!d || d.asset_id !== props.assetId) return;
    if (!ip.prompt) ip.prompt = d.generation_info?.prompt ?? "";
    if (!ip.negativePrompt) ip.negativePrompt = d.generation_info?.negative_prompt ?? "";
  },
);

function paintAt(x: number, y: number) {
  const ctx = maskCtx();
  ctx.fillStyle = MASK_COLOR;
  ctx.beginPath();
  ctx.arc(x, y, Math.round(ip.brushSize / box.scale), 0, Math.PI * 2);
  ctx.fill();
}

function drawCursor(x: number, y: number) {
  const ctx = cursorCanvas.value!.getContext("2d")!;
  ctx.clearRect(0, 0, imgW, imgH);
  const r = Math.round(ip.brushSize / box.scale);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(236, 72, 153, 0.95)";
  ctx.lineWidth = Math.max(1, 2 / box.scale);
  ctx.stroke();
  ctx.fillStyle = "rgba(236, 72, 153, 0.15)";
  ctx.fill();
}

function onPointerDown(e: PointerEvent) {
  if (!loaded.value || e.button !== 0) return;
  painting = true;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  const p = toImage(e.clientX, e.clientY);
  paintAt(p.x, p.y);
}

function onPointerMove(e: PointerEvent) {
  if (!loaded.value) return;
  const p = toImage(e.clientX, e.clientY);
  drawCursor(p.x, p.y);
  if (painting) paintAt(p.x, p.y);
}

function onPointerUp() {
  if (!painting) return;
  painting = false;
  ip.pushUndo(snapshot());
}

function onPointerLeave() {
  cursorCanvas.value?.getContext("2d")?.clearRect(0, 0, imgW, imgH);
}

function undo() {
  const snap = ip.undo();
  if (snap) maskCtx().putImageData(snap, 0, 0);
}

function redo() {
  const snap = ip.redo();
  if (snap) maskCtx().putImageData(snap, 0, 0);
}

function clearMask() {
  maskCtx().clearRect(0, 0, imgW, imgH);
  ip.pushUndo(snapshot());
}

onKeyStroke(["z", "y"], (e) => {
  if (!(e.ctrlKey || e.metaKey) || ip.viewMode !== "mask") return;
  e.preventDefault();
  if (e.key === "z") undo();
  else redo();
});

/** 遮罩转为黑白二值 PNG：涂抹区域为白色。 */
function binaryMask(): string | null {
  const src = snapshot().data;
  const off = document.createElement("canvas");
  off.width = imgW;
  off.height = imgH;
  const ctx = off.getContext("2d")!;
  const out = ctx.createImageData(imgW, imgH);
  let any = false;
  for (let i = 0; i < src.length; i += 4) {
    const on = src[i + 3] > 10;
    any ||= on;
    const v = on ? 255 : 0;
    out.data[i] = v;
    out.data[i + 1] = v;
    out.data[i + 2] = v;
    out.data[i + 3] = 255;
  }
  if (!any) return null;
  ctx.putImageData(out, 0, 0);
  return off.toDataURL("image/png");
}

async function generate() {
  const mask = binaryMask();
  if (!mask) {
    notify.warning("请先在画布上涂抹要重绘的区域");
    return;
  }
  const count = ip.count;
  const strength = ip.strength;
  generating.value = true;
  progress.value = 5;
  progressText.value = count === 1 ? "正在重绘候选图…" : `正在生成第 1 / ${count} 张…`;
  // 生成接口一次返回全部结果，这里按约 5 秒/张估算进度
  const stepPerTick = (88 / (count * 5000)) * 200;
  progressTimer = setInterval(() => {
    progress.value = Math.min(92, progress.value + stepPerTick);
    if (count > 1) progressText.value = `正在生成第 ${Math.min(count, Math.floor((progress.value / 90) * count) + 1)} / ${count} 张…`;
  }, 200);
  try {
    const result = await api.inpaintGenerate(props.assetId, {
      mask_base64: mask,
      prompt: ip.prompt,
      negative_prompt: ip.negativePrompt,
      strength,
      count,
    });
    ip.addBatch(result.session_id, result.candidates, strength);
    progress.value = 100;
    progressText.value = `已生成 ${result.candidates.length} 张候选图`;
    notify.success(`第 ${ip.batches.length} 轮生成完成，可在右侧选择并对比`);
    slider.value = 50;
  } catch (err) {
    progressText.value = `生成失败：${errorText(err)}`;
    notify.error(`局部重绘失败：${errorText(err)}`);
  } finally {
    clearInterval(progressTimer);
    generating.value = false;
    setTimeout(() => {
      if (!generating.value) progress.value = 0;
    }, 1500);
  }
}

function selectCandidate(c: Candidate) {
  ip.select(c);
  slider.value = 50;
}

function isActive(c: Candidate) {
  return ip.activeKey === `${c.batchId}:${c.candidate_id}`;
}

function visibleCandidates(b: Batch) {
  return b.candidates.filter((c) => !c.deleted);
}

async function apply() {
  const cand = ip.activeCandidate;
  if (!cand) return;
  applying.value = true;
  const oldId = props.assetId;
  try {
    const res = await api.inpaintApply(oldId, cand.sessionId, cand.candidate_id);
    const newId = res.new_asset_id || oldId;
    lib.renameAsset(oldId, newId, { width: res.width ?? cand.width, height: res.height ?? cand.height });
    const inSubmission = sub.renameAsset(oldId, newId);
    ip.reset(null);
    lb.renameAsset(oldId, newId);
    lb.mode = "view";
    if (inSubmission && sub.current.task_id) await sub.save("局部重绘已覆盖原图，当前投稿已自动同步保存");
    else notify.success("局部重绘结果已覆盖原图");
  } catch (err) {
    notify.error(`覆盖原图失败：${errorText(err)}`);
  } finally {
    applying.value = false;
  }
}

async function discardAll() {
  await ip.discard();
  clearMask();
  notify.info("已放弃全部重绘结果，原图保持不变");
}

// 对比滑块
const compareInner = ref<HTMLElement | null>(null);
let dragging = false;

function updateSlider(clientX: number) {
  const rect = compareInner.value?.getBoundingClientRect();
  if (!rect?.width) return;
  slider.value = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
}

function onCompareDown(e: PointerEvent) {
  dragging = true;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  updateSlider(e.clientX);
}

function onCompareMove(e: PointerEvent) {
  if (dragging) updateSlider(e.clientX);
}

function onCompareUp() {
  dragging = false;
}

onMounted(async () => {
  await nextTick();
  await setup();
});

onBeforeUnmount(() => clearInterval(progressTimer));
</script>

<template>
  <div class="editor">
    <div class="workspace">
      <div class="toolbar">
        <NRadioGroup v-model:value="ip.viewMode" size="small">
          <NRadioButton value="mask"><Brush :size="13" class="icon" /> 调整遮罩</NRadioButton>
          <NRadioButton value="compare" :disabled="!ip.activeCandidate">
            <SplitSquareHorizontal :size="13" class="icon" /> 效果对比
          </NRadioButton>
        </NRadioGroup>
        <template v-if="ip.viewMode === 'mask'">
          <div class="brush">
            <span class="muted">画笔</span>
            <NSlider v-model:value="ip.brushSize" :min="10" :max="150" :step="2" class="brush-slider" />
            <span class="mono faint">{{ ip.brushSize }}</span>
          </div>
          <NButton size="small" quaternary :disabled="!canUndo" @click="undo">
            <template #icon><Undo2 :size="15" /></template>撤销
          </NButton>
          <NButton size="small" quaternary :disabled="!canRedo" @click="redo">
            <template #icon><Redo2 :size="15" /></template>重做
          </NButton>
          <NButton size="small" quaternary @click="clearMask">
            <template #icon><Eraser :size="15" /></template>清空遮罩
          </NButton>
        </template>
        <template v-else>
          <NButton
            size="small"
            secondary
            @mousedown="showOriginal = true"
            @mouseup="showOriginal = false"
            @mouseleave="showOriginal = false"
            @touchstart.passive="showOriginal = true"
            @touchend="showOriginal = false"
          >
            <template #icon><Eye :size="15" /></template>按住看原图
          </NButton>
          <NButton size="small" quaternary @click="slider = 50">居中对比</NButton>
        </template>
      </div>

      <div ref="area" class="area">
        <div
          v-show="ip.viewMode === 'mask'"
          class="mask-layer"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
          @pointerleave="onPointerLeave"
        >
          <canvas ref="bgCanvas" class="canvas" :style="canvasStyle" />
          <canvas ref="maskCanvas" class="canvas" :style="canvasStyle" />
          <canvas ref="cursorCanvas" class="canvas cursor" :style="canvasStyle" />
        </div>
        <div v-if="ip.viewMode === 'compare' && ip.activeCandidate" class="compare-layer">
          <div
            ref="compareInner"
            class="compare"
            :style="canvasStyle"
            @pointerdown="onCompareDown"
            @pointermove="onCompareMove"
            @pointerup="onCompareUp"
            @pointercancel="onCompareUp"
          >
            <img :src="previewUrl(assetId, lb.bust)" alt="原图" class="compare-img" draggable="false" />
            <div v-show="!showOriginal" class="after" :style="{ clipPath: `inset(0 0 0 ${slider}%)` }">
              <img :src="ip.activeCandidate.preview_url" alt="重绘结果" class="compare-img" draggable="false" />
            </div>
            <div class="handle" :style="{ left: `${slider}%` }"><span class="pill">◀ ▶</span></div>
            <span class="label left">原图</span>
            <span class="label right">第 {{ ip.activeCandidate.round }} 轮 #{{ ip.activeCandidate.indexInRound }}</span>
          </div>
        </div>
      </div>
    </div>

    <aside class="side">
      <div class="side-body">
        <section class="card">
          <h4 class="card-title">局部重绘设置</h4>
          <p class="faint hint">在左侧涂抹要重绘的区域；未涂抹区域与原图生成参数（模型、步数、CFG、采样器等）保持一致。</p>
          <label class="field-label">正向提示词</label>
          <NInput v-model:value="ip.prompt" type="textarea" :autosize="{ minRows: 3, maxRows: 8 }" placeholder="默认继承原图提示词" />
          <label class="field-label">负向提示词</label>
          <NInput v-model:value="ip.negativePrompt" type="textarea" :autosize="{ minRows: 2, maxRows: 6 }" placeholder="默认继承原图负向提示词" />
          <div class="row-between">
            <label class="field-label">去噪强度</label>
            <span class="mono">{{ ip.strength.toFixed(2) }}</span>
          </div>
          <NSlider v-model:value="ip.strength" :min="0.1" :max="1" :step="0.05" :marks="{ 0.1: '微调', 0.7: '适中', 1: '大幅' }" />
          <label class="field-label">生成张数</label>
          <NRadioGroup v-model:value="ip.count" size="small">
            <NRadioButton :value="1">1 张</NRadioButton>
            <NRadioButton :value="2">2 张</NRadioButton>
            <NRadioButton :value="4">4 张</NRadioButton>
          </NRadioGroup>
          <NButton type="primary" block :loading="generating" :disabled="!loaded" @click="generate">
            <template #icon><Rocket :size="15" /></template>
            {{ ip.batches.length ? "再生成一轮" : "开始局部重绘" }}
          </NButton>
          <div v-if="generating || progress" class="progress">
            <NProgress type="line" :percentage="Math.round(progress)" :show-indicator="false" :height="6" />
            <span class="faint">{{ progressText }}</span>
          </div>
        </section>

        <section v-if="totalCandidates" class="card">
          <div class="row-between">
            <h4 class="card-title">候选结果 {{ totalCandidates }}</h4>
            <span class="faint">共 {{ ip.batches.length }} 轮</span>
          </div>
          <div v-for="(b, i) in ip.batches" v-show="visibleCandidates(b).length" :key="b.batchId" class="batch" :class="{ latest: i === 0 }">
            <button type="button" class="batch-head" @click="b.collapsed = !b.collapsed">
              <span class="batch-title">第 {{ b.round }} 轮<template v-if="i === 0">（最新）</template></span>
              <span class="faint">强度 {{ b.strength.toFixed(2) }} · {{ visibleCandidates(b).length }} 张 · {{ b.time }}</span>
              <span class="faint toggle">{{ b.collapsed ? "展开" : "收起" }}</span>
            </button>
            <div v-if="b.collapsed" class="mini-row">
              <img
                v-for="c in visibleCandidates(b)"
                :key="c.candidate_id"
                :src="c.preview_url"
                class="mini"
                :class="{ active: isActive(c) }"
                :title="`第 ${c.round} 轮 #${c.indexInRound}（Seed ${c.seed}）`"
                @click="selectCandidate(c)"
              />
            </div>
            <div v-else class="cand-grid">
              <div v-for="c in visibleCandidates(b)" :key="c.candidate_id" class="cand" :class="{ active: isActive(c) }" @click="selectCandidate(c)">
                <img :src="c.preview_url" :alt="`候选 #${c.indexInRound}`" loading="lazy" />
                <span class="cand-badge">#{{ c.indexInRound }}</span>
                <div class="cand-actions">
                  <button type="button" :class="{ on: c.starred }" :aria-label="c.starred ? '取消标记' : '标记心仪'" @click.stop="c.starred = !c.starred">
                    <Star :size="13" :fill="c.starred ? 'currentColor' : 'none'" />
                  </button>
                  <button type="button" aria-label="剔除" @click.stop="ip.remove(c)"><X :size="13" /></button>
                </div>
                <div class="cand-meta faint">Seed {{ c.seed }}</div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div v-if="totalCandidates" class="footer">
        <NButton type="success" block :loading="applying" :disabled="!ip.activeCandidate" @click="apply">
          <template #icon><Check :size="15" /></template>
          <template v-if="ip.activeCandidate">采用第 {{ ip.activeCandidate.round }} 轮 #{{ ip.activeCandidate.indexInRound }} 覆盖原图</template>
          <template v-else>选择一张候选图</template>
        </NButton>
        <NButton block secondary type="error" @click="discardAll">
          <template #icon><Trash2 :size="15" /></template>放弃全部重绘结果
        </NButton>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.editor {
  flex: 1;
  min-width: 0;
  display: flex;
}

.workspace {
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
  gap: 8px;
  min-height: 48px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}

.icon {
  vertical-align: -2px;
}

.brush {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 6px;
}

.brush-slider {
  width: 120px;
}

.area {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.mask-layer,
.compare-layer {
  position: absolute;
  inset: 0;
}

.mask-layer {
  cursor: none;
  touch-action: none;
}

.canvas {
  position: absolute;
}

.cursor {
  pointer-events: none;
}

.compare {
  position: absolute;
  overflow: hidden;
  cursor: ew-resize;
  touch-action: none;
  user-select: none;
}

.compare-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none;
}

.after {
  position: absolute;
  inset: 0;
}

.handle {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  margin-left: -1px;
  background: #fff;
  box-shadow: 0 0 6px rgba(0, 0, 0, 0.6);
  pointer-events: none;
}

.pill {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  padding: 4px 8px;
  border-radius: 12px;
  background: #fff;
  color: #1b1f27;
  font-size: 10px;
  white-space: nowrap;
}

.label {
  position: absolute;
  top: 10px;
  padding: 2px 8px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 11px;
  pointer-events: none;
}

.label.left {
  left: 10px;
}

.label.right {
  right: 10px;
}

.side {
  width: 380px;
  flex: none;
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--border);
  background: var(--surface);
}

.side-body {
  flex: 1;
  overflow-y: auto;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.card {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.card-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}

.hint {
  margin: 0;
  font-size: 12px;
}

.field-label {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-muted);
}

.row-between {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.progress {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}

.batch {
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}

.batch.latest {
  border-color: var(--primary);
}

.batch-head {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: none;
  background: var(--surface-2);
  color: var(--text);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.batch-title {
  font-weight: 600;
}

.toggle {
  margin-left: auto;
}

.mini-row {
  display: flex;
  gap: 6px;
  padding: 8px;
  overflow-x: auto;
}

.mini {
  width: 44px;
  height: 60px;
  object-fit: cover;
  border-radius: 4px;
  border: 2px solid transparent;
  cursor: pointer;
}

.mini.active {
  border-color: var(--primary);
}

.cand-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  padding: 8px;
}

.cand {
  position: relative;
  border: 2px solid transparent;
  border-radius: 6px;
  overflow: hidden;
  background: var(--image-bg);
  cursor: pointer;
}

.cand.active {
  border-color: var(--primary);
}

.cand img {
  width: 100%;
  aspect-ratio: 3 / 4;
  object-fit: cover;
}

.cand-badge {
  position: absolute;
  top: 4px;
  left: 4px;
  padding: 0 6px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 11px;
}

.cand-actions {
  position: absolute;
  top: 4px;
  right: 4px;
  display: flex;
  gap: 4px;
}

.cand-actions button {
  display: inline-grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  cursor: pointer;
}

.cand-actions button.on {
  color: var(--favorite);
}

.cand-meta {
  padding: 3px 6px;
  font-size: 11px;
  background: var(--surface-2);
}

.footer {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  background: var(--surface);
}
</style>
