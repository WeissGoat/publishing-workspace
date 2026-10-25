import { useLocalStorage } from "@vueuse/core";
import { defineStore } from "pinia";
import { computed, watchEffect } from "vue";
import { cssVariables, palettes, type ThemeName } from "@/theme/palette";

export const useUiStore = defineStore("ui", () => {
  const stored = useLocalStorage<string>("pw_theme", "dark");
  // 兼容带引号或无效的存储值，统一归一为 dark / light
  const theme = computed<ThemeName>({
    get: () => (stored.value.replace(/"/g, "") === "light" ? "light" : "dark"),
    set: (value) => {
      stored.value = value;
    },
  });
  const palette = computed(() => palettes[theme.value]);

  watchEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme.value;
    root.style.colorScheme = theme.value;
    for (const [key, value] of Object.entries(cssVariables(palette.value))) {
      root.style.setProperty(key, value);
    }
  });

  function toggleTheme() {
    theme.value = theme.value === "dark" ? "light" : "dark";
  }

  return { theme, palette, toggleTheme };
});
