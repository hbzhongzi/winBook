// EPUB 章节窗口化管理。
//
// 背景：epubjs 的 ContinuousViewManager.check() 会沿滚动方向无限追加章节
// （epub.js 10934-11023 行），trim() 只保留"当前可见 + 相邻一节"，
// 都不满足「同时最多保留 N 章」的需求。长书（如 30+ 章）会把整本书的 iframe
// 全部创建出来，内存与首屏时间随章节数线性增长。
//
// 本模块在 ContinuousViewManager 之上做一层窗口化：
// - 以"当前可见章节"为中心，维护 [center-pre, center+pre] 的窗口
// - 滚动时按需向前/向后补齐窗口，窗口外的 view 销毁回收（DOM + iframe 一并移除）
// - 回收"上方"章节时必须补偿 scrollTop，否则视口会跳走
//
// 之所以不用 epubjs 内置 check()：它按 offset（像素）而非章节数决定加载，
// 且没有"回收"逻辑（trim 的保留策略与 offset 耦合，对预加载数不可控）。

/** epubjs IframeView 的最小接口 */
export type EpubView = {
  section: { index: number; href: string };
  element: HTMLElement;
  display?: (request?: unknown) => Promise<unknown> | unknown;
  show?: () => void;
  displayed?: boolean;
  shown?: boolean;
  destroy?: () => void;
  bounds?: () => { top: number; height: number; left: number; width: number };
};

export type ViewCollection = {
  all: () => EpubView[];
  first: () => EpubView | undefined;
  last: () => EpubView | undefined;
  indexOf: (v: EpubView) => number;
  remove: (v: EpubView) => void;
};

export type WindowManagerOpts = {
  /** epubjs manager（ContinuousViewManager 实例） */
  manager: {
    views: ViewCollection;
    container: HTMLElement;
    append: (section: unknown) => Promise<EpubView> | EpubView;
    prepend: (section: unknown) => Promise<EpubView> | EpubView;
    request?: unknown;
    q?: { enqueue: (fn: () => unknown) => unknown };
  };
  /** 书脊，用于取相邻章节 */
  spine: {
    get: (target: string | number) => { index: number } | undefined;
  };
  /** 由 spine 派生的相邻关系（epubjs Section 有 prev/next，这里用泛型访问避免耦合类型） */
  sectionNav: {
    prev: (section: unknown) => unknown;
    next: (section: unknown) => unknown;
  };
  /** 获取当前预加载章节数（设置项，动态读取） */
  getPreload: () => number;
  /** 当前可见章节回调（用于侧边栏高亮联动，也包含同一 XHTML 内的锚点滚动） */
  onVisibleChange?: (sectionIndex: number, view: EpubView) => void;
  /** DEBUG 临时：窗口状态快照回调 */
  onSyncState?: (state: string) => void;
};

export type WindowAnchor = { sectionIndex: number; ratio: number };

export type WindowManager = {
  /** 依据当前滚动位置重新计算窗口（滚动时调用，内部节流） */
  scheduleSync: () => void;
  /** 立即同步一次 */
  sync: () => void;
  /** 滚到指定章节（侧边栏点击时调用） */
  scrollToSection: (sectionIndex: number) => void;
  /** 视口锚点：可见章节下标 + 探针在该章内的比例（阅读位置上报/恢复用） */
  getAnchor: () => WindowAnchor | null;
  /** 销毁窗口管理器 */
  destroy: () => void;
};

/** 计算视口顶部所处的章节下标（views 数组下标） */
function findVisibleViewIndex(views: EpubView[], containerRect: { top: number; bottom: number }): number {
  // 视口中线比视口顶部更稳：章节边界恰好对齐顶部时不会误判上一章
  const probe = (containerRect.top + containerRect.bottom) / 2;
  let best = 0;
  for (let i = 0; i < views.length; i++) {
    const r = views[i].element.getBoundingClientRect();
    if (r.bottom <= probe) continue; // 该章完全在探针上方
    if (r.top <= probe) return i; // 探针落在该章范围内
    best = i; // 该章在探针下方，记为候选
    break;
  }
  return best;
}

export function createChapterWindow(opts: WindowManagerOpts): WindowManager {
  const { manager } = opts;
  const stage = manager.container;
  let destroyed = false;
  let syncing = false;
  let pending = false;
  let lastVisible = -1;

  /** 已加载的 view 是否都还在 DOM 中（epubjs 内部可能自行移除） */
  const liveViews = () => manager.views.all().filter((v) => v.element.isConnected);

  const discardView = (view: EpubView | undefined) => {
    if (!view) return;
    try {
      view.destroy?.();
    } catch {
      // Keep the collection consistent even if iframe cleanup throws.
    }
    manager.views.remove(view);
  };

  const appendAndDisplay = async (section: unknown): Promise<boolean> => {
    const result = await Promise.resolve(manager.append(section));
    const view = result as EpubView | undefined;
    try {
      if (view && typeof view.display === "function") {
        await Promise.resolve(view.display(manager.request));
      }
      // ContinuousViewManager.show() is normally called after its queued
      // display completes. Dynamic append/prepend bypasses that path.
      view?.show?.();
      return true;
    } catch {
      discardView(view);
      return false;
    }
  };

  const prependAndDisplay = async (section: unknown): Promise<boolean> => {
    const result = await Promise.resolve(manager.prepend(section));
    const view = result as EpubView | undefined;
    try {
      if (view && typeof view.display === "function") {
        await Promise.resolve(view.display(manager.request));
      }
      view?.show?.();
      return true;
    } catch {
      discardView(view);
      return false;
    }
  };

  const notifyVisible = (view: EpubView | null) => {
    if (!view) return;
    const idx = view.section.index;
    if (idx !== lastVisible) lastVisible = idx;
    // 即使 section 没变也要通知：同一 XHTML 内可能有多个目录锚点，
    // 侧栏高亮需要随着正文在该文件内的滚动继续更新。
    opts.onVisibleChange?.(idx, view);
  };

  /** 回收窗口外的 view。
   *  视口锚定：以中心章元素为锚，回收完成后按偏移差回补 scrollTop。
   *  Chromium 在移除上方内容时会 clamp scrollTop（实测被拉回 0），
   *  而直接加减被移除元素高度在 epubjs 异步重排下会算错，必须用锚点实测偏移。 */
  const evictOutside = (centerSectionIndex: number) => {
    const pre = Math.max(0, opts.getPreload());
    const views = manager.views.all();
    const centerPos = views.findIndex((v) => v.section.index === centerSectionIndex);
    if (centerPos < 0) return; // 中心章不在窗口内（异步期间被移除），本轮不回收
    const anchorEl = views[centerPos].element;
    const stageRect0 = stage.getBoundingClientRect();
    const anchorBefore = anchorEl.getBoundingClientRect().top - stageRect0.top;
    let removed = 0;
    // 从后往前遍历：manager.views.remove 内部会 splice，从后删不会打乱未处理的下标
    for (let i = views.length - 1; i >= 0; i--) {
      const v = views[i];
      if (i >= centerPos - pre && i <= centerPos + pre) continue;
      try {
        v.destroy?.();
      } catch {
        // 忽略销毁异常，继续回收其余 view
      }
      manager.views.remove(v);
      removed++;
    }
    if (removed > 0) {
      const after = anchorEl.getBoundingClientRect().top - stage.getBoundingClientRect().top;
      if (Math.abs(after - anchorBefore) > 1) {
        stage.scrollTop += after - anchorBefore;
      }
    }
    opts.onSyncState?.(
      `evict center=${centerSectionIndex} removed=${removed} ` +
      `anchor ${Math.round(anchorBefore)}->${Math.round(
        anchorEl.getBoundingClientRect().top - stage.getBoundingClientRect().top
      )} st=${Math.round(stage.scrollTop)}`
    );
  };

  /**
   * 补齐窗口：以中心章为基准，向上 prepend / 向下 append，
   * 直到中心左右各有 pre 章，或到达书首/书尾。
   *
   * 关键：用「中心章左右实际已加载的章数」判断是否够，而不是 views 数组下标差——
   * 下标差在有非线性/空壳章节时会失真，导致窗口看起来够了实际缺章。
   * 每轮都重新定位中心（prepend/append 会改变数组），保证补齐与回收基于同一基准。
   */
  const fillWindow = async (centerSectionIndex: number): Promise<boolean> => {
    const pre = Math.max(0, opts.getPreload());
    if (pre === 0) return false;
    let changed = false;
    /** 中心章在当前 views 数组中的下标；找不到返回 -1 */
    const posOf = (views: EpubView[], idx: number) =>
      views.findIndex((v) => v.section.index === idx);

    // 向下补齐：中心右侧已加载章数不足 pre 时 append
    for (let guard = 0; guard <= pre * 2; guard++) {
      const views = liveViews();
      if (views.length === 0) break;
      const pos = posOf(views, centerSectionIndex);
      if (pos < 0) break; // 中心章已不在窗口内（不应发生），放弃补齐
      if (views.length - 1 - pos >= pre) break; // 右侧已够
      const last = views[views.length - 1];
      const next = opts.sectionNav.next(last.section) as { index: number } | undefined;
      if (!next) break; // 已到书尾
      if (next.index <= last.section.index) break; // spine 非线性，防御性退出
      if (!(await appendAndDisplay(next))) break;
      changed = true;
    }

    // 向上补齐：中心左侧已加载章数不足 pre 时 prepend
    for (let guard = 0; guard <= pre * 2; guard++) {
      const views = liveViews();
      if (views.length === 0) break;
      const pos = posOf(views, centerSectionIndex);
      if (pos < 0) break;
      if (pos >= pre) break; // 左侧已够
      const first = views[0];
      const prev = opts.sectionNav.prev(first.section) as { index: number } | undefined;
      if (!prev) break; // 已到书首（无正文可补）
      if (prev.index >= first.section.index) break;
      // 视口锚定：记录当前中心章顶边相对 stage 顶边的偏移，prepend 完成后按此恢复。
      // 不能只记 scrollTop —— epubjs 的 view.display() 是异步的，期间
      // append/prepend 会触发重排与 scrollTop clamp，事后按旧数值恢复会错位
      // （真书实测：滚动几轮后 scrollTop 被重置为 0、正文空白）。
      const anchorEl = views[Math.min(pos, views.length - 1)].element;
      const anchorOffset = anchorEl.getBoundingClientRect().top - stage.getBoundingClientRect().top;
      if (!(await prependAndDisplay(prev))) break;
      // 锚点元素仍在 DOM 中（未回收），按偏移恢复视口位置
      const after = anchorEl.getBoundingClientRect().top - stage.getBoundingClientRect().top;
      if (Math.abs(after - anchorOffset) > 1) {
        stage.scrollTop += after - anchorOffset;
      }
      changed = true;
    }
    return changed;
  };

  /**
   * 窗口同步主流程：算出目标章节区间 → 补齐 → 回收。
   *
   * 设计要点：区间用「中心章在 spine 中的位置」表达（section.index 对连续 spine
   * 即可用；非线性 spine 由 next/prev 链保证不跳章），补齐与回收共用同一份区间，
   * 避免"补完又被裁"的震荡。补齐/回收的每个循环都重新定位中心下标，
   * 因为 prepend/append 会改变 views 数组。
   */
  const sync = () => {
    if (destroyed) return;
    if (syncing) {
      pending = true;
      return;
    }
    syncing = true;
    const views = liveViews();
    if (views.length === 0) {
      syncing = false;
      return;
    }
    const rect = stage.getBoundingClientRect();
    const centerIdx = findVisibleViewIndex(views, rect);
    const centerSectionIndex = views[Math.min(centerIdx, views.length - 1)].section.index;

    // 锁必须持有到异步补齐 + 回收全部完成，否则滚动中的多次 sync 会并发增删 view，
    // 表现为"正文突然空白且滚不动"。这里在 then/catch 里统一释放。
    const snap = (tag: string, vlist: EpubView[], c: number) => {
      opts.onSyncState?.(
        `${tag} pre=${opts.getPreload()} scrollTop=${Math.round(stage.scrollTop)} ` +
          `scrollH=${stage.scrollHeight} views=[${vlist.map((v) => v.section.index).join(",")}] ` +
          `center=${c}`
      );
    };
    snap("before-fill", views, centerSectionIndex);
    void fillWindow(centerSectionIndex)
      .then(() => {
        if (destroyed) return;
        const views2 = liveViews();
        if (views2.length === 0) {
          opts.onSyncState?.("after-fill views empty");
          return;
        }
        // 补齐后按视口真实位置重新判定可见章（prepend 可能改变它）
        const rect2 = stage.getBoundingClientRect();
        const c2 = findVisibleViewIndex(views2, rect2);
        const visible = views2[Math.min(c2, views2.length - 1)];
        notifyVisible(visible);
        snap("before-evict", views2, visible.section.index);
        // 以可见章为基准回收：左右各保留 pre 章
        evictOutside(visible.section.index);
        snap("after-evict", liveViews(), visible.section.index);
      })
      .catch(() => undefined)
      .then(() => {
        syncing = false;
        if (pending && !destroyed) {
          pending = false;
          scheduleSync();
        }
      });
  };

  // 滚动节流：连续滚动时 120ms 一次足够，避免频繁增删 iframe
  let timer: ReturnType<typeof setTimeout> | null = null;
  const scheduleSync = () => {
    if (destroyed) return;
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      sync();
    }, 120);
  };

  const onScroll = () => scheduleSync();
  stage.addEventListener("scroll", onScroll, { passive: true });

  const scrollToSection = (sectionIndex: number) => {
    const views = liveViews();
    const target = views.find((v) => v.section.index >= sectionIndex);
    if (!target) return;
    const rect = target.element.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    stage.scrollTop += rect.top - stageRect.top;
    scheduleSync();
  };

  /**
   * 视口锚点：与 findVisibleViewIndex 同一探针（视口中线），
   * ratio = 探针在可见章内的相对位置。用于阅读位置上报（章内比例，
   * 与窗口构成无关）与恢复时的精确定位。
   */
  const getAnchor = (): WindowAnchor | null => {
    const views = liveViews();
    if (views.length === 0) return null;
    const rect = stage.getBoundingClientRect();
    const idx = findVisibleViewIndex(views, rect);
    const view = views[Math.min(Math.max(idx, 0), views.length - 1)];
    if (!view) return null;
    const r = view.element.getBoundingClientRect();
    if (r.height <= 0) return null;
    const probe = (rect.top + rect.bottom) / 2;
    const ratio = Math.min(1, Math.max(0, (probe - r.top) / r.height));
    return { sectionIndex: view.section.index, ratio };
  };

  const destroy = () => {
    destroyed = true;
    stage.removeEventListener("scroll", onScroll);
    if (timer) clearTimeout(timer);
    timer = null;
  };

  return { scheduleSync, sync, scrollToSection, getAnchor, destroy };
}
