export type AppError = { code: string; message: string };

// Wails v2 将 Go error 以字符串形式 reject，按 "CODE: message" 前缀解析
export function toAppError(e: unknown): AppError {
  const raw = typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
  const m = /^([A-Z][A-Z0-9_]+):\s*([\s\S]*)$/.exec(raw.trim());
  return m ? { code: m[1], message: m[2].trim() } : { code: "UNKNOWN", message: raw };
}
