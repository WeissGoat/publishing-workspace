// localStorage 读写：私密窗口或存储被禁用时静默回退，不影响页面使用。
// raw=true 时按纯字符串存取（兼容旧前端直接写入的字符串值，如 library_sort_by）。

export function readStorage<T>(key: string, fallback: T, raw = false): T {
  try {
    const value = localStorage.getItem(key);
    if (value === null) return fallback;
    return raw ? (value as unknown as T) : (JSON.parse(value) as T);
  } catch {
    return fallback;
  }
}

export function writeStorage(key: string, value: unknown, raw = false) {
  try {
    localStorage.setItem(key, raw ? String(value) : JSON.stringify(value));
  } catch {
    // 忽略存储失败
  }
}
