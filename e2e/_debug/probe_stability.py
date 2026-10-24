"""稳定性探针：打开 → Page Down×3 → 等上报 → 截图 A → 再等 10s → 截图 A2。
若 A 与 A2 有差异，说明活视图几何仍在漂移（图片加载），上报位置本身就会过时；
若相同，则漂移只发生在恢复的重渲染阶段。"""
import subprocess
import sys

sys.path.insert(0, "e2e")
import driver as D
from driver import App, log, sleep, shot


def main():
    subprocess.run(["taskkill", "/F", "/IM", "book-editor.exe"], capture_output=True)
    sleep(800)
    app = App()
    sleep(2000)
    ok = D.open_file(app, "12.epub")
    log(f"probe: open -> {ok}")
    sleep(6000)
    r = app.rect()
    D.click_screen(r[0] + 641, r[1] + 31 + 400)
    sleep(600)
    for _ in range(3):
        D.tap(0x22)
        sleep(500)
    sleep(5500)
    shot("probe-A", bbox=app.rect())
    sleep(10000)
    shot("probe-A2", bbox=app.rect())
    log("probe: done（比对 probe-A 与 probe-A2）")
    D.flush_log()


if __name__ == "__main__":
    main()
