export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

function withQuery(path: string, query?: Query): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

// 后端错误格式不统一：{detail: "..."}、{detail: {code, message}}、FastAPI 校验错误列表
function errorMessage(body: unknown, status: number): { message: string; code?: string } {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string") return { message: detail };
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    const { message, code } = detail as { message?: string; code?: string };
    if (message) return { message, code };
  }
  if (Array.isArray(detail) && detail.length) {
    const first = detail[0] as { msg?: string };
    if (first?.msg) return { message: first.msg };
  }
  const error = (body as { error?: { message?: string; code?: string } } | null)?.error;
  if (error?.message) return { message: error.message, code: error.code };
  return { message: `请求失败 (HTTP ${status})` };
}

async function request<T>(method: string, path: string, options: { query?: Query; body?: unknown; raw?: BodyInit; headers?: Record<string, string> } = {}): Promise<T> {
  const headers: Record<string, string> = { ...options.headers };
  let body: BodyInit | undefined = options.raw;
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  const res = await fetch(withQuery(path, options.query), { method, headers, body });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const { message, code } = errorMessage(data, res.status);
    throw new ApiError(message, res.status, code);
  }
  return data as T;
}

export const http = {
  get: <T>(path: string, query?: Query) => request<T>("GET", path, { query }),
  post: <T>(path: string, body?: unknown, query?: Query) => request<T>("POST", path, { body, query }),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, { body }),
  putRaw: <T>(path: string, raw: BodyInit, contentType: string) =>
    request<T>("PUT", path, { raw, headers: { "Content-Type": contentType } }),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, { body }),
  delete: <T>(path: string, query?: Query) => request<T>("DELETE", path, { query }),
};

export const enc = encodeURIComponent;
