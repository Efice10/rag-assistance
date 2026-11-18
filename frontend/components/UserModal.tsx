"use client";

import { Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import {
  CLEARANCE_LABELS,
  ROLE_LABELS,
  type DepartmentRow,
  type ManagedUser,
  type Role,
  type User,
} from "@/lib/types";

const FIELD =
  "mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 disabled:bg-slate-100 disabled:text-slate-500";

/** Create a user (`editing` null) or edit one. */
export function UserModal({
  actor,
  editing,
  departments,
  onClose,
  onSaved,
}: {
  actor: User;
  editing: ManagedUser | null;
  departments: DepartmentRow[];
  onClose: () => void;
  onSaved: (user: ManagedUser) => void;
}) {
  const isSelf = editing?.id === actor.id;
  const [name, setName] = useState(editing?.name ?? "");
  const [email, setEmail] = useState(editing?.email ?? "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>(editing?.role ?? "staff");
  const [departmentId, setDepartmentId] = useState<number | "">(editing?.department?.id ?? departments[0]?.id ?? "");
  const [clearance, setClearance] = useState(editing?.clearance_level ?? 1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, submitting]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (departmentId === "") {
      setError("Choose a department.");
      return;
    }

    const payload: Record<string, unknown> = {
      name: name.trim(),
      email: email.trim(),
      role,
      department_id: departmentId,
      clearance_level: clearance,
    };
    if (password || !editing) {
      payload.password = password;
    }

    setSubmitting(true);
    setError(null);
    try {
      const { data } = editing
        ? await api.put<{ data: ManagedUser }>(`/users/${editing.id}`, payload)
        : await api.post<{ data: ManagedUser }>("/users", payload);
      onSaved(data.data);
    } catch (err) {
      setError(errorMessage(err, "Could not save the user. Try again."));
      setSubmitting(false);
    }
  }

  // Nobody can grant a clearance above their own; keep an existing higher
  // value visible so the form does not silently change it.
  const maxLevel = Math.max(actor.clearance_level, editing?.clearance_level ?? 1);
  const levels = Array.from({ length: maxLevel }, (_, index) => index + 1);

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="user-modal-title"
    >
      <form onSubmit={submit} className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="user-modal-title" className="text-lg font-semibold text-slate-900">
            {editing ? `Edit ${editing.name}` : "Add user"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
            className="rounded-md p-1 text-slate-500 hover:bg-slate-100"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium text-slate-700">
              Name
              <input
                type="text"
                name="name"
                required
                maxLength={255}
                value={name}
                onChange={(event) => setName(event.target.value)}
                className={FIELD}
              />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Email
              <input
                type="email"
                name="email"
                required
                maxLength={255}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={FIELD}
              />
            </label>
          </div>

          <label className="block text-sm font-medium text-slate-700">
            {editing ? "New password" : "Initial password"}
            <input
              type="password"
              name="password"
              autoComplete="new-password"
              required={!editing}
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={FIELD}
            />
            <span className="mt-1 block text-xs font-normal text-slate-500">
              {editing
                ? "Leave blank to keep the current password. Setting one signs the user out everywhere."
                : "At least 8 characters. Share it with the user through a secure channel."}
            </span>
          </label>

          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block text-sm font-medium text-slate-700">
              Role
              <select
                name="role"
                value={role}
                disabled={isSelf}
                onChange={(event) => setRole(event.target.value as Role)}
                className={FIELD}
              >
                {(Object.keys(ROLE_LABELS) as Role[]).map((value) => (
                  <option key={value} value={value}>
                    {ROLE_LABELS[value]}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm font-medium text-slate-700">
              Department
              <select
                name="department_id"
                required
                value={departmentId}
                onChange={(event) => setDepartmentId(event.target.value ? Number(event.target.value) : "")}
                className={FIELD}
              >
                {departments.length === 0 && <option value="">No departments</option>}
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm font-medium text-slate-700">
              Clearance
              <select
                name="clearance_level"
                value={clearance}
                onChange={(event) => setClearance(Number(event.target.value))}
                className={FIELD}
              >
                {levels.map((level) => (
                  <option key={level} value={level} disabled={level > actor.clearance_level}>
                    {level} · {CLEARANCE_LABELS[level]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <p className="text-xs text-slate-500">
            {isSelf
              ? "You cannot change your own role, so your organization always keeps an administrator."
              : "Role, department and clearance decide which documents this person can find. Changes apply from their next request."}
          </p>

          {error && (
            <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">
              {error}
            </p>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || departments.length === 0}
            className="flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-on-accent hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {submitting ? "Saving…" : editing ? "Save changes" : "Add user"}
          </button>
        </div>
      </form>
    </div>
  );
}
