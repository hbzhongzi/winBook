// EPUB 打开诊断日志（D79）：落盘 localStorage 环形缓冲，失败页可直接查看/复制。
// 背景：EpubViewer 原有 logRef 只写 console.info，Wails 生产构建下用户看不到，
// 导致「EPUB 解析失败」无法追溯是哪一步触发（book.opened / display / 空白兜底 / resume）。
// 本模块只做记录与读取，不影响打开流程判定。

import { WriteDiagLog } from "../../wailsjs/go/main/App";

const DIAG_KEY = "bookeditor.epub.diag.v1";
const MAX = 200;

// D87：落盘节流——诊断条目高频写入时避免每条都触发一次文件 IO。
let diskFlushTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleDiskFlush(): void {
  if (diskFlushTimer) return;
  diskFlushTimer = setTimeout(() => {
    diskFlushTimer = null;
    try {
      void WriteDiagLog(getEpubDiagText(200)).catch(() => undefined);
    } catch {
      // Wails 绑定不可用（开发期浏览器）：忽略
    }
  }, 400);
}

export type EpubDiagEntry = { t: number; code: string; detail?: string };

function read(): EpubDiagEntry[] {
  try {
    const raw = localStorage.getItem(DIAG_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is EpubDiagEntry =>
        !!x && typeof x === "object" && typeof (x as EpubDiagEntry).code === "string"
    );
  } catch {
    return [];
  }
}

/** 追加一条诊断；同时输出到 console 便于开发期查看。 */
export function epubDiag(code: string, detail?: string): void {
  const entry: EpubDiagEntry = { t: Date.now(), code, detail };
  try {
    const all = read();
    all.push(entry);
    const trimmed = all.length > MAX ? all.slice(-MAX) : all;
    localStorage.setItem(DIAG_KEY, JSON.stringify(trimmed));
    scheduleDiskFlush(); // D87：同步落盘，取证不依赖点诊断按钮
  } catch {
    // 存储不可用：仅 console
  }
  try {
    console.info("[epub-diag]", code, detail ?? "");
  } catch {
    // 忽略
  }
}

/** 读取全部诊断（按时间正序），供失败页展示。 */
export function getEpubDiag(): EpubDiagEntry[] {
  return read();
}

/** 生成可复制的纯文本（时间 + 阶段码 + 详情）。 */
export function getEpubDiagText(limit = 60): string {
  const all = getEpubDiag();
  const slice = all.length > limit ? all.slice(-limit) : all;
  return slice
    .map((e) => {
      const d = new Date(e.t);
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      const ss = String(d.getSeconds()).padStart(2, "0");
      const ms = String(d.getMilliseconds()).padStart(3, "0");
      return `${hh}:${mm}:${ss}.${ms} ${e.code}${e.detail ? " | " + e.detail : ""}`;
    })
    .join("\n");
}

/** 清空诊断（打开新书时调用，避免跨书混淆）。 */
export function clearEpubDiag(): void {
  try {
    localStorage.removeItem(DIAG_KEY);
  } catch {
    // 忽略
  }
}
