"""设置面板个性化 GUI 冒烟（v0.2.0 + v0.2.5 快捷键分类）。

驱动方式（v0.2.5c 起改为坐标点击 + 像素验证）：
- 齿轮按钮：客户端像素坐标（实测 1241,26）
- 对话框内控件：客户端像素坐标点击（对话框固定 640x600 居中，窗口客户区
  1278x828 固定，坐标与窗口屏幕位置无关；历史「坐标不可靠」结论源于早期
  窗口尺寸/DPI 不固定 + 对话框高度 auto 导致坐标漂移，v0.2.5c 已修复）
- 验证：像素采样断言 + 截图留证，颜色不靠肉眼判断

历史方法论与废弃原因：
- v0.2.0–v0.2.5b 用 Tab/Enter 键盘导航。实证缺陷：① WebView2 对连续快按 Tab/点击
  存在随机丢事件竞态（标定实验 c5/c6 中复现，单次丢失率约 1/4），Tab 计数法
  路径会整体错位；② 鼠标悬停 nav 列会使整列变淡蓝底，干扰选中态像素检测。
- 现方案：坐标点击 + 点击后 SetCursorPos(2,2) 移开鼠标消 hover + nav 选中态
  像素验证 + 丢点击自动重试（≤3 次）+ 整轮流程重试兜底。

v0.2.5b 前台保障（2026-10-21 实测教训）：本机 Navicat 等第三方窗口会抢前台，
导致点击/截图落到错误窗口（A19/A20 假阴性、sm-02 曾截到 Navicat 登录界面）。
fg() 哨兵：每次点击/按键/截图前 force_foreground 并验证 GetForegroundWindow==hwnd；
open_file 后 move_to(40,60) 避开右上角通知弹窗区（与 smoke_shelf 一致）。

对话框控件坐标（客户区；2026-10-21 于新构建实测标定，calib8/calib9：
  .settings-dialog 固定 height:600px → 对话框客户区 y 111..710 恒定，
  nav/主题卡/色板/滑块/footer 坐标在「主题 × 窗格」两维下零漂移）：
  nav 列 x=394：阅读体验 y=197 / 界面外观 y=234 / 快捷键 y=271 / 高级 y=308（pitch 37）
  主题卡（appearance 窗格，4 等宽卡）：浅色 x=523 / 深色 x=639 / 护眼 x=755 /
    羊皮纸 x=870，卡中心 y=260
  强调色 6 板 y=415：蓝 502 / 靛蓝 542 / 绿 582 / 琥珀 622 / 玫红 662 / 青 703
  字号滑块轨道 y=563（x 515..820），点击获焦后 End 推最大值 20
  footer y=680：取消 x=843 / 保存 x=910
  高级窗格：重置 (889,250) / 清空 (889,311)
    （v0.2.8 D60：该「清空」不再直接清空，改为打开固定尺寸 560×420 的
      书架管理对话框——自选清除列表 + 清空全部二次确认；本脚本不点它，
      清空路径由 smoke_shelf.clear_shelf_via_settings 覆盖）

断言设计注记（2026-10-21 修正）：v0.2.0 的「工具栏扫绿/蓝」断言恒真——
「打开图书」图标着色强调色，而 localStorage 残留强调色恰为绿，扫啥中都。
A21 改为采样面板内「保存」主按钮中心色（复位恢复默认蓝 → 切绿 → 保存后变绿），
真正验证强调色保存链路；基线「工具栏蓝」保留作坐标漂移防护。

v0.2.5 注记：新增「快捷键」nav 分类，本脚本在主管线内 click_nav("hotkeys")
覆盖其存在性与可达性；录制交互（A68–A71）由单测（readerHotkeys 16 项 +
settings v4 7 项）与真机 verify 覆盖。
"""
import subprocess
import sys

sys.path.insert(0, "e2e")
import driver as D
from driver import App, log, sleep, shot, click_client, tap, force_foreground
import ctypes

user32 = ctypes.windll.user32

FIXTURE = sys.argv[1] if len(sys.argv) > 1 else "12.epub"

GEAR = (1241, 26)  # 客户端坐标（实测）
NAV = {"reading": (394, 197), "appearance": (394, 234),
       "hotkeys": (394, 271), "advanced": (394, 308)}
THEME_DARK = (639, 260)
ACCENT_GREEN = (582, 415)
FONT_SLIDER = (700, 563)
SAVE = (910, 680)
CANCEL = (843, 680)
RESET = (889, 250)

VK_END = 0x23
VK_ESCAPE = 0x1B

# 像素断言基准色（styles.css 令牌）
DARK_BAR = (17, 24, 39)      # data-theme=dark  --bar-bg #111827
LIGHT_BAR = (250, 251, 252)  # :root            --bar-bg #fafbfc
GREEN = (5, 150, 105)        # 强调色-绿 #059669
BLUE = (37, 99, 235)         # 强调色-蓝 #2563eb（默认）
NAV_SELECTED_BG = (239, 246, 255)   # 浅色主题 nav 选中态淡蓝底 #eff6ff
NAV_SELECTED_BG_DARK = (30, 58, 95)  # 深色主题 nav 选中态深蓝底 #1e3a5f

RESULTS = []
CUR = [None]  # 当前 app hwnd（key/fg 无参时取当前）


def check(name, ok, detail=""):
    RESULTS.append((name, ok))
    log(f"[{'PASS' if ok else 'FAIL'}] {name} {detail}")


def grab(app):
    from PIL import ImageGrab
    return ImageGrab.grab(bbox=app.rect())


def px(im, cx, cy):
    """客户端坐标 → 截图像素（窗口 rect 左上为原点，+1 边框 +31 标题栏）。"""
    return im.getpixel((cx + 1, cy + 31))


def near(p, rgb, tol=12):
    return all(abs(p[i] - rgb[i]) <= tol for i in range(3))


def scan_color(im, rgb, tol=30, x1=500, y0=32, y1=112):
    """工具栏条带（窗口坐标 y 32..112, x 0..500）内扫描指定颜色。"""
    for y in range(y0, y1):
        for x in range(0, x1):
            if near(im.getpixel((x, y)), rgb, tol):
                return True
    return False


def fg(app=None):
    """前台哨兵：强制激活并验证；第三方窗口（Navicat/通知弹窗）抢焦点时重试。"""
    hwnd = app.hwnd if app else CUR[0]
    for i in range(4):
        force_foreground(hwnd)
        if user32.GetForegroundWindow() == hwnd:
            return True
        log(f"fg: 第 {i + 1} 次前台验证失败，重试")
        sleep(300)
    log("fg: 前台保障失败（疑似窗口被完全遮挡或最小化）")
    return False


def move_mouse_away():
    """鼠标移出窗口（屏幕左上角），消除 nav 列 hover 底色对选中态检测的干扰。"""
    user32.SetCursorPos(2, 2)
    sleep(300)


def click(app, x, y):
    fg(app)
    click_client(app.hwnd, x, y)


def key(vk):
    fg()
    tap(vk)


def shot_fg(app, name):
    fg(app)
    shot(name, bbox=app.rect())


def nav_selected(im, key_name):
    """nav 选中态检测（双主题）：项内空白为选中底——浅色主题淡蓝 #eff6ff、
    深色主题深蓝 #1e3a5f（未选中：浅色白 #fafbfc / 深色 #111827）。

    采样整行项宽（客户区 x 330..441 → 截图 x 331..442），要求选中底色像素
    占多数（≥25），文字字间空隙足以稳定达标；未选中项对选中底 0 命中，
    双主题底色均与选中底可辨（差 ≥11）。调用方须先 move_mouse_away() 消 hover；
    localStorage 可能残留深色主题，两套底色都必须认。
    """
    sy = NAV[key_name][1] + 31
    hits = 0
    for sx in range(331, 443):
        p = im.getpixel((sx, sy))
        if near(p, NAV_SELECTED_BG, 10) or near(p, NAV_SELECTED_BG_DARK, 12):
            hits += 1
    return hits >= 25


def click_nav(app, key_name):
    """坐标点击 nav 项 + 选中态验证 + 丢点击重试（WebView2 偶发丢事件）。"""
    x, y = NAV[key_name]
    for attempt in range(3):
        click(app, x, y)
        move_mouse_away()
        im = grab(app)
        if nav_selected(im, key_name):
            return True
        log(f"click_nav({key_name}) 第 {attempt + 1} 次未生效，重试")
    return False


def run_once():
    """完整冒烟流程；返回是否全部断言通过（供 main 决定是否整轮重试）。"""
    subprocess.run(["taskkill", "/F", "/IM", "book-editor.exe"],
                   capture_output=True)
    sleep(800)

    app = App()
    CUR[0] = app.hwnd
    sleep(2000)
    ok = D.open_file(app, FIXTURE)
    log(f"smoke: open_file -> {ok}, title={D.window_text(app.hwnd)!r}")
    fg(app)
    app.move_to(40, 60)  # 避开右上角通知弹窗区
    sleep(3000)
    shot_fg(app, "sm-00-book")

    # 0. 复位到默认设置：强调色/主题跨重启持久化，残留值会让基线不确定。
    #    高级 → 重置（仅草稿）→ 保存 → Esc，顺带覆盖「恢复默认」路径。
    click(app, *GEAR)
    sleep(1000)
    if not click_nav(app, "advanced"):
        check("复位-nav 可达 advanced", False)
    sleep(400)
    click(app, *RESET)   # 草稿恢复默认（不落库）
    sleep(500)
    click(app, *SAVE)    # 保存默认值并生效
    sleep(600)
    key(VK_ESCAPE)
    sleep(600)
    # 复位链路验证：状态栏恢复浅色（证明恢复默认+保存真正生效，
    # 而非旧版坐标错误时的「点击落空、恰好默认态」假通过）
    im = grab(app)
    bar0 = px(im, 640, 810)
    check("复位-状态栏恢复浅色", near(bar0, LIGHT_BAR, 10), str(bar0))
    shot_fg(app, "sm-00b-reset-default")

    # 基线：浅色状态栏 + 蓝色工具按钮（坐标漂移防护）
    im = grab(app)
    check("基线-状态栏浅色", near(px(im, 640, 810), LIGHT_BAR, 10), str(px(im, 640, 810)))
    check("基线-工具按钮蓝", scan_color(im, BLUE))

    # 1. 打开设置（默认落在「阅读体验」）
    click(app, *GEAR)
    sleep(1000)
    shot_fg(app, "sm-01-settings-reading")

    # 1b. v0.2.5：快捷键分类可达性（pane 打开即验证存在）
    if not click_nav(app, "hotkeys"):
        check("快捷键-nav 可达 hotkeys", False)
    sleep(400)
    shot_fg(app, "sm-01b-hotkeys")

    # 2. 点 nav「界面外观」
    if not click_nav(app, "appearance"):
        check("外观-nav 可达 appearance", False)
    sleep(500)
    shot_fg(app, "sm-02-appearance")

    # 3. 点「深色」主题卡
    click(app, *THEME_DARK)
    sleep(600)
    shot_fg(app, "sm-03-theme-dark")

    # 4. 点第三颗色板（绿）
    click(app, *ACCENT_GREEN)
    sleep(600)
    shot_fg(app, "sm-04-accent-green")

    # 5. 点字号滑块 → End（最大值 20）
    click(app, *FONT_SLIDER)
    sleep(300)
    key(VK_END)
    sleep(500)
    shot_fg(app, "sm-05-font-20")

    # 6. 点「保存」（面板不关，底部显示「已保存」；主按钮随强调色变绿）
    click(app, *SAVE)
    sleep(700)
    move_mouse_away()  # 指针停在按钮上会采到 hover 色（accent-hover）
    shot_fg(app, "sm-06-saved")
    im = grab(app)
    btn = px(im, *SAVE)
    check("A21-保存后主按钮绿", near(btn, GREEN, 35), str(btn))

    # 7. Esc 关闭面板 → 应用主题生效（A19）
    key(VK_ESCAPE)
    sleep(900)
    shot_fg(app, "sm-07-app-dark")
    im = grab(app)
    bar = px(im, 640, 810)
    check("A19-保存后状态栏深色", near(bar, DARK_BAR, 12), str(bar))

    # 8. 重启应用验证持久化（A20）
    app.close()
    sleep(1500)
    app2 = App()
    CUR[0] = app2.hwnd
    sleep(2000)
    ok2 = False
    for i in range(3):
        ok2 = D.open_file(app2, FIXTURE)
        if ok2:
            break
        log(f"sm-08: 第 {i + 1} 次 reopen 失败，重试")
    log(f"smoke: reopen -> {ok2}")
    fg(app2)
    app2.move_to(40, 60)
    sleep(6000)
    shot_fg(app2, "sm-08-restart-persist")
    im2 = grab(app2)
    bar2 = px(im2, 640, 810)
    check("A20-重启后状态栏深色", near(bar2, DARK_BAR, 12), str(bar2))
    # 强调色跨重启持久化：开面板验主按钮仍为绿（避开工具栏扫色恒真问题）
    click(app2, *GEAR)
    sleep(1000)
    move_mouse_away()
    btn2 = px(grab(app2), *SAVE)
    check("A20-重启后主按钮绿", near(btn2, GREEN, 35), str(btn2))
    key(VK_ESCAPE)
    sleep(500)
    app2.close()

    failed = [n for n, ok in RESULTS if not ok]
    log(f"==== 冒烟结果: {len(RESULTS) - len(failed)}/{len(RESULTS)} 通过" +
        (f"，失败: {failed}" if failed else "") + " ====")
    D.flush_log()
    return not failed


def main():
    for round_no in (1, 2):
        RESULTS.clear()
        log(f"==== 第 {round_no} 轮冒烟开始 ====")
        if run_once():
            return
        log(f"==== 第 {round_no} 轮存在失败项，整体重试 ====")
    log("==== 两轮均未全绿，按失败退出 ====")


if __name__ == "__main__":
    main()
