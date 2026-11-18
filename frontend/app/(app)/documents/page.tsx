"use client";

import { Download, Eye, FileText, Loader2, RefreshCw, ShieldCheck, Upload } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ClearanceBadge, StatusBadge } from "@/components/Badges";
import { SourceViewer, type ViewerTarget } from "@/components/SourceViewer";
import { UploadModal } from "@/components/UploadModal";
import { api, downloadDocument, errorMessage } from "@/lib/api";
import { confirmAction, toast } from "@/lib/feedback";
import { useSession } from "@/lib/session";
import type { DocumentItem } from "@/lib/types";

const POLL_INTERVAL_MS = 3000;

export default function DocumentsPage() {
  const session = useSession();
  const [documents, setDocuments] = useState<DocumentItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [actingId, setActingId] = useState<number | null>(null);
  const [showOlder, setShowOlder] = useState(false);
  const [viewing, setViewing] = useState<ViewerTarget | null>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<{ data: DocumentItem[] }>("/documents", {
        params: showOlder ? { include_superseded: 1 } : undefined,
      });
      setDocuments(data.data);
      setError(null);
    } catch (err) {
      setError(errorMessage(err, "Could not load documents."));
    }
  }, [showOlder]);

  useEffect(() => {
    // Deferred so the fetch (and its state updates) runs after the effect.
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  // Keep refreshing while anything is still being indexed.
  const inProgress = documents?.some((doc) => doc.status === "pending" || doc.status === "processing") ?? false;

  useEffect(() => {
    if (!inProgress) {
      return;
    }
    const timer = window.setInterval(load, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [inProgress, load]);

  async function act(doc: DocumentItem, action: "reindex" | "approve") {
    if (action === "approve") {
      const confirmed = await confirmAction({
        title: `Approve "${doc.title}" for indexing?`,
        body: `${(doc.error_message ?? "This document was held for review").replace(/\.?\s*$/, ".")} Approve only if you have read it and the flagged text is harmless. Your approval is recorded in the audit log.`,
        confirmLabel: "Approve and index",
      });
      if (!confirmed) {
        return;
      }
    }
    setActingId(doc.id);
    try {
      const { data } = await api.post<{ data: DocumentItem }>(`/documents/${doc.id}/${action}`);
      setDocuments((current) => current?.map((item) => (item.id === doc.id ? data.data : item)) ?? null);
      toast.success(action === "approve" ? `"${doc.title}" approved and queued for indexing.` : `"${doc.title}" was queued again.`);
    } catch (err) {
      toast.error(errorMessage(err, action === "approve" ? "Could not approve the document." : "Could not reindex the document."));
    } finally {
      setActingId(null);
    }
  }

  async function download(doc: DocumentItem) {
    setDownloadingId(doc.id);
    try {
      await downloadDocument(doc.id, doc.title);
    } catch (err) {
      setError(errorMessage(err, "The download failed."));
    } finally {
      setDownloadingId(null);
    }
  }

  const user = session?.user;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Documents</h1>
          <p className="text-sm text-slate-600">
            Policies and manuals you are cleared to see. Indexed documents can be queried in chat.
          </p>
        </div>
        <label className="ml-auto flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={showOlder}
            onChange={(event) => setShowOlder(event.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          Show older versions
        </label>
        {user?.can_upload && (
          <button
            type="button"
            onClick={() => setUploading(true)}
            className="flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-on-accent hover:bg-indigo-500"
          >
            <Upload className="h-4 w-4" aria-hidden />
            Upload document
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        {documents === null ? (
          <div className="flex items-center justify-center gap-2 p-10 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading documents…
          </div>
        ) : documents.length === 0 ? (
          <div className="p-10 text-center">
            <FileText className="mx-auto h-8 w-8 text-slate-300" aria-hidden />
            <p className="mt-2 text-sm font-medium text-slate-900">No documents yet</p>
            <p className="text-sm text-slate-600">
              {user?.can_upload
                ? "Upload a PDF, Word, Excel, PowerPoint or text file to make it searchable in chat."
                : "Nothing has been shared with your department at your clearance level."}
            </p>
          </div>
        ) : (
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">Department</th>
                <th className="px-4 py-3 font-medium">Clearance</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Uploaded</th>
                <th className="px-4 py-3 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {documents.map((doc) => (
                <tr key={doc.id} data-testid="document-row">
                  <td className="px-4 py-3">
                    <p className={`font-medium ${doc.superseded ? "text-slate-500" : "text-slate-900"}`}>
                      <button
                        type="button"
                        onClick={() => setViewing({ document_id: doc.id, document_title: doc.title })}
                        className="text-left underline-offset-2 hover:text-indigo-700 hover:underline"
                      >
                        {doc.title}
                      </button>
                      {doc.version > 1 && (
                        <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">
                          v{doc.version}
                        </span>
                      )}
                      {doc.superseded && <span className="ml-1.5 text-xs font-normal">(replaced by a newer version)</span>}
                    </p>
                    {(doc.status === "failed" || doc.status === "flagged") && doc.error_message && (
                      <p className={`mt-0.5 text-xs ${doc.status === "failed" ? "text-rose-700" : "text-amber-800"}`}>
                        {doc.error_message}
                      </p>
                    )}
                    {doc.pii_redactions > 0 && (
                      <p className="mt-0.5 text-xs text-slate-500" title="Masked in the search index; the file itself is unchanged">
                        {doc.pii_redactions} personal detail{doc.pii_redactions === 1 ? "" : "s"} masked
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{doc.department?.name ?? "—"}</td>
                  <td className="px-4 py-3">
                    <ClearanceBadge level={doc.clearance_level} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={doc.status} />
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {new Date(doc.created_at).toLocaleDateString(undefined, { dateStyle: "medium" })}
                    <span className="block text-xs text-slate-500">{doc.uploaded_by?.name}</span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    {user?.role === "admin" && doc.status === "flagged" && (
                      <button
                        type="button"
                        onClick={() => act(doc, "approve")}
                        disabled={actingId === doc.id}
                        title="You have read the document and the flagged text is harmless"
                        className="mr-1.5 inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-2.5 py-1.5 text-xs font-medium text-on-accent hover:bg-amber-500 disabled:opacity-50"
                      >
                        <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Approve
                      </button>
                    )}
                    {user?.can_upload && !doc.superseded && (doc.status === "failed" || doc.status === "indexed") && (
                      <button
                        type="button"
                        onClick={() => act(doc, "reindex")}
                        disabled={actingId === doc.id}
                        className="mr-1.5 inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                      >
                        <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Reindex
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setViewing({ document_id: doc.id, document_title: doc.title })}
                      aria-label={`View ${doc.title}`}
                      className="mr-1.5 inline-flex items-center gap-1.5 rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-medium text-indigo-800 hover:bg-indigo-100"
                    >
                      <Eye className="h-3.5 w-3.5" aria-hidden /> View
                    </button>
                    <button
                      type="button"
                      onClick={() => download(doc)}
                      disabled={downloadingId === doc.id}
                      className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                    >
                      {downloadingId === doc.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      ) : (
                        <Download className="h-3.5 w-3.5" aria-hidden />
                      )}
                      Download
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {viewing && <SourceViewer source={viewing} onClose={() => setViewing(null)} />}

      {uploading && user && (
        <UploadModal
          user={user}
          onClose={() => setUploading(false)}
          onUploaded={(document) => {
            setUploading(false);
            setDocuments((current) => [document, ...(current ?? [])]);
          }}
        />
      )}
    </>
  );
}
