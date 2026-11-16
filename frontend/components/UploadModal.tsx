"use client";

import { Loader2, UploadCloud, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { CLEARANCE_LABELS, type DocumentItem, type NamedRef, type User } from "@/lib/types";

const MAX_BYTES = 20 * 1024 * 1024;

function isAccepted(file: File): boolean {
  return /\.(pdf|docx)$/i.test(file.name);
}

export function UploadModal({
  user,
  onClose,
  onUploaded,
}: {
  user: User;
  onClose: () => void;
  onUploaded: (document: DocumentItem) => void;
}) {
  const [departments, setDepartments] = useState<NamedRef[]>([]);
  const [title, setTitle] = useState("");
  const [departmentId, setDepartmentId] = useState<number | "">(user.department?.id ?? "");
  const [clearance, setClearance] = useState(1);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ data: NamedRef[] }>("/departments")
      .then(({ data }) => {
        if (!cancelled) {
          setDepartments(data.data);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(errorMessage(err, "Could not load departments."));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, submitting]);

  function chooseFile(candidate: File | undefined) {
    if (!candidate) {
      return;
    }
    if (!isAccepted(candidate)) {
      setError("Only PDF and DOCX files are accepted.");
      return;
    }
    if (candidate.size > MAX_BYTES) {
      setError("The file is larger than 20 MB.");
      return;
    }
    setError(null);
    setFile(candidate);
    if (!title) {
      setTitle(candidate.name.replace(/\.(pdf|docx)$/i, "").replace(/[-_]+/g, " "));
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!file || departmentId === "") {
      setError("Choose a file and a department.");
      return;
    }

    const form = new FormData();
    form.append("title", title.trim());
    form.append("department_id", String(departmentId));
    form.append("clearance_level", String(clearance));
    form.append("file", file);

    setSubmitting(true);
    setError(null);
    try {
      const { data } = await api.post<{ data: DocumentItem }>("/documents", form);
      onUploaded(data.data);
    } catch (err) {
      setError(errorMessage(err, "The upload failed. Try again."));
      setSubmitting(false);
    }
  }

  const levels = Array.from({ length: user.clearance_level }, (_, index) => index + 1);

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="upload-title"
    >
      <form onSubmit={submit} className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="upload-title" className="text-lg font-semibold text-slate-900">
            Upload document
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
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              chooseFile(event.dataTransfer.files[0]);
            }}
            className={`rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
              dragging ? "border-indigo-500 bg-indigo-50" : "border-slate-300 bg-slate-50"
            }`}
          >
            <UploadCloud className="mx-auto h-8 w-8 text-slate-400" aria-hidden />
            <p className="mt-2 text-sm text-slate-700">
              {file ? <span className="font-medium">{file.name}</span> : "Drag a PDF or DOCX here"}
            </p>
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="mt-2 text-sm font-medium text-indigo-700 underline-offset-2 hover:underline"
            >
              {file ? "Choose a different file" : "or browse your computer"}
            </button>
            <input
              ref={fileInput}
              type="file"
              name="file"
              accept=".pdf,.docx"
              className="sr-only"
              aria-label="Document file"
              onChange={(event) => chooseFile(event.target.files?.[0])}
            />
            <p className="mt-1 text-xs text-slate-500">Up to 20 MB</p>
          </div>

          <label className="block text-sm font-medium text-slate-700">
            Title
            <input
              type="text"
              name="title"
              required
              maxLength={255}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium text-slate-700">
              Department
              <select
                name="department_id"
                required
                value={departmentId}
                onChange={(event) => setDepartmentId(event.target.value ? Number(event.target.value) : "")}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
              >
                {departments.length === 0 && <option value="">Loading…</option>}
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm font-medium text-slate-700">
              Clearance level
              <select
                name="clearance_level"
                value={clearance}
                onChange={(event) => setClearance(Number(event.target.value))}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
              >
                {levels.map((level) => (
                  <option key={level} value={level}>
                    {level} · {CLEARANCE_LABELS[level]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <p className="text-xs text-slate-500">
            Only people in this department with this clearance level or higher will be able to find, download, or
            ask questions about this document.
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
            disabled={submitting || !file || departments.length === 0}
            className="flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {submitting ? "Uploading…" : "Upload"}
          </button>
        </div>
      </form>
    </div>
  );
}
