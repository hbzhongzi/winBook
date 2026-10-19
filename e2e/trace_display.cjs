// epubjs 渲染链路追踪：renderTo + display 全过程，patch display 记录所有调用
// 用法: node trace_display.cjs <epub路径>
const path = require("path");
const fs = require("fs");

const { JSDOM } = require(path.join("C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/jsdom"));

const dom = new JSDOM("<!DOCTYPE html><html><head></head><body><div id='c'></div></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});
const w = dom.window;
for (const k of ["window", "document", "navigator", "DOMParser", "XMLHttpRequest", "Blob", "FileReader", "File", "URL", "TextDecoder", "TextEncoder", "requestAnimationFrame", "cancelAnimationFrame", "getComputedStyle", "Node", "Element", "HTMLElement", "HTMLDivElement", "HTMLIFrameElement", "Image", "CustomEvent", "Event", "MouseEvent", "KeyboardEvent", "atob", "btoa", "self"]) {
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
console.log("== 目标:", path.basename(target));

const book = ePub(data.buffer);
const T = (label) => (v) => { console.log(`[trace] ${label}`, v && v.href ? v.href : JSON.stringify(v)); return v; };

const timeout = setTimeout(() => {
  console.log("[trace] TIMEOUT 20s");
  process.exit(3);
}, 20000);

book.opened
  .then(() => {
    console.log("[trace] opened");
    const container = document.getElementById("c");
    // jsdom 无布局，补一个尺寸
    Object.defineProperty(container, "clientWidth", { value: 800 });
    Object.defineProperty(container, "clientHeight", { value: 600 });
    const rendition = book.renderTo(container, { width: "100%", height: "100%", flow: "scrolled-doc" });
    console.log("[trace] renderTo 完成");
    // patch display 记录调用
    const origDisplay = rendition.display.bind(rendition);
    rendition.display = function (t) {
      console.log("[trace] >>> rendition.display 被调用, target =", JSON.stringify(t));
      return origDisplay(t);
    };
    ["displayed", "relocated", "resized", "displayError"].forEach((ev) => {
      try {
        rendition.on(ev, (payload) => {
          const href = payload && payload.href;
          const cfi = payload && payload.start && payload.start.cfi;
          console.log(`[trace] 事件 ${ev}: href=${href || "-"} cfi=${cfi || "-"}`);
        });
      } catch { /* 事件名不适用则忽略 */ }
    });
    return origDisplay(undefined)
      .then((section) => {
        console.log("[trace] display() resolve, section =", section && section.href);
        return new Promise((r) => setTimeout(r, 3000));
      })
      .then(() => {
        console.log("[trace] 3s 后 spine 当前视图内容检查完成");
        process.exit(0);
      });
  })
  .catch((e) => {
    console.log("[trace] opened/display REJECTED:", e && e.message);
    process.exit(4);
  });
