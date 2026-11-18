"use client";

import { ChevronLeft, ChevronRight, Loader2, Search, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { AuditLogItem, PageMeta } from "@/lib/types";

/** Administrative actions, labelled so they stand apart from chat prompts. */
const ADMIN_ACTIONS: Record<string, string> = {
  "user.created": "User created",
  "user.updated": "User updated",
  "user.deactivated": "User deactivated",
  "user.reactivated": "User reactivated",
  "department.created": "Department created",
  "department.renamed": "Department renamed",
};

export default function AuditLogsPage() {
  const session = useSession();
  const isAdmin = session?.user.role === "admin";
  const [logs, setLogs] = useState<AuditLogItem[] | null>(null);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) {
      return;
    }
    let cancelled = false;
    api
      .get<{ data: AuditLogItem[]; meta: PageMeta }>("/audit-logs", { params: { page, q: search || undefined } })
      .then(({ data }) => {
        if (!cancelled) {
          setLogs(data.data);
          setMeta(data.meta);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(errorMessage(err, "Could not load audit logs."));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin, page, search]);

  if (session && !isAdmin) {
    return (
      <div className="mx-auto mt-16 max-w-md text-center">
        <ShieldAlert className="mx-auto h-10 w-10 text-slate-300" aria-hidden />
        <h1 className="mt-3 text-lg font-semibold text-slate-900">Administrators only</h1>
        <p className="mt-1 text-sm text-slate-600">
          Audit logs are visible to organization administrators. Ask an administrator if you need a record
          reviewed.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Audit logs</h1>
          <p className="text-sm text-slate-600">
            Every prompt sent to the assistant in your organization, with the documents it cited, and every
            change an administrator made to users or departments. Records cannot be edited or deleted.
          </p>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setPage(1);
            setSearch(searchInput.trim());
          }}
          className="flex items-center gap-2"
          role="search"
        >
          <label className="sr-only" htmlFor="audit-search">
            Search prompts or users
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" aria-hidden />
            <input
              id="audit-search"
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search prompts or users"
              className="w-56 rounded-md border border-slate-300 bg-white py-2 pl-8 pr-3 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            />
          </div>
          <button
            type="submit"
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Search
          </button>
        </form>
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        {logs === null ? (
          <div className="flex items-center justify-center gap-2 p-10 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading audit logs…
          </div>
        ) : logs.length === 0 ? (
          <p className="p-10 text-center text-sm text-slate-600">
            {search ? `No records match "${search}".` : "No prompts have been recorded yet."}
          </p>
        ) : (
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Time</th>
                <th className="px-4 py-3 font-medium">User</th>
                <th className="px-4 py-3 font-medium">Prompt or change</th>
                <th className="px-4 py-3 font-medium">Cited documents</th>
                <th className="px-4 py-3 font-medium">IP address</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 align-top">
              {logs.map((log) => (
                <tr key={log.id} data-testid="audit-row">
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                    {new Date(log.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">{log.user?.name ?? "Unknown"}</p>
                    <p className="text-xs text-slate-500">{log.user?.email}</p>
                  </td>
                  <td className="max-w-sm px-4 py-3 text-slate-800">
                    {ADMIN_ACTIONS[log.action] && (
                      <span className="mr-2 rounded bg-indigo-50 px-1.5 py-0.5 text-xs font-medium text-indigo-700">
                        {ADMIN_ACTIONS[log.action]}
                      </span>
                    )}
                    {log.prompt}
                    {log.action === "chat.query_failed" && (
                      <span className="ml-2 rounded bg-rose-50 px-1.5 py-0.5 text-xs font-medium text-rose-700">
                        Failed
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {log.documents.length === 0 ? (
                      <span className="text-slate-400">None</span>
                    ) : (
                      <ul className="space-y-0.5">
                        {log.documents.map((document) => (
                          <li key={document.id}>{document.title}</li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-600">
                    {log.ip_address ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {meta && meta.last_page > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
          <p>
            Page {meta.current_page} of {meta.last_page} · {meta.total} records
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={meta.current_page <= 1}
              className="flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden /> Previous
            </button>
            <button
              type="button"
              onClick={() => setPage((current) => current + 1)}
              disabled={meta.current_page >= meta.last_page}
              className="flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              Next <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
