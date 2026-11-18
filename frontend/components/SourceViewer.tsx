"use client";

import { AlertTriangle, Download, FileText, Loader2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, downloadDocument, errorMessage } from "@/lib/api";

/** What to open: a document, and optionally the page a citation points at. */
export interface ViewerTarget {
  document_id: number;
  document_title: string;
  page_number?: number | null;
}

interface Preview {
  format: string;
  pages: { page: number; text: string }[];
  truncated: boolean;
}

/** What a "page" is called in each format. */
const UNIT: Record<string, string> = { pptx: "Slide", xlsx: "Sheet" };

/**
 * Side panel that shows a document without downloading it. PDFs open in the
 * browser's own viewer at the cited page (`#page=N`); every other format is
 * shown as its text, page by page (slides, sheets), scrolled to the cited one.
 * Both come through routes that re-check access on the server.
 */
export function SourceViewer({ source, onClose }: { source: ViewerTarget; onClose: () => void }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cited = useRef<HTMLElement | null>(null);
  const page = source.page_number ?? null;

  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;

    async function load() {
      const { data } = await api.get<{ data: Preview }>(`/documents/${source.document_id}/preview`);
      if (cancelled) return;
      if (data.data.format === "pdf") {
        const response = await api.get(`/documents/${source.document_id}/download`, { responseType: "blob" });
        if (cancelled) return;
        url = URL.createObjectURL(response.data as Blob);
        setPdfUrl(url);
      }
      setPreview(data.data);
    }

    load().catch((err) => !cancelled && setError(errorMessage(err, "Could not open that document.")));

    return () => {
      cancelled = true;
      if (url) {
        URL.revokeObjectURL(url);
      }
    };
  }, [source.document_id]);

  // Bring the cited page into view once the text is there.
  useEffect(() => {
    cited.current?.scrollIntoView({ block: "start" });
  }, [preview]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const unit = UNIT[preview?.format ?? ""] ?? "Page";
  const showPageHeadings = (preview?.pages.length ?? 0) > 1 || unit !== "Page";

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={page ? `${source.document_title}, page ${page}` : source.document_title}
        data-testid="source-viewer"
        onClick={(event) => event.stopPropagation()}
        className="flex h-full w-full max-w-3xl flex-col bg-white shadow-xl"
      >
        <header className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
          <FileText className="h-5 w-5 shrink-0 text-indigo-600" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-900">{source.document_title}</p>
            <p className="text-xs text-slate-500">
              {page ? `Cited ${unit.toLowerCase()} ${page}` : preview?.format ? preview.format.toUpperCase() : "Document"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => downloadDocument(source.document_id, source.document_title).catch(() => {})}
            className="flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
          >
            <Download className="h-3.5 w-3.5" aria-hidden /> Download
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close document"
            className="rounded-md p-1 text-slate-500 hover:bg-slate-100"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto bg-slate-100">
          {error ? (
            <p role="alert" className="m-4 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">
              {error}
            </p>
          ) : !preview ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Opening document…
            </div>
          ) : pdfUrl ? (
            <iframe
              title={page ? `${source.document_title}, page ${page}` : source.document_title}
              src={page ? `${pdfUrl}#page=${page}` : pdfUrl}
              className="h-full w-full"
            />
          ) : (
            <div className="mx-auto max-w-2xl space-y-4 p-4" data-testid="text-preview">
              <p className="text-xs text-slate-500">
                Text view: formatting and images are not shown. Download the file for the original layout.
              </p>
              {preview.truncated && (
                <p className="flex items-center gap-1.5 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> This document is long; only the first part is
                  shown here.
                </p>
              )}
              {preview.pages.length === 0 && <p className="text-sm text-slate-600">This document has no readable text.</p>}
              {preview.pages.map(({ page: number, text }) => {
                const isCited = page !== null && number === page;
                return (
                  <section
                    key={number}
                    ref={isCited ? (element) => void (cited.current = element) : undefined}
                    data-cited={isCited || undefined}
                    className={`rounded-lg border bg-white p-4 shadow-sm ${
                      isCited ? "border-indigo-400 ring-2 ring-indigo-500/30" : "border-slate-200"
                    }`}
                  >
                    {showPageHeadings && (
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {unit} {number}
                        {isCited && <span className="ml-2 normal-case text-indigo-700">cited</span>}
                      </h3>
                    )}
                    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-800">{text}</p>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
