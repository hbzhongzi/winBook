import { describe, expect, it } from "vitest";
import { toAppError } from "../appError";

// 错误码契约见落地说明文档 5.2：Go 侧 "CODE: message" 前缀，前端统一解析

describe("toAppError", () => {
  it("解析带前缀的字符串错误", () => {
    expect(toAppError("FILE_TOO_LARGE: 文件超过 100MB 限制")).toEqual({
      code: "FILE_TOO_LARGE",
      message: "文件超过 100MB 限制",
    });
  });

  it("解析 Error 对象的 message", () => {
    expect(toAppError(new Error("UNSUPPORTED_FORMAT: 暂不支持 .mobi 格式"))).toEqual({
      code: "UNSUPPORTED_FORMAT",
      message: "暂不支持 .mobi 格式",
    });
  });

  it("保留 message 中的冒号与后续内容", () => {
    expect(toAppError("READ_FAILED: 打开文件对话框失败: boom")).toEqual({
      code: "READ_FAILED",
      message: "打开文件对话框失败: boom",
    });
  });

  it("保留多行 message", () => {
    const r = toAppError("PARSE_FAILED: 第一行\n第二行");
    expect(r.code).toBe("PARSE_FAILED");
    expect(r.message).toBe("第一行\n第二行");
  });

  it("去除首尾空白", () => {
    expect(toAppError("  FILE_NOT_FOUND: x  ")).toEqual({
      code: "FILE_NOT_FOUND",
      message: "x",
    });
  });

  it("无前缀错误落入 UNKNOWN 并保留原文", () => {
    expect(toAppError("something broke")).toEqual({
      code: "UNKNOWN",
      message: "something broke",
    });
  });

  it("小写开头的伪码不算前缀", () => {
    expect(toAppError("file_too_large: nope")).toEqual({
      code: "UNKNOWN",
      message: "file_too_large: nope",
    });
  });

  it("非 Error 非字符串输入兜底为 UNKNOWN", () => {
    expect(toAppError(42)).toEqual({ code: "UNKNOWN", message: "42" });
    expect(toAppError(null)).toEqual({ code: "UNKNOWN", message: "null" });
    expect(toAppError({ code: "X", message: "y" })).toEqual({
      code: "UNKNOWN",
      message: "[object Object]",
    });
  });

  it("覆盖 5.2 表全部错误码的解析形状", () => {
    const codes = [
      "USER_CANCELED",
      "FILE_NOT_FOUND",
      "FILE_TOO_LARGE",
      "UNSUPPORTED_FORMAT",
      "READ_FAILED",
      "PARSE_FAILED",
      "UNKNOWN",
    ];
    for (const code of codes) {
      expect(toAppError(code + ": msg").code).toBe(code);
    }
  });
});
