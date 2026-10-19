import { useCallback, useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { base64ToUint8Array } from "../utils/base64";

// worker 方案 A（主选）：Vite 打包期解析；文件名以 node_modules/pdfjs-dist/build 实际结果为准
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

const SCALE = 1.2; // 默认缩放比例（与原文档 6.3 一致）

type Props = {
  dataBase64: string;
};

export default function PdfViewer({ dataBase64 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [current, setCurrent] = useState(1);
  const [failed, setFailed] = useState(false);

  const renderPage = useCallback(async (pageNum: number) => {
    const pdf = pdfRef.current;
    const canvas = canvasRef.current;
    if (!pdf || !canvas) return;
    // 取消未完成的渲染任务，避免快速翻页竞态
    if (renderTaskRef.current) {
      renderTaskRef.current.cancel();
      renderTaskRef.current = null;
    }
    try {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: SCALE });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const task = page.render({ canvas, viewport });
      renderTaskRef.current = task;
      await task.promise;
      renderTaskRef.current = null;
    } catch (e) {
      // 取消产生的 RenderingCancelledException 静默处理
      if ((e as Error | null)?.name !== "RenderingCancelledException") {
        setFailed(true);
      }
    }
  }, []);

  // 加载文档并渲染第一页
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const bytes = base64ToUint8Array(dataBase64);
        const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
        if (cancelled) {
          pdf.cleanup();
          return;
        }
        pdfRef.current = pdf;
        setPageCount(pdf.numPages);
        setCurrent(1);
        await renderPage(1);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
      pdfRef.current?.cleanup();
      pdfRef.current = null;
    };
  }, [dataBase64, renderPage]);

  // 翻页渲染
  useEffect(() => {
    if (pageCount > 0 && current >= 1 && current <= pageCount) {
      renderPage(current);
    }
  }, [current, pageCount, renderPage]);

  // 窗口尺寸变化时重渲当前页（与原文档 6.3 一致）
  useEffect(() => {
    const onResize = () => renderPage(current);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [current, renderPage]);

  if (failed) {
    return (
      <section className="state state-pdf active" aria-label="PDF 解析失败">
        <div className="welcome">
          <span className="welcome-title">PDF 解析失败，请确认文件未加密或损坏</span>
        </div>
      </section>
    );
  }

  return (
    <section className="state state-pdf active" aria-label="PDF 显示">
      <div className="pdf-canvas-area">
        <div className="pdf-page">
          <canvas ref={canvasRef} className="pdf-canvas" />
          {pageCount > 0 && <div className="pdf-footer">— {current} —</div>}
        </div>
      </div>
      <div className="pdf-controls">
        <button
          type="button"
          className="pg-btn"
          onClick={() => setCurrent((p) => Math.max(1, p - 1))}
          disabled={current <= 1}
        >
          上一页
        </button>
        <span className="pg-indicator">
          {pageCount > 0 ? current + " / " + pageCount : "载入中…"}
        </span>
        <button
          type="button"
          className="pg-btn"
          onClick={() => setCurrent((p) => Math.min(pageCount, p + 1))}
          disabled={pageCount === 0 || current >= pageCount}
        >
          下一页
        </button>
        <span className="zoom-chip">缩放 120%</span>
      </div>
    </section>
  );
}
