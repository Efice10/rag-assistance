"use client";

import { CheckCircle2, Loader2, RefreshCw, ShieldAlert, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { StatusBadge } from "@/components/Badges";
import { api, errorMessage } from "@/lib/api";
import { toast } from "@/lib/feedback";
import { useSession } from "@/lib/session";
import type { DocumentItem } from "@/lib/types";

interface FailedJob {
  id: number;
  queue: string;
  job: string;
  document: { id: number; title: string } | null;
  error: string;
  failed_at: string;
}

interface Processing {
  failed_documents: DocumentItem[];
  stuck_documents: DocumentItem[];
  failed_jobs: FailedJob[];
  stuck_after_minutes: number;
}

const BUTTON =
  "inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50";

export default function ProcessingPage() {
  const session = useSession();
  const isAdmin = session?.user.role === "admin";
  const [data, setData] = useState<Processing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<{ data: Processing }>("/admin/processing")
      .then(({ data }) => {
        setData(data.data);
        setError(null);
      })
      .catch((err) => setError(errorMessage(err, "Could not load processing status.")));
  }, []);

  useEffect(() => {
    if (isAdmin) {
      load();
    }
  }, [isAdmin, load]);

  if (session && !isAdmin) {
    return (
      <div className="mx-auto mt-16 max-w-md text-center">
        <ShieldAlert className="mx-auto h-10 w-10 text-slate-300" aria-hidden />
        <h1 className="mt-3 text-lg font-semibold text-slate-900">Administrators only</h1>
      </div>
    );
  }

  async function run(key: string, request: () => Promise<unknown>, done: string) {
    setBusy(key);
    try {
      await request();
      toast.success(done);
      load();
    } catch (err) {
      toast.error(errorMessage(err, "That action failed."));
    } finally {
      setBusy(null);
    }
  }

  const reindex = (doc: DocumentItem) =>
    run(`doc-${doc.id}`, () => api.post(`/documents/${doc.id}/reindex`), `"${doc.title}" was queued again.`);

  const nothingWrong =
    data && !data.failed_documents.length && !data.stuck_documents.length && !data.failed_jobs.length;

  return (
    <>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">Processing</h1>
        <p className="text-sm text-slate-600">
          Documents that could not be indexed, documents waiting on the queue worker, and failed queue jobs.
        </p>
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      )}

      {!data ? (
        <div className="flex items-center justify-center gap-2 p-10 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading…
        </div>
      ) : nothingWrong ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center shadow-sm">
          <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-500" aria-hidden />
          <p className="mt-2 text-sm font-medium text-slate-900">Nothing needs attention</p>
          <p className="text-sm text-slate-600">Every document is indexed or on its way.</p>
        </div>
      ) : (
        <div className="space-y-6">
          <DocumentSection
            title="Failed documents"
            empty="No failed documents."
            documents={data.failed_documents}
            busy={busy}
            onReindex={reindex}
          />
          <DocumentSection
            title={`Waiting more than ${data.stuck_after_minutes} minutes`}
            hint="If several documents wait here, the queue worker is probably not running: start it with php artisan queue:work redis in backend/."
            empty="Nothing is stuck in the queue."
            documents={data.stuck_documents}
            busy={busy}
            onReindex={reindex}
          />

          <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <h2 className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900">Failed queue jobs</h2>
            {data.failed_jobs.length === 0 ? (
              <p className="px-4 py-4 text-sm text-slate-500">No failed jobs.</p>
            ) : (
              <ul className="divide-y divide-slate-100" data-testid="failed-jobs">
                {data.failed_jobs.map((job) => (
                  <li key={job.id} className="flex flex-wrap items-start gap-3 px-4 py-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-slate-900">
                        {job.job} · {job.document?.title}
                      </p>
                      <p className="mt-0.5 break-words font-mono text-xs text-rose-700">{job.error}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        Queue {job.queue} · {new Date(job.failed_at).toLocaleString()}
                      </p>
                    </div>
                    <button
                      type="button"
                      className={BUTTON}
                      disabled={busy === `job-${job.id}`}
                      onClick={() => run(`job-${job.id}`, () => api.post(`/admin/failed-jobs/${job.id}/retry`), "The job was queued again.")}
                    >
                      <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Retry
                    </button>
                    <button
                      type="button"
                      className={BUTTON}
                      disabled={busy === `job-${job.id}`}
                      onClick={() => run(`job-${job.id}`, () => api.delete(`/admin/failed-jobs/${job.id}`), "The failure record was removed.")}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden /> Forget
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </>
  );
}

function DocumentSection({
  title,
  hint,
  empty,
  documents,
  busy,
  onReindex,
}: {
  title: string;
  hint?: string;
  empty: string;
  documents: DocumentItem[];
  busy: string | null;
  onReindex: (doc: DocumentItem) => void;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {hint && documents.length > 0 && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
      </div>
      {documents.length === 0 ? (
        <p className="px-4 py-4 text-sm text-slate-500">{empty}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {documents.map((doc) => (
            <li key={doc.id} className="flex flex-wrap items-start gap-3 px-4 py-3 text-sm" data-testid="processing-document">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-900">
                  {doc.title} <span className="font-normal text-slate-500">· {doc.department?.name}</span>
                </p>
                {doc.error_message && <p className="mt-0.5 text-xs text-rose-700">{doc.error_message}</p>}
              </div>
              <StatusBadge status={doc.status} />
              <button type="button" className={BUTTON} disabled={busy === `doc-${doc.id}`} onClick={() => onReindex(doc)}>
                <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Reindex
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
