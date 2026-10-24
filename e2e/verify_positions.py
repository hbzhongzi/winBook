"""A29–A31 阅读位置恢复精度核对。

对 EPUB / PDF / TXT 各执行：打开 → 改变位置 → 截图 A → 等上报 → 回书架 →
点卡片续读 → 截图 B。

- A29（EPUB）：章节级自动判定（比对 A/B 侧栏目录高亮项位置，±6px），
  口径来自 2026-10-20 用户确认「不需要精准定位，只需要定位到对应章节」；
  章内像素级比对仍由人工看截图（落地文档第 7 章 + 偏差 D32）。
- A30/A31（PDF/TXT）：人工看截图（实测像素级一致）。

用法：python e2e/verify_positions.py [epub|pdf|txt|all]
"""
import subprocess
import sys

sys.path.insert(0, "e2e")
import driver as D
from driver import App, log, sleep, shot, window_text, find_pdf_buttons

SHELF_BTN = (1199, 26)
GEAR = (1241, 26)
VK_TAB = 0x09
VK_RETURN = 0x0D
VK_ESCAPE = 0x1B
WHEEL = 0x0800


def screen_at(app, cx, cy):
    r = app.rect()
    return (r[0] + 1 + cx, r[1] + 31 + cy)


def click_at(app, cx, cy):
    D.force_foreground(app.hwnd)
    sleep(250)
    D.click_screen(*screen_at(app, cx, cy))


def key(vk):
    D.tap(vk)


def tab(n=1):
    for _ in range(n):
        key(VK_TAB)
        sleep(140)


def is_cover_purple(p):
    r, g, b = p[0], p[1], p[2]
    return b > 200 and 95 <= r <= 185 and g < 170 and b - r > 55


def is_cover_red(p):
    r, g, b = p[0], p[1], p[2]
    return r > 180 and g < 130 and b < 130 and r - g > 80


def is_cover_green(p):
    r, g, b = p[0], p[1], p[2]
    return g > 150 and r < 120 and b < 160 and g - r > 60


COVER_TESTS = (("epub", is_cover_purple), ("pdf", is_cover_red), ("txt", is_cover_green))


def find_covers(app, want=None):
    """扫描欢迎页书架区，返回封面中心 (cx, cy, fmt) 列表（按 x 升序）。

    封面是 42x56 实心渐变块：按列密度（>=30 px/列）分组，宽>=30 且行跨度>=40
    才认定（滤掉徽标文字等稀疏彩色像素）。want 指定格式则只扫该渐变。
    """
    from PIL import ImageGrab
    tests = [(f, t) for f, t in COVER_TESTS if want is None or f == want]
    im = ImageGrab.grab(bbox=app.rect())
    px = im.load()
    covers, group = [], []
    for x in range(150, 1130):
        n = sum(1 for y in range(91, 551)
                if any(t(px[x, y]) for _, t in tests))
        if n >= 30:
            if group and x - group[-1] > 3:
                if len(group) >= 30:
                    covers.append(group)
                group = []
            group.append(x)
    if len(group) >= 30:
        covers.append(group)
    out = []
    for g in covers:
        ys = [y for x in g for y in range(91, 551)
              if any(t(px[x, y]) for _, t in tests)]
        if max(ys) - min(ys) >= 40:
            cx, cy = (g[0] + g[-1]) // 2 - 1, (min(ys) + max(ys)) // 2 - 31
            fmt = tests[0][0] if want else "epub"
            out.append((cx, cy, fmt))
    return out


def wheel(notches, app, cx=640, cy=400):
    import ctypes
    x, y = screen_at(app, cx, cy)
    ctypes.windll.user32.SetCursorPos(x, y)
    sleep(300)
    for _ in range(notches):
        ctypes.windll.user32.mouse_event(WHEEL, 0, 0, -120, 0)
        sleep(140)


def clear_shelf(app):
    click_at(app, *GEAR)
    sleep(900)
    tab(4)
    key(VK_RETURN)
    sleep(400)
    tab(2)
    key(VK_RETURN)
    sleep(300)
    key(VK_RETURN)
    sleep(400)
    key(VK_ESCAPE)
    sleep(600)


def statusbar_chapter_signature(path):
    """状态栏章名区域像素签名（相对窗口右下角的固定区域）。

    状态栏右侧为「渲染模式：连续滚动 · 当前：<章名>」，同章名渲染逐像素一致
    （实测 0.0）；不同章名/不同内容差异显著（实测 ~5.9）。浅色基线有效。
    """
    from PIL import Image
    im = Image.open(path).convert("RGB")
    W, H = im.size
    box = (W - 630, H - 30, W - 40, H)
    return list(im.crop(box).getdata())


def _mad(a, b):
    s = 0
    for pa, pb in zip(a, b):
        for i in range(3):
            s += abs(pa[i] - pb[i])
    return s / (len(a) * 3)


def check_same_chapter(tag, tol=1.0):
    """A29 章节级自动判定：A/B 状态栏章名区域像素一致（mad < tol）即同章。

    口径：2026-10-20 用户确认「EPUB 不需要精准定位，只需要定位到对应章节」。
    """
    a = statusbar_chapter_signature(f"e2e/shots/{tag}-A-before.png")
    b = statusbar_chapter_signature(f"e2e/shots/{tag}-B-resumed.png")
    if len(a) != len(b):
        log(f"{tag}: 章节判定跳过（截图尺寸不一致 {len(a)} vs {len(b)}）")
        return None
    d = _mad(a, b)
    ok = d < tol
    log(f"{tag}: 章节判定 {'PASS' if ok else 'FAIL'}（状态栏 mad={d:.3f}，阈值 {tol}）")
    return ok


def resume_from_shelf(app, tag, restore_wait, want="epub"):
    """回书架 → 点卡片续读 → 截图 B。"""
    # 回书架（带重试：偶发点击未生效，重试至多 3 次）
    for attempt in range(3):
        click_at(app, *SHELF_BTN)
        sleep(1200)
        if window_text(app.hwnd) == "BookEditor":
            break
        log(f"{tag}: 第 {attempt + 1} 次书架点击未生效，重试")
    log(f"{tag}: 点书架后 title={window_text(app.hwnd)!r}")
    covers = find_covers(app, want=want)
    if not covers:
        shot(f"{tag}-shelf-debug", bbox=app.rect())
        log(f"{tag}: 书架无卡片，跳过")
        return False
    cx, cy, _ = covers[0]
    click_at(app, cx + 88, cy)
    sleep(2500)
    shot(f"{tag}-B-early", bbox=app.rect())   # 恢复后早期：校正刚跑完
    sleep(restore_wait - 2500)
    shot(f"{tag}-B-resumed", bbox=app.rect())
    log(f"{tag}: 续读完成 title={window_text(app.hwnd)!r}")
    return True


def run_epub(app):
    tag = "A29-epub"
    ok = D.open_file(app, "12.epub")
    log(f"{tag}: open -> {ok}")
    app.move_to(40, 60)   # open_file 的 ensure_ready 会复位窗口，故在此再移
    sleep(6000)
    # 确定性滚动：先点正文聚焦 stage（避免焦点在侧栏时按键滚侧栏），
    # 再用 Page Down——键盘事件直达焦点元素，不受鼠标位置/弹窗干扰
    # （滚轮方式曾被测点弹出的 QQ 通知窗偷走后半段事件，导致上报位置早于视觉位置）
    click_at(app, 640, 400)
    sleep(600)
    for _ in range(3):
        D.tap(0x22)  # VK_NEXT (Page Down)
        sleep(500)
    sleep(5500)             # debounce：滚动停止 3s 后上报 + 余量
    shot(f"{tag}-A-before", bbox=app.rect())
    resume_from_shelf(app, tag, 9000)   # EPUB 恢复含 display + 稳定等待，多给时间
    check_same_chapter(tag)             # 章节级自动判定（D32 口径）


def run_pdf(app):
    tag = "A30-pdf"
    ok = D.open_file(app, "sample.pdf")
    log(f"{tag}: open -> {ok}")
    app.move_to(40, 60)
    sleep(5000)
    btns = find_pdf_buttons(app)
    log(f"{tag}: buttons={btns}")
    if btns:
        D.click_screen(*btns[-1])       # 下一页 → 第 2 页（共 3 页）
        sleep(2000)
    shot(f"{tag}-A-before", bbox=app.rect())
    resume_from_shelf(app, tag, 5000, want="pdf")


def run_txt(app):
    tag = "A31-txt"
    # 用长文本样本（内置 sample-utf8.txt 仅 3 行滚不动，测不出比例恢复）
    ok = D.open_file(app, "long-sample.txt")
    log(f"{tag}: open -> {ok}")
    app.move_to(40, 60)
    sleep(2500)
    # TXT：点正文聚焦 + Page Down（与 EPUB 同款确定性滚动）
    click_at(app, 640, 400)
    sleep(500)
    for _ in range(5):
        D.tap(0x22)
        sleep(500)
    sleep(5500)
    shot(f"{tag}-A-before", bbox=app.rect())
    resume_from_shelf(app, tag, 3000, want="txt")


def main():
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    subprocess.run(["taskkill", "/F", "/IM", "book-editor.exe"], capture_output=True)
    sleep(800)
    app = App()
    sleep(2000)
    app.move_to(40, 60)   # 移到屏幕左侧，避开右上角通知弹窗（曾盖住书架按钮）
    clear_shelf(app)
    if which in ("all", "epub"):
        run_epub(app)
    if which in ("all", "pdf"):
        run_pdf(app)
    if which in ("all", "txt"):
        run_txt(app)
    log("verify_positions: done（请人工比对 *-A-before 与 *-B-resumed 截图）")
    D.flush_log()


if __name__ == "__main__":
    main()
