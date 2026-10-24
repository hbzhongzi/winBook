"""书架与阅读位置记忆 GUI 冒烟（v0.2.1）。

对应落地说明文档 6.3 冒烟步骤与第 7 章验收：
  sm-shelf-01 记录产生：打开 → 滚动 → 回书架，欢迎页出现书记卡片 + 进度条有填充
  sm-shelf-02 续读不弹框：点卡片直接打开书（无文件对话框），标题恢复（A32）
  sm-shelf-03 移除：悬停卡片右上角逐卡 → 卡片消失
  sm-shelf-04 清空：高级页「清空」→ 书架管理对话框（清空全部 + 二次确认）
              → 书架区隐藏（A34 / A77）
  A27 重启持久化：重开后书架仍在
  A28 去重：重复打开同一书卡片数不变（单测已覆盖，冒烟复核）
  A29–A31 位置精确恢复：不做像素断言（e2e 无 DOM/OCR），截图人工核对

坐标说明（均经 calib_shelf.py 实测校准）：
  - 书架按钮：客户端 (1199, 26)（齿轮 1241 左移 42 = 30 按钮宽 + 4 margin + 8 gap）
  - 卡片/移除按钮：不硬编码——按封面紫色渐变实心块（42x56）扫描自校准，
    再按结构偏移推导（卡片中心 = 封面中心 +88x；移除钮 = 封面中心 +190x -21y）
  - 一律先取最新窗口 rect 再换算屏幕坐标（历史教训：open_file 前台化会移动窗口，
    用过期的 rect 点击曾落空）
"""
import subprocess
import sys

sys.path.insert(0, "e2e")
import driver as D
from driver import App, log, sleep, shot, window_text, wait_dialog, find_open_button

FIXTURE = sys.argv[1] if len(sys.argv) > 1 else "12.epub"
SHELF_BTN = (1199, 26)   # 客户端坐标（实测）
GEAR = (1241, 26)        # 客户端坐标（smoke_settings 实测）
VK_TAB = 0x09
VK_RETURN = 0x0D
VK_ESCAPE = 0x1B
WHEEL = 0x0800

RESULTS = []


def check(name, ok, detail=""):
    RESULTS.append((name, ok))
    log(f"[{'PASS' if ok else 'FAIL'}] {name} {detail}")


def near(p, rgb, tol=12):
    return all(abs(p[i] - rgb[i]) <= tol for i in range(3))


def screen_at(app, cx, cy):
    """客户端坐标 → 屏幕坐标（每次现取窗口 rect，防窗口位移）。"""
    r = app.rect()
    return (r[0] + 1 + cx, r[1] + 31 + cy)


def click_at(app, cx, cy):
    D.force_foreground(app.hwnd)
    sleep(250)
    D.click_screen(*screen_at(app, cx, cy))


def click_shelf(app):
    """点书架按钮（带重试 + 移窗避开右上角通知弹窗）。

    环境里 QQ/微信通知弹窗会出现在屏幕右上角，恰好盖住应用窗口右上角的
    书架/齿轮按钮，导致点击落空（实测三次全败）。移窗到屏幕左侧可避开。
    """
    for attempt in range(3):
        app.move_to(40, 60)
        click_at(app, *SHELF_BTN)
        sleep(1200)
        if window_text(app.hwnd) == "BookEditor":
            return True
        log(f"shelf click: 第 {attempt + 1} 次未生效，重试")
    return False


def move_to(app, cx, cy):
    """只移动鼠标（触发 :hover，不点击）。"""
    import ctypes
    x, y = screen_at(app, cx, cy)
    ctypes.windll.user32.SetCursorPos(x, y)
    sleep(350)


def key(vk):
    D.tap(vk)


def tab(n=1):
    for _ in range(n):
        key(VK_TAB)
        sleep(140)


def is_cover_purple(p):
    """EPUB 封面渐变（#a78bfa→#6d28d9）命中；徽标紫字/靛蓝强调色被阈值排除。"""
    r, g, b = p[0], p[1], p[2]
    return b > 200 and 95 <= r <= 185 and g < 170 and b - r > 55


def find_covers(app):
    """扫描欢迎页书架区，返回 EPUB 封面中心的客户端坐标列表（按 x 升序）。

    封面是 42x56 实心渐变块：按列密度（>=30 px/列）分组，宽>=30 且行跨度>=40
    才认定（滤掉徽标文字等稀疏紫像素）。
    """
    from PIL import ImageGrab
    im = ImageGrab.grab(bbox=app.rect())
    px = im.load()
    # 书架高度带：client y 60..520 → img y 91..551（欢迎区下方）
    cols = {}
    for x in range(150, 1130):
        n = sum(1 for y in range(91, 551) if is_cover_purple(px[x, y]))
        if n >= 30:
            cols[x] = n
    covers = []
    group = []
    for x in sorted(cols):
        if group and x - group[-1] > 3:
            if len(group) >= 30:
                covers.append(group)
            group = []
        group.append(x)
    if len(group) >= 30:
        covers.append(group)
    out = []
    for g in covers:
        ys = [y for x in g for y in range(91, 551) if is_cover_purple(px[x, y])]
        if max(ys) - min(ys) >= 40:
            out.append(((g[0] + g[-1]) // 2 - 1, (min(ys) + max(ys)) // 2 - 31))
    return out


def accent_of(app):
    """从工具栏「打开图书」按钮取当前强调色（6 色白名单，驱动同款扫描）。"""
    from PIL import ImageGrab
    r = app.rect()
    im = ImageGrab.grab(bbox=(r[0], r[1] + 32, r[0] + 500, r[1] + 100))
    for y in range(im.height):
        for x in range(im.width):
            p = im.getpixel((x, y))
            for c in D.ACCENT_COLORS:
                if near(p, c, 18):
                    return c
    return None


def has_progress_fill(app, accent):
    """卡片进度行（img y 365..395, x 330..480）内是否有强调色填充。"""
    if not accent:
        return False
    from PIL import ImageGrab
    im = ImageGrab.grab(bbox=app.rect())
    px = im.load()
    for y in range(365, 395):
        for x in range(330, 480):
            if near(px[x, y], accent, 24):
                return True
    return False


def wheel_down(notches, app, cx=640, cy=400):
    """在客户端 (cx,cy) 处向下滚轮（负数 delta = 向书后半部分走）。"""
    import ctypes
    x, y = screen_at(app, cx, cy)
    ctypes.windll.user32.SetCursorPos(x, y)
    sleep(300)
    for _ in range(notches):
        ctypes.windll.user32.mouse_event(WHEEL, 0, 0, -120, 0)
        sleep(140)


# 书架管理对话框（v0.2.8）固定尺寸：与 styles.css 的 .shelf-manager 保持一致。
# 弹窗居中，故底部按钮坐标可按客户区尺寸推算；底部按钮 min-width:120px、右对齐，
# 「清空全部…」与「确认清空」在同一位置（两个面板的底部按钮布局一致）。
MGR_W, MGR_H = 560, 420
MGR_FOOT_Y_OFF = 392   # 底部按钮中心相对弹窗顶部的偏移（padding 12 + 按钮高 34/2）


def clear_shelf_via_settings(app):
    """高级页「清空」→ 书架管理对话框 → 清空全部 + 二次确认（v0.2.8 D60）。

    v0.2.7 及之前为「面板内二态确认」（同一按钮连按两次 Enter）；
    v0.2.8 改为弹出对话框，「清空全部…」后再经二次确认面板才真正清空（A77）。
    坐标推算依赖固定尺寸弹窗；若焦点序/尺寸变动需重新标定（真机校准项）。
    """
    app.move_to(40, 60)   # 避开右上角通知弹窗（会盖住齿轮/书架按钮）
    for attempt in range(3):
        click_at(app, *GEAR)
        sleep(900)
        if window_text(app.hwnd) != "BookEditor":
            break          # 标题带书名或弹窗打开即视为齿轮生效
        log(f"gear click: 第 {attempt + 1} 次未生效，重试")
    tab(4)               # close → 阅读体验 → 界面外观 → 高级
    key(VK_RETURN)       # 切到高级窗格
    sleep(400)
    tab(2)               # 重置 → 书架记录·清空
    key(VK_RETURN)       # 打开管理对话框
    sleep(700)
    shot("sm-shelf-clear-dialog", bbox=app.rect())

    cw, ch = app.client_size()
    left = (cw - MGR_W) // 2
    top = (ch - MGR_H) // 2
    # 底部最右按钮：右边缘 = 弹窗右缘 - 20(padding)，宽 120 → 中心 = 右缘 - 80
    btn_x = left + MGR_W - 80
    btn_y = top + MGR_FOOT_Y_OFF

    click_at(app, btn_x, btn_y)   # 面板一「清空全部…」
    sleep(600)
    shot("sm-shelf-clear-confirm", bbox=app.rect())
    click_at(app, btn_x, btn_y)   # 面板二「确认清空」
    sleep(700)
    key(VK_ESCAPE)                # 关设置面板（若已关则无副作用）
    sleep(600)


def main():
    subprocess.run(["taskkill", "/F", "/IM", "book-editor.exe"], capture_output=True)
    sleep(800)

    app = App()
    sleep(2000)

    # 0. 初始基线：清空书架（localStorage 跨运行残留，保证冒烟确定性；
    #    顺带先走一遍 v0.2.8 管理对话框的清空路径）
    clear_shelf_via_settings(app)
    shot("sm-shelf-00-baseline-cleared", bbox=app.rect())
    covers = find_covers(app)
    check("基线-书架已清空", len(covers) == 0, f"covers={len(covers)}")

    # 1. 打开图书（对话框路径）
    ok = D.open_file(app, FIXTURE)
    log(f"smoke: open_file -> {ok}, title={window_text(app.hwnd)!r}")
    if not ok:
        check("打开图书", False, "open_file 失败，中止")
        D.flush_log()
        return
    sleep(6000)

    # 2. 滚动产生阅读位置（记录时机已改为离场节点：回书架/退出时同步取，
    #    阅读中不周期性写库；此处等待仅余量，不再依赖节流触发）
    wheel_down(8, app)
    sleep(1500)

    # 3. 回书架：标题变 BookEditor + 卡片出现（sm-shelf-01）
    click_shelf(app)
    sleep(1200)
    title = window_text(app.hwnd)
    check("sm-shelf-01-回书架标题", title == "BookEditor", repr(title))
    covers = find_covers(app)
    check("sm-shelf-01-卡片出现", len(covers) == 1, f"covers={len(covers)}")
    shot("sm-shelf-01-shelf", bbox=app.rect())
    accent = accent_of(app)
    check("sm-shelf-01-位置已上报(进度条填充)", has_progress_fill(app, accent),
          f"accent={accent}")

    # 4. 点卡片续读：不弹文件对话框 + 标题恢复（sm-shelf-02 / A32）
    if covers:
        cx, cy = covers[0]
        click_at(app, cx + 88, cy)
        sleep(2500)
        dlg = wait_dialog(1500)
        check("sm-shelf-02-续读不弹框(A32)", dlg is None,
              "出现了文件对话框" if dlg else "")
        title = window_text(app.hwnd)
        check("sm-shelf-02-续读书打开", title == f"BookEditor — {FIXTURE}", repr(title))
        shot("sm-shelf-02-resumed", bbox=app.rect())
    else:
        check("sm-shelf-02-续读不弹框(A32)", False, "无卡片可点")

    # 5. 回书架 → 悬停移除 → 卡片消失（sm-shelf-03）
    click_shelf(app)
    sleep(1200)
    covers = find_covers(app)
    if covers:
        cx, cy = covers[0]
        move_to(app, cx + 190, cy - 21)   # 移除钮（悬停后才显示）
        sleep(300)
        shot("sm-shelf-03-remove-hover", bbox=app.rect())
        click_at(app, cx + 190, cy - 21)
        sleep(1000)
        covers2 = find_covers(app)
        check("sm-shelf-03-移除后卡片消失", len(covers2) == 0,
              f"剩余 {len(covers2)} 张")
        shot("sm-shelf-03-removed", bbox=app.rect())
    else:
        check("sm-shelf-03-移除后卡片消失", False, "无卡片可移除")

    # 6. 重新打开同一书 → 书架仍 1 张（A28 去重）
    ok = D.open_file(app, FIXTURE)
    check("A28-重复打开成功", ok, f"title={window_text(app.hwnd)!r}")
    sleep(5000)
    click_shelf(app)
    sleep(1200)
    covers = find_covers(app)
    check("A28-去重(重复打开卡片数不变)", len(covers) == 1, f"covers={len(covers)}")
    shot("sm-shelf-06-dedup", bbox=app.rect())

    # 7. 高级页「清空」→ 管理对话框二次确认清空 → 书架区隐藏（sm-shelf-04 / A34 / A77）
    clear_shelf_via_settings(app)
    click_shelf(app)
    sleep(1200)
    covers = find_covers(app)
    check("sm-shelf-04-清空后书架区隐藏(A34)", len(covers) == 0, f"covers={len(covers)}")
    shot("sm-shelf-04-cleared", bbox=app.rect())

    # 8. 再打开一次书（重建条目）→ 重启 → 书架仍在（A27 持久化）
    ok = D.open_file(app, FIXTURE)
    check("A27-重建条目打开成功", ok, "")
    sleep(5000)
    app.close()
    sleep(1500)
    app2 = App()
    sleep(2500)
    title = window_text(app2.hwnd)
    check("A27-重启后回到欢迎页", title == "BookEditor", repr(title))
    covers = find_covers(app2)
    check("A27-重启后书架保留", len(covers) == 1, f"covers={len(covers)}")
    shot("sm-shelf-08-restart-persist", bbox=app2.rect())
    app2.close()

    failed = [n for n, ok in RESULTS if not ok]
    log(f"==== 冒烟结果: {len(RESULTS) - len(failed)}/{len(RESULTS)} 通过" +
        (f"，失败: {failed}" if failed else "") + " ====")
    D.flush_log()


if __name__ == "__main__":
    main()
