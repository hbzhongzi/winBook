// 竞态实证：loaded.navigation resolve 时 replacementUrls 是否就绪
// 用法: node race_check.cjs <epub路径>
const path = require("path");
const fs = require("fs");

const { JSDOM } = require(path.join("C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/jsdom"));

const dom = new JSDOM("<!DOCTYPE html><html><head></head><body></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});
const w = dom.window;
for (const k of ["window", "document", "navigator", "DOMParser", "XMLHttpRequest", "Blob", "FileReader", "File", "URL", "TextDecoder", "TextEncoder", "requestAnimationFrame", "cancelAnimationFrame", "getComputedStyle", "Node", "Element", "HTMLElement", "Image", "CustomEvent", "Event", "MouseEvent", "KeyboardEvent", "atob", "btoa", "self", "XMLSerializer"]) {
  if (w[k] !== undefined) global[k] = w[k];
}
global.self = global;
if (!w.URL.createObjectURL) {
  w.URL.createObjectURL = () => "blob:http://localhost/" + Math.random().toString(36).slice(2);
  w.URL.revokeObjectURL = () => {};
}
global.URL = w.URL;

const ePub = require("E:/Winbook/book-editor/frontend/node_modules/epubjs/dist/epub.js");

const target = process.argv[2];
const data = new Uint8Array(fs.readFileSync(target));
console.log("== 目标:", path.basename(target), "大小:", data.length);

const book = ePub(data.buffer);
const t0 = Date.now();

book.loaded.navigation.then(async () => {
  console.log(`\n[${Date.now() - t0}ms] loaded.navigation 已 resolve（当前代码正是在此之后调用 display()）`);
  console.log("  replacementUrls.length =", book.resources.replacementUrls.length,
    "| urls.length =", book.resources.urls.length);
  console.log("  replacementUrls 就绪?", book.resources.replacementUrls.filter(Boolean).length > 0 ? "是" : "否 —— 竞态失败窗口");

  const section = book.spine.get(0);
  const out = await section.render(book.request);
  console.log(`\n[${Date.now() - t0}ms] 首章立即 render 结果（section=${section.href}）:`);
  console.log("  output 含 blob: URL?      ", /blob:http/.test(out) ? "是（已替换）" : "否 —— URL 未替换！");
  console.log("  output 仍含 ../Images/cover.jpg? ", out.includes("../Images/cover.jpg"));
  console.log("  output 仍含 ../../stylesheet.css?", out.includes("../../stylesheet.css"));
  console.log("  xlink:href 片段:", (out.match(/xlink:href="[^"]*"/) || ["<none>"])[0]);

  await book.opened;
  console.log(`\n[${Date.now() - t0}ms] book.opened 已 resolve（replacements 全部完成）`);
  console.log("  replacementUrls.length =", book.resources.replacementUrls.filter(Boolean).length,
    "/ urls:", book.resources.urls.length);

  section.contents = undefined; // 清掉已加载内容，强制重新 render
  const out2 = await section.render(book.request);
  console.log(`\n[${Date.now() - t0}ms] opened 后重新 render:`);
  console.log("  output 含 blob: URL?      ", /blob:http/.test(out2) ? "是（已替换）" : "否");
  console.log("  output 仍含 ../Images/cover.jpg? ", out2.includes("../Images/cover.jpg"));
  console.log("  xlink:href 片段:", (out2.match(/xlink:href="[^"]*"/) || ["<none>"])[0]);
  process.exit(0);
}).catch((e) => {
  console.log("FAILED:", e && e.stack || e);
  process.exit(1);
});
