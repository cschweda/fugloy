// PDF rendering for the user's own manuals, with pdf.js. The library is
// imported the first time a PDF is opened, never with the workbench, and its
// worker is one of the app's own built assets (no CDN). The page is drawn into
// a canvas at the screen's pixel density, so it stays sharp at any zoom, and
// the wanted name or address is marked on it from the PDF's text layer.
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { findMatches } from './manuals';

export type PdfDoc = PDFDocumentProxy;

type PdfJs = typeof import('pdfjs-dist');
let lib: Promise<PdfJs> | null = null;

function pdfjs(): Promise<PdfJs> {
  lib ??= (async () => {
    const [m, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
    m.GlobalWorkerOptions.workerSrc = worker.default;
    return m;
  })();
  lib.catch(() => {
    lib = null;
  });
  return lib;
}

export async function loadPdf(blob: Blob): Promise<PdfDoc> {
  const m = await pdfjs();
  const data = new Uint8Array(await blob.arrayBuffer());
  // Served by the site itself (nuxt.config: nitro.publicAssets).
  const base = new URL('/pdfjs/', window.location.href).href;
  return m.getDocument({ data, wasmUrl: `${base}wasm/`, standardFontDataUrl: `${base}standard_fonts/`, cMapUrl: `${base}cmaps/`, iccUrl: `${base}iccs/` }).promise;
}

export interface RenderResult {
  /** The term that was found and marked, or null (none of them on this page, or no text layer). */
  found: string | null;
  /** False when the page has no text at all (a scan without OCR). */
  hasText: boolean;
}

/**
 * Draws PDF page `n` (1-based) into the canvas at `scale` CSS pixels per PDF
 * point, and marks every place the first of `highlight` (in order) occurs.
 */
export async function renderPage(doc: PdfDoc, n: number, canvas: HTMLCanvasElement, highlight?: string | readonly string[], opts: { scale?: number } = {}): Promise<RenderResult> {
  const m = await pdfjs();
  const page = await doc.getPage(n);
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  const scale = opts.scale ?? 1;
  const viewport = page.getViewport({ scale: scale * dpr });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
  canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
  await page.render({ canvas, viewport }).promise;

  const content = await page.getTextContent();
  const items = content.items.filter((it): it is Extract<typeof it, { str: string }> => 'str' in it);
  const hasText = items.some((it) => it.str.trim() !== '');
  const terms = highlight === undefined ? [] : typeof highlight === 'string' ? [highlight] : highlight;
  const match = terms.length === 0 ? null : findMatches(items, terms);
  if (match === null) return { found: null, hasText };

  const ctx = canvas.getContext('2d');
  if (ctx === null) return { found: null, hasText };
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = 'rgba(255, 200, 0, 0.8)';
  ctx.strokeStyle = 'rgba(247, 129, 102, 1)';
  ctx.lineWidth = Math.max(1, 1.5 * (viewport.scale / scale));
  for (const hit of match.hits) {
    const it = items[hit.item]!;
    const tx = m.Util.transform(viewport.transform, it.transform);
    const fontHeight = Math.hypot(tx[2]!, tx[3]!);
    const width = it.width * viewport.scale;
    const len = Math.max(1, it.str.length);
    const x = tx[4]! + (width * hit.start) / len;
    const w = Math.max((width * (hit.end - hit.start)) / len, fontHeight * 0.6);
    const pad = fontHeight * 0.2;
    const rect = [x - pad, tx[5]! - fontHeight - pad, w + 2 * pad, fontHeight + 2 * pad] as const;
    ctx.fillRect(...rect);
    ctx.strokeRect(...rect);
  }
  ctx.restore();
  return { found: match.term, hasText };
}
