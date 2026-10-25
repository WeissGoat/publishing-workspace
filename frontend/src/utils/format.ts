const pad = (n: number) => String(n).padStart(2, "0");

function parseDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(String(iso).replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 今天显示「今天 HH:mm」，其他显示「MM-DD HH:mm」。 */
export function formatShortTime(iso: string | null | undefined): string {
  const d = parseDate(iso);
  if (!d) return "";
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.toDateString() === new Date().toDateString()) return `今天 ${hm}`;
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`;
}

export function formatDateTime(iso: string | null | undefined, withSeconds = false): string {
  const d = parseDate(iso);
  if (!d) return iso ? String(iso).slice(0, withSeconds ? 19 : 16).replace("T", " ") : "";
  const base = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return withSeconds ? `${base}:${pad(d.getSeconds())}` : base;
}

/** 定时发布时间窗：允许延迟时显示「开始 - 截止」。 */
export function formatScheduleWindow(iso: string | null | undefined, allowDelay: boolean, maxDelayMinutes: number): string {
  const d = parseDate(iso);
  if (!d) return "排期时间";
  const start = formatDateTime(iso);
  if (allowDelay && maxDelayMinutes > 0) {
    return `${start} - ${formatDateTime(new Date(d.getTime() + maxDelayMinutes * 60_000).toISOString())}`;
  }
  return start;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 本地日期与时间拼成后端使用的 +08:00 排期时间（与旧前端一致）。 */
export function toScheduledAt(date: string, time: string): string {
  return `${date}T${time || "20:00"}:00+08:00`;
}

export function splitScheduledAt(iso: string | null | undefined): { date: string; time: string } {
  if (!iso) return { date: "", time: "20:00" };
  const [date, rest = ""] = iso.split("T");
  return { date, time: rest.slice(0, 5) || "20:00" };
}

export function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function shiftMonth(month: string, offset: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + offset, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function localDateString(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
