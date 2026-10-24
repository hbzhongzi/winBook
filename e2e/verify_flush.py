"""阅读位置 flush 链路验证（修复「直接退出/点书架 阅读记录不更新」）。

三个场景，全部用「改变位置后不等 debounce 立即退出/切书」稳定复现旧缺陷
（旧代码 flush 只读 3s debounce 缓存，缓存未触发即丢位置）：

- flush-A（点书架，TXT）：打开 → Page Down ×5 → 立即点书架 → 书架卡片
  进度必须 > 0（旧行为：进度 0）。再点卡片续读验证能打开。
- flush-B（WM_CLOSE 退出，TXT）：打开 → Page Down ×5 → 立即 WM_CLOSE
  （触发 Go OnBeforeClose flush）→ 等退出 → 重启 → 书架卡片进度必须 > 0
  （旧行为：beforeunload 不触发/缓存空 → 进度 0）。
- flush-C（WM_CLOSE 退出，EPUB）：打开 → Page Down ×3 → 立即 WM_CLOSE →
  重启 → 点卡片续读 → 状态栏章名像素一致（mad < 1.0，同章）。

用法：python e2e/verify_flush.py [a|b|c|all]
"""
import subprocess
import sys

sys.path.insert(0, "e2e")
import driver as D
from driver import App, log, sleep, shot, window_text

SHELF_BTN = (1199, 26)
GEAR = (1241, 26)
VK_TAB = 0x09
VK_RETURN = 0x0D
VK_ESCAPE = 0x1B

# 六种强调色（持久化残留不一定是默认蓝，全部扫）
ACCENTS = [
    (37, 99, 235),   # 蓝
    (5, 150, 105),   # 绿
    (217, 119, 6),   # 琥珀
    (225, 29, 72),   # 玫红
    (13, 148, 136),  # 青
    (79, 70, 229),   # 靛蓝
]


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


def is_cover_green(p):
    r, g, b = p[0], p[1], p[2]
    return g > 150 and r < 120 and b < 160 and g - r > 60


def find_txt_cover(app):
    """欢迎页书架区找 TXT 卡（绿色渐变封面）中心，返回 client 坐标 (cx, cy)。"""
    from PIL import ImageGrab
    im = ImageGrab.grab(bbox=app.rect())
    px = im.load()
    cols = {}
    for x in range(150, 1130):
        n = sum(1 for y in range(91, 551) if is_cover_green(px[x, y]))
        if n >= 30:
            cols[x] = n
    group = []
    covers = []
    for x in sorted(cols):
        if group and x - group[-1] > 3:
            if len(group) >= 30:
                covers.append(group)
            group = []
        group.append(x)
    if len(group) >= 30:
        covers.append(group)
    for g in covers:
        ys = [y for x in g for y in range(91, 551) if is_cover_green(px[x, y])]
        if max(ys) - min(ys) >= 40:
            # 截图局部坐标 → client 坐标（窗口边框 1 + 标题栏 31）
            return ((g[0] + g[-1]) // 2 - 1, (min(ys) + max(ys)) // 2 - 31)
    return None


def measure_fill(app, tag):
    """截图书架并测量第一张卡（TXT 绿封面）进度条填充像素数。"""
    shot(f"{tag}-shelf", bbox=app.rect())
    from PIL import Image
    im = Image.open(f"e2e/shots/{tag}-shelf.png").convert("RGB")
    px = im.load()
    # 找绿封面（img 坐标）
    cols = {}
    for x in range(150, 1130):
        n = sum(1 for y in range(91, 551) if is_cover_green(px[x, y]))
        if n >= 30:
            cols[x] = n
    group, covers = [], []
    for x in sorted(cols):
        if group and x - group[-1] > 3:
            if len(group) >= 30:
                covers.append(group)
            group = []
        group.append(x)
    if len(group) >= 30:
        covers.append(group)
    for g in covers:
        ys = [y for x in g for y in range(91, 551) if is_cover_green(px[x, y])]
        if max(ys) - min(ys) >= 40:
            cx, cy = (g[0] + g[-1]) // 2, (min(ys) + max(ys)) // 2
            # 进度行：封面中心下方 5..50px；x 覆盖卡片主体宽
            n = 0
            for y in range(cy + 5, cy + 50):
                for x in range(cx - 30, cx + 185):
                    p = px[x, y]
                    if any(all(abs(p[i] - c[i]) <= 30 for i in range(3)) for c in ACCENTS):
                        n += 1
            return n, (cx, cy)
    return 0, None


def open_and_scroll(app, fixture, pages, wait_open):
    ok = D.open_file(app, fixture)
    log(f"open {fixture} -> {ok}")
    app.move_to(40, 60)
    sleep(wait_open)
    click_at(app, 640, 400)   # 点正文聚焦
    sleep(500)
    for _ in range(pages):
        D.tap(0x22)           # Page Down
        sleep(500)


def click_shelf(app):
    """回书架（带重试：偶发被通知弹窗干扰）。"""
    for attempt in range(3):
        app.move_to(40, 60)
        click_at(app, *SHELF_BTN)
        sleep(1200)
        if window_text(app.hwnd) == "BookEditor":
            return True
        log(f"shelf click: 第 {attempt + 1} 次未生效，重试")
    return False


def click_first_card(app):
    """点书架第一张卡（TXT 绿封面右侧 body 区）。"""
    cover = find_txt_cover(app)
    if not cover:
        log("click_first_card: 未找到 TXT 封面")
        return False
    cx, cy = cover
    click_at(app, cx + 88, cy)
    sleep(3000)
    return True


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


def wait_exit(app, timeout_ms=8000):
    step = 200
    for _ in range(timeout_ms // step):
        if not app.alive():
            return True
        sleep(step)
    return not app.alive()


def run_a():
    """flush-A：点书架即时更新（TXT）。"""
    tag = "flush-A"
    app = App()
    sleep(2000)
    app.move_to(40, 60)
    clear_shelf(app)
    open_and_scroll(app, "long-sample.txt", pages=5, wait_open=2500)
    shot(f"{tag}-before", bbox=app.rect())
    ok = click_shelf(app)
    log(f"{tag}: 回书架 -> {ok}")
    n, cover = measure_fill(app, tag)
    log(f"{tag}: 书架进度填充 {n}px（cover={cover}）")
    passed = n > 20
    log(f"{tag}: {'PASS' if passed else 'FAIL'}（阈值 >20px；旧行为为 0）")
    # 续读验证：点卡能打开
    opened = click_first_card(app)
    title = window_text(app.hwnd)
    log(f"{tag}: 续读打开 -> {opened} title={title!r}")
    shot(f"{tag}-resumed", bbox=app.rect())
    app.close()
    return passed and "long-sample" in title


def run_b():
    """flush-B：WM_CLOSE 退出更新 + 重启保留（TXT）。"""
    tag = "flush-B"
    app = App()
    sleep(2000)
    app.move_to(40, 60)
    clear_shelf(app)
    open_and_scroll(app, "long-sample.txt", pages=5, wait_open=2500)
    shot(f"{tag}-before", bbox=app.rect())
    # 立即退出：不等 debounce，走 Go OnBeforeClose → flush-request 链路
    app.close()
    exited = wait_exit(app)
    log(f"{tag}: WM_CLOSE 后进程退出 -> {exited}")
    if not exited:
        shot(f"{tag}-exit-timeout", bbox=app.rect())
        subprocess.run(["taskkill", "/F", "/IM", "book-editor.exe"], capture_output=True)
        return False
    # 重启：书架卡片进度应保留（flush 已落库）
    app2 = App()
    sleep(2000)
    app2.move_to(40, 60)
    n, cover = measure_fill(app2, f"{tag}-restart")
    log(f"{tag}: 重启后书架进度填充 {n}px（cover={cover}）")
    passed = n > 20
    log(f"{tag}: {'PASS' if passed else 'FAIL'}（阈值 >20px；旧行为为 0）")
    # 续读：位置应接近关闭前（留档 + mad 参考）
    if click_first_card(app2):
        shot(f"{tag}-resumed", bbox=app2.rect())
        from PIL import Image, ImageChops
        a = Image.open(f"e2e/shots/{tag}-before.png").convert("RGB")
        b = Image.open(f"e2e/shots/{tag}-resumed.png").convert("RGB")
        d = ImageChops.difference(a, b).getbbox()
        log(f"{tag}: 关闭前 vs 续读后 diff bbox={d}（None=像素级一致）")
    app2.close()
    return passed


def run_c():
    """flush-C：WM_CLOSE 退出链路对 EPUB 生效（章节级判定）。"""
    tag = "flush-C"
    app = App()
    sleep(2000)
    app.move_to(40, 60)
    clear_shelf(app)
    ok = D.open_file(app, "12.epub")
    log(f"{tag}: open -> {ok}")
    app.move_to(40, 60)
    sleep(6000)
    click_at(app, 640, 400)
    sleep(500)
    for _ in range(3):
        D.tap(0x22)
        sleep(500)
    shot(f"{tag}-A-before", bbox=app.rect())
    app.close()
    exited = wait_exit(app)
    log(f"{tag}: WM_CLOSE 后进程退出 -> {exited}")
    if not exited:
        subprocess.run(["taskkill", "/F", "/IM", "book-editor.exe"], capture_output=True)
        return False
    app2 = App()
    sleep(2000)
    app2.move_to(40, 60)
    # 点第一张卡（EPUB 紫封面）
    from verify_positions import find_covers
    covers = find_covers(app2, want="epub")
    if not covers:
        shot(f"{tag}-shelf-debug", bbox=app2.rect())
        log(f"{tag}: FAIL（重启后书架无卡片）")
        return False
    cx, cy, _ = covers[0]
    click_at(app2, cx + 88, cy)
    sleep(9000)
    shot(f"{tag}-B-resumed", bbox=app2.rect())
    # 章节级判定：状态栏章名区域 mad < 1.0
    from verify_positions import check_same_chapter
    ok = check_same_chapter(tag)
    app2.close()
    return bool(ok)


def main():
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    subprocess.run(["taskkill", "/F", "/IM", "book-editor.exe"], capture_output=True)
    sleep(800)
    results = {}
    if which in ("all", "a"):
        results["flush-A 点书架即时更新"] = run_a()
    if which in ("all", "b"):
        results["flush-B 退出更新+重启保留"] = run_b()
    if which in ("all", "c"):
        results["flush-C EPUB 退出链路"] = run_c()
    log("=== flush 验证结果 ===")
    allok = True
    for k, v in results.items():
        log(f"  {'PASS' if v else 'FAIL'}  {k}")
        allok = allok and v
    log(f"verify_flush: {'ALL PASS' if allok else 'HAS FAIL'}")
    D.flush_log()


if __name__ == "__main__":
    main()
