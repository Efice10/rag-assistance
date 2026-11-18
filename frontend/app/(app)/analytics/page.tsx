"use client";

import { Loader2, ShieldAlert, ThumbsDown } from "lucide-react";
import { useEffect, useState } from "react";
import { ClearanceBadge } from "@/components/Badges";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";

interface Metrics {
  days: number;
  totals: {
    queries: number;
    distinct_users: number;
    failed_queries: number;
    no_answer: number;
    no_answer_rate: number | null;
    ratings: number;
    helpful_rate: number | null;
  };
  queries_per_day: { date: string; count: number }[];
  top_documents: { id: number; title: string; citations: number }[];
  documents_by_status: Record<string, number>;
  documents_by_clearance: { level: number; label: string; count: number }[];
  recent_negative_feedback: {
    id: number;
    user: string | null;
    comment: string | null;
    question: string;
    answer: string;
    rated_at: string | null;
  }[];
}

const RANGES = [7, 30, 90];

function percent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

export default function AnalyticsPage() {
  const session = useSession();
  const isAdmin = session?.user.role === "admin";
  const [days, setDays] = useState(30);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) {
      return;
    }
    let cancelled = false;
    api
      .get<{ data: Metrics }>("/admin/metrics", { params: { days } })
      .then(({ data }) => {
        if (!cancelled) {
          setMetrics(data.data);
          setError(null);
        }
      })
      .catch((err) => !cancelled && setError(errorMessage(err, "Could not load analytics.")));
    return () => {
      cancelled = true;
    };
  }, [isAdmin, days]);

  if (session && !isAdmin) {
    return (
      <div className="mx-auto mt-16 max-w-md text-center">
        <ShieldAlert className="mx-auto h-10 w-10 text-slate-300" aria-hidden />
        <h1 className="mt-3 text-lg font-semibold text-slate-900">Administrators only</h1>
      </div>
    );
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Analytics</h1>
          <p className="text-sm text-slate-600">
            How the assistant is used in your organization, from the audit log and answer ratings.
          </p>
        </div>
        <div role="group" aria-label="Time range" className="flex rounded-md border border-slate-300 bg-white p-0.5">
          {RANGES.map((range) => (
            <button
              key={range}
              type="button"
              onClick={() => setDays(range)}
              aria-pressed={days === range}
              className={`rounded px-3 py-1.5 text-sm font-medium ${
                days === range ? "bg-indigo-600 text-white" : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              {range} days
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      )}

      {!metrics ? (
        <div className="flex items-center justify-center gap-2 p-10 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading analytics…
        </div>
      ) : (
        <div className="space-y-6">
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="metric-tiles">
            <Tile label="Questions asked" value={metrics.totals.queries.toLocaleString()} />
            <Tile label="People asking" value={metrics.totals.distinct_users.toLocaleString()} />
            <Tile
              label="No answer found"
              value={percent(metrics.totals.no_answer_rate)}
              note={`${metrics.totals.no_answer} refused for lack of evidence · ${metrics.totals.failed_queries} errors`}
            />
            <Tile
              label="Rated helpful"
              value={percent(metrics.totals.helpful_rate)}
              note={`${metrics.totals.ratings} rating${metrics.totals.ratings === 1 ? "" : "s"}`}
            />
          </dl>

          <QueriesChart data={metrics.queries_per_day} />

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="Most-cited documents">
              {metrics.top_documents.length === 0 ? (
                <p className="text-sm text-slate-500">No answers with citations in this period.</p>
              ) : (
                <ol className="space-y-2.5">
                  {metrics.top_documents.map((document) => (
                    <li key={document.id}>
                      <div className="flex justify-between gap-3 text-sm">
                        <span className="truncate text-slate-800">{document.title}</span>
                        <span className="tabular-nums text-slate-600">{document.citations}</span>
                      </div>
                      <div className="mt-1 h-2 rounded-full bg-slate-100">
                        <div
                          className="h-2 rounded-full bg-indigo-600"
                          style={{ width: `${(document.citations / metrics.top_documents[0].citations) * 100}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </Panel>

            <Panel title="Current documents">
              <table className="w-full text-sm">
                <caption className="sr-only">Documents by clearance level</caption>
                <tbody className="divide-y divide-slate-100">
                  {metrics.documents_by_clearance.map((row) => (
                    <tr key={row.level}>
                      <td className="py-2">
                        <ClearanceBadge level={row.level} />
                      </td>
                      <td className="py-2 text-right tabular-nums text-slate-700">{row.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-xs text-slate-500">
                {Object.entries(metrics.documents_by_status)
                  .map(([status, count]) => `${count} ${status}`)
                  .join(" · ") || "No documents yet."}
              </p>
            </Panel>
          </div>

          <Panel title="Recent unhelpful answers">
            {metrics.recent_negative_feedback.length === 0 ? (
              <p className="text-sm text-slate-500">No thumbs-down ratings yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100" data-testid="negative-feedback">
                {metrics.recent_negative_feedback.map((item) => (
                  <li key={item.id} className="py-3 text-sm">
                    <p className="font-medium text-slate-900">{item.question || "(question unavailable)"}</p>
                    <p className="mt-0.5 text-slate-600">{item.answer}</p>
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                      <ThumbsDown className="h-3.5 w-3.5" aria-hidden />
                      {item.user ?? "Unknown"}
                      {item.comment && <>: &ldquo;{item.comment}&rdquo;</>}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs text-slate-500">
              These are good candidates for the evaluation question set in <code>ai-service/eval/golden.jsonl</code>.
            </p>
          </Panel>
        </div>
      )}
    </>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</dd>
      {note && <dd className="mt-0.5 text-xs text-slate-500">{note}</dd>}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

/** One series, so one hue and no legend: the title names it. */
function QueriesChart({ data }: { data: { date: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((day) => day.count));
  const format = (date: string) =>
    new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });

  return (
    <Panel title="Questions per day">
      <div className="flex h-40 items-end gap-[2px] border-b border-slate-200" role="img" aria-label="Questions per day; table below">
        {data.map((day) => (
          <div key={day.date} className="group relative flex h-full flex-1 items-end">
            <div
              className="w-full rounded-t bg-indigo-600 group-hover:bg-indigo-800"
              style={{ height: `${(day.count / max) * 100}%`, minHeight: day.count ? 2 : 0 }}
            />
            <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-xs text-white group-hover:block">
              {format(day.date)}: {day.count}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-xs text-slate-500">
        <span>{data[0] && format(data[0].date)}</span>
        <span>Peak {max === 1 && !data.some((d) => d.count) ? 0 : max}</span>
        <span>{data.at(-1) && format(data.at(-1)!.date)}</span>
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-xs font-medium text-slate-600">Show as table</summary>
        <table className="mt-2 w-full text-left text-xs">
          <thead className="text-slate-500">
            <tr>
              <th className="py-1 font-medium">Date</th>
              <th className="py-1 text-right font-medium">Questions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700">
            {data.map((day) => (
              <tr key={day.date}>
                <td className="py-1">{format(day.date)}</td>
                <td className="py-1 text-right tabular-nums">{day.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </Panel>
  );
}
