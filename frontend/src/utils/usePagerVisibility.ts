import { useCallback, useEffect, useRef, useState } from "react";

// 翻页导航显隐（v0.2.6 优化）：把「悬停」升为一级状态，避免移向按钮途中被自动隐藏。
// 共享于 TextViewer / EpubViewer，消灭此前两份重复 timer 实现（D50 即因只改一边踩坑）。
//
// 实现要点：不依赖 mouseenter/mouseleave（WebView2 对合成输入不派发，且跨边界顺序不可靠），
// 改为在容器 mousemove 中对按钮组 DOM 做命中测试——指针落在按钮组上（含子孙）即视为悬停、
// 暂停隐藏；移出到阅读区才启动 2.5s 闲置计时。静止悬停时不再有 mousemove，因最后一次
// 事件即在按钮组上、未启动计时，故保持可见。

// 最后一次交互后闲置多久淡出（与原 F21 的 2.5s 一致）
export const PAGER_IDLE_HIDE_MS = 2500;

export function usePagerVisibility() {
  const [visible, setVisible] = useState(true);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 按钮组 DOM，供容器 mousemove 命中测试（指针在其上时暂停隐藏）
  const pagerElRef = useRef<HTMLElement | null>(null);

  const clearTimers = useCallback(() => {
    if (idleTimer.current) {
      clearTimeout(idleTimer.current);
      idleTimer.current = null;
    }
  }, []);

  const hide = useCallback(() => {
    clearTimers();
    setVisible(false);
  }, [clearTimers]);

  // 任意交互（容器 mousemove / 翻页键 / 章节切换 / 跨 iframe 转发）复现导航。
  // 传入 MouseEvent 且指针落在按钮组上 → 悬停态：暂停隐藏、不启动计时。
  const show = useCallback(
    (e?: MouseEvent) => {
      setVisible(true);
      if (e && pagerElRef.current && pagerElRef.current.contains(e.target as Node)) {
        clearTimers(); // 悬停：暂停隐藏
        return;
      }
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(hide, PAGER_IDLE_HIDE_MS);
    },
    [clearTimers, hide]
  );

  const setPagerEl = useCallback((el: HTMLElement | null) => {
    pagerElRef.current = el;
  }, []);

  useEffect(() => () => clearTimers(), [clearTimers]);

  return { visible, show, setPagerEl };
}
