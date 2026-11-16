"use client";

import { useSyncExternalStore } from "react";
import type { Session } from "./types";

const STORAGE_KEY = "era.session";

// undefined = not read yet, null = signed out.
let cached: Session | null | undefined;
const listeners = new Set<() => void>();

function read(): Session | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function getSession(): Session | null {
  if (typeof window === "undefined") {
    return null;
  }
  if (cached === undefined) {
    cached = read();
  }
  return cached;
}

export function setSession(session: Session | null): void {
  cached = session;
  try {
    if (session) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Storage can be unavailable (private mode); the in-memory session still works.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The current session. `undefined` while the page is still hydrating, so
 * callers can tell "not loaded yet" apart from "signed out" (`null`).
 */
export function useSession(): Session | null | undefined {
  return useSyncExternalStore(subscribe, getSession, () => undefined);
}
