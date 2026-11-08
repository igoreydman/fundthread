import {
  getDocument,
  GlobalWorkerOptions,
  Util,
  type PDFDocumentProxy,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { api } from "./api";
import { parseReceipt } from "./extraction";
import { pdfTextBounds } from "./pdfGeometry";
import type { Expense, Extraction, Word } from "./types";

GlobalWorkerOptions.workerSrc = workerUrl;
export const localAsset = (s: string) => new URL(s, window.location.href).href;
function check(signal: AbortSignal) {
  if (signal.aborted) throw new Error("Reading canceled.");
}

// The visible document and the batch reader use the same page/extraction path.
export async function extractPage({
  pdf,
  page,
  render,
  signal,
  progress,
  forceOcr = false,
}: {
  pdf: PDFDocumentProxy | null;
  page: number;
  render: () => Promise<HTMLCanvasElement>;
  signal: AbortSignal;
  progress?: (n: number | null) => void;
  forceOcr?: boolean;
}): Promise<Extraction> {
  check(signal);
  progress?.(0);
  try {
    if (pdf && !forceOcr) {
      const p = await pdf.getPage(page);
      const view = p.getViewport({ scale: 1 });
      const content = await p.getTextContent();
      check(signal);
      const words: Word[] = [];
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const box = pdfTextBounds(
          Util.transform(view.transform, item.transform),
          item.width * view.scale,
          view,
          content.styles[item.fontName],
          page,
        );
        if (box) words.push({ text: item.str, ...box });
      }
      if (words.map((w) => w.text).join("").length > 15)
        return parseReceipt(words, page, "Embedded PDF text · local");
    }
    const canvas = await render();
    check(signal);
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("eng", 1, {
      workerPath: localAsset("ocr/worker.min.js"),
      corePath: localAsset("ocr/core/"),
      langPath: localAsset("ocr/"),
      gzip: false,
      workerBlobURL: false,
      cacheMethod: "none",
      logger: (m) => {
        if (!signal.aborted) progress?.(m.progress);
      },
    });
    const abort = () => {
      void worker.terminate();
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      check(signal);
      const result = await worker.recognize(
        canvas,
        {},
        { text: true, blocks: true },
      );
      check(signal);
      const words: Word[] = [];
      for (const b of result.data.blocks || [])
        for (const p of b.paragraphs)
          for (const l of p.lines)
            for (const x of l.words)
              words.push({
                text: x.text,
                x: x.bbox.x0 / canvas.width,
                y: x.bbox.y0 / canvas.height,
                w: (x.bbox.x1 - x.bbox.x0) / canvas.width,
                h: (x.bbox.y1 - x.bbox.y0) / canvas.height,
                page,
              });
      return parseReceipt(
        words,
        page,
        `Tesseract ${result.data.version} · local`,
      );
    } finally {
      signal.removeEventListener("abort", abort);
      await worker.terminate();
      canvas.width = canvas.height = 0;
    }
  } finally {
    progress?.(null);
  }
}

export async function readOriginal(
  e: Expense,
  signal: AbortSignal,
  progress?: (n: number | null) => void,
) {
  const original = await api.document(e.documentId);
  check(signal);
  let task: ReturnType<typeof getDocument> | undefined;
  let url = "";
  let pdf: PDFDocumentProxy | null = null;
  let image: HTMLImageElement | undefined;
  const abort = () => {
    void task?.destroy();
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    const bytes = Uint8Array.from(original.bytes);
    if (original.mime === "application/pdf") {
      task = getDocument({
        data: bytes,
        cMapUrl: localAsset("pdf/cmaps/"),
        cMapPacked: true,
        standardFontDataUrl: localAsset("pdf/standard_fonts/"),
        wasmUrl: localAsset("pdf/wasm/"),
        iccUrl: localAsset("pdf/iccs/"),
      });
      pdf = await task.promise;
      if (pdf.numPages > 100)
        throw new Error("Split PDFs longer than 100 pages before reading.");
    } else {
      url = URL.createObjectURL(new Blob([bytes], { type: original.mime }));
      image = new Image();
      image.src = url;
      await image.decode();
      if (image.naturalWidth * image.naturalHeight > 24_000_000)
        throw new Error("Resize this image below 24 megapixels.");
    }
    check(signal);
    return await extractPage({
      pdf,
      page: 1,
      signal,
      progress,
      render: async () => {
        check(signal);
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d")!;
        if (pdf) {
          const p = await pdf.getPage(1),
            viewport = p.getViewport({ scale: 1.65 });
          if (viewport.width * viewport.height > 24_000_000)
            throw new Error("This page exceeds the reading resource limit.");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          await p.render({ canvas, canvasContext: ctx, viewport }).promise;
        } else if (image) {
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          ctx.drawImage(image, 0, 0);
        }
        return canvas;
      },
    });
  } finally {
    signal.removeEventListener("abort", abort);
    await task?.destroy();
    if (url) URL.revokeObjectURL(url);
  }
}
