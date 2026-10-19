// epubjs 对非 zip 数据的行为验证（Node + 最小 DOM 垫片）
global.window = global.window || {};
global.navigator = global.navigator || { userAgent: "node" };
global.document = global.document || { createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), documentElement: { style: {} } };
const path = require("path");
let ePub;
try {
  ePub = require(path.join("E:/Winbook/book-editor/frontend/node_modules/epubjs/dist/epub.js"));
} catch (e) {
  console.log("CJS 加载失败:", e.message);
  process.exit(2);
}
const fs = require("fs");
const data = new Uint8Array(fs.readFileSync("E:/Winbook/book-editor/e2e/fixtures/broken.epub"));
console.log("输入长度:", data.length);
const book = ePub(data.buffer);
console.log("book 构造完成");
const timeout = setTimeout(() => { console.log("TIMEOUT: opening 8s 未完成也未拒绝"); process.exit(3); }, 8000);
book.opened.then(() => {
  clearTimeout(timeout);
  console.log("opened resolved（异常：损坏文件不应打开成功）");
  process.exit(4);
}).catch((e) => {
  clearTimeout(timeout);
  console.log("opened rejected:", e && e.message);
  process.exit(0);
});
