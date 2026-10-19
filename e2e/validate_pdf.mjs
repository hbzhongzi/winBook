// PDF 样本前置校验：在 Node 中用 pdfjs-dist 验证可解析、页数正确、损坏样本按预期拒绝。
import * as pdfjsLib from "../frontend/node_modules/pdfjs-dist/build/pdf.mjs";
import fs from "node:fs";

const dir = new URL("./fixtures/", import.meta.url);
let failed = 0;

async function expectOk(name, numPages) {
  const data = new Uint8Array(fs.readFileSync(new URL(name, dir)));
  const pdf = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
  const page = await pdf.getPage(1);
  const vp = page.getViewport({ scale: 1.2 });
  const ok = pdf.numPages === numPages && vp.width > 0;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: numPages=${pdf.numPages} page1=${vp.width.toFixed(0)}x${vp.height.toFixed(0)} (expect ${numPages})`);
  if (!ok) failed++;
  await pdf.cleanup();
}

async function expectReject(name) {
  const data = new Uint8Array(fs.readFileSync(new URL(name, dir)));
  try {
    const pdf = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
    console.log(`FAIL ${name}: 预期解析失败，实际成功 numPages=${pdf.numPages}`);
    failed++;
    await pdf.cleanup();
  } catch (e) {
    console.log(`PASS ${name}: 按预期拒绝 (${e.name || e.message})`);
  }
}

await expectOk("sample.pdf", 3);
await expectOk("perf-30mb.pdf", 5);
await expectReject("broken.pdf");
console.log(failed === 0 ? "PDF_FIXTURES_OK" : `PDF_FIXTURES_FAILED(${failed})`);
process.exit(failed === 0 ? 0 : 1);
