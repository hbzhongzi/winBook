// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  DEFAULT_HOTKEYS,
  HOTKEY_ACTIONS,
  MAX_KEYS_PER_ACTION,
  cloneHotkeyMap,
  hotkeyKeyLabel,
  normalizeHotkeyKey,
  normalizeHotkeyMap,
  resolveHotkeyAction,
} from "../readerHotkeys";

describe("readerHotkeys：resolveHotkeyAction", () => {
  it("默认键位映射到正确动作", () => {
    const m = DEFAULT_HOTKEYS;
    expect(resolveHotkeyAction("ArrowLeft", m)).toBe("prev");
    expect(resolveHotkeyAction("PageUp", m)).toBe("prev");
    expect(resolveHotkeyAction("ArrowUp", m)).toBe("prev");
    expect(resolveHotkeyAction("ArrowRight", m)).toBe("next");
    expect(resolveHotkeyAction("PageDown", m)).toBe("next");
    expect(resolveHotkeyAction(" ", m)).toBe("next");
    expect(resolveHotkeyAction("ArrowDown", m)).toBe("next");
    expect(resolveHotkeyAction("Home", m)).toBe("home");
    expect(resolveHotkeyAction("End", m)).toBe("end");
  });

  it("未绑定键返回 null", () => {
    expect(resolveHotkeyAction("a", DEFAULT_HOTKEYS)).toBeNull();
    expect(resolveHotkeyAction("Escape", DEFAULT_HOTKEYS)).toBeNull();
    expect(resolveHotkeyAction("F5", DEFAULT_HOTKEYS)).toBeNull();
  });

  it("自定义键位生效", () => {
    const m = { prev: ["j"], next: ["k"], home: ["Home"], end: ["End"] };
    expect(resolveHotkeyAction("j", m)).toBe("prev");
    expect(resolveHotkeyAction("k", m)).toBe("next");
    expect(resolveHotkeyAction("ArrowLeft", m)).toBeNull(); // 覆盖默认后旧键失效
  });

  it("同键双绑时按 canonical 顺序取靠前动作（防御性，normalize 层已消解）", () => {
    const m = { prev: ["a"], next: ["a"], home: ["Home"], end: ["End"] };
    expect(resolveHotkeyAction("a", m)).toBe("prev");
  });
});

describe("readerHotkeys：normalizeHotkeyKey", () => {
  it("Spacebar 规范化为空格", () => {
    expect(normalizeHotkeyKey("Spacebar")).toBe(" ");
    expect(normalizeHotkeyKey(" ")).toBe(" ");
  });

  it("纯修饰键/锁定键拒绝", () => {
    for (const k of ["Shift", "Control", "Alt", "Meta", "CapsLock", "NumLock", "OS"]) {
      expect(normalizeHotkeyKey(k)).toBeNull();
    }
  });

  it("非字符串/空串/超长拒绝", () => {
    expect(normalizeHotkeyKey(42)).toBeNull();
    expect(normalizeHotkeyKey(undefined)).toBeNull();
    expect(normalizeHotkeyKey("")).toBeNull();
    expect(normalizeHotkeyKey("x".repeat(25))).toBeNull();
  });

  it("普通字符与命名键保留", () => {
    expect(normalizeHotkeyKey("a")).toBe("a");
    expect(normalizeHotkeyKey("ArrowLeft")).toBe("ArrowLeft");
    expect(normalizeHotkeyKey("PageDown")).toBe("PageDown");
  });
});

describe("readerHotkeys：normalizeHotkeyMap", () => {
  it("默认表规范化后与 DEFAULT_HOTKEYS 相等", () => {
    expect(normalizeHotkeyMap(DEFAULT_HOTKEYS)).toEqual(DEFAULT_HOTKEYS);
  });

  it("逐动作过滤修饰键、去重、截断到上限", () => {
    const out = normalizeHotkeyMap({
      prev: ["Shift", "a", "a", "b", "c", "d", "e", "f"],
      next: DEFAULT_HOTKEYS.next,
      home: DEFAULT_HOTKEYS.home,
      end: DEFAULT_HOTKEYS.end,
    });
    expect(out.prev).toEqual(["a", "b", "c", "d"]);
    expect(out.prev.length).toBe(MAX_KEYS_PER_ACTION);
  });

  it("跨动作冲突按 canonical 顺序先到先得", () => {
    const out = normalizeHotkeyMap({ prev: ["x"], next: ["x"], home: ["x"], end: ["x"] });
    expect(out.prev).toEqual(["x"]);
    expect(out.next).toEqual(DEFAULT_HOTKEYS.next);
    expect(out.home).toEqual(DEFAULT_HOTKEYS.home);
    expect(out.end).toEqual(DEFAULT_HOTKEYS.end);
  });

  it("空动作回落默认（防变砖）", () => {
    const out = normalizeHotkeyMap({ prev: [], next: [], home: [], end: [] });
    expect(out).toEqual(DEFAULT_HOTKEYS);
  });

  it("非数组/垃圾输入整体回落默认", () => {
    expect(normalizeHotkeyMap(null)).toEqual(DEFAULT_HOTKEYS);
    expect(normalizeHotkeyMap("nope")).toEqual(DEFAULT_HOTKEYS);
    expect(normalizeHotkeyMap({ prev: "a", next: 42, home: null, end: {} })).toEqual(DEFAULT_HOTKEYS);
  });

  it("输出为四个动作的完整结构", () => {
    const out = normalizeHotkeyMap({ prev: ["a"] });
    for (const a of HOTKEY_ACTIONS) {
      expect(Array.isArray(out[a])).toBe(true);
      expect(out[a].length).toBeGreaterThan(0);
    }
  });
});

describe("readerHotkeys：clone / label", () => {
  it("cloneHotkeyMap 深拷贝，改克隆不影响原表", () => {
    const c = cloneHotkeyMap(DEFAULT_HOTKEYS);
    c.prev.push("zzz");
    expect(DEFAULT_HOTKEYS.prev).not.toContain("zzz");
  });

  it("hotkeyKeyLabel 空格转可读文案", () => {
    expect(hotkeyKeyLabel(" ")).toBe("空格");
    expect(hotkeyKeyLabel("ArrowLeft")).toBe("ArrowLeft");
    expect(hotkeyKeyLabel("a")).toBe("a");
  });
});
