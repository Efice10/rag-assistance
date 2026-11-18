"use client";

import { Download, FileText, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, downloadDocument, errorMessage } from "@/lib/api";
import type { Source } from "@/lib/types";

/**
 * Side panel that shows a cited PDF at the cited page. The file is fetched
 * through the same download route as everywhere else, so access is re-checked
 * on the server; the browser's own PDF viewer jumps to `#page=N`. DOCX files
 * have no pages, so they fall back to a download.
 */
export function SourceViewer({ source, onClose }: { source: Source; onClose: () => void }) {
  const [file, setFile] = useState<{ url: string; isPdf: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;

    api
      .get(`/documents/${source.document_id}/download`, { responseType: "blob" })
      .then((response) => {
        if (cancelled) {
          return;
        }
        const blob = response.data as Blob;
        const isPdf = String(response.headers["content-type"] ?? blob.type).includes("pdf");
        url = URL.createObjectURL(blob);
        setFile({ url, isPdf });
      })
      .catch((err) => {
        if (!cancelled) {
          setError(errorMessage(err, "Could not open that document."));
        }
      });

    return () => {
      cancelled = true;
      if (url) {
        URL.revokeObjectURL(url);
      }
    };
  }, [source.document_id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/40" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`${source.document_title}, page ${source.page_number}`}
        data-testid="source-viewer"
        onClick={(event) => event.stopPropagation()}
        className="flex h-full w-full max-w-3xl flex-col bg-white shadow-xl"
      >
        <header className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
          <FileText className="h-5 w-5 shrink-0 text-indigo-600" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-900">{source.document_title}</p>
            <p className="text-xs text-slate-500">Cited page {source.page_number}</p>
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

        <div className="flex-1 bg-slate-100">
          {error ? (
            <p role="alert" className="m-4 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">
              {error}
            </p>
          ) : !file ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Opening document…
            </div>
          ) : file.isPdf ? (
            <iframe
              title={`${source.document_title}, page ${source.page_number}`}
              src={`${file.url}#page=${source.page_number}`}
              className="h-full w-full"
            />
          ) : (
            <div className="m-auto max-w-sm p-10 text-center text-sm text-slate-600">
              Only PDFs can be previewed at a page. Use Download to open this document.
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
