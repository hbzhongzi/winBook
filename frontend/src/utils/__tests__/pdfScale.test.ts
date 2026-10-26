// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import {
  FIT_LABELS,
  PDF_FITS,
  PDF_ZOOM_MAX,
  PDF_ZOOM_MIN,
  PDF_ZOOM_NUDGE,
  PDF_ZOOM_PRESETS,
  clampPdfZoom,
  clampSpreadLeft,
  currentDpr,
  fitRatio,
  normalizePdfFit,
  nudgeZoom,
  resolvePdfScale,
  spreadLeftMax,
  spreadLeftPage,
  spreadStep,
  type PdfFit,
} from "../pdfScale";

// A4 竖版与 16:9 横版（PDF pt @72dpi = CSS px）
const A4 = { pw: 595.28, ph: 841.89 };
const WIDE = { pw: 960, ph: 540 };
// 默认窗口内容区内盒（1280×860 窗 − 44，方案 §1.1 实算）
const BOX = { cw: 1236, ch: 679 };

describe("pdfScale v0.2.9 — 适配解析", () => {
  it("宽容器 + A4 竖版 → auto 判适宽，倍率 ≈2.08、宽度铺满", () => {
    const r = resolvePdfScale("auto", 100, BOX.cw, BOX.ch, A4.pw, A4.ph, true);
    expect(r.fit).toBe("width");
    expect(r.scale).toBeCloseTo(BOX.cw / A4.pw, 4); // 2.0763…
    expect(r.cssW).toBe(1236);
    expect(r.cssH).toBe(1748);
    // 宽窗下字最大：适宽倍率远大于适高
    expect(r.sw).toBeGreaterThan(r.sh);
  });

  it("窄容器 + A4 竖版 → auto 翻转为适高，整页可见", () => {
    const r = resolvePdfScale("auto", 100, 400, BOX.ch, A4.pw, A4.ph, true);
    expect(r.fit).toBe("height");
    expect(r.cssH).toBe(679);
    expect(r.cssW).toBe(480);
  });

  it("auto 翻转点（A4 竖版，容器高 679）：cw=481 判适宽，cw=480 判适高", () => {
    // 翻转条件 sw > sh → cw > pw × ch/ph = 595.28 × 679/841.89 ≈ 480.1
    const flip = A4.pw * (BOX.ch / A4.ph);
    expect(flip).toBeCloseTo(480.1, 1);
    expect(resolvePdfScale("auto", 100, 481, BOX.ch, A4.pw, A4.ph, true).fit).toBe("width");
    expect(resolvePdfScale("auto", 100, 480, BOX.ch, A4.pw, A4.ph, true).fit).toBe("height");
  });

  it("16:9 横版页在默认窗下 auto 仍判适宽（近似平局，底部溢 16px，方案 §3.1 边界）", () => {
    const r = resolvePdfScale("auto", 100, BOX.cw, BOX.ch, WIDE.pw, WIDE.ph, true);
    expect(r.fit).toBe("width");
    expect(Math.round(r.sw * 100)).toBe(129);
    expect(Math.round(r.sh * 100)).toBe(126);
    expect(r.cssH).toBe(695); // > 679，溢出 16px
  });

  it("width 适宽：cssW 精确等于容器宽", () => {
    const r = resolvePdfScale("width", 100, 1000, 600, A4.pw, A4.ph, true);
    expect(r.cssW).toBe(1000);
    expect(r.fit).toBe("width");
  });

  it("height 适高：cssH 精确等于容器高", () => {
    const r = resolvePdfScale("height", 100, 1000, 600, A4.pw, A4.ph, true);
    expect(r.cssH).toBe(600);
    expect(r.fit).toBe("height");
  });

  it("spread 双页：倍率受两页总宽与容器高双重约束", () => {
    const r = resolvePdfScale("spread", 100, BOX.cw, BOX.ch, A4.pw, A4.ph, true);
    // sp = min(1236/(2×595.28), 679/841.89) = min(1.0387, 0.8064) = 0.8064
    expect(r.fit).toBe("spread");
    expect(r.scale).toBeCloseTo(BOX.ch / A4.ph, 4);
    expect(r.cssW).toBe(480); // 单页宽；双页总宽 = 480×2 + 14
  });

  it("spread 窄容器：转由两页总宽约束", () => {
    const r = resolvePdfScale("spread", 100, 800, 679, A4.pw, A4.ph, true);
    expect(r.scale).toBeCloseTo(800 / (2 * A4.pw), 4);
  });

  it("custom：用 pdfZoom，与容器尺寸无关", () => {
    const r = resolvePdfScale("custom", 150, 100, 100, A4.pw, A4.ph, true);
    expect(r.fit).toBe("custom");
    expect(r.scale).toBe(1.5);
  });

  it("容器未测量（cw=0）→ scale 0，调用方据此跳过渲染", () => {
    const r = resolvePdfScale("auto", 100, 0, 0, A4.pw, A4.ph, true);
    expect(r.scale).toBe(0);
    expect(r.cssW).toBe(0);
    expect(r.cssH).toBe(0);
  });

  it("页面尺寸非法（pw=0）→ 全零，不产生 NaN", () => {
    const r = resolvePdfScale("width", 100, 1236, 679, 0, 0, true);
    expect(r.scale).toBe(0);
    expect(Number.isNaN(r.cssW)).toBe(false);
  });

  it("DPR 关闭 → 位图锁 1（bmp = css）", () => {
    const r = resolvePdfScale("width", 100, 1236, 679, A4.pw, A4.ph, false);
    expect(r.dpr).toBe(1);
    expect(r.bmpW).toBe(r.cssW);
    expect(r.bmpH).toBe(r.cssH);
  });

  it("DPR 开启 → 位图 = CSS × min(devicePixelRatio,2)", () => {
    const prev = window.devicePixelRatio;
    try {
      window.devicePixelRatio = 2;
      const r = resolvePdfScale("width", 100, 1236, 679, A4.pw, A4.ph, true);
      expect(r.dpr).toBe(2);
      expect(r.bmpW).toBe(r.cssW * 2);
      expect(r.bmpH).toBe(r.cssH * 2);
      window.devicePixelRatio = 3; // 超上限 → 锁 2
      const capped = resolvePdfScale("width", 100, 1236, 679, A4.pw, A4.ph, true);
      expect(capped.dpr).toBe(2);
    } finally {
      window.devicePixelRatio = prev;
    }
  });

  it("normalizePdfFit 白名单：非法/undefined → auto", () => {
    expect(normalizePdfFit("spread")).toBe("spread");
    expect(normalizePdfFit("neon")).toBe("auto");
    expect(normalizePdfFit(undefined)).toBe("auto");
    expect(normalizePdfFit(42)).toBe("auto");
  });

  it("clampPdfZoom：越界钳制、NaN/非数字回落默认", () => {
    expect(clampPdfZoom(1000)).toBe(PDF_ZOOM_MAX);
    expect(clampPdfZoom(10)).toBe(PDF_ZOOM_MIN);
    expect(clampPdfZoom(Number.NaN)).toBe(100);
    expect(clampPdfZoom("150" as never)).toBe(100); // 字符串按非数字处理
    expect(clampPdfZoom(undefined as never)).toBe(100);
    expect(clampPdfZoom(233.6)).toBe(234);
  });

  it("nudgeZoom：±步进并在边界停住", () => {
    expect(nudgeZoom(100, PDF_ZOOM_NUDGE)).toBe(110);
    expect(nudgeZoom(100, -PDF_ZOOM_NUDGE)).toBe(90);
    expect(nudgeZoom(395, PDF_ZOOM_NUDGE)).toBe(400); // 顶部钳制
    expect(nudgeZoom(55, -PDF_ZOOM_NUDGE)).toBe(50);
  });

  it("FIT_LABELS/PDF_FITS/预设表口径完整", () => {
    expect(PDF_FITS).toEqual(["auto", "width", "height", "spread", "custom"]);
    expect(Object.keys(FIT_LABELS)).toEqual(PDF_FITS);
    expect(PDF_ZOOM_PRESETS).toContain(100);
    expect(PDF_ZOOM_PRESETS.every((p) => p >= PDF_ZOOM_MIN && p <= PDF_ZOOM_MAX)).toBe(true);
  });
});

describe("pdfScale v0.2.9 — 双页步进与钳制", () => {
  it("spreadStep：仅双页 2，其余 1", () => {
    expect(spreadStep("spread")).toBe(2);
    expect(spreadStep("auto")).toBe(1);
    expect(spreadStep("custom")).toBe(1);
  });

  it("spreadLeftPage：奇数取自身、偶数取前一页", () => {
    expect(spreadLeftPage(3)).toBe(3);
    expect(spreadLeftPage(4)).toBe(3);
    expect(spreadLeftPage(1)).toBe(1);
    expect(spreadLeftPage(2)).toBe(1);
  });

  it("spreadLeftMax：偶数总页数末跨页在前一页；奇数总页数末页单独", () => {
    expect(spreadLeftMax(262)).toBe(261);
    expect(spreadLeftMax(263)).toBe(263);
    expect(spreadLeftMax(1)).toBe(1);
    expect(spreadLeftMax(0)).toBe(1);
  });

  it("clampSpreadLeft：恢复页码偶数 → 摊开到含该页的跨页", () => {
    // 从单页第 4 页切双页：应显示 3–4 跨页
    expect(clampSpreadLeft(4, 262)).toBe(3);
    expect(clampSpreadLeft(261, 262)).toBe(261);
    expect(clampSpreadLeft(262, 262)).toBe(261); // 偶数总页数：262 不能作左页
    expect(clampSpreadLeft(263, 263)).toBe(263);
    expect(clampSpreadLeft(999, 262)).toBe(261);
    expect(clampSpreadLeft(0, 262)).toBe(1);
  });

  it("currentDpr：关闭锁 1；开启取 min(dpr,2)", () => {
    const prev = window.devicePixelRatio;
    try {
      expect(currentDpr(false)).toBe(1);
      window.devicePixelRatio = 1.5;
      expect(currentDpr(true)).toBe(1.5);
      window.devicePixelRatio = 3;
      expect(currentDpr(true)).toBe(2);
    } finally {
      window.devicePixelRatio = prev;
    }
  });

  it("resolvePdfScale 对全部 fit 取值均返回有限数", () => {
    for (const fit of PDF_FITS as PdfFit[]) {
      const r = resolvePdfScale(fit, 120, 900, 600, A4.pw, A4.ph, true);
      expect(Number.isFinite(r.scale)).toBe(true);
      expect(Number.isFinite(r.cssW)).toBe(true);
      expect(Number.isFinite(r.bmpH)).toBe(true);
      expect(r.scale).toBeGreaterThan(0);
    }
  });

  it("fitRatio：auto 跟随实际解析结果，无测量数据返回 null", () => {
    const r = resolvePdfScale("auto", 100, BOX.cw, BOX.ch, A4.pw, A4.ph, true);
    expect(fitRatio(r, "auto", 100)).toBeCloseTo(r.sw, 6); // 本例解析为适宽
    expect(fitRatio(r, "width", 100)).toBeCloseTo(r.sw, 6);
    expect(fitRatio(r, "height", 100)).toBeCloseTo(r.sh, 6);
    expect(fitRatio(r, "spread", 100)).toBeCloseTo(r.sp, 6);
    expect(fitRatio(r, "custom", 130)).toBeCloseTo(1.3, 6);
    expect(fitRatio(null, "width", 100)).toBeNull();
  });
});
