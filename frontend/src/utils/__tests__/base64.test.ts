import { describe, expect, it } from "vitest";
import { base64ToUint8Array } from "../base64";

describe("base64ToUint8Array", () => {
  it("空串返回空数组", () => {
    expect(base64ToUint8Array("")).toEqual(new Uint8Array(0));
  });

  it("解码已知 Base64（Hello）", () => {
    expect(Array.from(base64ToUint8Array("SGVsbG8="))).toEqual([
      72, 101, 108, 108, 111,
    ]);
  });

  it("二进制字节往返不变（含 0x00/0xFF）", () => {
    const bytes = new Uint8Array([0x00, 0xff, 0x80, 0x7f, 0xab, 0xcd]);
    const b64 = btoa(String.fromCharCode(...bytes));
    expect(Array.from(base64ToUint8Array(b64))).toEqual(Array.from(bytes));
  });

  it("结果长度与解码后字节数一致", () => {
    // PDF 文件头 %PDF-1.4
    const bytes = base64ToUint8Array(btoa("%PDF-1.4"));
    expect(bytes.length).toBe(8);
    expect(new TextDecoder().decode(bytes)).toBe("%PDF-1.4");
  });
});
