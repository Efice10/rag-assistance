"use client";

import { useCallback, useState } from "react";

function readParam(key: string): string | null {
  return typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get(key);
}

/**
 * A piece of page state mirrored in the address bar (?key=value), so a
 * filtered view survives a refresh and can be shared as a link. The default
 * value is left out of the URL.
 *
 * Pages under app/(app)/ render only in the browser (AppShell shows a spinner
 * until the session is read), so the initial value can come from
 * window.location without a hydration mismatch, and without the Suspense
 * boundary useSearchParams() would need.
 */
export function useUrlParam(key: string, fallback: string): [string, (value: string) => void] {
  const [value, setValue] = useState(() => readParam(key) ?? fallback);

  const update = useCallback(
    (next: string) => {
      setValue(next);
      const url = new URL(window.location.href);
      if (next === fallback || next === "") {
        url.searchParams.delete(key);
      } else {
        url.searchParams.set(key, next);
      }
      window.history.replaceState(window.history.state, "", url);
    },
    [key, fallback],
  );

  return [value, update];
}

/** The same, for a positive integer such as a page number. */
export function useUrlNumber(key: string, fallback: number, allowed?: number[]): [number, (value: number) => void] {
  const [raw, setRaw] = useUrlParam(key, String(fallback));
  const parsed = Number.parseInt(raw, 10);
  const value = Number.isFinite(parsed) && parsed > 0 && (!allowed || allowed.includes(parsed)) ? parsed : fallback;
  return [value, useCallback((next: number) => setRaw(String(next)), [setRaw])];
}
