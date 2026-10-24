# -*- coding: utf-8 -*-
"""滚轮注入链路隔离验证。

滚轮打在目录侧栏（普通 overflow:auto 容器）上：
- 侧栏滚动 → 注入有效，说明 Win32 滚轮链路 OK，问题在 iframe 吞事件
- 侧栏不滚动 → 注入本身无效，需换注入方式（如 WM_MOUSEWHEEL / SendInput）
用法：python e2e/wheel_probe.py [文件名]
"""
import ctypes
import hashlib
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import driver as D
from driver import App, log, sleep, shot, flush_log, user32

user32.SetCursorPos = user32.SetCursorPos
MOUSEEVENTF_WHEEL = 0x0800
WHEEL_DELTA = 120


def wheel(notches):
    for _ in range(abs(notches)):
        delta = WHEEL_DELTA if notches > 0 else -WHEEL_DELTA
        ctypes.windll.user32.mouse_event(MOUSEEVENTF_WHEEL, 0, 0, delta, 0)
        sleep(100)


def fp(p):
    return hashlib.md5(open(p, 'rb').read()).hexdigest()[:10]


def main():
    fixture = sys.argv[1] if len(sys.argv) > 1 else "12.epub"
    app = App()
    sleep(2000)
    ok = D.open_file(app, fixture)
    log(f"wheel_probe: open_file({fixture}) -> {ok}")
    sleep(4000)
    r = app.rect()
    L, T, R, B = r

    # 目录侧栏（左侧 224px 宽，条目多于可视高度 → 可滚）
    sx = L + 110
    sy = T + 400
    p0 = shot("wh-00", bbox=r); f0 = fp(p0)
    user32.SetCursorPos(sx, sy); sleep(300)
    wheel(-5)   # 向上滚（若已在顶部则不变，作为基线）
    sleep(600)
    p1 = shot("wh-01-sidebar-up", bbox=r); f1 = fp(p1)
    wheel(10)   # 向下滚
    sleep(800)
    p2 = shot("wh-02-sidebar-down", bbox=r); f2 = fp(p2)
    log(f"wheel_probe: 侧栏 base={f0} up={f1} down={f2} 侧栏可滚={'YES' if f2 != f0 else 'NO'}")

    # 正文区
    cx = L + (R - L) // 2
    cy = T + (B - T) // 2
    p3 = shot("wh-03", bbox=r); f3 = fp(p3)
    user32.SetCursorPos(cx, cy); sleep(300)
    wheel(10)
    sleep(800)
    p4 = shot("wh-04-content-down", bbox=r); f4 = fp(p4)
    log(f"wheel_probe: 正文 base={f3} down={f4} 正文可滚={'YES' if f4 != f3 else 'NO'}")

    app.close()
    sleep(1200)
    flush_log()


if __name__ == "__main__":
    main()
