import { defineStore } from "pinia";
import { computed, ref, shallowRef } from "vue";
import { api, type InpaintCandidate } from "@/api";

export interface Candidate extends InpaintCandidate {
  batchId: string;
  sessionId: string;
  round: number;
  indexInRound: number;
  starred: boolean;
  deleted: boolean;
}

export interface Batch {
  batchId: string;
  round: number;
  sessionId: string;
  strength: number;
  time: string;
  collapsed: boolean;
  candidates: Candidate[];
}

const MAX_UNDO = 30;

// 局部重绘编辑状态独立于组件：在「查看 / 局部重绘」之间切换时保留遮罩、候选与提示词
export const useInpaintStore = defineStore("inpaint", () => {
  const assetId = ref<string | null>(null);
  const prompt = ref("");
  const negativePrompt = ref("");
  const strength = ref(0.7);
  const count = ref(2);
  const brushSize = ref(36);
  const batches = ref<Batch[]>([]);
  const activeKey = ref<string | null>(null);
  const viewMode = ref<"mask" | "compare">("mask");
  // 遮罩撤销栈（ImageData 体积大，不做深度响应式）
  const undoStack = shallowRef<ImageData[]>([]);
  const redoStack = shallowRef<ImageData[]>([]);

  const activeCandidates = computed(() => batches.value.flatMap((b) => b.candidates.filter((c) => !c.deleted)));
  const activeCandidate = computed(() => activeCandidates.value.find((c) => `${c.batchId}:${c.candidate_id}` === activeKey.value) ?? null);
  const hasPending = computed(() => batches.value.length > 0);

  function reset(nextAssetId: string | null, defaults: { prompt?: string; negative?: string } = {}) {
    assetId.value = nextAssetId;
    prompt.value = defaults.prompt ?? "";
    negativePrompt.value = defaults.negative ?? "";
    batches.value = [];
    activeKey.value = null;
    viewMode.value = "mask";
    undoStack.value = [];
    redoStack.value = [];
  }

  function pushUndo(snapshot: ImageData) {
    const next = [...undoStack.value, snapshot];
    if (next.length > MAX_UNDO) next.shift();
    undoStack.value = next;
    redoStack.value = [];
  }

  function undo(): ImageData | null {
    if (undoStack.value.length <= 1) return null;
    const stack = [...undoStack.value];
    const current = stack.pop()!;
    undoStack.value = stack;
    redoStack.value = [...redoStack.value, current];
    return stack[stack.length - 1];
  }

  function redo(): ImageData | null {
    if (!redoStack.value.length) return null;
    const redoList = [...redoStack.value];
    const snap = redoList.pop()!;
    redoStack.value = redoList;
    undoStack.value = [...undoStack.value, snap];
    return snap;
  }

  function addBatch(sessionId: string, candidates: InpaintCandidate[], usedStrength: number) {
    const round = batches.value.length + 1;
    const batchId = `batch_${Date.now()}_${round}`;
    const batch: Batch = {
      batchId,
      round,
      sessionId,
      strength: usedStrength,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      collapsed: false,
      candidates: candidates.map((c, i) => ({
        ...c,
        batchId,
        sessionId,
        round,
        indexInRound: i + 1,
        starred: false,
        deleted: false,
      })),
    };
    for (const b of batches.value) b.collapsed = true;
    batches.value = [batch, ...batches.value];
    const first = batch.candidates[0];
    if (first) select(first);
  }

  function select(c: Candidate) {
    activeKey.value = `${c.batchId}:${c.candidate_id}`;
    viewMode.value = "compare";
  }

  function remove(c: Candidate) {
    c.deleted = true;
    if (activeKey.value === `${c.batchId}:${c.candidate_id}`) {
      const next = activeCandidates.value[0];
      if (next) select(next);
      else {
        activeKey.value = null;
        viewMode.value = "mask";
      }
    }
  }

  /** 清理服务端临时候选并清空状态。 */
  async function discard() {
    const sessions = [...new Set(batches.value.map((b) => b.sessionId))];
    batches.value = [];
    activeKey.value = null;
    viewMode.value = "mask";
    await Promise.all(sessions.map((sid) => api.inpaintDiscard(sid).catch(() => undefined)));
  }

  async function discardIfPending() {
    if (hasPending.value) await discard();
  }

  return {
    assetId,
    prompt,
    negativePrompt,
    strength,
    count,
    brushSize,
    batches,
    activeKey,
    viewMode,
    undoStack,
    redoStack,
    activeCandidates,
    activeCandidate,
    hasPending,
    reset,
    pushUndo,
    undo,
    redo,
    addBatch,
    select,
    remove,
    discard,
    discardIfPending,
  };
});
