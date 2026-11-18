"use client";

import {
  Building2,
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Pencil,
  Plus,
  Search,
  ShieldAlert,
  UserPlus,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ClearanceBadge } from "@/components/Badges";
import { SsoSettings } from "@/components/SsoSettings";
import { UserModal } from "@/components/UserModal";
import { api, errorMessage } from "@/lib/api";
import { setSession, useSession } from "@/lib/session";
import { ROLE_LABELS, type DepartmentRow, type ManagedUser, type PageMeta, type User } from "@/lib/types";

const BUTTON =
  "rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50";

export default function UsersPage() {
  const session = useSession();
  const actor = session?.user;
  const isAdmin = actor?.role === "admin";

  const [users, setUsers] = useState<ManagedUser[] | null>(null);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [modal, setModal] = useState<{ editing: ManagedUser | null } | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const loadDepartments = useCallback(() => {
    api
      .get<{ data: DepartmentRow[] }>("/departments")
      .then(({ data }) => setDepartments(data.data))
      .catch((err) => setError(errorMessage(err, "Could not load departments.")));
  }, []);

  useEffect(() => {
    if (!isAdmin) {
      return;
    }
    let cancelled = false;
    api
      .get<{ data: ManagedUser[]; meta: PageMeta }>("/users", { params: { page, q: search || undefined } })
      .then(({ data }) => {
        if (!cancelled) {
          setUsers(data.data);
          setMeta(data.meta);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(errorMessage(err, "Could not load users."));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin, page, search, reload]);

  useEffect(() => {
    if (isAdmin) {
      loadDepartments();
    }
  }, [isAdmin, loadDepartments]);

  if (session && !isAdmin) {
    return (
      <div className="mx-auto mt-16 max-w-md text-center">
        <ShieldAlert className="mx-auto h-10 w-10 text-slate-300" aria-hidden />
        <h1 className="mt-3 text-lg font-semibold text-slate-900">Administrators only</h1>
        <p className="mt-1 text-sm text-slate-600">
          User accounts are managed by your organization&apos;s administrators.
        </p>
      </div>
    );
  }

  function replace(updated: ManagedUser) {
    setUsers((current) => current?.map((user) => (user.id === updated.id ? updated : user)) ?? null);
  }

  async function setActive(user: ManagedUser, active: boolean) {
    setPending(user.id);
    setError(null);
    try {
      const { data } = await api.put<{ data: ManagedUser }>(
        `/users/${user.id}/${active ? "reactivate" : "deactivate"}`,
      );
      replace(data.data);
    } catch (err) {
      setError(errorMessage(err, "Could not change the account status."));
    } finally {
      setPending(null);
      setConfirming(null);
    }
  }

  async function saved(user: ManagedUser) {
    setModal(null);
    setReload((count) => count + 1);
    loadDepartments();
    // Editing your own name or department: refresh the sidebar profile too.
    if (session && user.id === session.user.id) {
      const { data } = await api.get<{ user: User }>("/me");
      setSession({ token: session.token, user: data.user });
    }
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Users</h1>
          <p className="text-sm text-slate-600">
            Accounts in {actor?.organization?.name ?? "your organization"}. Deactivated accounts cannot sign in
            but stay on record, so their audit history is kept.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setModal({ editing: null })}
          disabled={departments.length === 0}
          className="flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          <UserPlus className="h-4 w-4" aria-hidden /> Add user
        </button>
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <section aria-labelledby="users-heading">
          <h2 id="users-heading" className="sr-only">
            User accounts
          </h2>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setPage(1);
              setSearch(searchInput.trim());
            }}
            className="mb-3 flex items-center gap-2"
            role="search"
          >
            <label className="sr-only" htmlFor="user-search">
              Search by name or email
            </label>
            <div className="relative flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" aria-hidden />
              <input
                id="user-search"
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Search by name or email"
                className="w-full rounded-md border border-slate-300 bg-white py-2 pl-8 pr-3 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
              />
            </div>
            <button
              type="submit"
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Search
            </button>
          </form>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            {users === null ? (
              <div className="flex items-center justify-center gap-2 p-10 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading users…
              </div>
            ) : users.length === 0 ? (
              <p className="p-10 text-center text-sm text-slate-600">
                {search ? `No users match "${search}".` : "No users yet."}
              </p>
            ) : (
              <table className="w-full min-w-[680px] text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">Department</th>
                    <th className="px-4 py-3 font-medium">Role</th>
                    <th className="px-4 py-3 font-medium">Clearance</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {users.map((user) => {
                    const isSelf = user.id === actor?.id;
                    return (
                      <tr key={user.id} data-testid="user-row" className={user.active ? "" : "bg-slate-50/60"}>
                        <td className="px-4 py-3">
                          <p className={`font-medium ${user.active ? "text-slate-900" : "text-slate-500"}`}>
                            {user.name}
                            {isSelf && <span className="ml-1.5 text-xs font-normal text-slate-500">(you)</span>}
                          </p>
                          <p className="text-xs text-slate-500">{user.email}</p>
                        </td>
                        <td className="px-4 py-3 text-slate-700">{user.department?.name ?? "—"}</td>
                        <td className="px-4 py-3 text-slate-700">{ROLE_LABELS[user.role]}</td>
                        <td className="px-4 py-3">
                          <ClearanceBadge level={user.clearance_level} />
                        </td>
                        <td className="px-4 py-3">
                          <span
                            data-testid="user-status"
                            className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
                              user.active
                                ? "bg-emerald-50 text-emerald-800 ring-emerald-600/20"
                                : "bg-slate-100 text-slate-600 ring-slate-500/20"
                            }`}
                          >
                            {user.active ? "Active" : "Deactivated"}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          {confirming === user.id ? (
                            <span className="inline-flex items-center gap-1.5">
                              <span className="text-xs text-slate-600">Sign them out and block access?</span>
                              <button
                                type="button"
                                onClick={() => setActive(user, false)}
                                disabled={pending === user.id}
                                className="rounded-md bg-rose-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-50"
                              >
                                Deactivate
                              </button>
                              <button type="button" onClick={() => setConfirming(null)} className={BUTTON}>
                                Cancel
                              </button>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => setModal({ editing: user })}
                                className={`${BUTTON} inline-flex items-center gap-1`}
                                aria-label={`Edit ${user.name}`}
                              >
                                <Pencil className="h-3.5 w-3.5" aria-hidden /> Edit
                              </button>
                              {!isSelf &&
                                (user.active ? (
                                  <button type="button" onClick={() => setConfirming(user.id)} className={BUTTON}>
                                    Deactivate
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setActive(user, true)}
                                    disabled={pending === user.id}
                                    className={BUTTON}
                                  >
                                    Reactivate
                                  </button>
                                ))}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {meta && meta.last_page > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
              <p>
                Page {meta.current_page} of {meta.last_page} · {meta.total} users
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
        </section>

        <DepartmentsPanel departments={departments} onChanged={loadDepartments} />
      </div>

      <SsoSettings departments={departments} />

      {modal && actor && (
        <UserModal
          actor={actor}
          editing={modal.editing}
          departments={departments}
          onClose={() => setModal(null)}
          onSaved={saved}
        />
      )}
    </>
  );
}

function DepartmentsPanel({ departments, onChanged }: { departments: DepartmentRow[]; onChanged: () => void }) {
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(request: Promise<unknown>, after: () => void) {
    setBusy(true);
    setError(null);
    try {
      await request;
      after();
      onChanged();
    } catch (err) {
      setError(errorMessage(err, "Could not save the department."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="departments-heading"
      className="h-fit rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <h2 id="departments-heading" className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        <Building2 className="h-4 w-4 text-slate-500" aria-hidden /> Departments
      </h2>
      <p className="mt-1 text-xs text-slate-500">Documents and non-admin users each belong to one department.</p>

      <ul className="mt-3 divide-y divide-slate-100" data-testid="department-list">
        {departments.map((department) => (
          <li key={department.id} className="flex items-center gap-2 py-2">
            {editingId === department.id ? (
              <form
                className="flex flex-1 items-center gap-1"
                onSubmit={(event) => {
                  event.preventDefault();
                  save(api.put(`/departments/${department.id}`, { name: editName.trim() }), () => setEditingId(null));
                }}
              >
                <label className="sr-only" htmlFor={`department-${department.id}`}>
                  Department name
                </label>
                <input
                  id={`department-${department.id}`}
                  value={editName}
                  maxLength={100}
                  required
                  autoFocus
                  onChange={(event) => setEditName(event.target.value)}
                  className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                />
                <button type="submit" disabled={busy} aria-label="Save name" className="rounded p-1 text-emerald-700 hover:bg-emerald-50">
                  <Check className="h-4 w-4" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => setEditingId(null)}
                  aria-label="Cancel rename"
                  className="rounded p-1 text-slate-500 hover:bg-slate-100"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </form>
            ) : (
              <>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">{department.name}</p>
                  <p className="text-xs text-slate-500">
                    {department.users_count ?? 0} users · {department.documents_count ?? 0} documents
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(department.id);
                    setEditName(department.name);
                  }}
                  aria-label={`Rename ${department.name}`}
                  className="rounded p-1 text-slate-500 hover:bg-slate-100"
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                </button>
              </>
            )}
          </li>
        ))}
      </ul>

      <form
        className="mt-3 flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          save(api.post("/departments", { name: newName.trim() }), () => setNewName(""));
        }}
      >
        <label className="sr-only" htmlFor="new-department">
          New department name
        </label>
        <input
          id="new-department"
          value={newName}
          maxLength={100}
          required
          placeholder="New department"
          onChange={(event) => setNewName(event.target.value)}
          className="min-w-0 flex-1 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
        />
        <button
          type="submit"
          disabled={busy || !newName.trim()}
          className="flex items-center gap-1 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" aria-hidden /> Add
        </button>
      </form>

      {error && (
        <p role="alert" className="mt-2 rounded-md bg-rose-50 px-2.5 py-1.5 text-xs text-rose-800">
          {error}
        </p>
      )}
    </section>
  );
}
