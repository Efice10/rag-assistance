"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

/** Catches an unexpected error in any page of the app, keeping the sidebar usable. */
export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto mt-16 max-w-md text-center" role="alert">
      <AlertTriangle className="mx-auto h-10 w-10 text-amber-500" aria-hidden />
      <h1 className="mt-3 text-lg font-semibold text-slate-900">This page ran into a problem</h1>
      <p className="mt-1 text-sm text-slate-600">
        Nothing was changed. Try again, and if it keeps happening, check that the backend is running.
      </p>
      <div className="mt-4 flex justify-center gap-2">
        <button
          type="button"
          onClick={() => retry()}
          className="flex items-center gap-1.5 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-on-accent hover:bg-indigo-500"
        >
          <RotateCcw className="h-4 w-4" aria-hidden /> Try again
        </button>
        <Link
          href="/chat"
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          Go to chat
        </Link>
      </div>
    </div>
  );
}
