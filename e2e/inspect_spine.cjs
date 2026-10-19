// epubjs spine 行为内省：确认 display() 无参时实际落在哪个 section
// 用法: node inspect_spine.cjs <epub路径>
const path = require("path");
const fs = require("fs");

const { JSDOM } = require(path.join("C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/jsdom"));

const dom = new JSDOM("<!DOCTYPE html><html><head></head><body></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});
const w = dom.window;
for (const k of ["window", "document", "navigator", "DOMParser", "XMLHttpRequest", "Blob", "FileReader", "File", "URL", "TextDecoder", "TextEncoder", "requestAnimationFrame", "cancelAnimationFrame", "getComputedStyle", "Node", "Element", "HTMLElement", "Image", "CustomEvent", "Event", "MouseEvent", "KeyboardEvent", "atob", "btoa", "self"]) {
  if (w[k] !== undefined) global[k] = w[k];
}
global.self = global;
// jsdom 未实现 createObjectURL/revokeObjectURL，epubjs Archive 需要
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

const timeout = setTimeout(() => {
  console.log("TIMEOUT: book.opened 15s 未完成");
  process.exit(3);
}, 15000);

book.opened
  .then(() => {
    clearTimeout(timeout);
    console.log("-- spine 全部章节 --");
    book.spine.each((s) => {
      console.log(`  index=${s.index} href=${s.href} linear=${s.linear} idref=${s.idref}`);
    });
    const first = book.spine.first();
    const got = book.spine.get(undefined);
    console.log("spine.first() ->", first && first.href, "linear=", first && first.linear);
    console.log("spine.get(undefined) ->", got && got.href, "linear=", got && got.linear);
    return book.loaded.navigation.then((nav) => {
      console.log("-- navigation.toc --");
      (nav.toc || []).forEach((t, i) => console.log(`  [${i}] ${t.label} -> ${t.href}`));
      process.exit(0);
    });
  })
  .catch((e) => {
    clearTimeout(timeout);
    console.log("opened REJECTED:", e && e.message);
    process.exit(4);
  });
