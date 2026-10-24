// 阅读命令注册表（v0.2.5 F22）：当前挂载的 Viewer 注册一个命令处理器，
// App 的 window 级快捷键派发经此槽位调用。
// 设计要点：
// - 同一时刻只有一个 Viewer 挂载（BookViewer 按格式渲染单个 Viewer，
//   且 state-host key 含 readerMode，切模式即重挂载），故单一槽位足够，
//   无需把命令接口沿 props 钻取；
// - 处理器返回 boolean：true=已消费（调用方 preventDefault），false=未处理；
// - 传入触发键名：滚动模式下允许区分「方向键微滚」与「翻页键整屏」
//   （v0.2.5 D46：避免改变存量滚动模式微操习惯）。
import type { HotkeyAction } from "./readerHotkeys";

export type ReaderCommandHandler = (action: HotkeyAction, key: string) => boolean;

let currentHandler: ReaderCommandHandler | null = null;

/** Viewer 挂载时注册；卸载时传 null 注销（effect cleanup） */
export function setReaderCommandHandler(fn: ReaderCommandHandler | null): void {
  currentHandler = fn;
}

/** 派发命令；返回是否有处理器消费（无处理器/抛错均按未消费处理） */
export function dispatchReaderCommand(action: HotkeyAction, key: string): boolean {
  if (!currentHandler) return false;
  try {
    return currentHandler(action, key);
  } catch {
    return false;
  }
}

// ---- 翻页导航复现（v0.2.5 F21 修正）----
// 翻页模式下 iframe 覆盖整个内容区，宿主 container 的 mousemove 收不到iframe
// 内移动事件（自动隐藏后鼠标无法复现导航）。iframe 内经 postMessage 把
// 「有交互」转到宿主，再经本槽位通知 Viewer 的 showPager()。
let pagerShowHandler: (() => void) | null = null;

/** EPUB 翻页 Viewer 挂载时注册；卸载时传 null 注销 */
export function setPagerShowHandler(fn: (() => void) | null): void {
  pagerShowHandler = fn;
}

/** 通知翻页导航「有交互」：iframe 内鼠标移动等宿主不可见的事件经此复现 */
export function notifyPagerActivity(): void {
  pagerShowHandler?.();
}

/** 滚动步进：方向键微滚（贴近原生手感），翻页键/空格整屏（D46） */
export function scrollStepFor(key: string, viewport: number): number {
  return /^Arrow(Up|Down|Left|Right)$/.test(key) ? Math.min(80, viewport * 0.12) : viewport * 0.9;
}
