import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

// 构建产物直接输出到 Python 包内，由 FastAPI 提供服务；运行时不需要 Node。
// 开发时 `npm run dev`，API 请求代理到本地 `publishing-workspace web`（默认 61300 端口）。
const apiTarget = process.env.PW_API_TARGET ?? "http://127.0.0.1:61300";

export default defineConfig(({ command }) => ({
  // 生产构建的静态资源挂在 /app/ 下，页面路由（/library、/calendar）由后端返回同一个 index.html
  base: command === "build" ? "/app/" : "/",
  plugins: [vue()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: {
    outDir: fileURLToPath(new URL("../src/publishing_workspace/web/static/app", import.meta.url)),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
  server: {
    port: 5173,
    proxy: { "/api": apiTarget },
  },
}));
