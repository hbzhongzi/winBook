// 阅读快捷键键位模型（v0.2.5 F22/F24）。
// 动作 → KeyboardEvent.key 数组；window 派发层反查当前按键属于哪个动作。
// 自定义经设置面板写入 Settings.hotkeys；非法/冲突值在 normalize 层消解。
// 本模块为纯函数，无 DOM/React 依赖，单测直接覆盖。

export type HotkeyAction = "prev" | "next" | "home" | "end";
export type HotkeyMap = Record<HotkeyAction, string[]>;

/** canonical 顺序：跨动作冲突消解时先到先得（prev 优先于 next …） */
export const HOTKEY_ACTIONS: HotkeyAction[] = ["prev", "next", "home", "end"];

/** 面板/提示展示名 */
export const HOTKEY_ACTION_LABELS: Record<HotkeyAction, string> = {
  prev: "上一页 / 上一屏",
  next: "下一页 / 下一屏",
  home: "首页",
  end: "末页",
};

export const DEFAULT_HOTKEYS: HotkeyMap = {
  prev: ["ArrowLeft", "PageUp", "ArrowUp"],
  next: ["ArrowRight", "PageDown", " ", "ArrowDown"],
  home: ["Home"],
  end: ["End"],
};

/** 纯修饰键/锁定键：不作为绑定值（按下它们本身不应触发动作） */
const MODIFIER_KEYS = new Set([
  "Shift",
  "Control",
  "Alt",
  "Meta",
  "CapsLock",
  "NumLock",
  "ScrollLock",
  "FnLock",
  "Fn",
  "OS",
]);

/** 每个动作最多绑定键数（防误操作堆积） */
export const MAX_KEYS_PER_ACTION = 4;

/** 单键长度上限：挡掉手改存储写入的超长垃圾值 */
const MAX_KEY_LEN = 24;

/** 规范化单个键值：合法返回 key，非法返回 null */
export function normalizeHotkeyKey(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const key = v === "Spacebar" ? " " : v; // 旧 Chrome/Spacebar 兼容
  if (!key || key.length > MAX_KEY_LEN) return null;
  if (MODIFIER_KEYS.has(key)) return null;
  return key;
}

/**
 * 反查动作：key 命中哪个动作，未命中返回 null。
 * 修饰键组合（Ctrl/Meta/Alt 按下）由调用方先行拦截，本函数只看 key 值。
 */
export function resolveHotkeyAction(key: string, map: HotkeyMap): HotkeyAction | null {
  for (const action of HOTKEY_ACTIONS) {
    if (map[action]?.includes(key)) return action;
  }
  return null;
}

/** 深拷贝：避免 DEFAULT_HOTKEYS 被引用污染 */
export function cloneHotkeyMap(map: HotkeyMap): HotkeyMap {
  return {
    prev: [...(map.prev ?? [])],
    next: [...(map.next ?? [])],
    home: [...(map.home ?? [])],
    end: [...(map.end ?? [])],
  };
}

/**
 * 规范化整张键位表：
 * 1. 逐动作：非法键过滤、去重、截断到 MAX_KEYS_PER_ACTION；
 * 2. 跨动作冲突消解：按 canonical 顺序先到先得，后到者剔除该键
 *    （存储态被手改出同键双绑时，保证确定性与单触发）；
 * 3. 动作为空时回落默认键位：手改存储/迁移异常不会让动作「变砖」
 *    （UI 层禁止删空最后一个键，正常路径不会触发本兜底）。
 */
export function normalizeHotkeyMap(raw: unknown): HotkeyMap {
  const src = (raw ?? {}) as Partial<Record<HotkeyAction, unknown>>;
  const out: HotkeyMap = { prev: [], next: [], home: [], end: [] };
  const taken = new Set<string>();
  for (const action of HOTKEY_ACTIONS) {
    const list = Array.isArray(src[action]) ? (src[action] as unknown[]) : [];
    const keys: string[] = [];
    for (const item of list) {
      const key = normalizeHotkeyKey(item);
      if (!key) continue;
      if (taken.has(key)) continue; // 已被靠前动作占用
      if (keys.includes(key)) continue;
      keys.push(key);
      taken.add(key);
      if (keys.length >= MAX_KEYS_PER_ACTION) break;
    }
    out[action] = keys.length > 0 ? keys : [...DEFAULT_HOTKEYS[action]];
  }
  return out;
}

/** 键位展示名：空格等不可见键转可读文案（chips / 录制提示用） */
export function hotkeyKeyLabel(key: string): string {
  if (key === " ") return "空格";
  return key;
}
