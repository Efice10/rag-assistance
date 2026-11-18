import { AlertCircle, CheckCircle2, Clock, Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { CLEARANCE_LABELS, type DocumentStatus } from "@/lib/types";

export const CLEARANCE_STYLES: Record<number, string> = {
  1: "bg-emerald-50 text-emerald-800 ring-emerald-600/20",
  2: "bg-sky-50 text-sky-800 ring-sky-600/20",
  3: "bg-amber-50 text-amber-900 ring-amber-600/30",
  4: "bg-rose-50 text-rose-800 ring-rose-600/20",
};

export function ClearanceBadge({ level, showIcon = false }: { level: number; showIcon?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
        CLEARANCE_STYLES[level] ?? "bg-slate-100 text-slate-700 ring-slate-500/20"
      }`}
    >
      {showIcon && <ShieldCheck className="h-3.5 w-3.5" aria-hidden />}
      L{level} · {CLEARANCE_LABELS[level] ?? "Unknown"}
    </span>
  );
}

const STATUS: Record<DocumentStatus, { label: string; style: string; icon: React.ReactNode }> = {
  pending: {
    label: "Pending",
    style: "bg-slate-100 text-slate-700 ring-slate-500/20",
    icon: <Clock className="h-3.5 w-3.5" aria-hidden />,
  },
  processing: {
    label: "Processing",
    style: "bg-indigo-50 text-indigo-800 ring-indigo-600/20",
    icon: <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />,
  },
  indexed: {
    label: "Indexed",
    style: "bg-emerald-50 text-emerald-800 ring-emerald-600/20",
    icon: <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />,
  },
  failed: {
    label: "Failed",
    style: "bg-rose-50 text-rose-800 ring-rose-600/20",
    icon: <AlertCircle className="h-3.5 w-3.5" aria-hidden />,
  },
  flagged: {
    label: "Held for review",
    style: "bg-amber-50 text-amber-900 ring-amber-600/30",
    icon: <ShieldAlert className="h-3.5 w-3.5" aria-hidden />,
  },
};

export function StatusBadge({ status }: { status: DocumentStatus }) {
  const { label, style, icon } = STATUS[status];
  return (
    <span
      data-status={status}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${style}`}
    >
      {icon}
      {label}
    </span>
  );
}
