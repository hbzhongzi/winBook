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

/** 已绑定快捷键转发的章节文档（WeakSet 防同文档重复绑定，v0.2.5 F22） */
const hotkeyBoundDocs = new WeakSet<Document>();

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
  resize: (width: string, height: string) => void;
  on?: (event: string, cb: (payload: unknown) => void) => void;
  started?: Promise<unknown>;
  manager?: EpubManager;
  hooks?: { content?: { register: (fn: (contents: EpubContents) => void) => void } };
};
/** epubjs Section：窗口化管理只需 index 与相邻关系 */
type EpubSection = {
  index: number;
  href: string;
  linear?: boolean;
  prev: () => EpubSection | null;
  next: () => EpubSection | null;
};
type EpubView = { section: EpubSection; element: HTMLElement; destroy?: () => void };
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
};

// epubjs 打开/目录加载超时：损坏文件时 epubjs 的 opened 可能永久挂起
// （既不 resolve 也不 reject，见 e2e/check_epubjs.cjs 实测），无超时则白屏无提示
const OPEN_TIMEOUT_MS = 10000;
// display() resolve 后等待 iframe 绘制的时间，再做内容校验
const SETTLE_MS = 700;
// 首章渲染为空白的自动后移次数（商业书常见：首章为图片页/空壳页）
const EMPTY_SECTION_RETRY = 1;

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

function tocDepth(item: EpubNavItem): number {
  if ((item.depth ?? 0) > 0) return item.depth ?? 0;
  const label = item.label.trim();
  return /^(如何|本章小结|小结|总结|练习|案例)/.test(label) ? 1 : 0;
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
      rendition.resize("100%", "100%");
    } catch {
      // 忽略重布局异常
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

/** 把宿主页面上的鼠标坐标换算为 iframe 文档内坐标 */
function iframeContentPoint(
  iframe: HTMLIFrameElement,
  ev: MouseEvent
): { x: number; y: number } | null {
  const r = iframe.getBoundingClientRect();
  return { x: ev.clientX - r.left, y: ev.clientY - r.top };
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

export default function EpubViewer({ dataBase64, settings, mode, onChapterChange, resume, getterRef, onReady }: Props) {
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
  const [active, setActive] = useState(0);
  const [failed, setFailed] = useState(false);

  // onChapterChange 经 ref 调用：父组件每次渲染都会传入新函数引用，
  // 若直接进 effect 依赖会导致 effect 反复重跑（书籍被销毁重建、目录状态重置）。
  const onChapterChangeRef = useRef(onChapterChange);
  onChapterChangeRef.current = onChapterChange;
  // 初始渲染完成回调经 ref：同上，避免引用变化触发 effect 重跑
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
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

  useEffect(() => {
    let destroyed = false;
    const container = containerRef.current;
    if (!container) return;
    // 横向翻页 / 纵向滚动：本组件在挂载期只走对应分支（state-host key 含
    // readerMode，改模式即整组件重挂载，故 mode 视为常量，无需内部响应式重配置）。
    const isPage = mode === "page";

    const fail = () => {
      if (destroyed) return;
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

    (async () => {
      // displayError 仅在初始显示阶段触发失败：用户主动点击无效目录项时
      // 由 jump() 自行吞掉拒绝，不整本书判定失败。
      let initialPhase = true;

      try {
        const bytes = base64ToUint8Array(dataBase64);
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
        });

        // displayError：section 加载失败时 epubjs 只抛事件、display() 永久挂起，
        // 监听后立即失败，不必等超时（实测：部分真实书触发此路径）。
        rendition.on?.("displayError", () => {
          if (initialPhase) fail();
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
        if (destroyed) return;
        const mgr = rendition.manager;
        if (mgr?.viewSettings) mgr.viewSettings.method = "blobUrl";

        // 目录加载：opened 后必然已完成；保留 await 与超时兜底
        const nav = await withTimeout(book.loaded.navigation, OPEN_TIMEOUT_MS);
        if (destroyed) return;
        const items = flattenToc(nav.toc ?? []);
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

        // 初始定位到目录首章（两种模式都要先 display 首章），而不是 book.spine.start
        // （spine 首项常是目录里没有的封面/版权页/书内目录页）。真书《关键对话》
        // spine 顺序为 cover → TOC → 正文，落到目录首章更符合阅读直觉。
        const startTarget = items.length > 0 ? items[0].href : undefined;
        await withTimeout(rendition.display(startTarget), OPEN_TIMEOUT_MS);
        if (destroyed) return;

        // manager 在 rendition.started 后已存在；两种模式都引用它（applyResume 恢复用）。
        const manager: EpubManager | null = (rendition.manager as EpubManager | null) ?? null;

        if (!isPage) {
          // ===== 纵向滚动（continuous + 自定义章节窗口化，与现状一致）=====
          if (!manager) throw new Error("EPUB manager unavailable");
          const managerAny = manager as unknown as Record<string, unknown>;
          let wmRef: WindowManager | null = null;
          // 接管章节加载：屏蔽 ContinuousViewManager 自带的 fill()/check() 补章，
          // 改由窗口管理器按「跳过非正文 spine 项」邻接补齐（见 chapterWindow.ts）。
          managerAny.fill = () => Promise.resolve();
          managerAny.check = () => {
            wmRef?.scheduleSync();
            return Promise.resolve(false);
          };

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
        if (destroyed) return;
        if (state !== false) {
          await applyResume();
          if (destroyed) return;
          initialPhase = false;
          return; // 有内容 / 无法判定 → 接受
        }

        // 二次沉淀复检（放宽 readyState 要求），排除章节体积大、绘制慢导致的误判
        state = await settleAndCheck(container, rendition, false);
        if (destroyed) return;
        if (state !== false) {
          initialPhase = false;
          return;
        }

        // 确认空白：向后跳章（最多 EMPTY_SECTION_RETRY 次）
        for (let step = 1; step <= EMPTY_SECTION_RETRY && step < items.length; step++) {
          setActive(step);
          onChapterChangeRef.current?.(items[step].label);
          try {
            await withTimeout(rendition.display(items[step].href), OPEN_TIMEOUT_MS);
          } catch {
            // 跳章显示失败：明确报错，不留无提示白屏
            // （epubjs 的 display 失败时 promise 永不 settle，只能靠超时兜底）
            fail();
            return;
          }
          if (destroyed) return;
          state = await settleAndCheck(container, rendition, false);
          if (destroyed) return;
          if (state !== false) {
            await applyResume();
            if (destroyed) return;
            initialPhase = false;
            return;
          }
        }
        // 多次校验仍为空白：按解析失败提示，避免无提示白屏
        fail();
      } catch {
        fail();
      } finally {
        initialPhase = false;
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

    const onResize = () => renditionRef.current?.resize("100%", "100%");
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
    // ResizeObserver 首次回调也会触发一次 resize，epubjs 内部对尺寸未变会提前返回，
    // 因此不会造成重复重排。resize 会让 epubjs 以当前 location 重新 display。
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(onResize);
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
    if (wm && target) {
      const manager = renditionRef.current?.manager;
      const view = manager?.views?.all?.().find((item) => item.section.index === target.sectionIndex);
      if (view) {
        const top = tocTargetTop(view, target);
        const stage = manager?.container;
        if (top !== null && stage) {
          stage.scrollTop += top - stage.getBoundingClientRect().top - 16;
          wm.scheduleSync();
          return;
        }
        // 目标在当前窗口内但锚点暂不可访问时，至少滚到该 section 顶部。
        wm.scrollToSection(target.sectionIndex);
        return;
      }
    }
    // 目标 section 不在窗口内：让 epubjs 定位到目标锚点，再由窗口管理器
    // 按用户设置补齐前后章节并回收窗口外内容。
    void withTimeout(Promise.resolve(renditionRef.current?.display(target?.href ?? href)), OPEN_TIMEOUT_MS)
      .then(() => windowRef.current?.sync())
      .catch(() => undefined);
  };

  if (failed) {
    return (
      <section className="state state-epub active" aria-label="EPUB 解析失败">
        <div className="welcome">
          <span className="welcome-title">EPUB 解析失败，请确认文件未加密或损坏</span>
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
