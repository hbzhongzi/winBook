import { describe, it, expect } from "vitest";
import { extOf, isSupportedExt } from "../dropOpen";

const ALLOWED = ["epub", "pdf", "txt"];

describe("extOf", () => {
  it("取小写扩展名（不含点）", () => {
    expect(extOf("a.epub")).toBe("epub");
    expect(extOf("book.EPUB")).toBe("epub");
    expect(extOf("path/to/book.PDF")).toBe("pdf");
  });
  it("无扩展名或尾点返回空串", () => {
    expect(extOf("noext")).toBe("");
    expect(extOf("trailing.")).toBe("");
  });
});

describe("isSupportedExt", () => {
  it("白名单内返回 true（大小写不敏感）", () => {
    expect(isSupportedExt("x.epub", ALLOWED)).toBe(true);
    expect(isSupportedExt("x.EPUB", ALLOWED)).toBe(true);
    expect(isSupportedExt("x.pdf", ALLOWED)).toBe(true);
    expect(isSupportedExt("x.txt", ALLOWED)).toBe(true);
  });
  it("白名单外 / 无扩展名返回 false", () => {
    expect(isSupportedExt("x.mobi", ALLOWED)).toBe(false);
    expect(isSupportedExt("x.zip", ALLOWED)).toBe(false);
    expect(isSupportedExt("x.png", ALLOWED)).toBe(false);
    expect(isSupportedExt("noext", ALLOWED)).toBe(false);
  });
  it("空白名单一律拒绝", () => {
    expect(isSupportedExt("x.epub", [])).toBe(false);
  });
});
