"use client";

import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InlineError } from "@/components/ui/inline-error";
import { Skeleton } from "@/components/ui/skeleton";
import { CV_EXPORT_MAX_BYTES } from "@/domain/cv/export";
import { t, type Locale } from "@/i18n/messages";
import { IDLE_ACTION_STATE } from "@/server/action-result";

import { issueCvExportDownloadAction } from "./actions";
import { classifyExportResult, stepPage } from "./cv-export-page-state";

export interface CvPdfPagesProps {
  locale: Locale;
  exportId: string;
  /** Pages the worker stored; the viewer shows what the file really has. */
  pageCount: number;
  /** The CV revision this PDF was exported from, and the one that is saved now. */
  revision: number;
  savedRevision: number;
}

type LoadResult = { exportId: string; attempt: number; ok: boolean; total: number };

/**
 * The pages of a finished export, drawn from the real PDF (never an estimate): one canvas with the current page,
 * Previous/Next page, and "Page n of N". The bytes come from a short-lived `inline` URL that is requested here, used
 * once and never put in the markup; they stay in memory and are released with the document when the view goes.
 * pdf.js and its worker are loaded only when this view is shown. A failure leaves the download available.
 */
export function CvPdfPages({ locale, exportId, pageCount, revision, savedRevision }: CvPdfPagesProps) {
  const [result, setResult] = useState<LoadResult | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [page, setPage] = useState(1);
  const [width, setWidth] = useState(0);
  const [drawFailed, setDrawFailed] = useState<string | null>(null);
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previousRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  const current = result !== null && result.exportId === exportId && result.attempt === attempt ? result : null;
  const phase = current === null ? "loading" : current.ok && drawFailed !== `${exportId}:${attempt}` ? "ready" : "error";
  const total = current?.ok ? current.total : pageCount;

  // Load the document: URL -> bytes -> pdf.js. Nothing here is stored beyond this view.
  useEffect(() => {
    let cancelled = false;
    let task: PDFDocumentLoadingTask | null = null;
    void (async () => {
      let ok = false;
      let pages = pageCount;
      try {
        const form = new FormData();
        form.set("export_id", exportId);
        form.set("disposition", "inline");
        const outcome = classifyExportResult(await issueCvExportDownloadAction(IDLE_ACTION_STATE, form));
        if (outcome.kind !== "download") throw new Error("no download URL");
        const response = await fetch(outcome.url, { cache: "no-store", credentials: "omit" });
        if (!response.ok) throw new Error("PDF request failed");
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength === 0 || bytes.byteLength > CV_EXPORT_MAX_BYTES) throw new Error("PDF size is not valid");
        const pdfjs = await import("pdfjs-dist/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        task = pdfjs.getDocument({ data: bytes, useSystemFonts: false, enableXfa: false });
        const document = await task.promise;
        if (cancelled) {
          void task.destroy();
          return;
        }
        docRef.current = document;
        pages = document.numPages;
        ok = true;
      } catch {
        ok = false;
      }
      if (!cancelled) setResult({ exportId, attempt, ok, total: pages });
    })();
    return () => {
      cancelled = true;
      docRef.current = null;
      void task?.destroy();
    };
  }, [exportId, attempt, pageCount]);

  // The column width decides the drawing scale.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const next = Math.round(entries[0]?.contentRect.width ?? 0);
      setWidth((previous) => (previous === next ? previous : next));
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, [phase]);

  // Draw the current page (device pixel ratio capped at 2).
  useEffect(() => {
    if (phase !== "ready" || width === 0) return;
    let cancelled = false;
    let drawing: RenderTask | null = null;
    void (async () => {
      const document = docRef.current;
      const canvas = canvasRef.current;
      if (!document || !canvas) return;
      try {
        const pdfPage = await document.getPage(Math.min(Math.max(page, 1), document.numPages));
        if (cancelled) return;
        const natural = pdfPage.getViewport({ scale: 1 });
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = pdfPage.getViewport({ scale: (width / natural.width) * ratio });
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        canvas.style.aspectRatio = `${natural.width} / ${natural.height}`;
        drawing = pdfPage.render({ canvas, viewport });
        await drawing.promise;
      } catch (error) {
        // A cancelled draw (page changed or view closed) is normal; any other failure shows the retry message.
        if (!cancelled && !(error instanceof Error && error.name === "RenderingCancelledException")) setDrawFailed(`${exportId}:${attempt}`);
      }
    })();
    return () => {
      cancelled = true;
      drawing?.cancel();
    };
  }, [phase, page, width, exportId, attempt]);

  const move = (delta: 1 | -1) => {
    const next = stepPage(page, total, delta);
    if (next === page) return;
    setPage(next);
    // Keep focus on a button that stays usable when the edge of the document is reached.
    if ((delta === 1 && next === total) || (delta === -1 && next === 1)) {
      requestAnimationFrame(() => (delta === 1 ? previousRef : nextRef).current?.focus());
    }
  };

  const earlier = revision !== savedRevision;
  return (
    <section className="cv-pdf" aria-labelledby="cv-pdf-heading" data-testid="cv-pdf-pages" data-phase={phase} lang={locale}>
      <div className="cv-pdf-heading">
        <h2 id="cv-pdf-heading" className="text-base font-semibold">{t(locale, "cv.exportPage.pages.heading")}</h2>
        <p className="field-help">{t(locale, "cv.exportPage.pages.forRevision", { revision })}</p>
        {earlier ? (
          <p className="field-help" data-testid="cv-pdf-earlier">
            <Badge variant="warning">{t(locale, "cv.exportPage.history.earlier")}</Badge> {t(locale, "cv.exportPage.pages.earlier")}
          </p>
        ) : null}
      </div>

      {phase === "loading" ? (
        <div className="cv-pdf-loading" role="status" data-testid="cv-pdf-loading">
          <Skeleton className="cv-pdf-skeleton" />
          <p className="field-help">{t(locale, "cv.exportPage.pages.loading")}</p>
        </div>
      ) : null}

      {phase === "error" ? (
        <InlineError>
          <p data-testid="cv-pdf-error">{t(locale, "cv.exportPage.pages.error")}</p>
          <Button
            variant="secondary"
            onClick={() => {
              setDrawFailed(null);
              setPage(1);
              setAttempt((value) => value + 1);
            }}
          >
            {t(locale, "cv.exportPage.pages.retry")}
          </Button>
        </InlineError>
      ) : null}

      {phase === "ready" ? (
        <>
          <div ref={stageRef} className="cv-pdf-stage">
            <canvas
              ref={canvasRef} className="cv-pdf-canvas" role="img" data-testid="cv-pdf-canvas" data-page={page}
              aria-label={t(locale, "cv.exportPage.pages.canvasLabel", { page, total })}
            />
          </div>
          <div className="cv-pdf-controls">
            <button
              ref={previousRef} type="button" className="button-secondary" aria-disabled={page <= 1 || undefined} onClick={() => move(-1)}
              data-testid="cv-pdf-previous"
            >
              {t(locale, "cv.exportPage.pages.previous")}
            </button>
            <p className="text-sm" role="status" aria-live="polite" data-testid="cv-pdf-indicator">
              {t(locale, "cv.exportPage.pages.pageOf", { page, total })}
            </p>
            <button
              ref={nextRef} type="button" className="button-secondary" aria-disabled={page >= total || undefined} onClick={() => move(1)}
              data-testid="cv-pdf-next"
            >
              {t(locale, "cv.exportPage.pages.next")}
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
