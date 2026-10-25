import type { GlobalThemeOverrides } from "naive-ui";

export type ThemeName = "dark" | "light";

// 单一配色来源：同时生成页面 CSS 变量与 Naive UI 主题覆盖，保证自定义组件与组件库一致
export interface Palette {
  bg: string;
  surface: string;
  surface2: string;
  surface3: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textFaint: string;
  primary: string;
  primaryHover: string;
  primaryPressed: string;
  primarySoft: string;
  onPrimary: string;
  favorite: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  info: string;
  imageBg: string;
  overlay: string;
  shadow: string;
}

export const palettes: Record<ThemeName, Palette> = {
  dark: {
    bg: "#0e1014",
    surface: "#16191f",
    surface2: "#1d2128",
    surface3: "#252a33",
    border: "#2a2f39",
    borderStrong: "#3a404c",
    text: "#e7e9ee",
    textMuted: "#a0a7b4",
    textFaint: "#6c7381",
    primary: "#4c8dff",
    primaryHover: "#6aa1ff",
    primaryPressed: "#3a76e0",
    primarySoft: "rgba(76, 141, 255, 0.16)",
    onPrimary: "#ffffff",
    favorite: "#f7b733",
    success: "#34c27a",
    successSoft: "rgba(52, 194, 122, 0.16)",
    warning: "#f0a03c",
    warningSoft: "rgba(240, 160, 60, 0.16)",
    danger: "#f05252",
    dangerSoft: "rgba(240, 82, 82, 0.16)",
    info: "#4c8dff",
    imageBg: "#0a0b0e",
    overlay: "rgba(5, 6, 8, 0.72)",
    shadow: "0 10px 30px rgba(0, 0, 0, 0.45)",
  },
  light: {
    bg: "#f3f4f7",
    surface: "#ffffff",
    surface2: "#f6f7f9",
    surface3: "#eceef2",
    border: "#e1e4ea",
    borderStrong: "#cdd2db",
    text: "#1b1f27",
    textMuted: "#5b6372",
    textFaint: "#8d94a2",
    primary: "#2f6fe4",
    primaryHover: "#4a83ec",
    primaryPressed: "#245bc0",
    primarySoft: "rgba(47, 111, 228, 0.1)",
    onPrimary: "#ffffff",
    favorite: "#e6a100",
    success: "#1f9d5a",
    successSoft: "rgba(31, 157, 90, 0.1)",
    warning: "#c97a12",
    warningSoft: "rgba(201, 122, 18, 0.1)",
    danger: "#d93636",
    dangerSoft: "rgba(217, 54, 54, 0.1)",
    info: "#2f6fe4",
    imageBg: "#e7e9ee",
    overlay: "rgba(20, 24, 32, 0.55)",
    shadow: "0 10px 30px rgba(20, 24, 32, 0.12)",
  },
};

const FONT =
  '"Inter", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", system-ui, -apple-system, "Segoe UI", sans-serif';

export function cssVariables(p: Palette): Record<string, string> {
  return {
    "--bg": p.bg,
    "--surface": p.surface,
    "--surface-2": p.surface2,
    "--surface-3": p.surface3,
    "--border": p.border,
    "--border-strong": p.borderStrong,
    "--text": p.text,
    "--text-muted": p.textMuted,
    "--text-faint": p.textFaint,
    "--primary": p.primary,
    "--primary-hover": p.primaryHover,
    "--primary-soft": p.primarySoft,
    "--on-primary": p.onPrimary,
    "--favorite": p.favorite,
    "--success": p.success,
    "--success-soft": p.successSoft,
    "--warning": p.warning,
    "--warning-soft": p.warningSoft,
    "--danger": p.danger,
    "--danger-soft": p.dangerSoft,
    "--image-bg": p.imageBg,
    "--overlay": p.overlay,
    "--shadow": p.shadow,
    "--font": FONT,
  };
}

export function naiveOverrides(p: Palette): GlobalThemeOverrides {
  return {
    common: {
      fontFamily: FONT,
      fontSize: "13px",
      fontSizeMedium: "13px",
      borderRadius: "6px",
      borderRadiusSmall: "4px",
      primaryColor: p.primary,
      primaryColorHover: p.primaryHover,
      primaryColorPressed: p.primaryPressed,
      primaryColorSuppl: p.primary,
      successColor: p.success,
      warningColor: p.warning,
      errorColor: p.danger,
      infoColor: p.info,
      bodyColor: p.bg,
      cardColor: p.surface,
      modalColor: p.surface,
      popoverColor: p.surface2,
      tableColor: p.surface,
      inputColor: p.surface2,
      borderColor: p.border,
      dividerColor: p.border,
      textColorBase: p.text,
      textColor1: p.text,
      textColor2: p.text,
      textColor3: p.textMuted,
      placeholderColor: p.textFaint,
      placeholderColorDisabled: p.textFaint,
    },
    Drawer: { color: p.surface },
    Tag: { borderRadius: "4px" },
  };
}
