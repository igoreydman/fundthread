import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  LoaderCircle,
  Minus,
  Plus,
  ScanText,
  Undo2,
} from "lucide-react";
import { api, desktop } from "./api";
import { extractPage } from "./localReceipt";
import type { Box, Expense, Extraction } from "./types";
GlobalWorkerOptions.workerSrc = workerUrl;
const local = (s: string) => new URL(s, window.location.href).href;
export type DocumentHandle = {
  extract: (forceOcr?: boolean) => Promise<Extraction>;
  exportPdf: (masks: Box[]) => Promise<Uint8Array>;
  cancel: () => void;
};
type Props = {
  expense: Expense;
  highlight?: Box;
  scrollToHighlight?: boolean;
  privacy?: boolean;
  fitToPage?: boolean;
  maskingDisabled?: boolean;
  masks?: Box[];
  onMasks?: (m: Box[]) => void;
  onPage?: (page: number, count: number) => void;
  onProgress?: (n: number | null) => void;
};
export const DocumentView = forwardRef<DocumentHandle, Props>(
  function DocumentView(
    {
      expense,
      highlight,
      scrollToHighlight = true,
      privacy = false,
      fitToPage = false,
      maskingDisabled = false,
      masks = [],
      onMasks,
      onPage,
      onProgress,
    },
    ref,
  ) {
    const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
    const [image, setImage] = useState<HTMLImageElement | null>(null);
    const [page, setPage] = useState(1);
    const [count, setCount] = useState(1);
    const [zoom, setZoom] = useState(1);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [renderVersion, setRenderVersion] = useState(0);
    const [fitWidth, setFitWidth] = useState(0);
    const [drag, setDrag] = useState<Box | null>(null);
    const mount = useRef<HTMLDivElement>(null);
    const reading = useRef<AbortController | null>(null);
    const job = useRef(0);
    const start = useRef<{ x: number; y: number } | null>(null);
    useEffect(() => {
      if (!fitToPage) return;
      const well = mount.current?.parentElement?.parentElement;
      const canvas = mount.current?.querySelector("canvas");
      if (!well || !canvas) return;
      const fit = () => {
        const style = getComputedStyle(well);
        const width =
          well.clientWidth -
          parseFloat(style.paddingLeft) -
          parseFloat(style.paddingRight);
        const height =
          well.clientHeight -
          parseFloat(style.paddingTop) -
          parseFloat(style.paddingBottom);
        if (width > 0 && height > 0)
          setFitWidth(Math.min(width, (height * canvas.width) / canvas.height));
      };
      const observer = new ResizeObserver(fit);
      observer.observe(well);
      fit();
      return () => observer.disconnect();
    }, [fitToPage, renderVersion]);
    useEffect(() => {
      let dead = false;
      let task: ReturnType<typeof getDocument> | null = null;
      let url = "";
      setLoading(true);
      setError("");
      setPdf(null);
      setImage(null);
      setPage(1);
      job.current++;
      reading.current?.abort();
      reading.current = null;
      void api
        .document(expense.documentId)
        .then(async (original) => {
          if (dead) return;
          const bytes = Uint8Array.from(original.bytes);
          if (original.mime === "application/pdf") {
            task = getDocument({
              data: bytes,
              cMapUrl: local("pdf/cmaps/"),
              cMapPacked: true,
              standardFontDataUrl: local("pdf/standard_fonts/"),
              wasmUrl: local("pdf/wasm/"),
              iccUrl: local("pdf/iccs/"),
            });
            const doc = await task.promise;
            if (dead) {
              void task?.destroy();
              return;
            }
            if (doc.numPages > 100) {
              void task?.destroy();
              throw new Error(
                "This build displays PDFs with up to 100 pages. Split a larger scan before importing.",
              );
            }
            setPdf(doc);
            setCount(doc.numPages);
          } else {
            url = URL.createObjectURL(
              new Blob([bytes], { type: original.mime }),
            );
            const img = new Image();
            img.src = url;
            await img.decode();
            if (dead) return;
            if (img.width * img.height > 24000000)
              throw new Error(
                "This image exceeds the display resource limit. Import a smaller scan.",
              );
            setImage(img);
            setCount(1);
          }
          if (!dead) setLoading(false);
        })
        .catch((e) => {
          if (!dead) {
            setError(String(e));
            setLoading(false);
          }
        });
      return () => {
        dead = true;
        job.current++;
        reading.current?.abort();
        reading.current = null;
        void task?.destroy();
        if (url) URL.revokeObjectURL(url);
      };
    }, [expense.documentId]);
    useEffect(() => {
      if (highlight) setPage(highlight.page);
    }, [highlight]);
    useEffect(() => {
      if (!scrollToHighlight || !highlight || highlight.page !== page) return;
      const node =
        mount.current?.parentElement?.querySelector(".source-highlight");
      node?.scrollIntoView({
        block: "center",
        inline: "nearest",
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
    }, [highlight, page, renderVersion, scrollToHighlight]);
    async function renderPage(
      n: number,
      scale = 1.65,
    ): Promise<HTMLCanvasElement> {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d")!;
      if (pdf) {
        const p = await pdf.getPage(n);
        const viewport = p.getViewport({ scale });
        if (viewport.width * viewport.height > 24000000)
          throw new Error("This page exceeds the display resource limit.");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await p.render({ canvas, canvasContext: ctx, viewport }).promise;
      } else if (image) {
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        ctx.drawImage(image, 0, 0);
      } else throw new Error("Wait for the original receipt to load.");
      return canvas;
    }
    useEffect(() => {
      let dead = false;
      if (!pdf && !image) return;
      setError("");
      void renderPage(page)
        .then((canvas) => {
          if (dead) return;
          const node = mount.current;
          if (node) {
            node.replaceChildren(canvas);
            setRenderVersion((v) => v + 1);
            onPage?.(page, count);
          }
        })
        .catch((e) => {
          if (!dead) setError(String(e));
        });
      return () => {
        dead = true;
      };
    }, [pdf, image, page, count]);
    function cancel() {
      job.current++;
      reading.current?.abort();
      reading.current = null;
      onProgress?.(null);
    }
    async function extract(forceOcr = false): Promise<Extraction> {
      reading.current?.abort();
      const controller = new AbortController();
      reading.current = controller;
      try {
        return await extractPage({
          pdf,
          page,
          render: () => renderPage(page),
          signal: controller.signal,
          progress: onProgress,
          forceOcr,
        });
      } finally {
        if (reading.current === controller) reading.current = null;
      }
    }
    async function exportPdf(regions: Box[]) {
      const { PDFDocument } = await import("pdf-lib");
      const output = await PDFDocument.create();
      for (let n = 1; n <= count; n++) {
        const canvas = await renderPage(n, 1.8);
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#111";
        for (const m of regions.filter((m) => m.page === n))
          ctx.fillRect(
            Math.floor(m.x * canvas.width) - 1,
            Math.floor(m.y * canvas.height) - 1,
            Math.ceil(m.w * canvas.width) + 2,
            Math.ceil(m.h * canvas.height) + 2,
          );
        const blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (b) =>
              b ? resolve(b) : reject(new Error("Could not render this page.")),
            "image/png",
          ),
        );
        const data = await blob.arrayBuffer();
        const png = await output.embedPng(data);
        const width = pdf ? canvas.width / 1.8 : Math.min(600, canvas.width);
        const height = (width * canvas.height) / canvas.width;
        const p = output.addPage([width, height]);
        p.drawImage(png, { x: 0, y: 0, width, height });
      }
      output.setTitle("Reviewed receipt copy");
      output.setCreator("FundThread");
      output.setProducer("FundThread");
      output.setSubject("Human-reviewed document derivative");
      return output.save();
    }
    useImperativeHandle(ref, () => ({ extract, exportPdf, cancel }));
    const point = (e: React.PointerEvent<HTMLDivElement>) => {
      const r = e.currentTarget.getBoundingClientRect();
      return {
        x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
        y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
      };
    };
    const rectangle = (
      a: { x: number; y: number },
      b: { x: number; y: number },
    ): Box => ({
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      w: Math.abs(a.x - b.x),
      h: Math.abs(a.y - b.y),
      page,
    });
    return (
      <div className={`document-view ${privacy ? "is-private" : ""}`}>
        <div className="document-toolbar">
          <span>
            <FileText size={15} />
            {privacy ? "Reviewed copy" : "Original receipt"}
          </span>
          <div className="toolbar-actions">
            <button
              className="icon-button"
              aria-label="Zoom out"
              onClick={() => setZoom((z) => Math.max(0.65, z - 0.15))}
            >
              <Minus size={15} />
            </button>
            <span>{Math.round(zoom * 100)}%</span>
            <button
              className="icon-button"
              aria-label="Zoom in"
              onClick={() => setZoom((z) => Math.min(2, z + 0.15))}
            >
              <Plus size={15} />
            </button>
          </div>
        </div>
        {privacy && (
          <div className="redaction-instruction">
            <ScanText size={15} />
            Drag over private details to mask them.
            <button
              className="text-button"
              disabled={maskingDisabled || !masks.length}
              onClick={() => onMasks?.(masks.slice(0, -1))}
            >
              <Undo2 size={13} />
              Undo
            </button>
          </div>
        )}
        <div className="paper-well">
          {loading && (
            <div className="document-message">
              <LoaderCircle className="spin" />
              Loading the original…
            </div>
          )}
          {error && (
            <div className="document-message error">
              <FileText />
              <strong>Couldn’t display this receipt</strong>
              <p>{error}</p>
              <small>
                {desktop
                  ? "The original remains in the organization’s database."
                  : "The original bytes remain unchanged in this tab."}
              </small>
            </div>
          )}
          <div
            className="page-visual"
            style={{
              width:
                fitToPage && fitWidth
                  ? `${zoom * fitWidth}px`
                  : `${zoom * 100}%`,
              display: loading || error ? "none" : undefined,
            }}
          >
            <div ref={mount} className="canvas-mount" />
            <div
              className={`page-overlay ${privacy ? "draw-mask" : ""}`}
              data-render={renderVersion}
              onPointerDown={(e) => {
                if (!privacy || maskingDisabled) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                start.current = point(e);
                setDrag(rectangle(start.current, start.current));
              }}
              onPointerMove={(e) => {
                if (start.current) setDrag(rectangle(start.current, point(e)));
              }}
              onPointerUp={(e) => {
                if (!start.current) return;
                const box = rectangle(start.current, point(e));
                start.current = null;
                setDrag(null);
                if (box.w > 0.005 && box.h > 0.005) onMasks?.([...masks, box]);
              }}
            >
              {highlight?.page === page && (
                <span
                  className="source-highlight"
                  style={{
                    left: `${highlight.x * 100}%`,
                    top: `${highlight.y * 100}%`,
                    width: `${highlight.w * 100}%`,
                    height: `${highlight.h * 100}%`,
                  }}
                />
              )}
              {[...masks, ...(drag ? [drag] : [])]
                .filter((m) => m.page === page && privacy)
                .map((m, i) => (
                  <span
                    key={i}
                    className="privacy-mask"
                    style={{
                      left: `${m.x * 100}%`,
                      top: `${m.y * 100}%`,
                      width: `${m.w * 100}%`,
                      height: `${m.h * 100}%`,
                    }}
                  />
                ))}
            </div>
          </div>
        </div>
        <div className="document-footer">
          <span title={expense.hash}>
            {privacy
              ? "Original stays unchanged"
              : desktop
                ? "Original archived"
                : api.browserMode() === "personal"
                  ? "Original in this tab"
                  : "Sample original"}
            <span className="tiny-dot" />
            {expense.mime === "application/pdf" ? "PDF" : "Image"}
          </span>
          <div className="pager">
            <button
              className="icon-button"
              aria-label="Previous page"
              disabled={page === 1}
              onClick={() => setPage((n) => n - 1)}
            >
              <ChevronLeft size={15} />
            </button>
            <span>
              {page} / {count}
            </span>
            <button
              className="icon-button"
              aria-label="Next page"
              disabled={page === count}
              onClick={() => setPage((n) => n + 1)}
            >
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
      </div>
    );
  },
);
