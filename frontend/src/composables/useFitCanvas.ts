import { useResizeObserver } from "@vueuse/core";
import { reactive, type Ref } from "vue";

export interface FitBox {
  scale: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

/**
 * 把原尺寸为 imageW × imageH 的画面等比缩放、居中放进容器，返回缩放与偏移；
 * 画布像素保持原图尺寸（1:1 像素操作），只通过 CSS 缩放显示。
 */
export function useFitCanvas(container: Ref<HTMLElement | null>, margin = 24, allowUpscale = true) {
  const box = reactive<FitBox>({ scale: 1, offsetX: 0, offsetY: 0, width: 0, height: 0 });
  let imageW = 0;
  let imageH = 0;
  const listeners: (() => void)[] = [];

  function fit() {
    const el = container.value;
    if (!el || !imageW || !imageH) return;
    const rect = el.getBoundingClientRect();
    const availW = Math.max(100, rect.width - margin);
    const availH = Math.max(100, rect.height - margin);
    let scale = Math.min(availW / imageW, availH / imageH);
    if (!allowUpscale) scale = Math.min(scale, 1);
    box.scale = scale;
    box.width = Math.round(imageW * scale);
    box.height = Math.round(imageH * scale);
    box.offsetX = Math.round((rect.width - box.width) / 2);
    box.offsetY = Math.round((rect.height - box.height) / 2);
    for (const fn of listeners) fn();
  }

  function setImageSize(w: number, h: number) {
    imageW = w;
    imageH = h;
    fit();
  }

  /** 视口坐标 → 原图像素坐标。 */
  function toImage(clientX: number, clientY: number) {
    const rect = container.value!.getBoundingClientRect();
    return {
      x: Math.round((clientX - rect.left - box.offsetX) / box.scale),
      y: Math.round((clientY - rect.top - box.offsetY) / box.scale),
    };
  }

  useResizeObserver(container, fit);

  return { box, fit, setImageSize, toImage, onFit: (fn: () => void) => listeners.push(fn) };
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片加载失败"));
    img.src = src;
  });
}
