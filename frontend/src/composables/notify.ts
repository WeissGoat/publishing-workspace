import type { DialogApi, MessageApi } from "naive-ui";

// 由 App.vue 中的 NotifyBridge 注入，使 store 与普通函数也能弹出提示与确认框
let messageApi: MessageApi | null = null;
let dialogApi: DialogApi | null = null;

export function bindNotify(message: MessageApi, dialog: DialogApi) {
  messageApi = message;
  dialogApi = dialog;
}

export const notify = {
  success: (text: string) => messageApi?.success(text, { duration: 3000 }),
  info: (text: string) => messageApi?.info(text, { duration: 3000 }),
  warning: (text: string) => messageApi?.warning(text, { duration: 4000 }),
  error: (text: string) => messageApi?.error(text, { duration: 5000, closable: true }),
};

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function confirmDialog(options: {
  title: string;
  content: string;
  positiveText?: string;
  danger?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    if (!dialogApi) {
      resolve(window.confirm(`${options.title}\n\n${options.content}`));
      return;
    }
    const create = options.danger ? dialogApi.error : dialogApi.warning;
    create({
      title: options.title,
      content: options.content,
      positiveText: options.positiveText ?? "确定",
      negativeText: "取消",
      onPositiveClick: () => resolve(true),
      onNegativeClick: () => resolve(false),
      onClose: () => resolve(false),
      onMaskClick: () => resolve(false),
    });
  });
}
