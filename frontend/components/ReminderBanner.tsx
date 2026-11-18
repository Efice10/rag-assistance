"use client";

import { BellRing, X } from "lucide-react";
import Link from "next/link";
import { dismissReminder, formatRange, useUpcoming } from "@/lib/events";
import { toast } from "@/lib/feedback";

/** "3 upcoming events in the next 7 days", each dismissable (module 29). */
export function ReminderBanner() {
  const { events, days } = useUpcoming();

  if (events.length === 0) {
    return null;
  }

  async function dismiss(id: number) {
    try {
      await dismissReminder(id);
    } catch {
      toast.error("Could not dismiss that reminder.");
    }
  }

  return (
    <section
      aria-label="Upcoming events"
      data-testid="reminder-banner"
      className="mb-5 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-medium text-indigo-800">
          <BellRing className="h-4 w-4" aria-hidden />
          {events.length} upcoming event{events.length === 1 ? "" : "s"} in the next {days} day{days === 1 ? "" : "s"}
        </p>
        <Link href="/calendar" className="text-xs font-medium text-indigo-700 underline-offset-2 hover:underline">
          View calendar
        </Link>
      </div>
      <ul className="mt-2 space-y-1">
        {events.slice(0, 5).map((event) => (
          <li key={event.id} className="flex items-center gap-2 text-slate-700">
            <span className="w-44 shrink-0 text-xs font-medium text-slate-600">
              {formatRange(event.starts_at, event.ends_at)}
            </span>
            <span className="min-w-0 flex-1 truncate">{event.title}</span>
            <button
              type="button"
              onClick={() => dismiss(event.id)}
              aria-label={`Dismiss reminder: ${event.title}`}
              title="Dismiss this reminder (it stays on the calendar)"
              className="rounded p-0.5 text-slate-400 hover:bg-white hover:text-slate-600"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Next to "Calendar" in the sidebar: upcoming count, and pending reviews for reviewers. */
export function CalendarBadges({ upcoming, pending }: { upcoming: number; pending: number | null }) {
  return (
    <span className="flex items-center gap-1">
      {upcoming > 0 && (
        <span
          title={`${upcoming} upcoming`}
          className="rounded-full bg-indigo-600 px-1.5 text-[11px] font-semibold leading-5 text-on-accent"
        >
          {upcoming}
          <span className="sr-only"> upcoming events</span>
        </span>
      )}
      {!!pending && (
        <span
          title={`${pending} waiting for review`}
          className="rounded-full bg-amber-100 px-1.5 text-[11px] font-semibold leading-5 text-amber-900"
        >
          {pending}
          <span className="sr-only"> events waiting for review</span>
        </span>
      )}
    </span>
  );
}
