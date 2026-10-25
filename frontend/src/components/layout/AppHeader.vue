<script setup lang="ts">
import { CalendarDays, Images, Moon, RefreshCw, Sun } from "@lucide/vue";
import { NButton, NTooltip } from "naive-ui";
import { useAppStore } from "@/stores/app";
import { useUiStore } from "@/stores/ui";

const ui = useUiStore();
const app = useAppStore();
</script>

<template>
  <header class="app-header">
    <div class="brand">
      <span class="brand-mark">PW</span>
      <span class="brand-name">Publishing Workspace</span>
    </div>
    <nav class="nav">
      <RouterLink to="/library" class="nav-link" active-class="active">
        <Images :size="15" />
        <span>素材库与投稿</span>
      </RouterLink>
      <RouterLink to="/calendar" class="nav-link" active-class="active">
        <CalendarDays :size="15" />
        <span>月度计划</span>
      </RouterLink>
    </nav>
    <div class="actions">
      <slot name="actions" />
      <NTooltip>
        <template #trigger>
          <NButton quaternary circle size="small" aria-label="刷新数据" @click="app.refresh()">
            <template #icon><RefreshCw :size="16" /></template>
          </NButton>
        </template>
        刷新数据
      </NTooltip>
      <NTooltip>
        <template #trigger>
          <NButton quaternary circle size="small" aria-label="切换主题" @click="ui.toggleTheme()">
            <template #icon>
              <Sun v-if="ui.theme === 'dark'" :size="16" />
              <Moon v-else :size="16" />
            </template>
          </NButton>
        </template>
        {{ ui.theme === "dark" ? "切换到浅色" : "切换到深色" }}
      </NTooltip>
    </div>
  </header>
</template>

<style scoped>
.app-header {
  position: sticky;
  top: 0;
  z-index: 50;
  height: 48px;
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 0 16px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}

.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.brand-mark {
  display: inline-grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  background: var(--primary);
  color: var(--on-primary);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.brand-name {
  font-weight: 600;
  font-size: 14px;
  white-space: nowrap;
}

.nav {
  display: flex;
  gap: 4px;
}

.nav-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border-radius: 6px;
  color: var(--text-muted);
  font-weight: 500;
  transition: background 0.15s, color 0.15s;
}

.nav-link:hover {
  color: var(--text);
  background: var(--surface-2);
}

.nav-link.active {
  color: var(--text);
  background: var(--surface-3);
}

.actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 4px;
}

@media (max-width: 640px) {
  .brand-name {
    display: none;
  }
}
</style>
