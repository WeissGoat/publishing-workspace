<script setup lang="ts">
import { darkTheme, NConfigProvider, NDialogProvider, NMessageProvider, zhCN, dateZhCN } from "naive-ui";
import { computed } from "vue";
import AppHeader from "@/components/layout/AppHeader.vue";
import NotifyBridge from "@/components/layout/NotifyBridge.vue";
import { useUiStore } from "@/stores/ui";
import { naiveOverrides } from "@/theme/palette";

const ui = useUiStore();
const naiveTheme = computed(() => (ui.theme === "dark" ? darkTheme : null));
const overrides = computed(() => naiveOverrides(ui.palette));
</script>

<template>
  <NConfigProvider :theme="naiveTheme" :theme-overrides="overrides" :locale="zhCN" :date-locale="dateZhCN">
    <NMessageProvider placement="top" :max="4">
      <NDialogProvider>
        <NotifyBridge />
        <div class="app-shell">
          <AppHeader />
          <RouterView v-slot="{ Component }">
            <KeepAlive>
              <component :is="Component" />
            </KeepAlive>
          </RouterView>
        </div>
      </NDialogProvider>
    </NMessageProvider>
  </NConfigProvider>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
</style>
