"use client";

import { useSyncExternalStore } from "react";

/**
 * Light, dark, or follow the system. The choice is a per-browser convenience
 * kept in localStorage; the inline script in app/layout.tsx applies it before
 * the first paint so the page never flashes the wrong theme.
 */
export type ThemeChoice = "light" | "dark" | "system";

const KEY = "theme";
const listeners = new Set<() => void>();

function read(): ThemeChoice {
  try {
    const value = window.localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(choice: ThemeChoice = read()) {
  const dark = choice === "dark" || (choice === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

export function setTheme(choice: ThemeChoice) {
  try {
    if (choice === "system") {
      window.localStorage.removeItem(KEY);
    } else {
      window.localStorage.setItem(KEY, choice);
    }
  } catch {
    // Storage blocked: the theme still applies for this page view.
  }
  current = choice;
  applyTheme(choice);
  listeners.forEach((listener) => listener());
}

let current: ThemeChoice | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Follow the operating system while the choice is "system".
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => (current ?? read()) === "system" && applyTheme("system");
  media.addEventListener("change", onChange);
  return () => {
    listeners.delete(listener);
    media.removeEventListener("change", onChange);
  };
}

export function useTheme(): ThemeChoice {
  return useSyncExternalStore(subscribe, () => (current ??= read()), () => "system");
}