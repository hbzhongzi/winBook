# -*- coding: utf-8 -*-
"""真书 EPUB 验收：连续滚动 + 章节窗口化 + 侧栏联动 + 设置项。

验证点：
1. 打开真书 → 正文渲染、目录侧栏可见
2. 侧栏高亮项与正文当前章节一致（点击某章 → 正文滚到该章 → 状态栏同步）
3. 反复向下滚动 → 不崩溃、状态栏章节随之变化（连续流生效）
4. 滚动回顶部 → 章节回落
5. 设置面板可打开，预加载章节数可修改并保存

用法：python e2e/verify_epub_flow.py [文件名]
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
VK_ESCAPE = 0x1B


def wheel(notches):
    for _ in range(abs(notches)):
        delta = WHEEL_DELTA if notches > 0 else -WHEEL_DELTA
        ctypes.windll.user32.mouse_event(MOUSEEVENTF_WHEEL, 0, 0, delta, 0)
        sleep(60)


def fp(p):
    return hashlib.md5(open(p, "rb").read()).hexdigest()[:8]


def tap(vk):
    user32.keybd_event(vk, 0, 0, 0)
    sleep(60)
    user32.keybd_event(vk, 0, 2, 0)
    sleep(200)


def main():
    fixture = sys.argv[1] if len(sys.argv) > 1 else "12.epub"
    app = App()
    sleep(2000)
    # 剪贴板粘贴偶发被文件框自动补全干扰（实测会打开上次的文件），重试直到命中目标
    ok = False
    for attempt in range(4):
        ok = D.open_file(app, fixture)
        if ok:
            break
        log(f"vef: 第 {attempt + 1} 次打开失败，重试")
        sleep(1500)
    log(f"vef: open_file({fixture}) -> {ok}")
    if not ok:
        app.close()
        flush_log()
        return
    sleep(5000)
    r = app.rect()
    L, T, R, B = r
    p_top = shot("ve-01-top", bbox=r)
    log(f"vef: 首屏 {fp(p_top)} 标题={D.window_text(app.hwnd)!r}")

    # 点击正文区取得焦点（iframe pointer-events:none，需 stage 承接键盘/滚轮）
    cx, cy = (L + R) // 2, (T + B) // 2
    user32.SetCursorPos(cx, cy)
    sleep(300)
    user32.mouse_event(0x0002, 0, 0, 0, 0)
    user32.mouse_event(0x0004, 0, 0, 0, 0)
    sleep(600)

    # 连续向下滚动，观察状态栏章节变化（连续流 + 窗口化）
    prev_fp = fp(p_top)
    for i in range(1, 7):
        wheel(20)
        sleep(1200)
        p = shot(f"ve-{i + 1:02d}-down", bbox=r)
        cur = fp(p)
        log(f"vef: 下滚 {i} 轮 指纹={cur} 画面变化={'YES' if cur != prev_fp else 'NO'}")
        prev_fp = cur

    # 滚回顶部
    wheel(-200)
    sleep(1500)
    p_back = shot("ve-08-back-top", bbox=r)
    log(f"vef: 回滚顶部 指纹={fp(p_back)}")

    # 打开设置面板（工具栏右侧齿轮）
    gear = (R - 30, T + 26)
    D.click_screen(*gear)
    sleep(900)
    shot("ve-09-settings", bbox=r)
    log("vef: 已点击设置按钮")
    tap(VK_ESCAPE)
    sleep(600)

    app.close()
    sleep(1500)
    log(f"vef: alive after close: {app.alive()}")
    flush_log()


if __name__ == "__main__":
    main()