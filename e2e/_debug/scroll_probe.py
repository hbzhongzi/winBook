# -*- coding: utf-8 -*-
"""正文区滚动位移量化核查。

判据不用整图指纹（滚动条/状态栏变化会污染），改为：
1. 只裁正文区（排除目录侧栏、工具栏、状态栏）
2. 计算逐行"墨水量"（非白像素数）剖面
3. 用剖面互相关求纵向位移（px）；位移接近 0 即"没滚动"
用法：python e2e/scroll_probe.py [文件名] [每档滚轮格数]
"""
import ctypes
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


def ink_profile(path, box):
    """返回正文区每一行的墨水量剖面。"""
    from PIL import Image
    im = Image.open(path).convert("L").crop(box)
    w, h = im.size
    px = im.load()
    prof = []
    for y in range(h):
        s = 0
        for x in range(0, w, 2):
            if px[x, y] < 200:
                s += 1
        prof.append(s)
    return prof


def shift_between(a, b, max_shift=4000):
    """求 b 相对 a 的纵向位移（使剖面最匹配的 shift，>0 表示内容上移=向下滚动）。"""
    n = min(len(a), len(b))
    A, B = a[:n], b[:n]
    best, best_score = 0, None
    # 允许内容移出窗口：只在共同覆盖区间比较
    for s in range(0, min(max_shift, n - 40)):
        # b[y] 对应 a[y+s]
        seg_b = B[0:n - s]
        seg_a = A[s:n]
        score = sum(abs(seg_a[i] - seg_b[i]) for i in range(0, len(seg_a), 7))
        if best_score is None or score < best_score:
            best_score, best = score, s
    return best


def report(tag, base_prof, shot_path, box, app):
    prof = ink_profile(shot_path, box)
    shift = shift_between(base_prof, prof)
    log(f"scroll_probe: {tag} 位移={shift}px " + ("滚动生效" if shift > 12 else "无位移"))
    return shift


def main():
    fixture = sys.argv[1] if len(sys.argv) > 1 else "12.epub"
    notches = int(sys.argv[2]) if len(sys.argv) > 2 else 12
    app = App()
    sleep(2000)
    ok = D.open_file(app, fixture)
    log(f"scroll_probe: open_file({fixture}) -> {ok}")
    sleep(4500)

    L, T, R, B = app.rect()
    # 正文区：排除左侧 240px 目录、顶部 70px 工具栏、底部 60px（状态栏+横滚条）
    box = (L + 245, T + 75, R - 20, B - 65)
    cx = (L + R) // 2
    cy = (T + B) // 2

    p0 = shot("sp-00-top", bbox=app.rect())
    prof0 = ink_profile(p0, box)

    # 先点击正文区让 stage 获得焦点（pointer-events:none 后滚轮需命中 stage）
    user32.SetCursorPos(cx, cy)
    sleep(200)
    user32.mouse_event(0x0002, 0, 0, 0, 0)  # LEFTDOWN
    user32.mouse_event(0x0004, 0, 0, 0, 0)  # LEFTUP
    sleep(500)
    for i in range(1, 4):
        wheel(notches)
        sleep(900)
        p = shot(f"sp-{i:02d}-wheel{i * notches}", bbox=app.rect())
        s = report(f"wheel x{i * notches}", prof0, p, box, app)
        if s == 0:
            log("scroll_probe: 该档未滚动，后续档位意义不大，提前结束")
            break

    # 向上滚回
    wheel(-notches * 2)
    sleep(1000)
    p = shot("sp-09-back", bbox=app.rect())
    prof_back = ink_profile(p, box)
    back = shift_between(prof0, prof_back)
    log(f"scroll_probe: 回滚后与初始差异位移={back}px " + ("已回到顶部" if back < 12 else "仍有偏移"))

    app.close()
    sleep(1200)
    flush_log()


if __name__ == "__main__":
    main()
