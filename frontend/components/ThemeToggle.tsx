"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { setTheme, type ThemeChoice, useTheme } from "@/lib/theme";

const OPTIONS: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

/** Light / Dark / System. `compact` cycles through them with one icon button. */
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const theme = useTheme();

  if (compact) {
    const index = OPTIONS.findIndex((option) => option.value === theme);
    const { icon: Icon, label } = OPTIONS[index];
    const next = OPTIONS[(index + 1) % OPTIONS.length];
    return (
      <button
        type="button"
        onClick={() => setTheme(next.value)}
        title={`Theme: ${label}. Switch to ${next.label.toLowerCase()}`}
        className="rounded-md p-2 text-slate-600 hover:bg-slate-100"
      >
        <Icon className="h-4 w-4" aria-hidden />
        <span className="sr-only">Theme: {label}. Switch to {next.label.toLowerCase()}</span>
      </button>
    );
  }

  return (
    <div role="radiogroup" aria-label="Theme" className="flex rounded-md border border-slate-300 bg-white p-0.5">
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={theme === value}
          onClick={() => setTheme(value)}
          title={label}
          className={`flex flex-1 items-center justify-center rounded py-1 ${
            theme === value ? "bg-slate-100 text-slate-900" : "text-slate-500 hover:text-slate-800"
          }`}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden />
          <span className="sr-only">{label}</span>
        </button>
      ))}
    </div>
  );
}
