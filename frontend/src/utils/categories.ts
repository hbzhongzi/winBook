// 图书分类（v0.2.8 F27–F30）：预设分类模板 + 用户自定义分类 + 空分类不显示。
// 自定义分类清单独立存储于 localStorage 键 bookeditor.cats.v1；预设分类为代码常量、
// 不落盘且只读（D61）。图书侧只存分类名字符串（D64），不存 id。
// 实施口径见 doce/BookEditor-v0.2.8-书架分类与清空确认开发方案.md 第 3 章。

/** 初始分类模板（只读，不可删除/改名；D61） */
export const PRESET_CATEGORIES: string[] = ["小说", "技术", "资料", "诗集"];

/** 未归类图书的兜底分类名 */
export const UNCLASSIFIED = "未分类";
/** 书架页签「全部」的哨兵名（非真实分类） */
export const ALL_TAB = "全部";

export const CATS_KEY = "bookeditor.cats.v1";
/** 分类名长度上限（防止 UI 溢出，D62） */
export const CAT_NAME_MAX = 12;

type CatsFile = { version: 1; custom: string[] };
type Listener = (custom: string[]) => void;

const listeners = new Set<Listener>();

/** 保留字：与页签语义冲突，禁止作为分类名（D62） */
const RESERVED = [UNCLASSIFIED, ALL_TAB];

export type CatResult = { ok: true; name: string } | { ok: false; reason: string };

/** 供派生函数使用的最小条目形状（避免与 library 循环依赖） */
export type CatLike = { cat?: string };

function normalizeCustom(raw: unknown): string[] {
  if (!raw || typeof raw !== "object") return [];
  const file = raw as Partial<CatsFile>;
  if (file.version !== 1 || !Array.isArray(file.custom)) return [];
  const out: string[] = [];
  for (const item of file.custom) {
    if (typeof item !== "string") continue;
    const name = item.trim();
    if (!name || name.length > CAT_NAME_MAX) continue;
    if (RESERVED.includes(name)) continue;
    if (PRESET_CATEGORIES.includes(name)) continue; // 与预设重名的脏数据丢弃
    if (out.includes(name)) continue;
    out.push(name);
  }
  return out;
}

/** 读取自定义分类（校验 + 去重；损坏 JSON / version 不符回落 []） */
export function loadCustomCategories(): string[] {
  try {
    const text = localStorage.getItem(CATS_KEY);
    if (!text) return [];
    return normalizeCustom(JSON.parse(text));
  } catch {
    return [];
  }
}

/** 预设 + 自定义（页签/菜单的完整候选集，不含「未分类」「全部」哨兵） */
export function allCategories(custom: string[] = loadCustomCategories()): string[] {
  return [...PRESET_CATEGORIES, ...custom];
}

/** 名称校验：非空、长度、保留字、重名（D62） */
export function validateCategoryName(
  name: string,
  custom: string[] = loadCustomCategories()
): CatResult {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return { ok: false, reason: "分类名不能为空" };
  if (trimmed.length > CAT_NAME_MAX) {
    return { ok: false, reason: `分类名不能超过 ${CAT_NAME_MAX} 个字符` };
  }
  if (RESERVED.includes(trimmed)) return { ok: false, reason: `「${trimmed}」为保留名称` };
  if (PRESET_CATEGORIES.includes(trimmed)) return { ok: false, reason: "与预设分类重名" };
  if (custom.includes(trimmed)) return { ok: false, reason: "分类已存在" };
  return { ok: true, name: trimmed };
}

function persist(custom: string[]): string[] {
  try {
    const file: CatsFile = { version: 1, custom };
    localStorage.setItem(CATS_KEY, JSON.stringify(file));
  } catch {
    // 隐私模式/存储不可用时静默降级为内存态
  }
  listeners.forEach((fn) => fn(custom));
  return custom;
}

/** 新建自定义分类；重名/保留字/超长返回 reason（UI 直接提示） */
export function addCategory(name: string): CatResult {
  const custom = loadCustomCategories();
  const v = validateCategoryName(name, custom);
  if (!v.ok) return v;
  persist([...custom, v.name]);
  return { ok: true, name: v.name };
}

/** 删除自定义分类；预设分类不可删（D61）。返回是否删除成功 */
export function removeCategory(name: string): boolean {
  const custom = loadCustomCategories();
  if (!custom.includes(name)) return false;
  persist(custom.filter((c) => c !== name));
  return true;
}

/** 重命名自定义分类；预设不可改名。调用方需同步改写条目（library.setEntriesCategory） */
export function renameCategory(oldName: string, newName: string): CatResult {
  const custom = loadCustomCategories();
  if (!custom.includes(oldName)) return { ok: false, reason: "仅自定义分类可改名" };
  const v = validateCategoryName(newName, custom.filter((c) => c !== oldName));
  if (!v.ok) return v;
  persist(custom.map((c) => (c === oldName ? v.name : c)));
  return { ok: true, name: v.name };
}

/** 订阅自定义分类变化，返回取消订阅函数 */
export function subscribeCategories(fn: Listener): () => void {
  listeners.add(fn);
  const onStorage = (ev: StorageEvent) => {
    if (ev.key === CATS_KEY) fn(loadCustomCategories());
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * 可见分类页签（F30 空分类不显示）：顺序为「未分类」→ 预设 → 自定义，
 * 仅保留 count > 0。「全部」由调用方单独渲染（恒显示）。
 */
export function visibleCategories(
  entries: CatLike[],
  custom: string[] = loadCustomCategories()
): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const e of entries) {
    const key = e.cat?.trim() ? e.cat.trim() : UNCLASSIFIED;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [UNCLASSIFIED, ...allCategories(custom)]
    .map((name) => ({ name, count: counts.get(name) ?? 0 }))
    .filter((c) => c.count > 0);
}
