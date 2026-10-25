// Pixiv 1:1 缩略图裁剪：crop_x / crop_y 为左上角在原图中的比例坐标（0 ~ 1）
// 横图左右裁、竖图上下裁、正方形无需裁剪；与旧前端和后端发布逻辑保持一致。

export type Orientation = "horizontal" | "vertical" | "square";

export interface CropInfo {
  orientation: Orientation;
  /** 可平移的最大比例 */
  max: number;
  /** Pixiv 官方默认位置：横图居中、竖图置顶 */
  defaultValue: number;
}

export function cropInfo(width: number, height: number): CropInfo {
  if (width > height) return { orientation: "horizontal", max: (width - height) / width, defaultValue: (width - height) / (2 * width) };
  if (height > width) return { orientation: "vertical", max: (height - width) / height, defaultValue: 0 };
  return { orientation: "square", max: 0, defaultValue: 0 };
}

/** 当前生效的裁剪值（未设置时取官方默认），并限制在有效范围内。 */
export function effectiveCrop(info: CropInfo, cropX: number | null, cropY: number | null): number {
  const raw = info.orientation === "horizontal" ? cropX : info.orientation === "vertical" ? cropY : 0;
  const value = raw ?? info.defaultValue;
  return Math.max(0, Math.min(info.max, value));
}

/** 在正方形取景框内显示图片的样式：横图按高度填满后左右平移，竖图按宽度填满后上下平移。 */
export function cropImageStyle(info: CropInfo, value: number): Record<string, string> {
  if (info.orientation === "horizontal") {
    return { height: "100%", width: "auto", maxWidth: "none", transform: `translateX(-${(value * 100).toFixed(4)}%)` };
  }
  if (info.orientation === "vertical") {
    return { width: "100%", height: "auto", maxHeight: "none", transform: `translateY(-${(value * 100).toFixed(4)}%)` };
  }
  return { width: "100%", height: "100%", transform: "none" };
}
