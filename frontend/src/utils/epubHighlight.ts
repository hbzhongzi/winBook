// EPUB 高亮 rect 计算（D103 新增，D105 修正过滤方向）。
//
// 为什么需要这一层：epubjs 的高亮经 `marks-pane` 的 `Highlight.render()` 绘制，
// 而它用 `filteredRanges()` 做「去重」，算法是——
//
//   rects.filter(box => !rects.some(other => other !== box && contains(other, box)))
//
// 即「凡是被另一个矩形包含的，一律丢弃」。它保留的是**最大的容器框**：跨块选区
// 时 `Range.getClientRects()` 会额外返回段落/body 级包围盒，于是逐行框全被吞掉，
// 只剩一个大矩形 = 整块实心色块。
//
// D105 修正：正确的过滤方向恰好**相反**——丢弃「包含了其它框的容器框」，保留
// 被包含的逐行框。D103/D104 曾写成「只丢完全重复项、保留全部」，容器框仍在，
// 一旦 getClientRects 返回它就会覆盖整段（截图里横向溢出的浅块）。
//
// D104 补充：本层**只负责过滤**，坐标换算仍交给 marks-pane 的原 render()。
// 原公式 `r.left - offset.left + container.left` 中的 `+ container.left` 抵消了
// Pane 容器在宿主页面的偏移，是 iframe 内坐标 → SVG 局部坐标的正确桥梁。

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

/** 包含判定的容差（px）：相邻行的亚像素差异不应被误判为「同一框」 */
const CONTAIN_EPS = 2;

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

/** a 是否（在容差内）完整包含 b */
function containsBox(a: RectLike, b: RectLike): boolean {
  return (
    b.left >= a.left - CONTAIN_EPS &&
    b.right <= a.right + CONTAIN_EPS &&
    b.top >= a.top - CONTAIN_EPS &&
    b.bottom <= a.bottom + CONTAIN_EPS
  );
}

/**
 * 过滤选区矩形：**丢零面积项、丢几何重复项、丢容器级大框**，只保留逐行框。
 *
 * 关键（D105）：与 marks-pane 的「被包含即丢弃」方向相反。容器大框（段落/body
 * 包围盒）会覆盖整段文字，必须丢；逐行框才是贴合文字的部分，必须留。
 * 判定用「某框包含至少一个其它框」——同行内嵌元素产生的重复框已在前面去重。
 */
export function filterRects(rects: RectLike[]): RectLike[] {
  const out: RectLike[] = [];
  for (const r of rects) {
    if (!Number.isFinite(r.width) || !Number.isFinite(r.height)) continue;
    if (r.width < MIN_SIDE || r.height < MIN_SIDE) continue;
    if (out.some((k) => nearlySame(k, r))) continue; // 几何完全重复：只留一个
    out.push(r);
  }
  // 容器框判定：若某框（容差内）包含其它框，它是段落/body 级包围盒，丢弃。
  return out.filter(
    (r) => !out.some((other) => other !== r && containsBox(r, other))
  );
}
