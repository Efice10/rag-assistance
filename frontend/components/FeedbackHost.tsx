"use client";

import { AlertTriangle, CheckCircle2, X, XCircle } from "lucide-react";
import { useEffect, useRef } from "react";
import { dismissToast, usePendingConfirm, useToasts } from "@/lib/feedback";

/** Renders toasts and the confirmation dialog. Mounted once, in the root layout. */
export function FeedbackHost() {
  return (
    <>
      <Toasts />
      <ConfirmDialog />
    </>
  );
}

function Toasts() {
  const toasts = useToasts();

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2"
      data-testid="toasts"
    >
      {toasts.map((item) => (
        <div
          key={item.id}
          className="pointer-events-auto flex items-start gap-2.5 rounded-lg border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-800 shadow-lg"
        >
          {item.tone === "success" ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
          ) : (
            <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" aria-hidden />
          )}
          <p className="flex-1">{item.message}</p>
          <button
            type="button"
            onClick={() => dismissToast(item.id)}
            aria-label="Dismiss"
            className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}

function ConfirmDialog() {
  const request = usePendingConfirm();
  const cancelButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!request) {
      return;
    }
    // Focus the safe choice first.
    cancelButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        request.resolve(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [request]);

  if (!request) {
    return null;
  }

  const danger = request.tone === "danger";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => request.resolve(false)}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby={request.body ? "confirm-body" : undefined}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl"
      >
        <div className="flex gap-3">
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
              danger ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-800"
            }`}
          >
            <AlertTriangle className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h2 id="confirm-title" className="text-base font-semibold text-slate-900">
              {request.title}
            </h2>
            {request.body && (
              <p id="confirm-body" className="mt-1 text-sm text-slate-600">
                {request.body}
              </p>
            )}
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelButton}
            type="button"
            onClick={() => request.resolve(false)}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => request.resolve(true)}
            className={`rounded-md px-4 py-2 text-sm font-medium text-on-accent ${
              danger ? "bg-rose-600 hover:bg-rose-500" : "bg-indigo-600 hover:bg-indigo-500"
            }`}
          >
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
