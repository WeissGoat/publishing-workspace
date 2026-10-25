import { defineStore } from "pinia";
import { ref } from "vue";

// 跨页面的轻量事件：顶部「刷新」按钮递增 refreshTick，各页面监听后重新拉取数据
export const useAppStore = defineStore("app", () => {
  const refreshTick = ref(0);
  function refresh() {
    refreshTick.value += 1;
  }
  return { refreshTick, refresh };
});
