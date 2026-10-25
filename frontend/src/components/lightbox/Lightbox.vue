<script setup lang="ts">
import { ArrowLeft, ChevronLeft, ChevronRight, Eye, Paintbrush, Sparkles, X } from "@lucide/vue";
import { onKeyStroke, useClipboard } from "@vueuse/core";
import { NButton, NTooltip } from "naive-ui";
import { computed, ref, watch } from "vue";
import { previewUrl } from "@/api";
import { notify } from "@/composables/notify";
import { useInpaintStore } from "@/stores/inpaint";
import { useLibraryStore } from "@/stores/library";
import { useLightboxStore, type LightboxMode } from "@/stores/lightbox";
import BuildDetailsPanel from "./BuildDetailsPanel.vue";
import DetailsPanel from "./DetailsPanel.vue";
import InpaintEditor from "./InpaintEditor.vue";
import MosaicEditor from "./MosaicEditor.vue";

const lb = useLightboxStore();
const lib = useLibraryStore();
const inpaintStore = useInpaintStore();
const { copy } = useClipboard({ legacy: true });

// 「按住对比」时临时替换大图
const peek = ref<{ id: string; name: string } | null>(null);

const title = computed(() => {
  if (lb.buildImage) return lb.buildImage.filename;
  return lb.details?.display_name ?? (lb.activeId ? lib.getAsset(lb.activeId)?.display_name : "") ?? lb.activeId ?? "";
});

const path = computed(() => {
  if (lb.build && lb.buildImage) {
    return lb.build.outputDir ? `${lb.build.outputDir}/output/${lb.build.selection}/${lb.buildImage.filename}` : lb.buildImage.filename;
  }
  return lb.details?.path ?? (lb.activeId ? lib.getAsset(lb.activeId)?.path : "") ?? "";
});

const imageSrc = computed(() => {
  if (peek.value) return previewUrl(peek.value.id, "peek");
  if (lb.buildImage) return lb.buildImage.preview_url;
  return lb.activeId ? previewUrl(lb.activeId, lb.bust) : "";
});

const modes = computed<{ key: LightboxMode; label: string; icon: unknown }[]>(() =>
  lb.isBuild
    ? [
        { key: "view", label: "查看", icon: Eye },
        { key: "mosaic", label: "手动打码", icon: Paintbrush },
      ]
    : [
        { key: "view", label: "查看", icon: Eye },
        { key: "inpaint", label: "局部重绘", icon: Sparkles },
      ],
);

const canStep = computed(() => lb.mode === "view" && lb.count > 1);

async function copyPath() {
  if (!path.value) return;
  await copy(path.value);
  notify.info("已复制文件路径");
}

async function close() {
  // 关闭时清理未采用的局部重绘候选（编辑器可能已因切换到「查看」而卸载）
  await inpaintStore.discardIfPending();
  inpaintStore.reset(null);
  lb.close();
}

function startPeek(target: { id: string; name: string }) {
  peek.value = target;
  const stop = () => {
    peek.value = null;
    window.removeEventListener("mouseup", stop);
    window.removeEventListener("touchend", stop);
    window.removeEventListener("blur", stop);
  };
  window.addEventListener("mouseup", stop);
  window.addEventListener("touchend", stop);
  window.addEventListener("blur", stop);
}

function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  return Boolean(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable));
}

onKeyStroke(["ArrowLeft", "ArrowRight", "Backspace", "Escape"], (e) => {
  if (!lb.isOpen || isTyping()) return;
  if (document.querySelector(".n-modal-container .n-modal, .n-dialog")) return;
  if (e.key === "Escape") {
    e.preventDefault();
    void close();
    return;
  }
  if (lb.mode !== "view") return;
  if ((e.key === "Backspace" || (e.altKey && e.key === "ArrowLeft")) && lb.history.length) {
    e.preventDefault();
    lb.back();
    return;
  }
  if (e.key === "ArrowLeft") {
    e.preventDefault();
    lb.step(-1);
  } else if (e.key === "ArrowRight") {
    e.preventDefault();
    lb.step(1);
  }
});

// 打开时锁定页面滚动
watch(
  () => lb.isOpen,
  (open) => {
    document.body.style.overflow = open ? "hidden" : "";
    if (!open) peek.value = null;
  },
);
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="lb.isOpen" class="lightbox" role="dialog" aria-modal="true" :aria-label="title">
        <header class="top">
          <div class="title-group">
            <NButton v-if="lb.history.length && lb.mode === 'view'" size="small" secondary @click="lb.back()">
              <template #icon><ArrowLeft :size="15" /></template>
              返回
            </NButton>
            <div class="title-text">
              <div class="filename truncate" :title="title">
                <span v-if="lb.build" class="build-tag">成品 · {{ lb.build.selection }}</span>{{ title }}
              </div>
              <div class="filepath truncate" :title="`${path}（点击复制）`" @click="copyPath">{{ path }}</div>
            </div>
          </div>
          <div class="mode-tabs" role="tablist">
            <button
              v-for="m in modes"
              :key="m.key"
              type="button"
              role="tab"
              class="mode-tab"
              :class="{ active: lb.mode === m.key }"
              :aria-selected="lb.mode === m.key"
              @click="lb.mode = m.key"
            >
              <component :is="m.icon" :size="14" />
              {{ m.label }}
            </button>
          </div>
          <div class="top-actions">
            <span class="counter">{{ lb.index + 1 }} / {{ lb.count }}</span>
            <NTooltip>
              <template #trigger>
                <NButton quaternary circle aria-label="关闭" @click="close">
                  <template #icon><X :size="18" /></template>
                </NButton>
              </template>
              关闭（Esc）
            </NTooltip>
          </div>
        </header>

        <div class="body">
          <InpaintEditor v-if="lb.mode === 'inpaint' && lb.activeId" :key="lb.activeId" :asset-id="lb.activeId" />
          <MosaicEditor v-else-if="lb.mode === 'mosaic' && lb.buildImage && lb.build" :image="lb.buildImage" :context="lb.build" />
          <template v-else>
            <div class="stage">
              <button v-if="canStep" type="button" class="nav prev" aria-label="上一张" @click="lb.step(-1)">
                <ChevronLeft :size="22" />
              </button>
              <img :key="imageSrc" :src="imageSrc" :alt="title" class="image" />
              <div v-if="peek" class="peek-banner">正在对比：<strong>{{ peek.name }}</strong>（松开恢复）</div>
              <button v-if="canStep" type="button" class="nav next" aria-label="下一张" @click="lb.step(1)">
                <ChevronRight :size="22" />
              </button>
            </div>
            <aside class="side">
              <BuildDetailsPanel v-if="lb.isBuild" />
              <DetailsPanel v-else @peek="startPeek" @request-close="close" />
            </aside>
          </template>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.lightbox {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}

.top {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 16px;
  height: 56px;
  padding: 0 12px 0 16px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}

.title-group {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.title-text {
  min-width: 0;
}

.filename {
  font-weight: 600;
  font-size: 14px;
}

.build-tag {
  margin-right: 6px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--warning-soft);
  color: var(--warning);
  font-size: 11px;
  font-weight: 600;
}

.filepath {
  font-size: 11px;
  color: var(--text-faint);
  cursor: copy;
}

.filepath:hover {
  color: var(--text-muted);
}

.mode-tabs {
  display: flex;
  padding: 3px;
  border-radius: 8px;
  background: var(--surface-3);
}

.mode-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 14px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-weight: 500;
  cursor: pointer;
}

.mode-tab.active {
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}

.top-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.counter {
  font-size: 12px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.body {
  flex: 1;
  min-height: 0;
  display: flex;
}

.stage {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px 64px;
  background: var(--image-bg);
}

.image {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.4);
}

.nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  display: inline-grid;
  place-items: center;
  width: 40px;
  height: 64px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
  opacity: 0.75;
}

.nav:hover {
  opacity: 1;
}

.nav.prev {
  left: 12px;
}

.nav.next {
  right: 12px;
}

.peek-banner {
  position: absolute;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  padding: 6px 12px;
  border-radius: 6px;
  background: var(--warning);
  color: #1b1f27;
  font-size: 12px;
}

.side {
  width: 380px;
  flex: none;
  border-left: 1px solid var(--border);
  background: var(--surface);
  overflow-y: auto;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

@media (max-width: 900px) {
  .top {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .mode-tabs {
    display: none;
  }

  .body {
    flex-direction: column;
  }

  .stage {
    padding: 12px 52px;
    min-height: 50vh;
  }

  .side {
    width: auto;
    border-left: none;
    border-top: 1px solid var(--border);
  }
}
</style>
