// 日历拖拽使用的 dataTransfer 类型：在 dragover 阶段即可凭类型判断是否接受放置
export const ENTRY_MIME = "application/x-pw-entry";
export const TASK_MIME = "application/x-pw-task";

export interface PreviewItem {
  src: string;
  caption: string;
}
