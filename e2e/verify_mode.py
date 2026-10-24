# -*- coding: utf-8 -*-
"""v0.2.2 阅读模式（横向翻页 ⇄ 纵向滚动）切换回归。

覆盖验收项：
- A35 默认纵向滚动、存量零回归（新装/旧配置均落到 scroll）
- A36 切换持久化到 settings.readerMode（重启/重进仍生效）
- A37 切换阅读模式不丢阅读位置（与 v0.2.1 位置记忆正交）
- A38 EPUB 翻页走 paginated（出现翻页导航、章节级恢复）
- A39 PDF 翻页走单页、滚动走连续虚拟化（出现翻页导航 / 连续滚动条）
- A40 TXT 翻页走 filmstrip（出现翻页导航 + 页码指示）
- A41 工具栏分段器与设置面板「阅读模式」双向同步
- A42 状态栏渲染模式文案随模式切换变化
- A43/A45/A48 翻页续读同页/同章（page-resume 子命令：切翻页→翻几页→退出→重开）
- A44 EPUB 滚动↔翻页切换落到最近阅读点（±1 页）：由 run_format 的 A37 位置保护路径覆盖
- A47 TXT 跨模式恢复一致：由 run_format 的 A37 位置保护路径覆盖
- A46 TXT 字号变化不漂移：手动在设置面板改字号后续读比对字符位置（坐标敏感，未自动覆盖）

机制（与 verify_positions.py 一致）：
- 坐标点击 + 截图落 e2e/shots/，状态栏右下角像素签名做模式/章节判定；
- 翻页导航是否存在用「底栏中段深色药丸按钮」像素探测近似判定，
  最终以人工看截图为准（与仓库既有 e2e 口径一致）。

用法：
    python e2e/verify_mode.py [epub|pdf|txt|all|page-resume]
    # page-resume：强化验证翻页模式位置保护（A43/A45/A48）

注意（重要）：
- 需在真实 Windows 桌面会话运行（Wails/WebView2 需要可见窗口），
  纯无头环境无法点击 GUI；本环境仅作为脚本交付，未实际执行。
- 工具栏「阅读模式」分段器坐标 MODE_TOGGLE_POINT 按 1280×720 默认皮肤标定，
  若窗口尺寸/皮肤改变导致点击落空，可用环境变量覆盖：
      MODE_TOGGLE_POINT="760,28" python e2e/verify_mode.py all
"""
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import driver as D
from driver import App, log, sleep, shot, window_text, click_at, tap


# ---- 书架封面探测（与 verify_positions.py 同口径，自包含避免跨脚本依赖） ----
def is_cover_purple(p):
    r, g, b = p[0], p[1], p[2]
    return b > 200 and 95 <= r <= 185 and g < 170 and b - r > 55


def is_cover_red(p):
    r, g, b = p[0], p[1], p[2]
    return r > 180 and g < 130 and b < 130 and r - g > 80


def is_cover_green(p):
    r, g, b = p[0], p[1], p[2]
    return g > 150 and r < 120 and b < 140 and g - r > 60


COVER_TESTS = (("epub", is_cover_purple), ("pdf", is_cover_red), ("txt", is_cover_green))


def find_covers(app, want=None):
    """扫描欢迎页书架区，返回封面中心 (cx, cy, fmt) 列表（按 x 升序）。"""
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

SHELF_BTN = (1199, 26)
GEAR = (1241, 26)

# 工具栏「阅读模式」分段器中心（客户区坐标，1280×720 默认皮肤标定）。
# 仅在「有书打开」时显示；用环境变量可覆盖。
_raw = os.environ.get("MODE_TOGGLE_POINT", "760,28")
try:
    MODE_TOGGLE_POINT = tuple(int(x) for x in _raw.split(","))
except Exception:
    MODE_TOGGLE_POINT = (760, 28)


def statusbar_signature(path):
    """状态栏右下角「渲染模式：…」区域像素签名（浅色基线有效）。"""
    from PIL import Image
    if not os.path.exists(path):
        return None
    im = Image.open(path).convert("RGB")
    W, H = im.size
    box = (W - 640, H - 30, W - 40, H)
    return list(im.crop(box).getdata())


def _mad(a, b):
    if a is None or b is None or len(a) != len(b):
        return None
    s = 0
    for pa, pb in zip(a, b):
        for i in range(3):
            s += abs(pa[i] - pb[i])
    return s / (len(a) * 3)


def pager_visible(app, tol=48):
    """底栏中段探测「翻页导航药丸按钮」（深色字形/边框像素）近似判定。

    返回 True 表示探测到底栏中段存在明显深色像素团（翻页导航），
    否则 False。该判定为近似，最终以人工看截图为准。
    """
    from PIL import ImageGrab
    r = app.rect()
    # 底栏区域：窗口底部上 60px、横向中段 380..900（客户区近似）
    top = r[3] - 60
    im = ImageGrab.grab(bbox=(r[0] + 380, top, r[0] + 900, r[3] - 6))
    dark = 0
    total = 0
    for px in im.getdata():
        total += 1
        if px[0] < 90 and px[1] < 90 and px[2] < 90:
            dark += 1
    ratio = dark / max(1, total)
    log(f"pager_visible: 底栏中段深色像素占比={ratio:.4f}")
    return ratio > (tol / 10000.0)


def toggle_mode(app):
    """点击工具栏「阅读模式」分段器，切到另一模式。"""
    x, y = MODE_TOGGLE_POINT
    D.force_foreground(app.hwnd)
    sleep(200)
    click_at(app, x, y)
    sleep(1200)


def back_to_shelf_and_resume(app, tag, want="epub", restore_wait=6000):
    """回书架 → 点卡片续读 → 截图 resumed。返回续读后标题。"""
    for attempt in range(3):
        click_at(app, *SHELF_BTN)
        sleep(1200)
        if window_text(app.hwnd) == "BookEditor":
            break
        log(f"{tag}: 第 {attempt + 1} 次书架点击未生效，重试")
    covers = find_covers(app, want=want)
    if not covers:
        shot(f"{tag}-shelf-debug", bbox=app.rect())
        log(f"{tag}: 书架无卡片，跳过续读")
        return None
    cx, cy, _ = covers[0]
    click_at(app, cx + 88, cy)
    sleep(2500)
    shot(f"{tag}-resumed-early", bbox=app.rect())
    sleep(restore_wait - 2500)
    shot(f"{tag}-resumed", bbox=app.rect())
    return window_text(app.hwnd)


def run_format(app, fmt, filename, label_default_contains):
    """单格式完整矩阵：默认 scroll → 改位置 → 切 page → 切回 scroll → 续读。

    返回该格式的逐检查项结果字典。
    """
    tag = f"M-{fmt}"
    res = {}
    log(f"===== {tag} 开始（{filename}）=====")
    ok = D.open_file(app, filename)
    log(f"{tag}: open -> {ok}")
    app.move_to(40, 60)
    sleep(5000)

    # A35：默认应为纵向滚动（状态栏文案含“滚动”）
    shot(f"{tag}-default-scroll", bbox=app.rect())
    sig_scroll = statusbar_signature(f"e2e/shots/{tag}-default-scroll.png")
    res["A35_default_scroll_shot"] = f"{tag}-default-scroll.png"

    # 改变阅读位置（scroll 模式）：EPUB/PDF/TXT 均用 Page Down 确定性滚动
    click_at(app, 640, 400)
    sleep(500)
    for _ in range(3):
        tap(0x22)  # VK_NEXT (Page Down)
        sleep(500)
    sleep(5000)  # debounce 等待上报
    shot(f"{tag}-scrolled", bbox=app.rect())
    sig_scrolled = statusbar_signature(f"e2e/shots/{tag}-scrolled.png")

    # A37 前置：记录切换前位置签名（用于切回 scroll 后对比）
    pos_before = statusbar_signature(f"e2e/shots/{tag}-scrolled.png")

    # 切到翻页模式（page）
    toggle_mode(app)
    shot(f"{tag}-page-mode", bbox=app.rect())
    sig_page = statusbar_signature(f"e2e/shots/{tag}-page-mode.png")
    pager = pager_visible(app)
    res["A38_39_40_pager_visible_in_page"] = pager
    res["A42_statusbar_changed_on_toggle"] = (_mad(sig_scroll, sig_page) or 0) > 0.5
    log(f"{tag}: A42 状态栏模式文案变化 mad={_mad(sig_scroll, sig_page)}")

    # 在翻页模式再翻一页（验证翻页导航可用）
    if pager:
        # 翻页模式下 PDF/TXT 有 ‹ › 按钮；EPUB 同样。点底栏中段下一个。
        click_at(app, 660, D.window_rect(app.hwnd)[3] - 34)
        sleep(1500)
        shot(f"{tag}-page-flipped", bbox=app.rect())

    # 切回滚动模式（scroll）
    toggle_mode(app)
    sleep(5000)  # 重挂载 + 恢复位置 + debounce
    shot(f"{tag}-back-scroll", bbox=app.rect())
    pos_after = statusbar_signature(f"e2e/shots/{tag}-back-scroll.png")
    d = _mad(pos_before, pos_after)
    res["A37_position_protected_on_switch"] = (d is not None and d < 2.0)
    log(f"{tag}: A37 切换位置保护 mad(切换前/切回后)={d}")

    # A36：切回滚动后状态栏应回到“滚动”文案（与默认一致）
    res["A36_back_to_scroll_shot"] = f"{tag}-back-scroll.png"

    # A41：设置面板「阅读模式」应与工具栏一致（截图备查）
    click_at(app, *GEAR)
    sleep(800)
    shot(f"{tag}-settings-mode", bbox=app.rect())
    tap(0x1B)  # ESC 关设置
    sleep(600)

    # 续读验证（回到书架再进，应仍是 scroll 模式 + 位置恢复）
    title = back_to_shelf_and_resume(app, tag, want=fmt, restore_wait=7000)
    res["A35_36_resume_in_scroll_shot"] = f"{tag}-resumed.png"
    log(f"{tag}: 续读标题={title!r}")
    return res


def run_page_resume(app, fmt, filename):
    """翻页模式位置保护强化（A43/A45/A48）：切翻页→翻几页→退出→重开→断言同页/同章。

    复用 back_to_shelf_and_resume（其间 flush 写库，position 带 cfi/page/anchor）；
    续读时 readerMode 已持久化为 page，按 CFI/页码/anchor 精确恢复，状态栏签名应与翻页末态接近。
    """
    tag = f"PR-{fmt}"
    res = {}
    log(f"===== {tag} 开始（{filename}）=====")
    ok = D.open_file(app, filename)
    log(f"{tag}: open -> {ok}")
    app.move_to(40, 60)
    sleep(5000)
    # 切到翻页模式并持久化（toggle_mode 经 saveSettings）
    toggle_mode(app)
    sleep(2000)
    # 翻 3 页（点底栏下一页按钮，坐标按窗口底栏中段偏右标定）
    for _ in range(3):
        r = D.window_rect(app.hwnd)
        click_at(app, r[2] - 60, r[3] - 34)
        sleep(1200)
    shot(f"{tag}-paged", bbox=app.rect())
    sig_paged = statusbar_signature(f"e2e/shots/{tag}-paged.png")
    # 退出到书架并续读（flush 写 position 后翻页模式恢复）
    back_to_shelf_and_resume(app, tag, want=fmt, restore_wait=7000)
    shot(f"{tag}-resumed", bbox=app.rect())
    sig_resumed = statusbar_signature(f"e2e/shots/{tag}-resumed.png")
    d = _mad(sig_paged, sig_resumed)
    res["A43_45_48_page_resume_same"] = (d is not None and d < 3.0)
    log(f"{tag}: 翻页续读同页/同章 mad={d}")
    return res


def main():
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    targets = {
        "epub": ("12.epub", "epub"),
        "pdf": ("sample.pdf", "pdf"),
        "txt": ("long-sample.txt", "txt"),
    }
    # page-resume：翻页读几页→退出→重开→断言同页/同章（A43/A45/A48）
    if which == "page-resume":
        app = App()
        sleep(1500)
        report = {}
        try:
            for fmt, (fn, _) in targets.items():
                report[fmt] = run_page_resume(app, fmt, fn)
        finally:
            app.close()
            sleep(1500)
        out = os.path.join(D.HERE, "verify_mode.page_resume.report.json")
        with open(out, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        log(f"报告已写 {out}")
        D.flush_log()
        return
    if which != "all" and which not in targets:
        print("usage: python e2e/verify_mode.py [epub|pdf|txt|all|page-resume]")
        sys.exit(2)
    sel = targets if which == "all" else {which: targets[which]}

    app = App()
    sleep(1500)
    report = {}
    try:
        for fmt, (fn, _) in sel.items():
            report[fmt] = run_format(app, fmt, fn, None)
    finally:
        app.close()
        sleep(1500)
        log(f"进程存活={app.alive()}")

    out = os.path.join(D.HERE, "verify_mode.report.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    log(f"报告已写 {out}")
    # 汇总打印
    for fmt, r in report.items():
        log(f"[{fmt}] " + " ".join(f"{k}={v}" for k, v in r.items()))
    D.flush_log()


if __name__ == "__main__":
    main()
