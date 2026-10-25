<script setup lang="ts">
import { CheckSquare, PanelLeftOpen, ShoppingBasket, SquareDashedMousePointer } from "@lucide/vue";
import { NBadge, NButton, NSelect, NSlider, NTooltip } from "naive-ui";
import { computed } from "vue";
import type { SortBy } from "@/api";
import { useLibraryStore } from "@/stores/library";
import { useSubmissionStore } from "@/stores/submission";
import { SORT_OPTIONS } from "./constants";

defineProps<{ sidebarCollapsed: boolean }>();
defineEmits<{ expandSidebar: [] }>();
const cardSize = defineModel<number>("cardSize", { required: true });

const lib = useLibraryStore();
const sub = useSubmissionStore();

const loaded = computed(() => lib.visibleAssets.length);
const percent = computed(() => (lib.total ? Math.min(100, Math.round((loaded.value / lib.total) * 100)) : 0));
</script>

<template>
  <div class="toolbar">
    <div class="left">
      <NTooltip v-if="sidebarCollapsed">
        <template #trigger>
          <NButton size="small" quaternary circle aria-label="展开筛选栏" @click="$emit('expandSidebar')">
            <template #icon><PanelLeftOpen :size="16" /></template>
          </NButton>
        </template>
        展开筛选栏
      </NTooltip>
      <div class="count">
        <span class="count-main">{{ lib.total.toLocaleString() }}</span>
        <span class="muted">张</span>
        <span v-if="lib.hasSelection && lib.total" class="faint count-sub">
          已载入 {{ loaded.toLocaleString() }}<template v-if="lib.hasMore"> · {{ percent }}%</template>
        </span>
      </div>
    </div>

    <div class="right">
      <NSelect
        :value="lib.filters.sortBy"
        :options="SORT_OPTIONS"
        size="small"
        class="sort"
        :consistent-menu-width="false"
        @update:value="(v: SortBy) => lib.setSort(v)"
      />
      <NTooltip>
        <template #trigger>
          <div class="size" @dblclick="cardSize = 170">
            <NSlider v-model:value="cardSize" :min="110" :max="360" :step="10" :tooltip="false" />
          </div>
        </template>
        卡片尺寸 {{ cardSize }}px（双击恢复默认）
      </NTooltip>
      <NButton
        size="small"
        :type="lib.batchMode ? 'primary' : 'default'"
        :secondary="lib.batchMode"
        @click="lib.batchMode = !lib.batchMode"
      >
        <template #icon><SquareDashedMousePointer :size="15" /></template>
        {{ lib.batchMode ? "退出多选" : "多选" }}
      </NButton>
      <NButton size="small" :disabled="!lib.visibleAssets.length" @click="lib.selectAllLoaded()">
        <template #icon><CheckSquare :size="15" /></template>
        全选已载入
      </NButton>
      <NBadge :value="sub.totalCount" :show="sub.totalCount > 0" :max="999">
        <NButton size="small" :type="sub.drawerOpen ? 'primary' : 'default'" @click="sub.drawerOpen = !sub.drawerOpen">
          <template #icon><ShoppingBasket :size="15" /></template>
          投稿篮
        </NButton>
      </NBadge>
    </div>
    <div v-if="lib.hasSelection && lib.hasMore && lib.total" class="progress" :style="{ width: `${percent}%` }" />
  </div>
</template>

<style scoped>
.toolbar {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 44px;
  padding: 6px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  flex-wrap: wrap;
}

.left,
.right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.right {
  flex-wrap: wrap;
  justify-content: flex-end;
}

.count {
  display: flex;
  align-items: baseline;
  gap: 4px;
}

.count-main {
  font-size: 16px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}

.count-sub {
  margin-left: 6px;
  font-size: 12px;
}

.sort {
  width: 168px;
}

.size {
  width: 110px;
  padding: 0 4px;
}

.progress {
  position: absolute;
  left: 0;
  bottom: -1px;
  height: 2px;
  background: var(--primary);
  transition: width 0.3s;
}
</style>
