// EPUB 高亮 rect 计算（D103 新增）。
//
// 为什么需要这一层：epubjs 的高亮经 `marks-pane` 的 `Highlight.render()` 绘制，
// 而它用 `filteredRanges()` 做「去重」，算法是——
//
//   rects.filter(box => !rects.some(other => other !== box && contains(other, box)))
//
// 即「凡是被另一个矩形包含的，一律丢弃」。这在单行选区下无害（各矩形互不包含），
// 但 `Range.getClientRects()` 在跨块元素选区时**会返回一个容器级大矩形**（段落/body
// 的包围盒），此时所有行矩形都被这个大家伙包含 → 全部被丢 → 只剩一个大矩形，
// 渲染出来就是**一整块实心色块把正文全盖住**。
//
// 这正是用户截图里滚动模式「整片蓝色矩形」的成因（D102 的 CSS 拆分修的是另一条
// 路径：SVG <g> 上的 background 按包围盒填色；两条都要治，缺一不可）。
//
// 本层用正确的判定替代：只丢「与其它矩形几乎完全相同」的重复项（getClientRects
// 在行内嵌套元素上会重复返回同一个几何框），**不**按包含关系丢弃——小块本就该留。

/** 与 DOMRect 对齐的最小结构（便于单测构造） */
export type RectLike = {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
};

/** 视为「同一矩形」的坐标容差（px）：getClientRects 的重复项坐标完全一致，1px 足够 */
const SAME_RECT_EPS = 1;

/** 宽或高小于此值的矩形不参与绘制（零面积/退化的行尾残片） */
const MIN_SIDE = 0.5;

function nearlySame(a: RectLike, b: RectLike): boolean {
  return (
    Math.abs(a.top - b.top) < SAME_RECT_EPS &&
    Math.abs(a.left - b.left) < SAME_RECT_EPS &&
    Math.abs(a.width - b.width) < SAME_RECT_EPS &&
    Math.abs(a.height - b.height) < SAME_RECT_EPS
  );
}

/**
 * 过滤选区矩形：丢零面积项 + 丢几何重复项，**保留**被包含的小矩形。
 *
 * 与 marks-pane 的差异（关键）：不因「被大矩形包含」而丢弃。跨块选区必然同时
 * 返回容器包围盒与逐行框，两者都要画——容器框负责覆盖段落留白，行框负责精准
 * 覆盖每一行，单留任意一种都会出问题（只留容器框 = 整块实心，只留行框 = 段间
 * 留白没盖到）。
 */
export function filterRects(rects: RectLike[]): RectLike[] {
  const out: RectLike[] = [];
  for (const r of rects) {
    if (!Number.isFinite(r.width) || !Number.isFinite(r.height)) continue;
    if (r.width < MIN_SIDE || r.height < MIN_SIDE) continue;
    if (out.some((k) => nearlySame(k, r))) continue; // 只去掉完全重复的几何框
    out.push(r);
  }
  return out;
}

/**
 * 把一个矩形换算成相对 SVG 原点的 x/y/宽/高。
 *
 * marks-pane 原实现用 `<g>.getBoundingClientRect()` 当原点（`offset`），首次渲染
 * 时 `<g>` 还没有子元素、包围盒为 0，于是所有 rect 坐标整体偏移。这里改为**显式
 * 传入偏移量**（由调用方给出 pane 的 svg 定位基准），不依赖 `<g>` 自身的包围盒，
 * 因此重画多少次都稳定。
 */
export function toSvgRect(r: RectLike, originLeft: number, originTop: number) {
  return {
    x: r.left - originLeft,
    y: r.top - originTop,
    width: r.width,
    height: r.height,
  };
}
