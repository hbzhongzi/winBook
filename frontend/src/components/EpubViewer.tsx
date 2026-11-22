import { useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import ePub from "epubjs";
import { base64ToUint8Array } from "../utils/base64";
import { createChapterWindow, type WindowManager } from "../utils/chapterWindow";
import { subscribeSettings, type ReaderMode, type Settings } from "../utils/settings";
import { setReaderCommandHandler, setPagerShowHandler, scrollStepFor } from "../utils/readerCommands";
import { usePagerVisibility } from "../utils/usePagerVisibility";
import { applyReadingStyle } from "../utils/readingTheme";
import type { ReadingPosition, PositionReport } from "../utils/library";
import { MARK_SELECT_MIN, type Mark, type MarkColor, type MarkLocator } from "../utils/marks";
import { epubDiag, clearEpubDiag, getEpubDiagText } from "../utils/epubDiag";
import { filterRects, type RectLike } from "../utils/epubHighlight";
import MarkToolbar, { type MarkToolbarMode } from "./MarkToolbar";
import type { MarksContext } from "./marksContext";

/** 已绑定快捷键转发的章节文档（WeakSet 防同文档重复绑定，v0.2.5 F22） */
const hotkeyBoundDocs = new WeakSet<Document>();
/** 已绑定「点击消散工具条/气泡」的章节文档（v0.3.0，page 模式 iframe 吞 mousedown） */
const markDismissBoundDocs = new WeakSet<Document>();
/** 已绑定「翻页模式悬停提示」的章节文档（D100，page 模式 iframe 可交互，宿主收不到 mousemove） */
const hoverBoundDocs = new WeakSet<Document>();

// epubjs 类型声明不完整，按使用面定义最小接口
type EpubNavItem = {
  label: string;
  href: string;
  subitems?: EpubNavItem[];
  depth?: number;
};
type TocTarget = EpubNavItem & {
  index: number;
  sectionIndex: number;
  fragment: string;
};
type EpubRendition = {
  display: (target?: string) => Promise<void>;
  // epubjs 运行时接受 number（像素）或 string（如 "100%"）；D88 起改用像素，
  // 传 "100%" 会因 stage.size() 写入 style.width="100%" 触发宽度反馈暴涨。
  resize: (width: string | number, height: string | number) => void;
  on?: (event: string, cb: (...args: unknown[]) => void) => void;
  started?: Promise<unknown>;
  manager?: EpubManager;
  hooks?: {
    content?: { register: (fn: (contents: EpubContents) => void) => void };
    render?: { register: (fn: (view: EpubView) => void) => void };
  };
  /**
   * epubjs annotations（v0.3.0 标记高亮载体，D67 验证点）。
   * highlight 以 Pane/SVG 覆盖层渲染：标记元素挂在宿主文档的 .epub-view 上
   * （非 iframe 内），故颜色经 styles 参数物化、宿主 CSS 可直接作用。
   * add 的 hash = encodeURI(cfiRange + type)，故 remove 必须同 type 成对调用；
   * 换色只能 remove + add（颜色不在 hash 里）。
   */
  annotations?: {
    add: (
      type: string,
      cfiRange: string,
      data: Record<string, string>,
      cb?: (() => void) | undefined,
      className?: string,
      styles?: Record<string, string>
    ) => EpubAnnotation;
    remove: (cfiRange: string, type: string) => void;
  };
  getRange?: (cfi: string) => Range | undefined;
  views?: () => EpubView[];
};
/** annotations.add 返回值（epub.js Annotation）：mark.element 为已挂载的 <g> */
type EpubAnnotation = {
  cfiRange: string;
  sectionIndex: number;
  mark?: { element?: SVGElement | null } | null;
};
/** epubjs Section：窗口化管理只需 index 与相邻关系 */
type EpubSection = {
  index: number;
  href: string;
  linear?: boolean;
  prev: () => EpubSection | null;
  next: () => EpubSection | null;
};
type EpubView = {
  section: EpubSection;
  element: HTMLElement;
  destroy?: () => void;
  /** 已渲染视图的 Contents（选词 CFI 反算 / 章节归属判定用） */
  contents?: EpubContentsLite;
};
/** Contents 最小面：document 供文档比对，cfiFromRange 供选区转 CFI（epub.js 6571） */
type EpubContentsLite = {
  document?: Document | null;
  cfiFromRange?: (range: Range) => string;
};
type EpubManager = {
  viewSettings?: Record<string, unknown>;
  views: {
    all: () => EpubView[];
    first: () => EpubView | undefined;
    last: () => EpubView | undefined;
    indexOf: (v: EpubView) => number;
    remove: (v: EpubView) => void;
  };
  container: HTMLElement;
  append: (section: EpubSection) => Promise<EpubView> | EpubView;
  prepend: (section: EpubSection) => Promise<EpubView> | EpubView;
  scrollTo?: (x: number, y: number, silent?: boolean) => void;
};
/** epubjs Contents：documentElement / body / document 三个引用 */
type EpubContents = {
  documentElement?: HTMLElement | null;
  body?: HTMLElement | null;
  document?: Document | null;
};
type EpubSpine = {
  get: (href: string | number) => unknown;
  each?: () => unknown[];
  [key: string]: unknown;
};
type EpubBook = {
  renderTo: (el: HTMLElement, opts: Record<string, unknown>) => EpubRendition;
  destroy: () => void;
  spine: EpubSpine;
  opened: Promise<unknown>;
  loaded: {
    navigation: Promise<{ toc: EpubNavItem[] }>;
    packaging?: { spine?: EpubSpine };
  };
};

/** 划词工具条状态（v0.3.0；坐标相对 section 定位容器，同 TextViewer 口径） */
type ToolbarState = {
  x: number;
  y: number;
  mode: MarkToolbarMode;
  /** 划选原文（选区捕获，落库/复制用） */
  text: string;
  locator: MarkLocator;
  /** existing 态：重叠的既有条目 id */
  markId: string | null;
};

type Props = {
  dataBase64: string;
  settings: Settings;
  /** 阅读模式：scroll=纵向滚动（continuous+scrolled+窗口化），page=横向翻页（default+paginated） */
  mode: ReaderMode;
  onChapterChange?: (title: string) => void;
  /** 打开时的初始阅读位置（一次性消费；null = 从首章开始） */
  resume?: ReadingPosition | null;
  /**
   * 同步取位置注册位：挂载期间 App 可随时调用取当前阅读位置
   * （仅离场节点 flush 用：退出软件/点击书架/切书；卸载时组件置回 null）。
   */
  getterRef?: MutableRefObject<(() => PositionReport | null) | null>;
  /** 初始渲染（含位置恢复/失败兜底）完成：App 淡出加载遮罩 */
  onReady?: () => void;
  /** v0.3.0 标记上下文（App 组装、BookViewer 透传）；缺失时纯阅读无标记 */
  marksCtx?: MarksContext;
  /** D96：目录就绪后回传树路径，供标记面板按章节组织分组 */
  onTocContext?: (ctx: TocContext | null) => void;
};

/**
 * D96：目录树路径上下文（EpubViewer 产出 → 标记面板消费）。
 * nodes[].order 是目录树索引路径，labels 是对应标签；面板据此判断层级与阅读顺序。
 * 单一事实源：面板侧 `MarksPanel` 的 TocContext 由此扩展（附 currentLabels）。
 */
export type TocNode = {
  href: string;
  label: string;
  depth: number;
  order: number[];
  labels: string[];
};
export type TocContext = { nodes: TocNode[] };

// epubjs 打开/目录加载超时：损坏文件时 epubjs 的 opened 可能永久挂起
// （既不 resolve 也不 reject，见 e2e/check_epubjs.cjs 实测），无超时则白屏无提示
const OPEN_TIMEOUT_MS = 10000;
// display() resolve 后等待 iframe 绘制的时间，再做内容校验
const SETTLE_MS = 700;
// 首章渲染为空白的自动后移次数（商业书常见：首章为图片页/空壳页）
const EMPTY_SECTION_RETRY = 1;
/** D97/D98：高亮悬停多久浮出标记内容（毫秒）；过短会在划选/滚动时误弹 */
const HOVER_DELAY_MS = 220;

/**
 * v0.3.0 标记：annotations.add 的 type（与 remove 成对；epub.js 7943 行
 * hash = encodeURI(cfiRange + type)，type 不一致会漏删）。
 */
const MARK_ANNO_TYPE = "highlight";
/**
 * annotations 的 className：必须是单 token——classList.add 不接受含空格的
 * token（Chrome 抛 InvalidCharacterError，整个 add 会失败）。
 * 宿主样式类（mark-hl / mark-hl-{color}）在挂载后由本组件补加。
 */
const MARK_ANNO_CLASS = "markhl";
/**
 * 高亮四色（SVG 覆盖层填充值，与 TXT .mark-hl-* CSS、基线 HTML --hl-* 同色值）。
 * 覆盖 epubjs 默认的 fill:yellow + multiply：深色阅读主题下 multiply 会糊成一片，
 * 统一 normal + 0.6 不透明度，light/dark/eye/sepia 四主题下均可见。
 */
const MARK_HL_FILLS: Record<MarkColor, Record<string, string>> = {
  yellow: { fill: "#fef08a", "fill-opacity": "0.6", "mix-blend-mode": "normal" },
  green: { fill: "#bbf7d0", "fill-opacity": "0.6", "mix-blend-mode": "normal" },
  blue: { fill: "#bfdbfe", "fill-opacity": "0.6", "mix-blend-mode": "normal" },
  pink: { fill: "#fbcfe8", "fill-opacity": "0.6", "mix-blend-mode": "normal" },
};
/** 拖拽选词的最小位移（px）：横向门槛。小于视为单击 */
const MARK_DRAG_MIN = 6;
/**
 * D100：纵向拖拽门槛（px）。
 * 滚动模式（scrolled-doc）里用户选词必然带纵向偏移，但纵向拖动也最容易与
 * 滚轮/触控板滑动混淆，故门槛略高于横向；两者任一达标即视为选词拖动。
 */
const MARK_DRAG_VERT_MIN = 12;

/**
 * D100：判定「按下 → 松开」是否构成选词拖拽（纯函数，便于测试）。
 *
 * 为什么不用欧氏距离：滚动模式是 scrolled-doc，正文纵向滚动，用户选词几乎
 * 必然带纵向偏移——选到行末要下带半行（约 8px）、选整段要下带上百像素。
 * 早期用 `hypot(dx,dy) > 6`，纯纵向小幅拖动在窄行文本上常常不足 6px，
 * 表现为「滚动模式标记不了」。改为按方向分别判定：
 * - 横向 ≥ MARK_DRAG_MIN（6px）：正常从左往右扫词；
 * - 纵向 ≥ MARK_DRAG_VERT_MIN（12px）：跨行选段；门槛更高是因为纵向手势
 *   更容易与滚动混淆，避免轻微抖动就弹工具条。
 */
export function isMarkDrag(dx: number, dy: number): boolean {
  return Math.abs(dx) >= MARK_DRAG_MIN || Math.abs(dy) >= MARK_DRAG_VERT_MIN;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("EPUB_OPEN_TIMEOUT")), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * D88：把 rendition resize 到容器的实测像素尺寸。
 * 绝不能传 "100%"——epubjs stage.size() 遇到非数字会把容器 style.width 设成 "100%"，
 * 而 .epub-container 的父级 overflow:hidden + 超宽 iframe 会让百分比层层放大，
 * 实测宽度从 1042 指数暴涨到 22369620px（真机日志），当前页被推到可视区外 → 看不见正文。
 * 传像素整数可切断反馈循环。
 */
function resizeRenditionToContainer(rendition: EpubRendition, container: HTMLElement): void {
  const rect = container.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width));
  const h = Math.max(1, Math.floor(rect.height));
  rendition.resize(w, h);
}

/**
 * D81：EPUB 渲染 DOM 状态探针，写入诊断日志。
 * 定位「能打开但正文纯白」——记录 iframe 数量/可见性/正文文本长度、view 数量/displayed 状态。
 * 只读，不影响渲染流程。
 */
function probeEpubDom(
  container: HTMLElement | null,
  rendition: EpubRendition | null,
  tag: string
): void {
  const frames = container ? Array.from(container.querySelectorAll<HTMLIFrameElement>("iframe")) : [];
  const views = rendition?.manager?.views?.all?.() ?? [];
  const displayed = views.filter(
    (v) => (v as unknown as { displayed?: boolean }).displayed === true
  ).length;
  let info = `probe=${tag} frames=${frames.length} views=${views.length} displayed=${displayed}`;
  for (let i = 0; i < Math.min(frames.length, 3); i++) {
    const f = frames[i];
    let len = -1;
    let ready = "?";
    let vis = "?";
    try {
      const d = f.contentDocument;
      if (d) {
        ready = d.readyState;
        len = (d.body?.innerText || d.body?.textContent || "").replace(/\s+/g, "").length;
        vis = f.style.visibility || getComputedStyle(f).visibility;
      }
    } catch {
      ready = "xdomain";
    }
    const r = f.getBoundingClientRect();
    info += ` | f${i}[${Math.round(r.width)}x${Math.round(r.height)} ready=${ready} vis=${vis} len=${len}]`;
  }
  epubDiag(info);
}

/**
 * 等待 stage 滚动高度稳定：100ms 轮询，连续两轮相同即返回（或超时）。
 * 位置恢复时用——iframe 章节异步渲染期间 scrollHeight 会持续变化，
 * 未稳定时按比例设 scrollTop 会偏。
 */
async function waitStageStable(stage: HTMLElement, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = -1;
  while (Date.now() < deadline) {
    const h = stage.scrollHeight;
    if (h > 0 && h === last) return;
    last = h;
    await sleep(100);
  }
}

/** 去掉目录 href 里的 #anchor，只留文档路径 */
function hrefWithoutHash(href: string): string {
  const i = href.indexOf("#");
  return i > -1 ? href.slice(0, i) : href;
}

function hrefFragment(href: string): string {
  const i = href.indexOf("#");
  if (i < 0) return "";
  try {
    return decodeURIComponent(href.slice(i + 1));
  } catch {
    return href.slice(i + 1);
  }
}

function flattenToc(items: EpubNavItem[], output: EpubNavItem[] = [], depth = 0): EpubNavItem[] {
  for (const item of items) {
    output.push({ label: item.label, href: item.href, depth });
    if (item.subitems?.length) flattenToc(item.subitems, output, depth + 1);
  }
  return output;
}

/**
 * 扁平化目录并记录每个项的「树路径」（D96：标记按章节显示用）。
 * order = 各级祖先在其兄弟数组中的下标；labels = 对应标签。
 * 与 flattenToc 分开实现：flattenToc 为既有行为（目录侧栏 + tocTargets）不动，
 * 避免为新增的面板分组需求改动已验证的目录/跳转链路。
 */
export function tocNodesWithPath(
  items: EpubNavItem[],
  prefix: number[] = [],
  labels: string[] = [],
  out: Array<{ href: string; label: string; depth: number; order: number[]; labels: string[] }> = []
): Array<{ href: string; label: string; depth: number; order: number[]; labels: string[] }> {
  items.forEach((item, i) => {
    const order = [...prefix, i];
    const path = [...labels, item.label];
    out.push({ href: item.href, label: item.label, depth: order.length - 1, order, labels: path });
    if (item.subitems?.length) tocNodesWithPath(item.subitems, order, path, out);
  });
  return out;
}

/** 标题文本判定为「子级小节」的启发式（D90/D91） */
function isSubItemLabel(label: string): boolean {
  const s = label.trim();
  if (/^(如何|本章小结|小结|总结|练习|案例)/.test(s)) return true;
  if (/^(part|section|appendix)\s+(?:\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i.test(s)) return true;
  // "The Adventure of ..." 是明确的单篇故事名，即使落在分页边界（无锚点）也应降级
  if (/^the adventure of (the )?/i.test(s)) return true;
  return false;
}

/**
 * D91：EPUB nav 层级推断。样本 toc.ncx 是平铺的（76 项全在同一层，无嵌套），
 * epubjs 拿不到 depth，只能靠客观结构推断：
 *  - EPUB 自带 depth > 0 → 尊重原始层级；
 *  - 命中分部关键词（Part I / 小结 等）→ 子项；
 *  - 带 #锚点的目录项指向物理文件内某一节 → 子项；无锚点的文件首项 → 父项。
 * 个别项可能与原书逻辑不完全一致（如恰好在分页边界的故事），但整体可辨大小标题。
 */
function inferTocDepths(items: EpubNavItem[]): EpubNavItem[] {
  return items.map((it) => {
    if ((it.depth ?? 0) > 0) return it;
    if (isSubItemLabel(it.label) || it.href.includes("#")) return { ...it, depth: 1 };
    return it;
  });
}

function tocDepth(item: EpubNavItem): number {
  return item.depth ?? 0;
}

/**
 * 从书脊中取出 href 对应的 section（仅取元信息，不触发加载）。
 * epubjs 的 spine.get() 已处理 #anchor 剥离与 URI 编码（epub.js 14714-14718 行）。
 */
function loadSpineSection(book: EpubBook, href: string): EpubSection | undefined {
  // 必须使用 book.spine。loaded.packaging.spine 是解析后的原始包结构，
  // 不保证提供与 book.spine 相同的 href -> section 索引映射。
  const spine = book.spine;
  if (!spine) return undefined;
  try {
    const sec = spine.get(hrefWithoutHash(href));
    if (sec && typeof (sec as { index?: number }).index === "number") {
      return sec as EpubSection;
    }
    // spine.get 未命中时按 href 后缀兜底（目录 href 可能与 spine 归一化形式不同）
    const items = spine.each?.() ?? [];
    for (const s of items) {
      const h = (s as { href?: string }).href ?? "";
      const target = hrefWithoutHash(href);
      if (h === target || h.endsWith("/" + target) || h.endsWith(target)) {
        return s as EpubSection;
      }
    }
  } catch {
    // spine 结构异常时返回 undefined，交由上层降级处理
  }
  return undefined;
}

function viewIframe(view: { element: HTMLElement }): HTMLIFrameElement | null {
  if (view.element instanceof HTMLIFrameElement) return view.element;
  return view.element.querySelector("iframe");
}

/** 返回目录目标在宿主 stage 中的绝对顶部位置。 */
function tocTargetTop(view: { element: HTMLElement }, target: TocTarget): number | null {
  const iframe = viewIframe(view);
  if (!iframe) return null;
  const iframeRect = iframe.getBoundingClientRect();
  if (!target.fragment) return iframeRect.top;
  let doc: Document | null = null;
  try {
    doc = iframe.contentDocument;
  } catch {
    return null;
  }
  if (!doc) return null;
  const node = doc.getElementById(target.fragment) ?? doc.getElementsByName(target.fragment)[0];
  if (!node) return null;
  return iframeRect.top + node.getBoundingClientRect().top;
}

/** 等待 iframe 绘制，零高度则强制重新布局，返回内容状态（true 有 / false 空白 / null 无法判定） */
async function settleAndCheck(
  container: HTMLElement,
  rendition: EpubRendition,
  strict: boolean
): Promise<boolean | null> {
  await sleep(SETTLE_MS);
  if (iframeIsZeroSized(container)) {
    try {
      epubDiag("SETTLE_ZERO_RESIZE", "iframe<40px; resize clears views");
      resizeRenditionToContainer(rendition, container);
    } catch (e) {
      epubDiag("SETTLE_ZERO_ERR", (e as { message?: string })?.message ?? String(e));
    }
    await sleep(500);
  }
  return iframeContentState(container, strict);
}

/**
 * 检查 rendition iframe 是否已渲染出可见内容。
 * 返回 true=有内容，false=确认空白，null=尚无法判定（未加载完成/跨域不可访问）。
 * strict=true 时要求文档加载完成才下结论（首轮保守判定，避免误判慢加载章节）。
 *
 * 无文本时仅"成功加载的位图/媒体元素"算作内容：商业书首页常为纯图片页
 * （如 SVG <image> 封面），图片加载失败时 svg/div 框体仍有尺寸，
 * 若据此判定"有内容"会接受白屏（真书实测：封面 SVG 367x514、图可 fetch
 * 但不渲染，白屏被误判为正常）。
 */
function iframeContentState(container: HTMLElement, strict: boolean): boolean | null {
  const iframe = container.querySelector("iframe");
  if (!(iframe instanceof HTMLIFrameElement)) return null;
  let doc: Document | null = null;
  try {
    doc = iframe.contentDocument;
  } catch {
    return null; // 跨域：不阻断渲染流程
  }
  if (!doc || !doc.body) return null;
  if (strict && doc.readyState !== "complete") return null; // 仍在加载，避免误判
  const text = (doc.body.innerText || doc.body.textContent || "").replace(/[\s\u3000]+/g, "");
  if (text.length > 0) return true;
  const els = doc.body.querySelectorAll("img,canvas,video,picture,object,embed");
  for (let i = 0; i < els.length; i++) {
    const el = els[i] as HTMLElement & { naturalWidth?: number; videoWidth?: number };
    const r = el.getBoundingClientRect();
    if (r.width <= 8 || r.height <= 8) continue;
    if (el.naturalWidth === 0) continue; // 位图未加载成功（跨文档，用属性判断而非 instanceof）
    if (el.videoWidth === 0) continue; // 视频无有效帧
    return true;
  }
  return false;
}

/** iframe 是否被布局成零高度（renderTo 时容器尚未完成布局会导致白屏） */
function iframeIsZeroSized(container: HTMLElement): boolean {
  const iframe = container.querySelector("iframe");
  if (!(iframe instanceof HTMLIFrameElement)) return false;
  const r = iframe.getBoundingClientRect();
  return r.height < 40 || r.width < 40;
}

/**
 * 滚动归属修复：把 iframe 变成"纯展示"，滚动与命中全部交给外层 stage。
 *
 * 背景（真书《关键对话》实测）：scrolled-doc 下 epubjs 把 iframe 撑到整章高度
 * （iframe 36479px），由 stage（.epub-container，overflow:auto，scrollHeight 38175）
 * 负责滚动。但 iframe 是 stage 里唯一可命中的子元素，命中测试恒为 IFRAME：
 * 滚轮/PageDown/End 全部落进 iframe 内部文档，而内层文档几乎不溢出
 * （docScrollHeight 38186 vs clientHeight 38175，仅差 11px），
 * 事件被内层吞掉且不冒泡到父文档 → 正文区完全滚不动。
 *
 * 方案：iframe 设 pointer-events:none，滚轮/键盘命中穿透到 stage；
 * 代价是失去框内文本选区与链接点击，改由 stage 上的选择/点击桥接补回
 * （见 bindStageInteraction）。
 */
function makeIframeClickThrough(stage: HTMLElement): () => void {
  const apply = () => {
    stage.querySelectorAll<HTMLIFrameElement>("iframe").forEach((f) => {
      f.style.pointerEvents = "none";
    });
  };
  apply();
  // 每次 display 新建 iframe 后都要重新应用
  const mo = new MutationObserver(apply);
  mo.observe(stage, { childList: true, subtree: true });
  return () => mo.disconnect();
}

/**
 * iframe 穿透后的交互补偿：
 * 1. Ctrl+C / Ctrl+A 走 stage 选中整章文本（选区通过 Range 跨文档映射回 iframe）
 * 2. 正文内链接：监听 iframe 内 <a> 的 click，交给宿主打开（epubjs 已拦截，
 *    这里仅保证 pointer-events:none 后点击能落到 stage 上再转发）
 */
function bindStageInteraction(stage: HTMLElement, onLink: (href: string) => void): () => void {
  const cleanups: (() => void)[] = [];

  const onKeyDown = (ev: KeyboardEvent) => {
    if (!ev.ctrlKey && !ev.metaKey) return;
    const key = ev.key.toLowerCase();
    const iframe = stage.querySelector("iframe");
    if (!(iframe instanceof HTMLIFrameElement)) return;
    let doc: Document | null = null;
    try {
      doc = iframe.contentDocument;
    } catch {
      doc = null;
    }
    if (!doc?.body) return;
    if (key === "a") {
      ev.preventDefault();
      const sel = doc.defaultView?.getSelection();
      if (sel) {
        const range = doc.createRange();
        range.selectNodeContents(doc.body);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    } else if (key === "c") {
      const sel = doc.defaultView?.getSelection();
      const text = sel?.toString() ?? doc.body.innerText ?? "";
      if (text) {
        ev.preventDefault();
        void navigator.clipboard?.writeText(text).catch(() => undefined);
      }
    }
  };
  stage.addEventListener("keydown", onKeyDown);
  cleanups.push(() => stage.removeEventListener("keydown", onKeyDown));

  const onClick = (ev: MouseEvent) => {
    const iframe = stage.querySelector("iframe");
    if (!(iframe instanceof HTMLIFrameElement)) return;
    let doc: Document | null = null;
    try {
      doc = iframe.contentDocument;
    } catch {
      doc = null;
    }
    if (!doc) return;
    const coords = iframeContentPoint(iframe, ev);
    if (!coords) return;
    const el = doc.elementFromPoint(coords.x, coords.y);
    const anchor = el?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (anchor) {
      ev.preventDefault();
      onLink(anchor.getAttribute("href") ?? "");
    }
  };
  stage.addEventListener("click", onClick);
  cleanups.push(() => stage.removeEventListener("click", onClick));

  return () => cleanups.forEach((fn) => fn());
}

/**
 * 滚动模式划词桥接（v0.3.0）：iframe pointer-events:none 下原生拖拽选区不可用
 * （事件根本进不了 iframe），在 stage 上记录 mousedown/mouseup 两端点，
 * 用 iframe 文档自身的 caretRangeFromPoint 重建 Range、回填选区（原生选中视觉），
 * 再统一交 onDragSelect。右键（contextmenu）命中高亮 <g> → onMarkMenu（编辑/删除）。
 *
 * 不监听 iframe 内 selectionchange：那是 page 模式的通道（rendition "selected"），
 * 滚动模式若双通道会有 250ms 防抖造成的双弹工具条。
 */
function bindStageMarks(
  stage: HTMLElement,
  handlers: {
    onDragSelect: (doc: Document, range: Range) => void;
    /** D98：右键高亮 → 上下文菜单（编辑/删除） */
    onMarkMenu: (id: string, clientX: number, clientY: number) => void;
    onPress: () => void;
    /** D97：悬停命中的标记 id（null = 未命中），用于浮出标记内容 */
    onHover: (id: string | null, clientX: number, clientY: number) => void;
  }
): () => void {
  let down: { x: number; y: number } | null = null;
  const cleanups: (() => void)[] = [];

  /**
   * D100 踩坑（必读）：**不能用 `stage.querySelector(".mark-hovertip")` 做豁免**。
   *
   * 提示浮层由 React 渲染在 stage 的**兄弟节点**（.epub-wrap 下的 .mark-hovertip），
   * 不是 stage 的子节点，所以该 find 恒返回 null → overTip 恒 false → 豁免从未生效。
   * 原意是「提示跟随光标时不要自激」，但真正的自激源在别处：
   * 提示 `pointer-events:none` 已保证光标不落在提示上，故此处不做任何豁免。
   * 保留此注释是为了防止后续又把这个死代码加回来。
   */

  const onMove = (ev: MouseEvent) => {
    // 拖拽选词过程中不弹悬停提示（会把工具条位置挤乱）
    if (down) return;
    const g = findMarkElAt(stage, ev.clientX, ev.clientY);
    handlers.onHover(g?.getAttribute("data-id") ?? null, ev.clientX, ev.clientY);
  };

  // 鼠标离开正文区：收起悬停提示，避免提示孤留
  const onLeave = () => handlers.onHover(null, 0, 0);

  const onDown = (ev: MouseEvent) => {
    handlers.onPress(); // 新一次按下：消散上一轮工具条/气泡/菜单
    handlers.onHover(null, ev.clientX, ev.clientY); // D97：按下即收起悬停提示
    down = null;
    if (ev.button !== 0) return;
    const t = ev.target as HTMLElement | null;
    if (t?.closest?.(".mark-toolbar, .mark-bubble, .mark-menu")) return;
    const iframe = iframeAtPoint(stage, ev.clientX, ev.clientY);
    if (!iframe) {
      // D100 诊断：按下点没落在任何 iframe 内（例如落在高亮 SVG 覆盖层/滚动条上）
      epubDiag("DRAG_DOWN_NOIFRAME", `x=${ev.clientX} y=${ev.clientY} tag=${t?.tagName ?? "-"}`);
      return;
    }
    const p = iframeContentPoint(iframe, ev);
    if (!p) return;
    down = { x: p.x, y: p.y };
  };

  // D98：右键高亮 → 编辑/删除菜单；未命中高亮时不拦截（保留原生菜单）
  const onContextMenu = (ev: MouseEvent) => {
    const t = ev.target as HTMLElement | null;
    if (t?.closest?.(".mark-toolbar, .mark-bubble, .mark-menu")) return;
    const g = findMarkElAt(stage, ev.clientX, ev.clientY);
    const id = g?.getAttribute("data-id");
    if (!id) return;
    ev.preventDefault();
    handlers.onHover(null, 0, 0);
    handlers.onMarkMenu(id, ev.clientX, ev.clientY);
  };

  const onUp = (ev: MouseEvent) => {
    const start = down;
    down = null;
    if (ev.button !== 0) return;
    const t = ev.target as HTMLElement | null;
    if (t?.closest?.(".mark-toolbar, .mark-bubble, .mark-menu")) return;
    if (!start) {
      // D100 诊断：mouseup 到达但 mousedown 没记下起点——说明起点那一下没命中 iframe，
      // 或命中点落在宿主元素上（如高亮 SVG 覆盖层）。这是「滚动模式选不中」的头号嫌疑。
      epubDiag("DRAG_UP_NOSTART", `x=${ev.clientX} y=${ev.clientY}`);
      return;
    }
    const iframe = iframeAtPoint(stage, ev.clientX, ev.clientY);
    if (!iframe) return;
    let doc: Document | null = null;
    try {
      doc = iframe.contentDocument;
    } catch {
      doc = null;
    }
    if (!doc?.body) return;
    const end = iframeContentPoint(iframe, ev);
    if (!end) return;
    const dx = Math.abs(end.x - start.x);
    const dy = Math.abs(end.y - start.y);
    const isDrag = isMarkDrag(dx, dy);
    // D100 诊断：滚动模式选不中时先看这条——dx/dy 是否达到判定门槛。
    // 没有这条日志 = mousedown 没命中 iframe（见 DRAG_DOWN_NOIFRAME / DRAG_UP_NOSTART）。
    epubDiag("DRAG_UP", `dx=${Math.round(dx)} dy=${Math.round(dy)} isDrag=${isDrag}`);
    if (isDrag) {
      // 拖拽选词：两端 caret → Range（坐标均为 iframe 文档内坐标）
      const a = caretRangeAt(doc, start.x, start.y);
      const b = caretRangeAt(doc, end.x, end.y);
      const range = a && b ? rangeBetween(doc, a, b) : null;
      if (!range) return;
      // 回填选区：提供原生选中视觉。epubjs 的 selectionchange 监听会因此收到
      // SELECTED 事件，但滚动模式不注册 selected 处理器，无副作用。
      try {
        const sel = doc.defaultView?.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      } catch {
        // 忽略（个别文档拒绝程序化选区时仅损失选中视觉）
      }
      handlers.onDragSelect(doc, range);
      return;
    }
    // D98：单击高亮不再弹气泡——悬停看内容、右键改删（用户明确要求）
  };

  stage.addEventListener("mousedown", onDown);
  stage.addEventListener("mouseup", onUp);
  stage.addEventListener("mousemove", onMove);
  stage.addEventListener("mouseleave", onLeave);
  stage.addEventListener("contextmenu", onContextMenu);
  cleanups.push(() => stage.removeEventListener("mousedown", onDown));
  cleanups.push(() => stage.removeEventListener("mouseup", onUp));
  cleanups.push(() => stage.removeEventListener("mousemove", onMove));
  cleanups.push(() => stage.removeEventListener("mouseleave", onLeave));
  cleanups.push(() => stage.removeEventListener("contextmenu", onContextMenu));
  return () => cleanups.forEach((fn) => fn());
}

/** 把宿主页面上的鼠标坐标换算为 iframe 文档内坐标 */
function iframeContentPoint(
  iframe: HTMLIFrameElement,
  ev: MouseEvent
): { x: number; y: number } | null {
  const r = iframe.getBoundingClientRect();
  return { x: ev.clientX - r.left, y: ev.clientY - r.top };
}

/** 命中某视口坐标的 iframe（滚动模式多章节多 iframe 纵向堆叠，取最上层） */
function iframeAtPoint(root: HTMLElement, x: number, y: number): HTMLIFrameElement | null {
  const iframes = root.querySelectorAll<HTMLIFrameElement>("iframe");
  for (let i = iframes.length - 1; i >= 0; i--) {
    const r = iframes[i].getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return iframes[i];
  }
  return null;
}

/** 找承载该文档的 iframe（选区坐标换算：iframe 视口坐标 + iframe 元素视口坐标 = 宿主视口坐标） */
function iframeOfDoc(root: HTMLElement | null, doc: Document): HTMLIFrameElement | null {
  if (!root) return null;
  const iframes = root.querySelectorAll<HTMLIFrameElement>("iframe");
  for (let i = 0; i < iframes.length; i++) {
    let d: Document | null = null;
    try {
      d = iframes[i].contentDocument;
    } catch {
      d = null;
    }
    if (d === doc) return iframes[i];
  }
  return null;
}

/** iframe 文档内坐标 → caret Range（滚动模式拖拽选词桥接；无文本处返回 null） */
function caretRangeAt(doc: Document, x: number, y: number): Range | null {
  try {
    return doc.caretRangeFromPoint(x, y);
  } catch {
    return null;
  }
}

/** 两个 caret 按文档序组 Range（拖拽方向不限）；跨文档时返回 null（章节边界放弃） */
function rangeBetween(doc: Document, a: Range, b: Range): Range | null {
  if (a.startContainer.ownerDocument !== b.endContainer.ownerDocument) return null;
  try {
    const r = doc.createRange();
    r.setStart(a.startContainer, a.startOffset);
    r.setEnd(b.endContainer, b.endOffset);
    if (!r.collapsed) return r;
    const r2 = doc.createRange();
    r2.setStart(b.startContainer, b.startOffset);
    r2.setEnd(a.endContainer, a.endOffset);
    return r2.collapsed ? null : r2;
  } catch {
    return null;
  }
}

/** 命中测试：root 下所有 annotations 高亮 <g data-id>（SVG 覆盖层，宿主文档；取面积最小者） */
function findMarkElAt(root: HTMLElement | null, x: number, y: number): SVGGElement | null {
  if (!root) return null;
  let best: SVGGElement | null = null;
  let bestArea = Number.POSITIVE_INFINITY;
  root.querySelectorAll<SVGGElement>("svg g[data-id]").forEach((g) => {
    const r = g.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return;
    const area = r.width * r.height;
    if (area < bestArea) {
      best = g;
      bestArea = area;
    }
  });
  return best;
}

/** 按 mark id 找高亮元素（跳转闪烁用） */
function findMarkElById(root: HTMLElement | null, id: string): SVGGElement | null {
  if (!root) return null;
  return root.querySelector<SVGGElement>('svg g[data-id="' + id + '"]');
}

/** 归一化文本（EPUB 既有标记重叠判定：容忍跨元素选词的空白差异） */
function normText(s: string): string {
  return s.replace(/\s+/g, "");
}

/**
 * 构造「跳过非正文 spine 项」的章节邻接。
 *
 * 很多书的 spine 里混有封面页、书内目录页（真书《关键对话》：
 * cover.xhtml → TOC.xhtml → 正文三段），它们不是阅读内容。
 * 若直接用 section.prev()/next() 扩展窗口，这些页会被渲染进正文流，
 * 表现为"滚动过程中正文突然变成书的目录页/版权页"。
 *
 * 判定方式：以「该 section.index 是否出现在目录映射表里」为准——
 * 比 href 字符串比对可靠（epubjs 对 href 有多种归一化形式：相对/绝对/blob 前缀）。
 */
function createSectionNav(contentSectionIndexes: Set<number>, spine: EpubSpine): {
  prev: (section: unknown) => unknown;
  next: (section: unknown) => unknown;
} {
  // 无目录信息时不过滤，退回 epubjs 原生邻接
  const filterOn = contentSectionIndexes.size > 0;
  const isContent = (sec: unknown): boolean => {
    if (!filterOn) return true;
    const idx = (sec as { index?: number })?.index;
    return typeof idx === "number" && contentSectionIndexes.has(idx);
  };

  const contentIndexes = [...contentSectionIndexes].sort((a, b) => a - b);
  const indexedWalk = (start: EpubSection, dir: -1 | 1): EpubSection | null => {
    const pos = contentIndexes.indexOf(start.index);
    if (pos < 0) return null;
    const targetIndex = contentIndexes[pos + dir];
    if (targetIndex === undefined) return null;
    return (spine.get(targetIndex) as EpubSection | null) ?? null;
  };

  /** 从 start 出发沿 dir 方向找最近的正文 section（dir=-1 向前，+1 向后） */
  const walk = (start: EpubSection, dir: -1 | 1): EpubSection | null => {
    let cur = (dir === 1 ? start.next() : start.prev()) as EpubSection | null;
    let guard = 0;
    // guard 上限防止非线性 spine 成环导致死循环
    while (cur && guard++ < 64) {
      if (isContent(cur)) return cur;
      cur = (dir === 1 ? cur.next() : cur.prev()) as EpubSection | null;
    }
    return null;
  };

  return {
    prev: (section) =>
      filterOn ? indexedWalk(section as EpubSection, -1) : walk(section as EpubSection, -1),
    next: (section) =>
      filterOn ? indexedWalk(section as EpubSection, 1) : walk(section as EpubSection, 1),
  };
}

export default function EpubViewer({ dataBase64, settings, mode, onChapterChange, resume, getterRef, onReady, marksCtx, onTocContext }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLElement | null>(null); // 翻页 section：mousemove 监听挂这里（祖先，覆盖内容区与按钮组）
  const bookRef = useRef<EpubBook | null>(null);
  const renditionRef = useRef<EpubRendition | null>(null);
  const windowRef = useRef<WindowManager | null>(null);
  // 翻页模式导航：effect 内注册 prev/next，JSX 按钮调用
  const pagerRef = useRef<{ prev: () => void; next: () => void } | null>(null);
  // 翻页导航显隐（v0.2.6）：共享 hook，悬停一级状态，避免移向按钮途中消失
  const pager = usePagerVisibility();
  const showPager = pager.show;
  // 翻页模式当前章节 href（relocated 实时更新），用于章节级采集/高亮匹配
  const currentHrefRef = useRef<string>("");
  // 当前阅读点 CFI（两模式 relocated 实时更新）；优先于 href+ratio 用于精确还原
  const currentCfiRef = useRef<string>("");
  const [toc, setToc] = useState<EpubNavItem[]>([]);
  // D96：目录树路径（面板按章节组织标记用）；null 表示无目录，面板退化为平铺分组
  const [tocContext, setTocContext] = useState<TocContext | null>(null);
  const [active, setActive] = useState(0);
  const [failed, setFailed] = useState(false);
  // 失败原因码（D79）：失败页展示当前触发点，配合完整诊断文本可定位
  const [failReason, setFailReason] = useState("");
  const [diagOpen, setDiagOpen] = useState(false);

  // onChapterChange 经 ref 调用：父组件每次渲染都会传入新函数引用，
  // 若直接进 effect 依赖会导致 effect 反复重跑（书籍被销毁重建、目录状态重置）。
  const onChapterChangeRef = useRef(onChapterChange);
  onChapterChangeRef.current = onChapterChange;
  // 初始渲染完成回调经 ref：同上，避免引用变化触发 effect 重跑
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  // D96：目录路径回传经 ref，理由同上（父组件每次渲染都给新引用）
  const onTocContextRef = useRef(onTocContext);
  onTocContextRef.current = onTocContext;
  // 初始位置一次性消费：恢复完成后置 null，防止重复恢复
  const resumeRef = useRef(resume);
  // 组件内诊断信息经 ref 输出到控制台，避免污染状态栏/触发重渲染
  const logRef = useRef<((msg: string) => void) | null>(null);
  logRef.current = (msg: string) => {
    if (typeof console !== "undefined") console.info("[epub]", msg);
  };
  // 预加载章节数经 ref 读取：设置变更时无需重建书籍，窗口管理器下次同步即生效
  const preloadRef = useRef(settings.epubPreloadCount);
  preloadRef.current = settings.epubPreloadCount;
  // 设置全量镜像：主题/字号变更时重注已加载章节的阅读样式
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  // 用户主动点击侧栏标记：用于抑制随之而来的滚动反向高亮，避免抖动
  const suppressScrollSyncRef = useRef(false);
  // active 的镜像：闭包里读到的 state 可能是旧值，高亮判定需要即时值
  const activeRef = useRef(0);
  // 每个目录项都保留自己的 section + fragment；同一个 XHTML 可能包含多个目录项。
  const tocTargetsRef = useRef<TocTarget[]>([]);

  // ===== v0.3.0 标记：上下文 / annotations 同步 / 工具条 / 气泡 / 跳转 =====
  const marksCtxRef = useRef(marksCtx);
  marksCtxRef.current = marksCtx;
  // mark id → 已挂载 annotation（cfi + color）：换色需 remove+add（hash 只含 cfi+type）
  const annoKeysRef = useRef<Map<string, { cfi: string; color: MarkColor }>>(new Map());
  // 目录镜像：闭包里读即时值（选区所在章名回填用）
  const tocRef = useRef<EpubNavItem[]>([]);
  tocRef.current = toc;
  // D84：jump 后短时间内禁止 resize——跳章 display 会把 iframe 撑到整章展开宽度，
  // 若此时 resize 会 clear 掉刚加载的正文并自愈回首章（表现为「跳章跳回第一章且空白」）。
  const jumpResizeGuardRef = useRef(0);
  const [toolbar, setToolbar] = useState<ToolbarState | null>(null);
  // D97：悬停提示——高亮上停留即浮出标记内容（只读），移开即消失
  const [hoverTip, setHoverTip] = useState<{ mark: Mark; x: number; y: number } | null>(null);
  const hoverTimerRef = useRef<number | null>(null);
  const hoverIdRef = useRef<string | null>(null);
  // D98：右键菜单（编辑/删除）——取代原「左键点击高亮弹气泡」
  const [ctxMenu, setCtxMenu] = useState<{ mark: Mark; x: number; y: number } | null>(null);

  // D98：右键菜单关闭时机——点别处 / Esc / 滚动（菜单用 fixed 坐标，滚动后会脱位）
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    const onDown = (ev: MouseEvent) => {
      const t = ev.target as HTMLElement | null;
      if (t?.closest?.(".mark-menu")) return;
      close();
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    // 捕获阶段监听：epub-content/iframe 内部滚动也能收到
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [ctxMenu]);
  const jumpNonceRef = useRef(-1);

  /** 清掉 iframe 内的程序化选区（宿主文档无选区可清；标记落库后调用） */
  const clearSelection = () => {
    window.getSelection()?.removeAllRanges();
    const root = containerRef.current;
    if (!root) return;
    root.querySelectorAll<HTMLIFrameElement>("iframe").forEach((f) => {
      try {
        f.contentDocument?.defaultView?.getSelection()?.removeAllRanges();
      } catch {
        // 跨域不可访问：忽略
      }
    });
  };

  /** 选区所在章节信息：href 取 toc 目标 href（面板分组脚注用），chapter 取目录 label */
  const chapterInfoForDoc = (doc: Document): { href: string; chapter: string } => {
    const view = renditionRef.current?.views?.().find((v) => {
      try {
        return v.contents?.document === doc;
      } catch {
        return false;
      }
    });
    const href = view?.section?.href ?? currentHrefRef.current;
    const target = tocTargetsRef.current.find(
      (t) => hrefWithoutHash(t.href) === hrefWithoutHash(href)
    );
    if (target) return { href: target.href, chapter: tocRef.current[target.index]?.label ?? "" };
    return { href, chapter: tocRef.current[activeRef.current]?.label ?? "" };
  };

  /**
   * 划词落工具条（§4.1/4.2/4.4）：两模式共用。
   * - page 模式：iframe 可交互，epubjs selectionchange（250ms 防抖）→ rendition
   *   "selected" 带 cfi 与 contents，range 由 getRange 反查；
   * - scroll 模式：iframe pointer-events:none，由 bindStageMarks 自建 Range 后调入，
   *   cfi 由 contents.cfiFromRange 现算。
   * 坐标换算：选区矩形在 iframe 视口系，加 iframe 元素视口矩形才是宿主视口坐标。
   */
  const handleSelection = (doc: Document, range: Range, cfi: string | null) => {
    const ctx = marksCtxRef.current;
    const text = range.toString();
    if (text.trim().length < MARK_SELECT_MIN || !ctx?.enabled) {
      // 低于阈值 / 总开关关闭：不弹工具条（既有高亮照常显示，§3.3）
      setToolbar(null);
      return;
    }
    if (!cfi) {
      setToolbar(null);
      return;
    }
    const info = chapterInfoForDoc(doc);
    const locator: MarkLocator = { kind: "epub", cfi, href: info.href, chapter: info.chapter };
    // existing：与既有 epub 标记文本重叠（多条取首个）。EPUB 侧无稳定的 CFI 区间
    // 相交原语，文本包含关系覆盖「重选同一段/更大段」的常见场景。
    const sel = normText(text);
    const hit = ctx.marks.find(
      (m) =>
        m.locator.kind === "epub" &&
        m.text.length > 0 &&
        (normText(m.text).includes(sel) || sel.includes(normText(m.text)))
    );
    const rect = range.getBoundingClientRect();
    const host = sectionRef.current;
    const hostRect = host?.getBoundingClientRect();
    const iframe = iframeOfDoc(containerRef.current, doc);
    const iframeRect = iframe?.getBoundingClientRect();
    // D98：气泡已移除（悬停看内容、右键改删）
    if (!hostRect || !iframeRect) {
      setToolbar(null);
      return;
    }
    const cx = iframeRect.left + rect.left - hostRect.left + rect.width / 2;
    epubDiag("TOOLBAR_SHOW", `${hit ? "existing" : "new"} cfi=${cfi.slice(0, 48)} len=${text.length}`);
    const top = iframeRect.top + rect.top - hostRect.top;
    const bottom = iframeRect.top + rect.bottom - hostRect.top;
    setToolbar({
      // 以选区中心水平居中（CSS translateX(-50%)），夹紧在容器内（同 TXT 口径）
      x: Math.min(Math.max(cx, 170), Math.max(170, hostRect.width - 170)),
      // 上方空间不足翻到下方（§4.2）
      y: top > 48 ? top - 42 : bottom + 6,
      mode: hit ? "existing" : "new",
      text,
      locator,
      markId: hit?.id ?? null,
    });
  };

  // ===== D97：悬停显示标记内容 =====
  /** 取消待触发的悬停计时与已显示的提示 */
  const cancelHover = () => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    hoverIdRef.current = null;
    setHoverTip(null);
  };

  /** D98：右键高亮 → 上下文菜单（用视口坐标，fixed 定位，靠近右/下边界时夹紧） */
  const openMarkMenu = (id: string, clientX: number, clientY: number) => {
    const m = marksCtxRef.current?.marks.find((x) => x.id === id);
    if (!m) return;
    const x = Math.min(Math.max(4, clientX), Math.max(4, window.innerWidth - 168));
    const y = Math.min(Math.max(4, clientY), Math.max(4, window.innerHeight - 96));
    epubDiag("MARK_MENU", `id=${id}`);
    setCtxMenu({ mark: m, x, y });
  };

  /**
   * 悬停提示（D97/D98）：命中高亮即浮出「标记内容」，鼠标离开立即消失。
   *
   * 内容 = 划选原文 + 感悟。只对划词标记（text 非空）显示；独立想法无原文可挂，
   * 不参与悬停。提示浮层 `pointer-events: none`——用户要求「悬停显示内容、
   * 鼠标离开消失」，提示不可交互，故不需要「鼠标移入提示保持」那套豁免逻辑。
   * 编辑/删除走右键菜单（§4.5 修订）。
   */
  const scheduleHover = (id: string | null, clientX: number, clientY: number) => {
    if (!id) {
      if (hoverIdRef.current !== null || hoverTip) cancelHover();
      return;
    }
    if (hoverIdRef.current === id) {
      // 同一高亮内移动：提示跟随光标（否则高亮很长时提示会停在首次出现的位置）
      setHoverTip((prev) => (prev ? { ...prev, x: clientX, y: clientY } : prev));
      return;
    }
    // 不提前写 hoverIdRef：只有真的弹出提示才记 id，
    // 否则「独立想法/无原文」的高亮会把 id 占住，之后再悬停同一处不再尝试。
    cancelHover();
    const m0 = marksCtxRef.current?.marks.find((x) => x.id === id);
    if (!m0 || !m0.text) return;
    // 提示是只读浮层，直接跟随光标右上偏移；HOVER_DELAY 仅用于抑制划选后的误弹
    hoverTimerRef.current = window.setTimeout(() => {
      hoverTimerRef.current = null;
      const m = marksCtxRef.current?.marks.find((x) => x.id === id);
      if (!m || !m.text) return;
      hoverIdRef.current = id;
      epubDiag("HOVER_TIP", `id=${id}`);
      setHoverTip({ mark: m, x: clientX, y: clientY });
    }, HOVER_DELAY_MS);
  };

  /**
   * 用正确的 rect 过滤重画一条高亮（D103 引入，D104 修正坐标系）。
   *
   * 为什么不能直接用 marks-pane 的结果：它的 `filteredRanges()` 会丢弃「被其它矩形
   * 包含」的框。`Range.getClientRects()` 在跨块元素（段落/body）选区时会额外返回
   * 一个容器级包围盒，于是逐行框全被它吞掉 → 只画出一个大矩形 = 整块实心色块。
   *
   * D104 关键修正：**只替换矩形过滤，不接管坐标计算**。marks-pane 原 render 用
   * `r.left - offset.left + container.left`，其中 `+ container.left` 正好抵消 Pane
   * 容器在宿主页面的偏移。D103 曾自行拿 `svg.getBoundingClientRect()` 当原点写
   * `<rect>`，那是**宿主页面坐标**，与 iframe 内容视口坐标不同系：容器一旦不在
   * 页面原点（侧栏/留白），高亮就整体左上偏移。改为临时替换 `filteredRanges()`
   * 后调用原 render，让成熟坐标系继续生效，本函数只喂正确的矩形列表。
   */
  const repaintHighlight = (mark: unknown): void => {
    const m = mark as
      | {
          range?: Range;
          element?: SVGGElement | null;
          attributes?: Record<string, string>;
          filteredRanges?: () => RectLike[];
          render?: () => void;
        }
      | null
      | undefined;
    const g = m?.element;
    const range = m?.range;
    const originalRender = m?.render;
    const originalFiltered = m?.filteredRanges;
    if (
      !g ||
      !range ||
      typeof originalRender !== "function" ||
      typeof originalFiltered !== "function"
    ) {
      return;
    }
    // 读取逐行矩形，只做过滤：去掉完全重复项与零面积项，**保留被包含的逐行框**。
    // 坐标换算交给原 render，这里不碰。详见 utils/epubHighlight.ts 顶部说明。
    const rects = filterRects(Array.from(range.getClientRects()) as RectLike[]);
    if (rects.length === 0) return;

    const patched = m as { filteredRanges: () => RectLike[] };
    const hadOwnFiltered = Object.prototype.hasOwnProperty.call(m, "filteredRanges");
    patched.filteredRanges = () => rects;
    try {
      // 原 render 会清空 <g>、按自己的坐标系写 <rect>；fill/fill-opacity 由
      // mark.bind 已写在 <g> 上，正常由子元素继承。
      originalRender.call(m);
    } finally {
      // 恢复原方法，避免影响后续 relocate / 其它视图的渲染。
      if (hadOwnFiltered) patched.filteredRanges = originalFiltered;
      else delete (m as { filteredRanges?: () => RectLike[] }).filteredRanges;
    }

    // 圆角 + 颜色写到每个 <rect>（D103 防御性措施保留）：即使书籍 CSS 对 <g>
    // 设了 fill，每一行颜色也始终一致。
    const attrs = m.attributes ?? {};
    g.querySelectorAll("rect").forEach((el) => {
      el.setAttribute("rx", "2");
      if (attrs.fill) el.setAttribute("fill", attrs.fill);
      if (attrs["fill-opacity"]) el.setAttribute("fill-opacity", attrs["fill-opacity"]);
    });

    const gb = g.getBoundingClientRect();
    epubDiag(
      "HL_REPAINT",
      `id=${g.getAttribute("data-id") ?? "-"} rects=${rects.length} g=${Math.round(gb.width)}x${Math.round(gb.height)}`
    );
  };

  /**
   * annotations 同步（D67）：marks ↔ rendition.annotations 增量 diff。
   * - 新增/换色：remove(cfi) + add（hash=cfi+type，换色必须重加）；
   * - 删除：remove；
   * - 章节未渲染时不急：epubjs hooks.render.inject 会在视图渲染时补挂，
   *   本函数在「书籍打开完成」与「marks 变更」两个时机各跑一次兜底。
   * 想法/空原文条目不挂高亮（ collapsed CFI 无可见区域，面板条目照常可跳转）。
   */
  const syncAnnotations = () => {
    const annos = renditionRef.current?.annotations;
    const ctx = marksCtxRef.current;
    if (!annos || !ctx) return;
    const map = annoKeysRef.current;
    const seen = new Set<string>();
    for (const m of ctx.marks) {
      if (m.locator.kind !== "epub" || m.text.length === 0) continue;
      seen.add(m.id);
      const cur = map.get(m.id);
      if (cur && cur.cfi === m.locator.cfi && cur.color === m.color) continue;
      if (cur) {
        try {
          annos.remove(cur.cfi, MARK_ANNO_TYPE);
        } catch {
          // 移除失败不阻断重加
        }
      }
      try {
        const anno = annos.add(
          MARK_ANNO_TYPE,
          m.locator.cfi,
          { id: m.id },
          undefined,
          MARK_ANNO_CLASS,
          MARK_HL_FILLS[m.color]
        );
        // add 只对「已渲染视图」挂载；此处补齐宿主样式类。
        // D102：**只加功能类 mark-hl，不加 mark-hl-{color}** ——
        // SVG <g> 一旦带上带 background 的颜色类，浏览器会按包围盒涂一整块实心
        // 矩形把正文盖住（滚动模式多行高亮时尤其明显）。EPUB 颜色由 fill 属性给出。
        const g = anno?.mark?.element as SVGGElement | null | undefined;
        if (g) {
          g.classList.add("mark-hl");
          // D103：用正确的 rect 过滤重画。marks-pane 的 filteredRanges 会因
          // 「被另一个矩形包含」而丢掉逐行框（跨块选区必现），只剩一个容器级
          // 大矩形 → 整块实心色块盖住正文。详见 utils/epubHighlight.ts 顶部说明。
          repaintHighlight(anno?.mark);
        }
        map.set(m.id, { cfi: m.locator.cfi, color: m.color });
      } catch {
        // CFI 无法解析（章节内容变化/书籍损坏）：跳过，下次同步重试
      }
    }
    for (const [id, cur] of [...map]) {
      if (seen.has(id)) continue;
      try {
        annos.remove(cur.cfi, MARK_ANNO_TYPE);
      } catch {
        // 忽略
      }
      map.delete(id);
    }
  };

  // 工具条动作（§4.3/4.4/4.6）：色点落库/改色 → marks 变更 → syncAnnotations 挂高亮
  const onToolbarColor = (color: MarkColor) => {
    const ctx = marksCtxRef.current;
    epubDiag("TOOLBAR_ACTION", `color=${color} hasCtx=${!!ctx} hasToolbar=${!!toolbar} mode=${toolbar?.mode ?? "-"}`);
    if (!ctx || !toolbar) return;
    if (toolbar.mode === "existing" && toolbar.markId) {
      ctx.onUpdate(toolbar.markId, { color }); // 改色
    } else {
      ctx.onAdd({ color, text: toolbar.text, locator: toolbar.locator });
    }
    clearSelection();
    setToolbar(null);
  };

  const onToolbarNote = () => {
    const ctx = marksCtxRef.current;
    epubDiag("TOOLBAR_ACTION", `note hasCtx=${!!ctx} hasToolbar=${!!toolbar} mode=${toolbar?.mode ?? "-"}`);
    if (!ctx || !toolbar) return;
    if (toolbar.mode === "existing" && toolbar.markId) {
      const m = ctx.marks.find((x) => x.id === toolbar.markId);
      if (m) ctx.onEdit(m);
    } else {
      ctx.onNoteNew({ quote: toolbar.text, locator: toolbar.locator });
    }
    clearSelection();
    setToolbar(null);
  };

  const onToolbarCopy = () => {
    if (toolbar) marksCtxRef.current?.onCopy(toolbar.text);
    clearSelection();
    setToolbar(null);
  };

  const onToolbarDelete = () => {
    const ctx = marksCtxRef.current;
    if (!ctx || !toolbar?.markId) return;
    ctx.onDelete(toolbar.markId);
    clearSelection();
    setToolbar(null);
  };

  // marks 变更 → annotations 增量同步（打开前的早场由主 effect 打开完成回调兜底）
  useEffect(() => {
    syncAnnotations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marksCtx?.marks]);

  // 跳转目标（§4.16/F35）：面板点条目 → display(cfi) 定位 + 高亮闪烁 1.6s。
  // nonce 防同一条目重复触发；display 后章节流重建，annotation 经 hooks.render
  // 补挂需等渲染，故闪烁做两级延迟重试。
  useEffect(() => {
    const ctx = marksCtxRef.current;
    const jt = ctx?.jumpTarget ?? null;
    if (!jt || jt.nonce === jumpNonceRef.current) return;
    jumpNonceRef.current = jt.nonce;
    const loc = jt.mark.locator;
    const rendition = renditionRef.current;
    if (loc.kind !== "epub" || !rendition) {
      ctx?.onJumpDone();
      return;
    }
    const flash = () => {
      const g = findMarkElById(containerRef.current, jt.mark.id);
      if (!g) return false;
      g.classList.add("mark-hl", "mark-flash");
      window.setTimeout(() => g.classList.remove("mark-flash"), 1600);
      return true;
    };
    void (async () => {
      try {
        await withTimeout(Promise.resolve(rendition.display(loc.cfi)), OPEN_TIMEOUT_MS);
        windowRef.current?.sync();
      } catch {
        // 定位失败：仍尝试闪烁（章节可能已渲染）
      }
      if (!flash()) window.setTimeout(() => { if (!flash()) window.setTimeout(flash, 500); }, 300);
      ctx?.onJumpDone();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marksCtx?.jumpTarget]);

  useEffect(() => {
    let destroyed = false;
    const container = containerRef.current;
    if (!container) return;
    // 横向翻页 / 纵向滚动：本组件在挂载期只走对应分支（state-host key 含
    // readerMode，改模式即整组件重挂载，故 mode 视为常量，无需内部响应式重配置）。
    const isPage = mode === "page";

    const fail = (reason: string) => {
      if (destroyed) return;
      epubDiag("FAIL", reason);
      setFailReason(reason);
      setFailed(true);
      // 打开失败（含超时）时主动销毁，避免挂起的 book 实例残留
      try {
        bookRef.current?.destroy();
      } catch {
        // 忽略销毁异常
      }
      bookRef.current = null;
      renditionRef.current = null;
    };

    // stage（.epub-container）由 epubjs 在 renderTo/display 时创建，
    // 滚动补偿要在 display 之后再绑定，卸载时回滚。
    let unwireScroll: (() => void) | null = null;
    // 窗口管理器引用（D80）：必须在首次 display 之前就存在，好让提前接管的
    // check() 闭包能访问到稍后创建的 wm。display 后再绑定 wmRef = wm。
    let wmRef: WindowManager | null = null;

    (async () => {
      clearEpubDiag();
      epubDiag("OPEN_BEGIN", `mode=${mode} b64len=${dataBase64.length}`);
      // displayError 仅在「初始首章显示」阶段触发失败：用户主动点击无效目录项时
      // 由 jump() 自行吞掉拒绝，不整本书判定失败。
      // failOnDisplayError 进一步把「阅读位置恢复」的 display 排除在失败判定外：
      // applyResume 内部已有 CFI→href 降级 / 失败停在首章的处理（见下），
      // 其 display 若触发 displayError 只应降级，不能升级为整本解析失败（D76）。
      let initialPhase = true;
      let failOnDisplayError = true;

      try {
        const bytes = base64ToUint8Array(dataBase64);
        epubDiag("BYTES", `len=${bytes.length}`);
        const book = ePub(bytes.buffer as ArrayBuffer) as unknown as EpubBook;
        bookRef.current = book;
        // manager: "continuous" —— 多章拼接渲染（epubjs ContinuousViewManager）。
        // 用 continuous 而非 default 的原因：default manager 每次 display 只保留
        // 一个 section，无法在同一条滚动流里呈现相邻章节，也就无法做窗口化。
        // flow 用 "scrolled"（continuous 下 scrolled-doc 会被归一到 scrolled）。
        const rendition = book.renderTo(container, {
          width: "100%",
          height: "100%",
          // 纵向滚动走 continuous+scrolled（依赖自定义章节窗口化）；
          // 横向翻页走 default+paginated（epubjs 自带分栏分页，与窗口化冲突，见方案 4.3）
          flow: isPage ? "paginated" : "scrolled",
          manager: isPage ? "default" : "continuous",
        });
        renditionRef.current = rendition;
        // 新书（或同书重开）：annotation 映射随旧 rendition 一起作废，重置以免漏删
        annoKeysRef.current.clear();

        // 滚动归属：scrolled-doc 下 epubjs 把 iframe 撑到整章高度、由外层 stage 滚动。
        // 但 iframe 内文档本身仍可滚动（比 iframe 高几十 px），滚轮落在 iframe 上时
        // 事件被内层文档消费且不冒泡到父文档，正文区滚轮/PageDown/End 全部无效
        // （真书《关键对话》实测：iframe 36479px、内文档 36500px）。
        // 官方注入点 hooks.content 在每个 section 渲染完成后触发，
        // 在此禁用内层滚动，把滚动权干净地交给 stage。
        rendition.hooks?.content?.register((contents) => {
          // 阅读主题/字号注入：iframe 是独立文档，宿主 CSS 变量不会渗入，
          // 必须把阅读层令牌物化成具体值写入章节文档（readingTheme.ts）。
          // 每次新章节文档加载都会触发本钩子，天然覆盖动态补齐的章节。
          const inner = contents?.document;
          if (inner) applyReadingStyle(inner, settingsRef.current);
          // 纵向滚动才需要禁用内层滚动（把滚动权交给外层 stage）；
          // 翻页模式下 epubjs 自行管理分页，禁止内层滚动会破坏其布局。
          if (!isPage) {
            const doc = contents?.documentElement;
            if (doc) doc.style.overflow = "hidden";
          }
          // 快捷键转发（v0.2.5 F22）：iframe 是独立文档，其内部 keydown 不冒泡到
          // 宿主 window。翻页模式下 iframe 可交互（点击正文后焦点落在其内），
          // 在此直接向章节文档挂监听，把按键 postMessage 给宿主派发层。
          // 同一章内 relocated 会再次触发本钩子，WeakSet 防重复绑定翻两页。
          // 注意：监听器函数创建于宿主域，回调内 window 即宿主 window，
          // window.postMessage 的消息事件落在宿主（App.tsx 的 message 监听）。
          if (isPage && inner && !hotkeyBoundDocs.has(inner)) {
            hotkeyBoundDocs.add(inner);
            inner.addEventListener("keydown", (ev: KeyboardEvent) => {
              if (ev.ctrlKey || ev.metaKey || ev.altKey) return; // 组合键归选区/复制
              ev.preventDefault();
              window.postMessage({ __readerHotkey: true, key: ev.key }, "*");
            });
            // 鼠标移动转发（v0.2.5 F21 修正）：iframe 覆盖整个内容区，宿主
            // container 的 mousemove 收不到其内事件，自动隐藏后无法复现。
            // 节流 120ms 后经 postMessage 通知宿主 showPager（D50）。
            let lastMoveFwd = 0;
            inner.addEventListener("mousemove", () => {
              const now = performance.now();
              if (now - lastMoveFwd < 120) return;
              lastMoveFwd = now;
              window.postMessage({ __readerPager: true }, "*");
            });
          }
          // 划词工具条/气泡的点击消散（v0.3.0）：iframe 吞掉 mousedown，宿主
          // stage 收不到（page 模式 iframe 可交互；scroll 模式本就走 stage 桥接，
          // 此处监听不会触发，无害）。回调闭包创建于宿主域，可直接 setState。
          // 工具条/气泡自身在宿主文档，其 mousedown 不经过 iframe，不受影响。
          if (inner && !markDismissBoundDocs.has(inner)) {
            markDismissBoundDocs.add(inner);
            inner.addEventListener("mousedown", () => {
              epubDiag("MARK_DISMISS", "iframe mousedown");
              setToolbar(null);
              // D98：气泡已移除（悬停看内容、右键改删）
            });
          }
          // D100 修复：**翻页模式悬停看不到**。
          // 根因：悬停判定只挂在滚动模式的 stage 上（bindStageMarks）。翻页模式 iframe
          // 是**可交互**的（未设 pointer-events:none），鼠标事件全部进入 iframe 文档，
          // 不会冒泡到宿主 stage —— 所以翻页模式从来没有悬停判定，日志里也只有滚动
          // 模式那次会话的 HOVER_TIP。
          // 解决：在章节文档上直接挂 mousemove，命中高亮 <g> 后换算成宿主视口坐标，
          // 复用同一个 scheduleHover（提示浮层在宿主文档，坐标必须换算）。
          // 同一文档 relocated 会再次触发本钩子，用 WeakSet 去重防重复绑定。
          if (isPage && inner && !hoverBoundDocs.has(inner)) {
            hoverBoundDocs.add(inner);
            // 诊断节流：翻页模式 mousemove 频率高，只在「命中结果变化」时打点，
            // 否则每条 hover 都在日志里刷屏、反而看不出问题。
            let lastSig = "";
            inner.addEventListener("mousemove", (ev: MouseEvent) => {
              const iframe = iframeOfDoc(containerRef.current, inner);
              const ir = iframe?.getBoundingClientRect();
              if (!ir) {
                if (lastSig !== "noiframe") {
                  lastSig = "noiframe";
                  epubDiag("HOVER_PAGE_NOIFRAME", "iframe 未找到（文档可能已回收）");
                }
                return;
              }
              const x = ev.clientX + ir.left;
              const y = ev.clientY + ir.top;
              const g = findMarkElAt(container, x, y);
              const id = g?.getAttribute("data-id") ?? null;
              const sig = id ?? "none";
              if (sig !== lastSig) {
                lastSig = sig;
                epubDiag(
                  "HOVER_PAGE_HIT",
                  `id=${id ?? "-"} x=${Math.round(x)} y=${Math.round(y)} svgCount=${container.querySelectorAll("svg g[data-id]").length}`
                );
              }
              scheduleHover(id, x, y);
            });
            // 鼠标移出 iframe：收起提示（否则提示会孤留在正文上）。
            // 用 mouseout + relatedTarget 判空：iframe 文档的 mouseleave 在光标直接
            // 移出 iframe 边界时不一定触发（Chrome 下跨文档边界只发 mouseout）。
            inner.addEventListener("mouseout", (ev: MouseEvent) => {
              const to = ev.relatedTarget as Node | null;
              if (!to) {
                scheduleHover(null, 0, 0);
                return;
              }
              // 移出文档根节点也算离开
              const root = inner.documentElement;
              if (root && !root.contains(to)) scheduleHover(null, 0, 0);
            });
          }
        });

        // annotations 的 hooks.render.inject 先于本钩子注册（Rendition 构造时）：
        // 章节视图渲染/补挂后，为高亮 <g> 补宿主样式类（flash 动画用；颜色已由
        // styles 物化在 SVG 属性上，不依赖 CSS）。
        rendition.hooks?.render?.register((view) => {
          const ctx = marksCtxRef.current;
          // D103：补挂路径也要按正确算法重画 rect。hooks.render 触发时视图刚
          // 完成排版，marks-pane 的原 render 可能仍按「包含去重」画出了大色块，
          // 这里用视图上的 highlights 映射取回 Mark 实例再重画一次。
          const viewAnys = view as unknown as {
            highlights?: Record<string, { mark?: unknown }>;
            contents?: { window?: Window };
          };
          const highlightMap = viewAnys.highlights ?? {};
          view.element?.querySelectorAll<SVGGElement>("svg g[data-id]").forEach((g) => {
            const id = g.getAttribute("data-id");
            const m = ctx?.marks.find((x) => x.id === id);
            // D102：同 1158 行——只补功能类，不补带 background 的颜色类。
            // 同时清掉可能残留的旧颜色类（升级前写入的 DOM 会带着它）。
            if (!m) return;
            g.classList.remove("mark-hl-yellow", "mark-hl-green", "mark-hl-blue", "mark-hl-pink");
            g.classList.add("mark-hl");
            // 按 data-id 找回对应的 Highlight 实例（epubjs 以 cfiRange 为键，
            // 而遍历 DOM 只能拿到 id，故按 element 反查）
            for (const key of Object.keys(highlightMap)) {
              const entry = highlightMap[key];
              const el = (entry?.mark as { element?: SVGGElement } | undefined)?.element;
              if (el === g) {
                repaintHighlight(entry.mark);
                break;
              }
            }
          });
        });

        // displayError：section 加载失败时 epubjs 只抛事件、display() 永久挂起，
        // 监听后立即失败，不必等超时（实测：部分真实书触发此路径）。
        rendition.on?.("displayError", (err: unknown) => {
          epubDiag("displayError", (err as { message?: string })?.message ?? String(err));
          if (initialPhase && failOnDisplayError) fail("displayError:首章/目录加载");
        });

        // 必须等 book.opened，不能只等 loaded.navigation：
        // epubjs 的 book.opened 在 resources.replacements()（为全部 manifest 资源
        // 创建 blob URL）完成后才 resolve（epub.js Book.open 18095-18099 行）；
        // 而 loaded.navigation 在解析完目录时即 resolve（18079 行），远早于资源替换。
        // 若此窗口内调用 display()，section 序列化时 replacementUrls 仍为空数组，
        // substitute() 不会替换任何 URL——正文里的相对路径（图片 xlink:href /
        // ../../stylesheet.css）原样留在 blob iframe 文档中，全部加载失败 → 纯白屏。
        // 真书实测（关键对话 1.8MB/18 资源）：navigation 79ms 即 resolve，
        // replacementUrls.length=0；小样本因资源少、建 URL 快，竞态常赢故未暴露。
        await withTimeout(book.opened, OPEN_TIMEOUT_MS);
        epubDiag("BOOK_OPENED", `spine=${book.spine?.length ?? "?"}`);
        if (destroyed) return;

        // 强制 blobUrl 模式：epubjs 默认 srcdoc（about:srcdoc 文档），
        // Chromium 限制 about:srcdoc 文档不加载 blob: 子资源——书籍的相对
        // URL（图片 xlink:href、CSS link）即使已被正确替换成 blob URL 也不会
        // 发起请求（实测：资源计时 0 条、styleSheets=0），纯图片首页（SVG 封面）
        // 必然白屏、书籍 CSS 全部丢失。
        // 注意：manager 由 start() 创建，而 start() 排在渲染队列中 book.opened
        // 之后——必须等 rendition.started resolve 后再补设 viewSettings.method
        // （renderTo 返回时 manager 尚未创建，提前补设会静默无效；
        // ContinuousViewManager 的 viewSettings 也不透传 renderTo 的 method 选项）。
        await withTimeout(rendition.started ?? Promise.resolve(), OPEN_TIMEOUT_MS);
        epubDiag("RENDITION_STARTED");
        if (destroyed) return;
        const mgr = rendition.manager;
        if (mgr?.viewSettings) mgr.viewSettings.method = "blobUrl";

        // 目录加载：opened 后必然已完成；保留 await 与超时兜底
        const nav = await withTimeout(book.loaded.navigation, OPEN_TIMEOUT_MS);
        epubDiag("NAV_LOADED", `toc=${nav.toc?.length ?? 0}`);
        if (destroyed) return;
        // D96：同时保留树路径（面板按章节组织用）——用 nav.toc 原始嵌套，而非推断后的扁平表
        const nodes = tocNodesWithPath(nav.toc ?? []);
        setTocContext(nodes.length ? { nodes } : null);
        onTocContextRef.current?.(nodes.length ? { nodes } : null);
        const items = inferTocDepths(flattenToc(nav.toc ?? []));
        setToc(items);

        // 每个目录项都保留自己的 section + fragment。
        // 一个 XHTML 可以包含多个目录项，不能用 section.index 单值覆盖它们。
        const targets = items.flatMap((item, index) => {
          const section = loadSpineSection(book, item.href);
          return section && typeof section.index === "number"
            ? [{ ...item, index, sectionIndex: section.index, fragment: hrefFragment(item.href) }]
            : [];
        });
        tocTargetsRef.current = targets;
        const mappedSectionIndexes = new Set(targets.map((target) => target.sectionIndex));
        const contentSectionIndexes = new Set(mappedSectionIndexes);
        const firstContentIndex = Math.min(...mappedSectionIndexes);
        if (Number.isFinite(firstContentIndex)) {
          // Keep linear spine sections after the first mapped TOC section even
          // when the navigation document omits a later XHTML file.
          for (let index = firstContentIndex; index < 10000; index++) {
            const section = book.spine.get(index) as EpubSection | null;
            if (!section) break;
            if (section.linear !== false) contentSectionIndexes.add(index);
          }
        }
        if (items.length > 0) {
          activeRef.current = 0;
          setActive(0);
          onChapterChangeRef.current?.(items[0].label);
        }

        // manager 在 rendition.started 后已存在；两种模式都引用它（applyResume 恢复用）。
        const manager: EpubManager | null = (rendition.manager as EpubManager | null) ?? null;

        // D80 关键修复：必须在首次 display 之前接管 continuous manager 的 fill/check。
        // epubjs 的 rendition.display() → manager.display() → .then(() => this.fill())，
        // continuous 的 fill() 递归 check() 会 Promise.all(各章 display) 补齐视口；
        // 首章常不在 spine 0（本书在 index 12），补齐过程任一章渲染卡住 → display()
        // 永不 settle → 10s 超时被误判「EPUB 解析失败」（真机日志 DISPLAY_START 后超时）。
        // 原代码在 display 之后才 patch，第一次 display 仍走原生 fill，正是卡死点。
        // 这里提前 patch 为 no-op fill + 委托 wm 的 check（wm 稍后创建，经 wmRef 共享）。
        if (!isPage && manager) {
          const managerAny = manager as unknown as Record<string, unknown>;
          epubDiag("PATCH_FILL_CHECK", "before display");
          managerAny.fill = () => Promise.resolve();
          managerAny.check = () => {
            wmRef?.scheduleSync();
            return Promise.resolve(false);
          };
        }

        // 初始定位到目录首章（两种模式都要先 display 首章），而不是 book.spine.start
        // （spine 首项常是目录里没有的封面/版权页/书内目录页）。真书《关键对话》
        // spine 顺序为 cover → TOC → 正文，落到目录首章更符合阅读直觉。
        const startTarget = items.length > 0 ? items[0].href : undefined;
        epubDiag("DISPLAY_START", `target=${startTarget ?? "(none)"}`);
        await withTimeout(rendition.display(startTarget), OPEN_TIMEOUT_MS);
        epubDiag("DISPLAY_OK");
        probeEpubDom(container, rendition, "after-display");
        if (destroyed) return;

        if (!isPage) {
          // ===== 纵向滚动（continuous + 自定义章节窗口化，与现状一致）=====
          if (!manager) throw new Error("EPUB manager unavailable");

          // 建立「spine section.index → 侧栏下标」映射（用于过滤非正文 spine 项）。
          {
            const map = new Map<number, number>();
            for (let i = 0; i < items.length; i++) {
              const href = hrefWithoutHash(items[i].href);
              const sec = loadSpineSection(book, href);
              if (sec && typeof sec.index === "number") {
                map.set(sec.index, i);
              } else {
                // 降级：按已加载 view 的 href 后缀匹配（修复原 mgr 笔误 → manager）
                const viewsNow = manager.views?.all?.() ?? [];
                const hit = viewsNow.find((v) => {
                  const vh = (v.section.href ?? "").toLowerCase();
                  const th = href.toLowerCase();
                  return vh === th || vh.endsWith("/" + th) || vh.endsWith(th);
                });
                if (hit) map.set(hit.section.index, i);
              }
            }
            if (map.size === 0) {
              logRef.current?.("目录与书脊无法对应，章节过滤已降级");
            }
          }

          const stage = container.querySelector<HTMLElement>(".epub-container");
          if (stage && manager) {
            stage.tabIndex = 0; // 承接键盘滚动（PageDown/Home/End）
            const offPointer = makeIframeClickThrough(stage);
            const offInteract = bindStageInteraction(stage, (href) => {
              logRef.current?.(`正文链接：${href}（暂未实现外部打开）`);
            });
            // 划词桥接（v0.3.0）：iframe pointer-events:none 下原生拖拽选区不可用
            const offMarks = bindStageMarks(stage, {
              onPress: () => {
                setToolbar(null);
                // D98：气泡已移除（悬停看内容、右键改删）
              },
              onHover: scheduleHover,
              onDragSelect: (doc, range) => {
                // cfi 由所在视图的 Contents 反算（epub.js 6571）
                const contents = renditionRef.current?.views?.().find((v) => {
                  try {
                    return v.contents?.document === doc;
                  } catch {
                    return false;
                  }
                })?.contents;
                let cfi: string | null = null;
                try {
                  cfi = contents?.cfiFromRange?.(range) ?? null;
                } catch {
                  cfi = null;
                }
                handleSelection(doc, range, cfi);
              },
              onMarkMenu: (id, x, y) => {
                const ctx = marksCtxRef.current;
                if (!ctx?.enabled) return;
                openMarkMenu(id, x, y);
              },
            });

            // 窗口化管理：以当前可见章节为中心维持 [c-pre, c+pre]，滚动时动态补齐/回收。
            const nav = createSectionNav(contentSectionIndexes, book.spine);
            const wm = createChapterWindow({
              manager: manager as unknown as Parameters<typeof createChapterWindow>[0]["manager"],
              spine: {
                get: (target) => book.spine.get(target) as { index: number } | undefined,
              },
              sectionNav: nav,
              getPreload: () => preloadRef.current,
              onSyncState: (st) => {
                if (import.meta.env.DEV) document.body.dataset.dbgWin = st;
              },
              onVisibleChange: (sectionIndex, view) => {
                if (suppressScrollSyncRef.current) return;
                const sectionTargets = tocTargetsRef.current.filter(
                  (target) => target.sectionIndex === sectionIndex
                );
                let idx: number | undefined;
                if (sectionTargets.length > 0) {
                  // 同一 XHTML 内的多个目录项按锚点位置选择最后一个已经过视口中线的项。
                  const rect = stage.getBoundingClientRect();
                  const probe = (rect.top + rect.bottom) / 2;
                  idx = sectionTargets[0].index;
                  for (const target of sectionTargets) {
                    const top = view ? tocTargetTop(view, target) : null;
                    if (top !== null && top <= probe) idx = target.index;
                  }
                } else {
                  const previous = tocTargetsRef.current
                    .filter((target) => target.sectionIndex <= sectionIndex)
                    .at(-1);
                  idx = previous?.index ?? tocTargetsRef.current[0]?.index;
                }
                if (idx !== undefined && idx !== activeRef.current) {
                  activeRef.current = idx;
                  setActive(idx);
                  onChapterChangeRef.current?.(items[idx]?.label ?? "");
                }
              },
            });
            wmRef = wm;
            windowRef.current = wm;
            wm.sync();

            // 滚动模式也监听 relocated 采集 CFI（用于精确还原，与翻页分支互不干扰）
            rendition.on?.("relocated", (payload: unknown) => {
              const loc = payload as { start?: { cfi?: string } } | undefined;
              const cfi = loc?.start?.cfi;
              if (cfi) currentCfiRef.current = cfi;
            });

            // 阅读位置采集：取窗口锚点（章内比例）+ 目录匹配；离场节点 flush 实时取。
            const collectPosition = (): PositionReport | null => {
              const anchor = wm.getAnchor();
              if (!anchor) return null;
              const same = tocTargetsRef.current.filter((t) => t.sectionIndex === anchor.sectionIndex);
              const chosen = same.find((t) => t.index === activeRef.current) ?? same[0];
              if (!chosen) return null;
              return {
                position: {
                  kind: "epub",
                  tocIndex: chosen.index,
                  href: chosen.href,
                  sectionIndex: anchor.sectionIndex,
                  ratio: anchor.ratio,
                  ...(currentCfiRef.current ? { cfi: currentCfiRef.current } : {}),
                  mode: isPage ? "page" : "scroll",
                },
                progress: (chosen.index + 1) / Math.max(1, items.length),
              };
            };
            if (getterRef) getterRef.current = collectPosition;

            unwireScroll = () => {
              wm.destroy();
              windowRef.current = null;
              offPointer();
              offInteract();
              offMarks();
              if (getterRef && getterRef.current === collectPosition) {
                getterRef.current = null;
              }
            };
          }
        } else {
          // ===== 横向翻页（default + paginated）=====
          // 翻页模式不启用自定义窗口化（与 paginated 冲突，见方案 4.3）：
          // epubjs 默认 manager 自行按需加载章节，代价是不享受「窗口外章节回收」的内存优化。
          const stage = container;
          const offs: Array<() => void> = [];
          // 翻页导航自动隐藏（v0.2.6）：mousemove 挂在 section（按钮组与内容区的共同
          // 祖先），命中测试据此判定悬停/闲置——按钮组上静止不启动计时，移出才淡出。
          const section = sectionRef.current;
          if (section) {
            section.addEventListener("mousemove", showPager);
            offs.push(() => section.removeEventListener("mousemove", showPager));
          }
          // iframe 内鼠标移动经 postMessage 复现（F21 修正）：iframe 覆盖
          // 内容区，上面的 container 监听收不到其内事件，故另开槽位（D50）
          setPagerShowHandler(showPager);
          offs.push(() => setPagerShowHandler(null));
          showPager(); // 初始展示，随后自动隐藏
          const matchTarget = (locHref: string): TocTarget | null => {
            const base = hrefWithoutHash(locHref);
            return (
              tocTargetsRef.current.find((t) => hrefWithoutHash(t.href) === base) ?? null
            );
          };
          const applyLoc = (locHref: string) => {
            const target = matchTarget(locHref);
            if (!target) return;
            currentHrefRef.current = target.href;
            if (target.index !== activeRef.current) {
              activeRef.current = target.index;
              setActive(target.index);
              onChapterChangeRef.current?.(items[target.index]?.label ?? "");
            }
          };
          const renditionNext = () =>
            (rendition as unknown as { next?: (o?: number) => void }).next?.();
          const renditionPrev = () =>
            (rendition as unknown as { prev?: (o?: number) => void }).prev?.();
          // 当前章节随翻页变化（relocated 给出可见章节 href）→ 侧栏高亮 + 章名
          rendition.on?.("relocated", (payload: unknown) => {
            const loc = payload as { start?: { href?: string; cfi?: string } } | undefined;
            const h = loc?.start?.href;
            const cfi = loc?.start?.cfi;
            if (cfi) currentCfiRef.current = cfi;
            if (h) applyLoc(h);
            showPager(); // 翻页/章节变化即复现导航（R4：翻页中不隐藏）
          });
          // 键盘翻页已上收 window 级统一派发（v0.2.5 F22）：不再挂 stage 监听，
          // 避免焦点在 stage 内时一次按键翻两页；iframe 内焦点经 hooks.content
          // 注入的 postMessage 转发器覆盖（见上方注入点）。
          // 划词（v0.3.0）：page 模式 iframe 可交互，原生选区经 epubjs
          // selectionchange（250ms 防抖）→ CONTENTS.SELECTED → rendition "selected"
          // （epub.js 6526/9089/9108）。cfi 由事件直接给出，range 由 getRange 反查。
          rendition.on?.("selected", (cfi: unknown, contents: unknown) => {
            const cfiStr = typeof cfi === "string" ? cfi : "";
            epubDiag("SELECTED_EVENT", `cfi=${cfiStr.slice(0, 48)}`);
            if (!cfiStr) return;
            const doc = (contents as EpubContentsLite | undefined)?.document;
            const range = rendition.getRange?.(cfiStr) ?? null;
            if (!doc || !range) return;
            handleSelection(doc, range, cfiStr);
          });
          // D98：翻页模式左键点高亮不再弹气泡（悬停看内容、右键改删）。
          // epubjs 的 markClicked 只能拿到 id 与 cfi，拿不到鼠标视口坐标，
          // 故此处不处理；右键由 stage 上的 contextmenu 命中测试接管（见下）。
          // 保留打点用于确认 epubjs 的点击代理仍然工作（不影响行为）。
          rendition.on?.("markClicked", (_cfi: unknown, data: unknown) => {
            const id = (data as { id?: string } | undefined)?.id;
            epubDiag("MARK_CLICKED", `id=${id ?? "-"}`);
          });
          // D98：翻页模式右键菜单。
          // 关键约束：epubjs 的 DOM_EVENTS（constants.js）只转发
          // keydown/keyup/mouseup/mousedown/mousemove/click/touch*——**不含 contextmenu**，
          // 故 iframe 内右键既不会冒泡到宿主，也不会被 epubjs 代理出来。
          // 解决：直接在 iframe 文档上装 contextmenu 监听（每章渲染时补装）。
          if (stage) {
            const installCtx = (doc: Document) => {
              if (!doc || (doc as Document & { __markCtx?: boolean }).__markCtx) return;
              (doc as Document & { __markCtx?: boolean }).__markCtx = true;
              doc.addEventListener("contextmenu", (ev) => {
                const iframe = iframeOfDoc(containerRef.current, doc);
                const ir = iframe?.getBoundingClientRect();
                if (!ir) return;
                const x = ev.clientX + ir.left;
                const y = ev.clientY + ir.top;
                const g = findMarkElAt(stage, x, y);
                const id = g?.getAttribute("data-id");
                ev.preventDefault();
                cancelHover();
                if (!id) return;
                openMarkMenu(id, x, y);
              });
            };
            // 首次 + 每次新视图渲染时补装（翻页会重建 iframe 文档）
            offs.push(() => {
              /* 清理：文档随视图销毁，无需逐章 remove */
            });
            const installAll = () => {
              rendition.views?.().forEach((v) => {
                try {
                  const d = v.contents?.document;
                  if (d) installCtx(d);
                } catch {
                  // 跨域/已销毁：忽略
                }
              });
            };
            installAll();
            // rendered 在部分 epubjs 版本/视图复用下可能漏发，relocated 兜底补装
            rendition.on?.("rendered", installAll);
            rendition.on?.("relocated", installAll);
          }
          // 章节级采集：取 relocated 当前章节（ratio 记 0，与 D32 章节级口径一致）。
          const collectPosition = (): PositionReport | null => {
            const h = currentHrefRef.current || (startTarget ?? "");
            const target = matchTarget(h);
            if (!target) return null;
            return {
              position: {
                kind: "epub",
                tocIndex: target.index,
                href: target.href,
                sectionIndex: target.sectionIndex,
                ratio: 0,
                ...(currentCfiRef.current ? { cfi: currentCfiRef.current } : {}),
                mode: isPage ? "page" : "scroll",
              },
              progress: (target.index + 1) / Math.max(1, items.length),
            };
          };
          if (getterRef) getterRef.current = collectPosition;
          pagerRef.current = { prev: renditionPrev, next: renditionNext };
          unwireScroll = () => {
            offs.forEach((f) => f());
            stage.removeAttribute("tabindex");
            if (getterRef && getterRef.current === collectPosition) {
              getterRef.current = null;
            }
            pagerRef.current = null;
          };
        }

        // ===== 阅读位置恢复（一次性）：初始渲染与空白自检全部通过后执行 =====
        // 顺序不能提前：display() 会重建章节流，早于自检应用会在自检的
        // 二次 display 中丢失；也不能晚于 initialPhase=false 之后的用户操作。
        const applyResume = async () => {
          const r = resumeRef.current;
          resumeRef.current = null;
          if (!r || r.kind !== "epub" || !r.href) return;
          if (isPage) {
            // 翻页模式恢复：CFI 优先（精确章内页），缺 CFI 降级到章节首
            try {
              if (r.cfi) {
                await withTimeout(rendition.display(r.cfi), OPEN_TIMEOUT_MS);
              } else {
                await withTimeout(rendition.display(r.href), OPEN_TIMEOUT_MS);
              }
            } catch {
              return; // 恢复失败：降级停在首章，不升级为打开失败
            }
            if (destroyed) return;
            // display(cfi) 已精确还原章内位置；章节高亮用记录的 tocIndex 近似
            const idx = Math.min(Math.max(0, Math.round(r.tocIndex)), Math.max(0, items.length - 1));
            activeRef.current = idx;
            setActive(idx);
            currentHrefRef.current = r.href;
            onChapterChangeRef.current?.(items[idx]?.label ?? "");
            return;
          }
          const stage = container.querySelector<HTMLElement>(".epub-container");
          if (!stage) return;
          try {
            // 滚动模式恢复：CFI 优先（paginated/scrolled 下均精确，天然跨模式），
            // 缺 CFI 或 CFI 还原失败则降级到 href + 章内 ratio 数学。
            if (r.cfi) {
              await withTimeout(rendition.display(r.cfi), OPEN_TIMEOUT_MS);
            } else {
              await withTimeout(rendition.display(r.href), OPEN_TIMEOUT_MS);
            }
          } catch {
            if (r.cfi) {
              try {
                await withTimeout(rendition.display(r.href), OPEN_TIMEOUT_MS);
              } catch {
                return;
              }
            } else {
              return; // 恢复失败：降级停在首章，不升级为打开失败
            }
          }
          if (destroyed) return;
          await waitStageStable(stage, 1500);
          if (destroyed) return;
          // 无 CFI（旧数据/降级）才走章内 ratio 数学；CFI 已精确还原，不再扰动。
          if (!r.cfi) {
            const view = manager?.views?.all?.().find((v) => v.section.index === r.sectionIndex);
            const stageRect = stage.getBoundingClientRect();
            if (view) {
              // 与 jump() 同一套视口坐标换算法（不用 epubjs bounds()，其语义随版本漂移）
              const rect = view.element.getBoundingClientRect();
              const max = Math.max(0, stage.scrollHeight - stage.clientHeight);
              const ratio = Math.min(1, Math.max(0, r.ratio));
              const target = stage.scrollTop + (rect.top - stageRect.top) + ratio * rect.height;
              stage.scrollTop = Math.max(0, Math.min(target, max));
              // 自校正：display() 重建章节流后，章节高度/起始偏移可能与上报时不同
              // （实测一次映射系统性偏低约 150px）。读回锚点与目标比较，差值按当前
              // 章节高度折算成 scrollTop 修正，最多 2 次；语义是「章内相对位置」精确，
              // 章节绝对高度漂移由等待稳定 + 迭代吸收。
              for (let i = 0; i < 2 && !destroyed; i++) {
                const now = windowRef.current?.getAnchor();
                if (!now || now.sectionIndex !== r.sectionIndex) break;
                const delta = ratio - now.ratio;
                if (Math.abs(delta) < 0.01) break;
                const v2 = manager?.views?.all?.().find((v) => v.section.index === r.sectionIndex);
                if (!v2) break;
                const h2 = v2.element.getBoundingClientRect().height;
                if (h2 <= 0) break;
                stage.scrollTop = Math.max(0, Math.min(stage.scrollTop + delta * h2, max));
              }
            }
            windowRef.current?.sync();
          }
          // 侧栏高亮与章名同步（view 找不到时也执行，至少落到记录的章）
          const idx = Math.min(Math.max(0, Math.round(r.tocIndex)), Math.max(0, items.length - 1));
          activeRef.current = idx;
          setActive(idx);
          onChapterChangeRef.current?.(items[idx]?.label ?? "");
        };

        // 渲染后校验：iframe 零高度 → 强制重新布局自愈；内容空白 → 确认后向后跳一章。
        // 背景：部分商业 EPUB 首章为图片页/空壳页，或 renderTo 时容器未完成布局，
        // 表现为目录正常、正文纯白且无任何错误提示（用户实测反馈）。
        let state = await settleAndCheck(container, rendition, true);
        epubDiag("SETTLE_STRICT", `state=${state}`);
        probeEpubDom(container, rendition, "after-settle-strict");
        if (destroyed) return;
        // D85：翻页模式无窗口管理器，只显示首章。本书首章是书名扉页（len=25，仅
        // "The Complete Sherlock Holmes"），原 text.length>0 判定把它误判为有正文 →
        // OPEN_OK 后一直停在扉页=「翻页没内容」。滚动模式靠窗口管理器补齐相邻章节
        // 正文故无此问题。翻页模式追加最小正文阈值，空壳扉页强制走跳章到首个有正文章。
        // 提取为函数：strict 与 loose 两处复检都要应用，否则 loose 复检把同一扉页
        // 又判回 state=true 直接 return，跳章循环根本执行不到（D85 首次修复的漏洞）。
        const shellCoverCheck = (s: boolean | null): boolean | null => {
          if (!isPage || s !== true) return s;
          const iframe = container.querySelector("iframe");
          let textLen = -1;
          try {
            textLen = (
              iframe?.contentDocument?.body?.innerText ||
              iframe?.contentDocument?.body?.textContent ||
              ""
            ).replace(/\s+/g, "").length;
          } catch {
            // 跨域不可访问：不干预原判定
          }
          if (textLen >= 0 && textLen < 80) {
            epubDiag("EMPTY_SHELL_PAGE", `len=${textLen}; treat as empty`);
            return false;
          }
          return s;
        };
        state = shellCoverCheck(state);
        if (state !== false) {
          failOnDisplayError = false; // 位置恢复的 display 失败只降级，不判整本失败
          const r0 = resumeRef.current;
          epubDiag(
            "RESUME",
            !r0
              ? "none"
              : r0.kind === "epub"
                ? `kind=epub cfi=${!!r0.cfi} href=${r0.href ?? ""}`
                : `kind=${r0.kind}`
          );
          probeEpubDom(container, rendition, "before-resume");
          await applyResume();
          probeEpubDom(container, rendition, "after-resume");
          failOnDisplayError = true;
          if (destroyed) return;

          // D81：applyResume 用旧 CFI/href 二次 display()，其内部 clear() 会重建章节流。
          // 历史缺陷（e59acee）：二次 display 对部分书永久挂起，超时被内部 catch 吞掉后
          // 停在「view 已清空、新内容未挂载」的纯白态——这正是"能打开但正文全白"的表现。
          // 这里复检：若恢复后确认空白，重新 display 首章把正文捞回来，绝不留在纯白。
          let postState = await settleAndCheck(container, rendition, false);
          epubDiag("SETTLE_AFTER_RESUME", `state=${postState}`);
          probeEpubDom(container, rendition, "after-resume-settle");
          if (destroyed) return;
          if (postState === false) {
            try {
              await withTimeout(rendition.display(startTarget), OPEN_TIMEOUT_MS);
              epubDiag("RESUME_BLANK_RECOVERED", `display=${startTarget ?? "(none)"}`);
              probeEpubDom(container, rendition, "after-recover");
            } catch {
              fail("位置恢复后正文空白且首章重显失败");
              return;
            }
            if (destroyed) return;
          }
          initialPhase = false;
          epubDiag("OPEN_OK", "首章内容正常");
          return; // 有内容 / 无法判定 → 接受
        }

        // 二次沉淀复检（放宽 readyState 要求），排除章节体积大、绘制慢导致的误判
        state = await settleAndCheck(container, rendition, false);
        state = shellCoverCheck(state); // D85：空壳扉页在此也必须判空，否则被判回 true 提前 return
        epubDiag("SETTLE_LOOSE", `state=${state}`);
        if (destroyed) return;
        if (state !== false) {
          initialPhase = false;
          return;
        }

        // 确认空白：向后跳章（最多 EMPTY_SECTION_RETRY 次）
        for (let step = 1; step <= EMPTY_SECTION_RETRY && step < items.length; step++) {
          setActive(step);
          onChapterChangeRef.current?.(items[step].label);
          // D84：此跳章走打开流程内，不经 jump()，必须手动设 guard，
          // 否则 display 撑宽 iframe 触发的 resize 会清掉刚加载的正文（"一瞬间后消失"）。
          jumpResizeGuardRef.current = Date.now() + 1500;
          try {
            await withTimeout(rendition.display(items[step].href), OPEN_TIMEOUT_MS);
          } catch {
            // 跳章显示失败：明确报错，不留无提示白屏
            // （epubjs 的 display 失败时 promise 永不 settle，只能靠超时兜底）
            fail("跳章 display 超时:第" + (step + 1) + "章 " + items[step].href);
            return;
          }
          if (destroyed) return;
          state = await settleAndCheck(container, rendition, false);
          state = shellCoverCheck(state); // D85：跳到的章也要排除空壳页
          if (destroyed) return;
          if (state !== false) {
            // D86：若恢复位置指向的就是空壳扉页（首章），跳章后绝不再 applyResume——
            // 它会用旧 CFI 再 display 回扉页，把刚跳到的正文清掉（"一瞬间后消失"）。
            const r = resumeRef.current;
            const resumeIsShellCover =
              !!r &&
              r.kind === "epub" &&
              hrefWithoutHash(r.href) === hrefWithoutHash(items[0].href);
            if (resumeIsShellCover) {
              epubDiag("RESUME_SKIP_SHELL", `href=${r?.href ?? ""} (resume 指向空壳扉页)`);
              resumeRef.current = null;
            } else {
              failOnDisplayError = false; // 同上：跳章后的位置恢复 display 失败只降级
              await applyResume();
              failOnDisplayError = true;
            }
            if (destroyed) return;
            initialPhase = false;
            epubDiag("OPEN_OK", `跳章恢复:第${step + 1}章`);
            return;
          }
        }
        // 多次校验仍为空白：按解析失败提示，避免无提示白屏
        fail("空白自检未通过:首章+跳章均判定无内容");
      } catch (e) {
        fail("异常抛出:" + ((e as { message?: string })?.message ?? String(e)));
      } finally {
        initialPhase = false;
        // 初始阶段收官：补一次 annotations 同步（早于打开完成的 marks 变更此刻生效；
        // 失败路径 rendition 已销毁，syncAnnotations 内部判空跳过）。
        if (!destroyed) syncAnnotations();
        // 初始阶段收官（接受/跳章成功/失败兜底）：通知 App 淡出加载遮罩。
        // destroyed 时不发：组件已被新书替换，发了会误淡掉新书的遮罩。
        if (!destroyed) onReadyRef.current?.();
      }
    })();

    // 阅读命令注册（v0.2.5 F22）：window 级快捷键经 readerCommands 槽位派达到本 Viewer。
    // 翻页模式：prev/next 交 epubjs 分页，home/end 跳目录首/末章（章节级，同 D32 口径）；
    // 滚动模式：方向键微滚、翻页键整屏（D46），Home/End 顶/底。
    setReaderCommandHandler((action, key) => {
      if (isPage) {
        showPager(); // 键盘翻页即复现导航并重置计时（R4）
        if (action === "prev") {
          pagerRef.current?.prev();
          return true;
        }
        if (action === "next") {
          pagerRef.current?.next();
          return true;
        }
        const targets = tocTargetsRef.current;
        const href = action === "home" ? targets[0]?.href : targets[targets.length - 1]?.href;
        if (href) {
          void (renditionRef.current as unknown as { display?: (h: string) => Promise<unknown> })
            ?.display?.(href);
          return true;
        }
        return false;
      }
      const stage = container.querySelector<HTMLElement>(".epub-container");
      if (!stage) return false;
      if (action === "home") {
        stage.scrollTo({ top: 0 });
        return true;
      }
      if (action === "end") {
        stage.scrollTo({ top: stage.scrollHeight });
        return true;
      }
      const step = scrollStepFor(key, stage.clientHeight);
      stage.scrollBy({ top: action === "prev" ? -step : step });
      return true;
    });

    // D83：rendition.resize() 内部调用 manager.clear()，会销毁并清空全部 views
    // （epubjs 的 resize 不做「尺寸未变提前返回」）。epubjs 仅靠 onResized()→
    // display(location.start.cfi) 自愈；首次 display 刚完成时 location 可能尚未就绪，
    // ResizeObserver 首次回调（observe 后立即触发一次）会在此时 clear 掉首章且自愈
    // 失败 → 正文永久纯白。日志证据：after-display frames=1 → 700ms 后
    // after-settle-strict frames=0；jump display 短暂有内容（len=113151）后又空白。
    // 叠加 D80 把 continuous 的 check() patch 成 no-op、wm.sync() 在 views=0 时直接
    // return，清空后无任何自愈路径。修复：resize 后延迟复检 views，若仍为空则主动
    // 重显当前目标（不依赖 location 自愈）。
    let resizeBaseline: { w: number; h: number } | null = null;
    const resizeWithRecovery = () => {
      const rendition = renditionRef.current;
      if (!rendition || destroyed) return;
      // D84：jump 后的瞬态窗口内禁止 resize（跳章 display 必然撑宽 iframe，
      // 此时 resize 会清掉刚加载的正文），真实窗口缩放发生在跳转间隙不受影响。
      if (Date.now() < jumpResizeGuardRef.current) {
        epubDiag("RESIZE_SKIP_JUMP", `guard=${jumpResizeGuardRef.current - Date.now()}ms`);
        return;
      }
      epubDiag("RESIZE_BEGIN", "resize->manager.clear()");
      try {
        resizeRenditionToContainer(rendition, container);
      } catch (e) {
        epubDiag("RESIZE_ERR", (e as { message?: string })?.message ?? String(e));
        return;
      }
      window.setTimeout(() => {
        if (destroyed || renditionRef.current !== rendition) return;
        const views = rendition.manager?.views?.all?.() ?? [];
        if (views.length > 0) {
          epubDiag("RESIZE_OK", `views=${views.length}`);
          probeEpubDom(container, rendition, "after-resize-ok");
          windowRef.current?.sync();
          return;
        }
        // epubjs 自愈失败（location 未就绪 / display 挂起）：主动重显当前目标
        const location = rendition as unknown as {
          location?: { start?: { cfi?: string } };
        };
        const target =
          location.location?.start?.cfi ||
          currentCfiRef.current ||
          tocTargetsRef.current[0]?.href;
        epubDiag("RESIZE_RECOVER", `target=${target ?? "(none)"}`);
        void withTimeout(Promise.resolve(rendition.display(target)), OPEN_TIMEOUT_MS)
          .then(() => {
            epubDiag("RESIZE_RECOVER_OK", `target=${target ?? "(none)"}`);
            probeEpubDom(container, rendition, "after-resize-recover");
            windowRef.current?.sync();
          })
          .catch((e) => {
            epubDiag(
              "RESIZE_RECOVER_FAIL",
              (e as { message?: string })?.message ?? String(e)
            );
            probeEpubDom(container, rendition, "after-resize-recover-fail");
          });
      }, 600);
    };

    const onResize = () => resizeWithRecovery();
    window.addEventListener("resize", onResize);

    // 主题/字号变更：对已加载的章节文档重新注入阅读样式（iframe 独立文档，
    // 宿主的 data-theme 切换不会渗入，必须逐文档重注）
    const reinjectReading = () => {
      const views = renditionRef.current?.manager?.views?.all?.() ?? [];
      for (const v of views) {
        const iframe = viewIframe(v);
        let doc: Document | null = null;
        try {
          doc = iframe?.contentDocument ?? null;
        } catch {
          doc = null; // 跨域不可访问：跳过，下次 hooks.content 会带上新设置
        }
        if (doc) applyReadingStyle(doc, settingsRef.current);
      }
    };

    // epubjs 只监听 window.resize，不感知容器自身尺寸变化。目录侧栏出现后
    // 正文区宽度会从满宽收窄到「容器宽 - 224px」，若不主动 resize，
    // iframe 会保持旧宽度（右侧被裁掉一截，且行宽与可视宽度不一致）。
    // D83：ResizeObserver 的首次回调在 observe() 后立即触发，此时首次 display
    // 刚完成、location 可能未就绪；若照旧 resize 会 clear 掉首章且自愈失败 → 纯白。
    // 故首次回调只建立尺寸基线，不上报 resize；后续仅当尺寸真正变化时才 resize。
    const ro =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver((entries) => {
            const cr = entries[0]?.contentRect;
            if (!cr || destroyed) return;
            const w = Math.round(cr.width);
            const h = Math.round(cr.height);
            if (!resizeBaseline) {
              resizeBaseline = { w, h };
              epubDiag("RO_BASELINE", `${w}x${h}`);
              return;
            }
            // D84：jump 的 rendition.display() 会把 iframe 撑到整章展开宽度
            // （paginated 实测 43764x723），container 的 RO 随之读到该宽度并触发
            // resize→manager.clear()，刚加载的正文被清空；epubjs 自愈又回到首章
            // （len=25，只剩标题）→「跳章跳回第一章且正文空白」。
            // 真实容器宽度永远 ≤ 视口宽度，超过 viewport+200 即判为 display 中间态，
            // 忽略且不污染 baseline（否则弹回的正常宽度又被误判为变化，二次 clear）。
            const viewportW = window.innerWidth || 1920;
            if (w > viewportW + 200) {
              epubDiag("RO_IGNORE_EXPAND", `${w}x${h} viewport=${viewportW}`);
              return;
            }
            // 滚动条出现/消失造成的微小高度抖动（<40px）也不算真实变化
            if (Math.abs(w - resizeBaseline.w) < 2 && Math.abs(h - resizeBaseline.h) < 40) {
              return;
            }
            resizeBaseline = { w, h };
            epubDiag("RO_CHANGED", `${w}x${h}`);
            resizeWithRecovery();
          });
    ro?.observe(container);

    // 预加载章节数变更：立即让窗口管理器按新值重算（无需重开图书）
    const unsubSettings = subscribeSettings((s) => {
      settingsRef.current = s;
      preloadRef.current = s.epubPreloadCount;
      windowRef.current?.sync();
      reinjectReading();
    });

    return () => {
      destroyed = true;
      setReaderCommandHandler(null); // 注销快捷键命令（避免指向已销毁实例）
      unsubSettings();
      if (unwireScroll) unwireScroll();
      ro?.disconnect();
      window.removeEventListener("resize", onResize);
      onChapterChangeRef.current?.("");
      try {
        bookRef.current?.destroy();
      } catch {
        // 忽略销毁异常
      }
      bookRef.current = null;
      renditionRef.current = null;
    };
  }, [dataBase64]);

  /** 侧栏点击 → 正文滚动到对应章节（sidebar → content） */
  const jump = (index: number, href: string) => {
    // D84：跳章 display 会把 iframe 撑到整章展开宽度，1.2s 内禁止 resize 清除正文
    jumpResizeGuardRef.current = Date.now() + 1200;
    activeRef.current = index;
    setActive(index);
    onChapterChange?.(toc[index]?.label ?? "");
    // 抑制随之而来的滚动反向高亮，避免"点击后又跳到别的章"的抖动
    suppressScrollSyncRef.current = true;
    window.setTimeout(() => {
      suppressScrollSyncRef.current = false;
    }, 400);

    const target = tocTargetsRef.current.find((item) => item.index === index);
    const wm = windowRef.current;
    epubDiag("JUMP", `idx=${index} secIdx=${target?.sectionIndex ?? "?"} href=${href}`);
    if (wm && target) {
      const manager = renditionRef.current?.manager;
      const view = manager?.views?.all?.().find((item) => item.section.index === target.sectionIndex);
      if (view) {
        const top = tocTargetTop(view, target);
        const stage = manager?.container;
        if (top !== null && stage) {
          stage.scrollTop += top - stage.getBoundingClientRect().top - 16;
          wm.scheduleSync();
          epubDiag("JUMP_INWINDOW", `top=${Math.round(top)} st=${Math.round(stage.scrollTop)}`);
          return;
        }
        // 目标在当前窗口内但锚点暂不可访问时，至少滚到该 section 顶部。
        wm.scrollToSection(target.sectionIndex);
        epubDiag("JUMP_INWINDOW_FALLBACK", `secIdx=${target.sectionIndex}`);
        return;
      }
    }
    // 目标 section 不在窗口内：让 epubjs 定位到目标锚点，再由窗口管理器
    // 按用户设置补齐前后章节并回收窗口外内容。
    epubDiag("JUMP_DISPLAY", `href=${target?.href ?? href} (target not in window)`);
    void withTimeout(Promise.resolve(renditionRef.current?.display(target?.href ?? href)), OPEN_TIMEOUT_MS)
      .then(() => {
        epubDiag("JUMP_DISPLAY_OK", `href=${target?.href ?? href}`);
        probeEpubDom(containerRef.current, renditionRef.current, "after-jump-display");
        windowRef.current?.sync();
      })
      .catch((e) => {
        epubDiag("JUMP_DISPLAY_FAIL", `err=${(e as { message?: string })?.message ?? String(e)}`);
        probeEpubDom(containerRef.current, renditionRef.current, "after-jump-fail");
      });
  };

  if (failed) {
    const diagText = getEpubDiagText();
    return (
      <section className="state state-epub active" aria-label="EPUB 解析失败">
        <div className="welcome">
          <span className="welcome-title">EPUB 解析失败，请确认文件未加密或损坏</span>
          {failReason && <span className="epub-fail-reason">触发点：{failReason}</span>}
          <button
            type="button"
            className="btn epub-diag-toggle"
            onClick={() => setDiagOpen((v) => !v)}
          >
            {diagOpen ? "收起诊断日志" : "查看诊断日志"}
          </button>
          {diagOpen && (
            <div className="epub-diag-box">
              <pre>{diagText || "(无诊断记录)"}</pre>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  // 复制成功无需提示；失败时用户仍可在上方 <pre> 手动选择文本
                  void navigator.clipboard?.writeText(diagText).catch(() => undefined);
                }}
              >
                复制日志
              </button>
            </div>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="state state-epub active" aria-label="EPUB 显示" ref={sectionRef}>
      {toc.length > 0 && (
        <aside className="toc-sidebar">
          <div className="toc-title">目录</div>
          {toc.map((item, i) => (
            <button
              key={item.href + ":" + i}
              type="button"
              className={
                "toc-item toc-depth-" + Math.min(2, tocDepth(item)) +
                (i === active ? " active" : "")
              }
              aria-level={tocDepth(item) + 1}
              onClick={() => jump(i, item.href)}
            >
              {item.label}
            </button>
          ))}
        </aside>
      )}
      <div className="epub-content" ref={containerRef} />
      <button
        type="button"
        className="epub-diag-fab"
        title="查看 EPUB 渲染诊断日志"
        onClick={() => setDiagOpen((v) => !v)}
      >
        {diagOpen ? "✕" : "诊断"}
      </button>
      {diagOpen && (
        <div className="epub-live-diag-box">
          <pre>{getEpubDiagText() || "(无诊断记录)"}</pre>
          <button
            type="button"
            className="btn"
            onClick={() => {
              void navigator.clipboard?.writeText(getEpubDiagText()).catch(() => undefined);
            }}
          >
            复制日志
          </button>
        </div>
      )}
      {toolbar && (
        <MarkToolbar
          x={toolbar.x}
          y={toolbar.y}
          mode={toolbar.mode}
          onColor={onToolbarColor}
          onNote={onToolbarNote}
          onCopy={onToolbarCopy}
          onDelete={onToolbarDelete}
        />
      )}
      {ctxMenu && (
        <div
          className="mark-menu"
          // D98：fixed + 视口坐标（与悬停提示同理，避免被 overflow/transform 裁切）
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          role="menu"
          aria-label="标记操作"
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            type="button"
            className="menu-item"
            onClick={() => {
              const m = ctxMenu.mark;
              setCtxMenu(null);
              cancelHover();
              marksCtxRef.current?.onEdit(m);
            }}
          >
            编辑标记
          </button>
          <button
            type="button"
            className="menu-item danger"
            onClick={() => {
              const id = ctxMenu.mark.id;
              setCtxMenu(null);
              cancelHover();
              marksCtxRef.current?.onDelete(id);
            }}
          >
            删除标记
          </button>
        </div>
      )}
      {hoverTip && (
        <div
          className="mark-hovertip"
          // D98：fixed + 视口坐标——跟随光标，且不受 .state/.epub-content 的
          // overflow 与 transform 影响（后者会裁掉 absolute 子元素）
          style={{ left: hoverTip.x, top: hoverTip.y }}
          role="tooltip"
        >
          <div className="mh-quote">{hoverTip.mark.text}</div>
          {hoverTip.mark.note && <div className="mh-note">{hoverTip.mark.note}</div>}
        </div>
      )}
      {mode === "page" && (
        <div
          className={"epub-pager" + (pager.visible ? " show" : "")}
          role="group"
          aria-label="翻页"
          ref={pager.setPagerEl}
        >
          <button
            type="button"
            className="pg-btn"
            onClick={() => pagerRef.current?.prev()}
            aria-label="上一页"
          >
            ‹
          </button>
          <button
            type="button"
            className="pg-btn"
            onClick={() => pagerRef.current?.next()}
            aria-label="下一页"
          >
            ›
          </button>
        </div>
      )}
    </section>
  );
}
