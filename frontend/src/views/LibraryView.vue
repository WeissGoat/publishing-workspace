<script setup lang="ts">
import { onKeyStroke, useLocalStorage } from "@vueuse/core";
import { onActivated, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import ActiveFilters from "@/components/library/ActiveFilters.vue";
import BatchBar from "@/components/library/BatchBar.vue";
import FilterSidebar from "@/components/library/FilterSidebar.vue";
import GalleryToolbar from "@/components/library/GalleryToolbar.vue";
import VirtualGallery from "@/components/library/VirtualGallery.vue";
import Lightbox from "@/components/lightbox/Lightbox.vue";
import SubmissionDrawer from "@/components/submission/SubmissionDrawer.vue";
import { useAppStore } from "@/stores/app";
import { useLibraryStore } from "@/stores/library";
import { useLightboxStore } from "@/stores/lightbox";
import { useSubmissionStore } from "@/stores/submission";

const lib = useLibraryStore();
const sub = useSubmissionStore();
const lightbox = useLightboxStore();
const app = useAppStore();
const route = useRoute();

const cardSize = useLocalStorage("library_card_size", 170);
const sidebarCollapsed = useLocalStorage("pw_sidebar_collapsed", false);
const gallery = ref<InstanceType<typeof VirtualGallery> | null>(null);

function openAsset(assetId: string) {
  lightbox.openAsset(
    assetId,
    lib.visibleAssets.map((a) => a.asset_id),
  );
}

async function applyRouteQuery() {
  const submissionId = route.query.submission_id;
  const planId = route.query.plan_id;
  const entryId = route.query.entry_id;
  if (typeof submissionId === "string" && submissionId) {
    await sub.load(submissionId);
  } else if (typeof planId === "string" && typeof entryId === "string" && planId && entryId) {
    await sub.loadLegacyFromPlan(planId, entryId);
  }
}

onMounted(async () => {
  void sub.loadHistory();
  await lib.init();
  await applyRouteQuery();
});

onActivated(() => {
  void applyRouteQuery();
});

watch(
  () => app.refreshTick,
  () => {
    if (route.name !== "library") return;
    void lib.refreshAll();
    void sub.loadHistory();
  },
);

function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  return Boolean(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable));
}

function blocked(): boolean {
  return route.name !== "library" || lightbox.isOpen || isTyping() || Boolean(document.querySelector(".n-modal-container .n-modal"));
}

onKeyStroke(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"], (e) => {
  if (blocked()) return;
  e.preventDefault();
  gallery.value?.moveFocus(e.key as "ArrowLeft");
});

onKeyStroke([" ", "Enter"], (e) => {
  if (blocked() || !lib.focusedId) return;
  e.preventDefault();
  openAsset(lib.focusedId);
});

onKeyStroke("a", (e) => {
  if (blocked() || !(e.ctrlKey || e.metaKey)) return;
  e.preventDefault();
  lib.selectAllLoaded();
});

onKeyStroke("Escape", () => {
  if (blocked()) return;
  if (lib.selected.size) lib.clearSelection();
  else lib.focus(null);
});
</script>

<template>
  <div class="library" :class="{ 'sidebar-collapsed': sidebarCollapsed, 'basket-open': sub.drawerOpen }">
    <FilterSidebar v-show="!sidebarCollapsed" class="sidebar" @collapse="sidebarCollapsed = true" />
    <main class="pane">
      <GalleryToolbar
        v-model:card-size="cardSize"
        :sidebar-collapsed="sidebarCollapsed"
        @expand-sidebar="sidebarCollapsed = false"
      />
      <ActiveFilters />
      <div class="gallery-wrap">
        <VirtualGallery ref="gallery" :card-size="cardSize" @open="openAsset" />
      </div>
    </main>
    <SubmissionDrawer v-if="sub.drawerOpen" class="basket" />
    <BatchBar />
    <Lightbox />
  </div>
</template>

<style scoped>
.library {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
  height: calc(100vh - 48px);
  overflow: hidden;
}

.library.basket-open {
  grid-template-columns: 300px minmax(0, 1fr) 440px;
}

.library.sidebar-collapsed {
  grid-template-columns: minmax(0, 1fr);
}

.library.sidebar-collapsed.basket-open {
  grid-template-columns: minmax(0, 1fr) 440px;
}

.sidebar {
  min-height: 0;
}

.pane {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.gallery-wrap {
  flex: 1;
  min-height: 0;
}

.basket {
  min-height: 0;
}

@media (max-width: 1280px) {
  .library.basket-open {
    grid-template-columns: 260px minmax(0, 1fr) 400px;
  }
}

@media (max-width: 960px) {
  .library,
  .library.basket-open {
    grid-template-columns: minmax(0, 1fr);
  }

  .sidebar {
    position: fixed;
    z-index: 70;
    top: 48px;
    left: 0;
    bottom: 0;
    width: min(320px, 90vw);
    box-shadow: var(--shadow);
  }

  .basket {
    position: fixed;
    z-index: 70;
    top: 48px;
    right: 0;
    bottom: 0;
    width: min(440px, 100vw);
    box-shadow: var(--shadow);
  }
}
</style>
