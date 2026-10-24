// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createChapterWindow } from "../chapterWindow";

/** 构造一个最小可用的 view 集合，模拟 epubjs 的 Views 容器 */
function makeStage(): HTMLElement {
  const stage = document.createElement("div");
  document.body.appendChild(stage);
  // jsdom 不实现布局，给固定尺寸让 getBoundingClientRect 有确定值
  stage.getBoundingClientRect = () =>
    ({ top: 0, bottom: 600, left: 0, right: 800, width: 800, height: 600, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  Object.defineProperty(stage, "clientHeight", { value: 600, configurable: true });
  Object.defineProperty(stage, "scrollHeight", { value: 6000, configurable: true });
  stage.scrollTop = 0;
  return stage;
}

/** 构造 view：section.index 递增 */
function makeViews(indices: number[] = []) {
  return indices.map((idx) => ({
    section: { index: idx, href: `s${idx}.xhtml` },
    element: document.createElement("div"),
    destroy: vi.fn(),
  }));
}

let stageRef: { scrollTop: number } = { scrollTop: 0 };

/** 模拟 manager：append/prepend 从 sections 池取章，views 提供 first/last/indexOf/remove */
function makeManager(initial: number[], pool: number[]) {
  const stage = makeStage();
  const container = stage;
  const destroyed: number[] = [];
  const displayed: number[] = [];
  const shown: number[] = [];
  const viewsArr: ReturnType<typeof makeViews> = [];

  /** 为 viewsArr 中每个 view 按当前下标挂上反映 stage.scrollTop 的 rect */
  const attach = () => {
    viewsArr.forEach((v, i) => {
      v.element.getBoundingClientRect = () => {
        const top = i * 1000 - container.scrollTop;
        return {
          top, bottom: top + 1000, left: 0, right: 800,
          width: 800, height: 1000, x: 0, y: top, toJSON: () => ({}),
        } as DOMRect;
      };
    });
  };

  const mkView = (section: { index: number; href: string }) => {
    const el = document.createElement("div");
    // view 的 element 必须挂在文档中：窗口管理器用 isConnected 过滤有效 view
    container.appendChild(el);
    const v = {
      section,
      element: el,
      destroy: vi.fn(() => destroyed.push(section.index)),
      display: vi.fn(() => {
        displayed.push(section.index);
        return Promise.resolve();
      }),
      show: vi.fn(() => shown.push(section.index)),
    };
    return v as unknown as (typeof viewsArr)[number];
  };

  initial.forEach((idx) => viewsArr.push(mkView({ index: idx, href: `s${idx}.xhtml` })));
  attach();

  const manager = {
    container,
    views: {
      all: () => viewsArr.slice(),
      first: () => viewsArr[0],
      last: () => viewsArr[viewsArr.length - 1],
      indexOf: (v: (typeof viewsArr)[number]) => viewsArr.indexOf(v),
      remove: (v: (typeof viewsArr)[number]) => {
        const i = viewsArr.indexOf(v);
        if (i > -1) viewsArr.splice(i, 1);
        attach();
      },
    },
    append: (section: { index: number; href: string }) => {
      const v = mkView(section);
      viewsArr.push(v);
      attach();
      return Promise.resolve(v);
    },
    prepend: (section: { index: number; href: string }) => {
      const v = mkView(section);
      viewsArr.unshift(v);
      attach();
      return Promise.resolve(v);
    },
  };
  void pool;
  return { manager, viewsArr, destroyed, displayed, shown, stage, attach };
}

describe("createChapterWindow", () => {
  let wm: ReturnType<typeof createChapterWindow> | null = null;
  beforeEach(() => {
    stageRef = { scrollTop: 0 };
    vi.useFakeTimers();
  });
  afterEach(() => {
    wm?.destroy();
    wm = null;
    vi.useRealTimers();
  });

  it("同步后回调当前可见章节的 spine index", async () => {
    vi.useRealTimers();
    const { manager } = makeManager([1, 2, 3], [0, 1, 2, 3, 4, 5]);
    const seen: number[] = [];
    wm = createChapterWindow({
      manager: manager as never,
      spine: { get: () => undefined },
      sectionNav: {
        prev: (s) => ({ index: (s as { index: number }).index - 1, href: "" }),
        next: (s) => ({ index: (s as { index: number }).index + 1, href: "" }),
      },
      getPreload: () => 0,
      onVisibleChange: (i) => seen.push(i),
    });
    wm.sync();
    // sync 内部走 Promise（补齐 → 回调 → 回收），需等一拍
    await new Promise((r) => setTimeout(r, 30));
    // 视口 top=0、bottom=600，中线 300 落在 index 2 的区间（top=1000? 否）——
    // 首章 top=0..1000 覆盖中线，故应为 index 1
    expect(seen[0]).toBe(1);
  });

  it("同一 XHTML 内继续滚动时重复通知可见 view", async () => {
    vi.useRealTimers();
    const { manager, stage } = makeManager([2], [2]);
    const seen: number[] = [];
    wm = createChapterWindow({
      manager: manager as never,
      spine: { get: () => undefined },
      sectionNav: {
        prev: () => null,
        next: () => null,
      },
      getPreload: () => 0,
      onVisibleChange: (index) => seen.push(index),
    });

    wm.sync();
    await new Promise((r) => setTimeout(r, 30));
    stage.scrollTop = 320;
    wm.sync();
    await new Promise((r) => setTimeout(r, 30));

    // section.index 没变，但调用方仍需获得第二次通知来更新同一文件内的锚点高亮。
    expect(seen).toEqual([2, 2]);
  });

  it("预加载数 > 0 时向上向下补齐窗口", async () => {
    vi.useRealTimers();
    // 初始仅章 3，pre=2 → 窗口应补齐为 章1..章5（中心章3 前后各 2 章）
    const { manager, viewsArr } = makeManager([3], [1, 2, 3, 4, 5, 6]);
    wm = createChapterWindow({
      manager: manager as never,
      spine: { get: () => undefined },
      sectionNav: {
        prev: (s) => {
          const i = (s as { index: number }).index - 1;
          return i >= 1 ? { index: i, href: "" } : null;
        },
        next: (s) => {
          const i = (s as { index: number }).index + 1;
          return i <= 6 ? { index: i, href: "" } : null;
        },
      },
      getPreload: () => 2,
    });
    wm.sync();
    await new Promise((r) => setTimeout(r, 60));
    const idxs = viewsArr.map((v) => v.section.index).sort((a, b) => a - b);
    expect(idxs).toContain(3); // 中心章必须在
    expect(idxs.length).toBeLessThanOrEqual(2 * 2 + 1); // 窗口不超过 2*pre+1
    expect(idxs.length).toBeGreaterThanOrEqual(3); // 至少补到 pre 级别
  });

  it("窗口不超过 2*pre+1 章（上限约束）", async () => {
    vi.useRealTimers();
    // 初始已加载 6 章，pre=1 → 同步后应回收多余章节，只留 3 章
    const { manager, viewsArr } = makeManager([1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 6]);
    wm = createChapterWindow({
      manager: manager as never,
      spine: { get: () => undefined },
      sectionNav: {
        prev: (s) => {
          const i = (s as { index: number }).index - 1;
          return i >= 1 ? { index: i, href: "" } : null;
        },
        next: (s) => {
          const i = (s as { index: number }).index + 1;
          return i <= 6 ? { index: i, href: "" } : null;
        },
      },
      getPreload: () => 1,
    });
    wm.sync();
    await new Promise((r) => setTimeout(r, 60));
    const idxs = viewsArr.map((v) => v.section.index);
    expect(idxs.length).toBeLessThanOrEqual(2 * 1 + 1);
  });

  it("dynamic window calls display for appended views", async () => {
    vi.useRealTimers();
    const { manager, displayed, shown } = makeManager([2], [1, 2, 3]);
    wm = createChapterWindow({
      manager: manager as never,
      spine: { get: () => undefined },
      sectionNav: {
        prev: () => null,
        next: (s) => ({ index: (s as { index: number }).index + 1, href: "" }),
      },
      getPreload: () => 1,
    });
    wm.sync();
    await new Promise((r) => setTimeout(r, 60));
    expect(displayed).toEqual([3]);
    expect(shown).toEqual([3]);
  });

  it("中心章靠近书尾时向上补齐而不越界", async () => {
    vi.useRealTimers();
    // 初始 [3,4]，视口在顶部 → 中心章 3，pre=2 → 窗口 [1..5] 但书尾到 4
    const { manager, viewsArr } = makeManager([3, 4], [1, 2, 3, 4]);
    wm = createChapterWindow({
      manager: manager as never,
      spine: { get: () => undefined },
      sectionNav: {
        prev: (s) => {
          const i = (s as { index: number }).index - 1;
          return i >= 1 ? { index: i, href: "" } : null;
        },
        next: (s) => {
          const i = (s as { index: number }).index + 1;
          return i <= 4 ? { index: i, href: "" } : null;
        },
      },
      getPreload: () => 2,
    });
    wm.sync();
    await new Promise((r) => setTimeout(r, 60));
    const idxs = viewsArr.map((v) => v.section.index).sort((a, b) => a - b);
    // 书尾为章 4，不会越界加载不存在的章节
    expect(Math.max(...idxs)).toBeLessThanOrEqual(4);
    expect(idxs.length).toBeLessThanOrEqual(2 * 2 + 1);
  });

  it("scrollToSection 把目标章节滚到视口", () => {
    const { manager, stage } = makeManager([1, 2, 3], [1, 2, 3]);
    wm = createChapterWindow({
      manager: manager as never,
      spine: { get: () => undefined },
      sectionNav: {
        prev: (s) => ({ index: (s as { index: number }).index - 1, href: "" }),
        next: (s) => ({ index: (s as { index: number }).index + 1, href: "" }),
      },
      getPreload: () => 0,
    });
    wm.scrollToSection(3);
    // 第 3 章 top = 2*1000 = 2000，减 scrollTop 后应等于 stage top（0）
    expect(stage.scrollTop).toBe(2000);
  });

  it("回收窗口外的章节", async () => {
    vi.useRealTimers();
    const { manager, viewsArr, destroyed, stage } = makeManager([1, 2, 3, 4, 5], [1, 2, 3, 4, 5]);
    stage.scrollTop = 0;
    wm = createChapterWindow({
      manager: manager as never,
      spine: { get: () => undefined },
      sectionNav: {
        prev: (s) => ({ index: (s as { index: number }).index - 1, href: "" }),
        next: (s) => ({ index: (s as { index: number }).index + 1, href: "" }),
      },
      getPreload: () => 0,
    });
    // 中心在第 3 章（index 3，视口中线 300 落在 top=2000..3000）
    stage.scrollTop = 2300;
    wm.sync();
    await new Promise((r) => setTimeout(r, 50));
    const remain = viewsArr.map((v) => v.section.index).sort((a, b) => a - b);
    // 预加载 0 → 只保留当前可见章
    expect(remain).toEqual([3]);
    // 回收确实销毁了 view
    expect(destroyed.length).toBeGreaterThan(0);
  });

  it("预加载章节数为 0 时不额外加载", async () => {
    vi.useRealTimers();
    const { manager, viewsArr } = makeManager([2], [1, 2, 3]);
    wm = createChapterWindow({
      manager: manager as never,
      spine: { get: () => undefined },
      sectionNav: {
        prev: () => ({ index: 1, href: "" }),
        next: () => ({ index: 3, href: "" }),
      },
      getPreload: () => 0,
    });
    wm.sync();
    await new Promise((r) => setTimeout(r, 30));
    expect(viewsArr.map((v) => v.section.index)).toEqual([2]);
  });

  it("getAnchor：顶部时返回首章与章内比例", () => {
    const { manager, stage } = makeManager([1, 2, 3], [1, 2, 3]);
    wm = createChapterWindow({
      manager: manager as never,
      spine: { get: () => undefined },
      sectionNav: { prev: () => null, next: () => null },
      getPreload: () => 0,
    });
    stage.scrollTop = 0;
    // 视口中线 300 落在章 1（top=0..1000），比例 0.3
    expect(wm.getAnchor()).toEqual({ sectionIndex: 1, ratio: 0.3 });
  });

  it("getAnchor：滚动后跟随可见章节", () => {
    const { manager, stage } = makeManager([1, 2, 3, 4, 5], [1, 2, 3, 4, 5]);
    wm = createChapterWindow({
      manager: manager as never,
      spine: { get: () => undefined },
      sectionNav: { prev: () => null, next: () => null },
      getPreload: () => 0,
    });
    stage.scrollTop = 2300;
    // 各章 top：-2300/-1300/-300/700/1700，中线 300 落在章 3，比例 (300+300)/1000=0.6
    expect(wm.getAnchor()).toEqual({ sectionIndex: 3, ratio: 0.6 });
  });

  it("getAnchor：无 views 时返回 null", () => {
    const { manager } = makeManager([], []);
    wm = createChapterWindow({
      manager: manager as never,
      spine: { get: () => undefined },
      sectionNav: { prev: () => null, next: () => null },
      getPreload: () => 0,
    });
    expect(wm.getAnchor()).toBeNull();
  });
});
