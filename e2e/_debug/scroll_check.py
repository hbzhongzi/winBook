# -*- coding: utf-8 -*-
"""EPUB 正文区滚动链路核查。

问题背景：scrolled-doc 模式下 epubjs 把 iframe 撑到整章高度（真书 36479px），
外层 stage（.epub-container，overflow:auto）负责滚动。若滚轮事件被 iframe 内部
文档吃掉（iframe 内文档仅溢出 21px），用户滚轮就会"滚不动"。

本脚本：
1. 在正文区连续滚轮 N 格，每档截图，验证画面是否变化
2. 键盘 PageDown / End 验证键盘滚动
3. 横向滚动条是否存在（底部灰条像素检测）
用法：python e2e/scroll_check.py [文件名] [滚轮格数]
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
VK_NEXT = 0x22   # PageDown
VK_END = 0x23    # End
VK_PRIOR = 0x21  # PageUp
VK_HOME = 0x24   # Home


def wheel(notches):
    for _ in range(abs(notches)):
        delta = WHEEL_DELTA if notches > 0 else -WHEEL_DELTA
        ctypes.windll.user32.mouse_event(MOUSEEVENTF_WHEEL, 0, 0, delta, 0)
        sleep(120)


def tap(vk):
    user32.keybd_event(vk, 0, 0, 0)
    sleep(60)
    user32.keybd_event(vk, 0, 2, 0)  # KEYEVENTF_KEYUP
    sleep(250)


def hscrollbar_shot(im):
    """检测底部是否存在横向滚动条（灰色滑块 #8b8b8b）。"""
    from PIL import Image
    w, h = im.size
    hits = 0
    for y in range(h - 60, h - 20):
        row = [im.getpixel((x, y)) for x in range(0, w, 2)]
        gray = sum(1 for p in row if abs(p[0] - p[1]) < 6 and 200 < p[0] < 250)
        if gray > w // 4:
            hits += 1
    return hits


def main():
    fixture = sys.argv[1] if len(sys.argv) > 1 else "12.epub"
    notches = int(sys.argv[2]) if len(sys.argv) > 2 else 10
    app = App()
    sleep(2000)
    ok = D.open_file(app, fixture)
    log(f"scroll_check: open_file({fixture}) -> {ok}")
    sleep(4000)

    from PIL import Image
    p = shot("sc-00-top", bbox=app.rect())
    im = Image.open(p)
    log(f"scroll_check: 顶部 hscroll_rows={hscrollbar_shot(im)}")
    base = hashlib.md5(open(p, 'rb').read()).hexdigest()[:10]
    log(f"scroll_check: 顶部截图指纹 {base}")

    # 正文区中心滚轮
    r = app.rect()
    cx = (r[0] + r[2]) // 2
    cy = (r[1] + r[3]) // 2
    user32.SetCursorPos(cx, cy)
    sleep(400)
    for i in range(1, 5):
        wheel(notches)
        sleep(900)
        p = shot(f"sc-{i:02d}-wheel{i * notches}", bbox=app.rect())
        h = hashlib.md5(open(p, 'rb').read()).hexdigest()[:10]
        im2 = Image.open(p)
        log(f"scroll_check: wheel x{i * notches} 指纹={h} 变化={'YES' if h != base else 'NO'} "
            f"hscroll_rows={hscrollbar_shot(im2)}")

    # 键盘：PageDown
    user32.SetCursorPos(cx, cy)
    sleep(200)
    tap(VK_NEXT)
    tap(VK_NEXT)
    sleep(800)
    p = shot("sc-05-pagedown", bbox=app.rect())
    h = hashlib.md5(open(p, 'rb').read()).hexdigest()[:10]
    log(f"scroll_check: PageDown x2 指纹={h} 变化={'YES' if h != base else 'NO'}")

    # 键盘：End（跳到本章末尾）
    tap(VK_END)
    sleep(1200)
    p = shot("sc-06-end", bbox=app.rect())
    h = hashlib.md5(open(p, 'rb').read()).hexdigest()[:10]
    log(f"scroll_check: End 指纹={h} 变化={'YES' if h != base else 'NO'}")

    # 回到顶部
    tap(VK_HOME)
    sleep(1000)
    p = shot("sc-07-home", bbox=app.rect())
    h = hashlib.md5(open(p, 'rb').read()).hexdigest()[:10]
    log(f"scroll_check: Home 指纹={h} 回到顶部={'YES' if h == base else 'NO'}")

    app.close()
    sleep(1200)
    flush_log()


if __name__ == "__main__":
    main()
