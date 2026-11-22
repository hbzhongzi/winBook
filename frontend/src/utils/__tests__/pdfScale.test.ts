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
  columnStep,
  currentDpr,
  fitRatio,
  migratePdfFit,
  normalizePdfColumns,
  normalizePdfFit,
  nudgeZoom,
  resolvePdfScale,
  spreadLeftMax,
  spreadLeftPage,
  zoomAnchorScroll,
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

  // D102：双页不再是 fit 取值，改用 columns=2 表达
  it("双栏（columns=2）：auto 判定基于「扣掉间距后的一半宽」", () => {
    const r = resolvePdfScale("auto", 100, BOX.cw, BOX.ch, A4.pw, A4.ph, true, 2);
    // sw = (1236−14)/(2×595.28) = 1.0264；sh = 679/841.89 = 0.8064
    // auto 判据是 sw > sh，故此处判适宽（与单栏同容器的判定结果可能不同，正说明栏数参与了解析）
    expect(r.fit).toBe("width");
    expect(r.scale).toBeCloseTo((BOX.cw - 14) / (2 * A4.pw), 4);
    // 单栏同容器下 sw = 1236/595.28 = 2.076，也判适宽，但倍率是双栏的两倍多
    const one = resolvePdfScale("auto", 100, BOX.cw, BOX.ch, A4.pw, A4.ph, true, 1);
    expect(one.scale).toBeGreaterThan(r.scale);
  });

  it("双栏：两页总宽恰好等于容器宽（含间距），无溢出", () => {
    const r = resolvePdfScale("width", 100, BOX.cw, BOX.ch, A4.pw, A4.ph, true, 2);
    const totalW = r.cssW * 2 + 14;
    expect(Math.abs(totalW - BOX.cw)).toBeLessThanOrEqual(2); // 允许 1px 舍入
  });

  it("双栏窄容器：转由两页总宽约束", () => {
    const r = resolvePdfScale("width", 100, 800, 679, A4.pw, A4.ph, true, 2);
    expect(r.scale).toBeCloseTo((800 - 14) / (2 * A4.pw), 4);
  });

  it("缩放彻底不改变栏数：任何 fit/倍率下栏数语义不变", () => {
    for (const fit of ["auto", "width", "height", "custom"] as PdfFit[]) {
      const r1 = resolvePdfScale(fit, 100, BOX.cw, BOX.ch, A4.pw, A4.ph, true, 1);
      const r2 = resolvePdfScale(fit, 100, BOX.cw, BOX.ch, A4.pw, A4.ph, true, 2);
      // 单栏的 sw 是双栏 sw 的两倍（双栏要扣间距再对半分），但 fit 语义不变
      expect(r1.fit).toBe(r2.fit);
      expect(r2.sw).toBeLessThan(r1.sw);
    }
  });

  // ===== D103：双栏 custom 倍率基准 =====
  it("双栏 custom 100%：两页总宽恰好铺满可用宽（不再溢出裁切）", () => {
    const r = resolvePdfScale("custom", 100, BOX.cw, BOX.ch, A4.pw, A4.ph, true, 2);
    const totalW = r.cssW * 2 + 14;
    expect(Math.abs(totalW - BOX.cw)).toBeLessThanOrEqual(2); // 与适宽同宽
    // 每页宽 = 可用宽的一半
    expect(r.cssW).toBeCloseTo((BOX.cw - 14) / 2, 0);
  });

  it("双栏 custom 50%：每页宽 = 可用宽的一半 × 50%，不溢出容器", () => {
    const r = resolvePdfScale("custom", 50, BOX.cw, BOX.ch, A4.pw, A4.ph, true, 2);
    const usableHalf = (BOX.cw - 14) / 2;
    expect(r.cssW).toBe(Math.round(usableHalf * 0.5));
    expect(r.cssW * 2 + 14).toBeLessThan(BOX.cw);
  });

  it("单栏 custom 保持 v0.2.9 原口径（100% = 页面基准宽，存量零回归）", () => {
    const r = resolvePdfScale("custom", 100, BOX.cw, BOX.ch, A4.pw, A4.ph, true, 1);
    expect(r.scale).toBe(1);
    expect(r.cssW).toBe(Math.round(A4.pw));
  });

  it("双栏 custom 在任意倍率下两页总宽都不超过容器（放大不破栏的前提）", () => {
    for (const z of [50, 75, 100, 125, 150, 200, 400]) {
      const r = resolvePdfScale("custom", z, BOX.cw, BOX.ch, A4.pw, A4.ph, true, 2);
      // 100% 恰好铺满，>100% 允许溢出（用户主动放大），但 100% 及以下必须装得下
      if (z <= 100) {
        expect(r.cssW * 2 + 14).toBeLessThanOrEqual(BOX.cw + 2);
      }
    }
  });

  it("旧 spread 配置迁移：等价于 columns=2 的 auto 口径", () => {
    const legacy = resolvePdfScale("spread", 100, BOX.cw, BOX.ch, A4.pw, A4.ph, true, 1);
    const modern = resolvePdfScale("auto", 100, BOX.cw, BOX.ch, A4.pw, A4.ph, true, 1);
    expect(legacy.scale).toBeCloseTo(modern.scale, 6);
    expect(migratePdfFit("spread")).toBe("auto");
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
    // D102：菜单只给四种适配方式（spread 已剥离为独立的栏数开关）
    expect(PDF_FITS).toEqual(["auto", "width", "height", "custom"]);
    expect(PDF_FITS).not.toContain("spread");
    // FIT_LABELS 仍需覆盖全部合法键（含兼容别名），避免查表时 undefined
    expect(Object.keys(FIT_LABELS)).toEqual(["auto", "width", "height", "spread", "custom"]);
    expect(PDF_ZOOM_PRESETS).toContain(100);
    expect(PDF_ZOOM_PRESETS.every((p) => p >= PDF_ZOOM_MIN && p <= PDF_ZOOM_MAX)).toBe(true);
  });

  // ===== D102：栏数独立于适配方式 =====
  it("columnStep：栏数即步进", () => {
    expect(columnStep(1)).toBe(1);
    expect(columnStep(2)).toBe(2);
  });

  it("normalizePdfColumns：显式 1/2 采用，缺字段从 spread 迁移", () => {
    expect(normalizePdfColumns(1)).toBe(1);
    expect(normalizePdfColumns(2)).toBe(2);
    expect(normalizePdfColumns(undefined, "spread")).toBe(2); // 旧双页配置迁移
    expect(normalizePdfColumns(undefined, "auto")).toBe(1);
    expect(normalizePdfColumns(undefined)).toBe(1);
    expect(normalizePdfColumns(3)).toBe(1); // 越界回落
    expect(normalizePdfColumns("2")).toBe(1); // 字符串不认，避免存储被手改成 "2" 时误判
    expect(normalizePdfColumns(2, "auto")).toBe(2); // 显式优先于迁移
  });

  it("migratePdfFit：spread → auto，其余原样", () => {
    expect(migratePdfFit("spread")).toBe("auto");
    expect(migratePdfFit("width")).toBe("width");
    expect(migratePdfFit("custom")).toBe("custom");
  });
});

describe("pdfScale v0.2.9 — 双栏步进与钳制", () => {
  it("columnStep：栏数即步进（D102 取代 spreadStep(fit)）", () => {
    expect(columnStep(2)).toBe(2);
    expect(columnStep(1)).toBe(1);
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

describe("D110：以鼠标为中心缩放的滚动锚点", () => {
  it("放大 2 倍：鼠标下的内容点保持在视口原位", () => {
    // 内容左边缘在视口 300px，鼠标在视口 400px（距内容边缘 100px）。
    // 放大 2 倍后该内容点距内容边缘 200px，内容边缘应落到 200px → scrollLeft 从 0 增到 100。
    expect(zoomAnchorScroll(0, 300, 100, 400, 2)).toBe(100);
  });

  it("缩小 0.5 倍：滚动位置相应回退", () => {
    // 内容边缘当前在 200、鼠标在 400（距边缘 200）；缩到 0.5 倍后目标边缘 = 400−100 = 300，
    // 需把 scrollLeft 从 100 减到 0（内容右移 100）。
    expect(zoomAnchorScroll(100, 200, 200, 400, 0.5)).toBe(0);
  });

  it("ratio=1 且锚点自洽时不改变滚动位置", () => {
    // 缩放前后内容尺寸不变时 currentLead 应恒等于 anchorViewport − anchorInContent
    expect(zoomAnchorScroll(80, 300, 100, 400, 1)).toBe(80);
    expect(zoomAnchorScroll(0, 250, 150, 400, 1)).toBe(0);
  });

  it("结果取整并钳到 ≥0，非法输入原样返回", () => {
    // 400−50=350 的目标边缘大于可滚动量 → 负结果钳 0
    expect(zoomAnchorScroll(20, 100, 100, 600, 0.5)).toBe(0);
    // 四舍五入：0 + 300.4 − (400−220) = 120.4 → 120
    expect(zoomAnchorScroll(0, 300.4, 100, 400, 2.2)).toBe(120);
    // 非法输入不把滚动位置算飞
    expect(zoomAnchorScroll(50, Number.NaN, 10, 20, 2)).toBe(50);
    expect(zoomAnchorScroll(50, 10, 20, 30, 0)).toBe(50);
    expect(zoomAnchorScroll(50, 10, 20, 30, -1)).toBe(50);
    expect(zoomAnchorScroll(50, 10, 20, 30, Number.NaN)).toBe(50);
  });
});
