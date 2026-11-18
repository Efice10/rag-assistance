"use client";

import { Check, ChevronLeft, ChevronRight, FileText, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ClearanceBadge } from "@/components/Badges";
import { SourceViewer } from "@/components/SourceViewer";
import { api, errorMessage } from "@/lib/api";
import { formatRange, parseDay, refreshUpcoming, toDay, useUpcoming } from "@/lib/events";
import { confirmAction, toast } from "@/lib/feedback";
import { useSession } from "@/lib/session";
import type { CalendarEvent, Source } from "@/lib/types";
import { useUrlParam } from "@/lib/useUrlParam";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function currentMonth(): string {
  return toDay(new Date()).slice(0, 7);
}

/** The 6-week grid (Monday first) that shows the given YYYY-MM month. */
function gridFor(month: string): Date[] {
  const [year, m] = month.split("-").map(Number);
  const first = new Date(year, m - 1, 1);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

function shiftMonth(month: string, delta: number): string {
  const [year, m] = month.split("-").map(Number);
  return toDay(new Date(year, m - 1 + delta, 1)).slice(0, 7);
}

function onDay(event: CalendarEvent, day: string): boolean {
  return event.starts_at <= day && (event.ends_at ?? event.starts_at) >= day;
}

type Timing = "past" | "today" | "future";

/** Over, happening today (a multi-day event running today counts), or still to come. */
function timingOf(event: CalendarEvent, today: string): Timing {
  if ((event.ends_at ?? event.starts_at) < today) return "past";
  return event.starts_at <= today ? "today" : "future";
}

/** Owner's colour scheme: green past, red today, yellow future. */
const TIMING: Record<Timing, { label: string; chip: string; swatch: string }> = {
  past: { label: "Past", chip: "bg-emerald-50 text-emerald-800 ring-emerald-600/25", swatch: "bg-emerald-500" },
  today: { label: "Today", chip: "bg-rose-50 text-rose-800 ring-rose-600/40 font-semibold", swatch: "bg-rose-500" },
  future: { label: "Upcoming", chip: "bg-amber-50 text-amber-900 ring-amber-600/40", swatch: "bg-amber-400" },
};

export default function CalendarPage() {
  const session = useSession();
  const user = session?.user;
  const isReviewer = !!user?.can_upload;
  const [monthParam, setMonth] = useUrlParam("month", currentMonth());
  const month = /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : currentMonth();
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selected, setSelected] = useState<CalendarEvent | null>(null);
  const [viewing, setViewing] = useState<Source | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const upcoming = useUpcoming();

  const grid = useMemo(() => gridFor(month), [month]);
  const today = toDay(new Date());

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ data: CalendarEvent[] }>("/events", { params: { from: toDay(grid[0]), to: toDay(grid[41]) } })
      .then(({ data }) => {
        if (!cancelled) {
          setEvents(data.data);
          setError(null);
        }
      })
      .catch((err) => !cancelled && setError(errorMessage(err, "Could not load events.")));
    return () => {
      cancelled = true;
    };
  }, [grid, reload]);

  const reviewed = useCallback(() => {
    setReload((count) => count + 1);
    refreshUpcoming();
  }, []);

  const title = parseDay(`${month}-01`).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const dayEvents = selectedDay ? (events ?? []).filter((event) => onDay(event, selectedDay)) : [];

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Calendar</h1>
          <p className="text-sm text-slate-600">
            Meetings, deadlines and trainings found in the documents you can see. Upcoming ones are confirmed by a
            reviewer; past ones from this year are added as history.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMonth(currentMonth())}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Today
          </button>
          <div className="flex items-center rounded-md border border-slate-300 bg-white">
            <button
              type="button"
              onClick={() => setMonth(shiftMonth(month, -1))}
              aria-label="Previous month"
              className="rounded-l-md p-1.5 text-slate-600 hover:bg-slate-100"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </button>
            <h2 className="min-w-36 px-2 text-center text-sm font-semibold text-slate-900" aria-live="polite">
              {title}
            </h2>
            <button
              type="button"
              onClick={() => setMonth(shiftMonth(month, 1))}
              aria-label="Next month"
              className="rounded-r-md p-1.5 text-slate-600 hover:bg-slate-100"
            >
              <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <section aria-label={`Events in ${title}`} className="overflow-x-auto">
          <ul className="mb-2 flex flex-wrap items-center gap-4 text-xs text-slate-600" aria-label="Colour key" data-testid="legend">
            {(Object.keys(TIMING) as Timing[]).map((timing) => (
              <li key={timing} className="flex items-center gap-1.5">
                <span className={`h-2.5 w-2.5 rounded-sm ${TIMING[timing].swatch}`} aria-hidden />
                {TIMING[timing].label}
              </li>
            ))}
          </ul>
          <div className="min-w-[560px] rounded-xl border border-slate-200 bg-white shadow-sm" data-testid="month-grid">
            <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-xs font-medium uppercase tracking-wide text-slate-500">
              {WEEKDAYS.map((weekday) => (
                <div key={weekday} className="py-2">
                  {weekday}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {grid.map((date) => {
                const day = toDay(date);
                const inMonth = day.startsWith(month);
                const items = (events ?? []).filter((event) => onDay(event, day));
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => {
                      setSelectedDay(day);
                      setSelected(items.length === 1 ? items[0] : null);
                    }}
                    aria-label={`${date.toLocaleDateString(undefined, { dateStyle: "full" })}, ${items.length} event${items.length === 1 ? "" : "s"}`}
                    aria-pressed={selectedDay === day}
                    className={`min-h-24 border-b border-r border-slate-100 p-1.5 text-left align-top hover:bg-slate-50 ${
                      selectedDay === day ? "bg-indigo-50/60" : ""
                    }`}
                  >
                    <span
                      className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                        day === today
                          ? "bg-indigo-600 font-semibold text-on-accent"
                          : inMonth
                            ? "text-slate-800"
                            : "text-slate-400"
                      }`}
                    >
                      {date.getDate()}
                    </span>
                    <span className="mt-1 block space-y-0.5">
                      {items.slice(0, 3).map((event) => {
                        const timing = timingOf(event, today);
                        return (
                          <span
                            key={event.id}
                            data-testid="event-chip"
                            data-timing={timing}
                            title={`${TIMING[timing].label}: ${event.title}`}
                            className={`block truncate rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${TIMING[timing].chip}`}
                          >
                            {event.title}
                          </span>
                        );
                      })}
                      {items.length > 3 && <span className="block text-[11px] text-slate-500">+{items.length - 3} more</span>}
                    </span>
                  </button>
                );
              })}
            </div>
            {events === null && (
              <p className="flex items-center justify-center gap-2 p-3 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading events…
              </p>
            )}
          </div>
        </section>

        <aside className="space-y-4">
          <EventDetail
            day={selectedDay}
            events={dayEvents}
            selected={selected}
            onSelect={setSelected}
            onOpenSource={setViewing}
          />
          {isReviewer && <ReviewPanel pendingCount={upcoming.pendingReview ?? 0} onReviewed={reviewed} />}
        </aside>
      </div>

      {viewing && <SourceViewer source={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}

function TimingBadge({ timing }: { timing: Timing }) {
  return (
    <span
      data-testid="timing-badge"
      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${TIMING[timing].chip}`}
    >
      {TIMING[timing].label}
    </span>
  );
}

function EventDetail({
  day,
  events,
  selected,
  onSelect,
  onOpenSource,
}: {
  day: string | null;
  events: CalendarEvent[];
  selected: CalendarEvent | null;
  onSelect: (event: CalendarEvent | null) => void;
  onOpenSource: (source: Source) => void;
}) {
  const today = toDay(new Date());

  if (!day) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
        Select a day to see its events.
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" data-testid="event-detail">
      <h2 className="text-sm font-semibold text-slate-900">
        {parseDay(day).toLocaleDateString(undefined, { dateStyle: "full" })}
      </h2>
      {events.length === 0 ? (
        <p className="mt-2 text-sm text-slate-600">No events.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {events.map((event) => (
            <li key={event.id}>
              <button
                type="button"
                onClick={() => onSelect(selected?.id === event.id ? null : event)}
                aria-expanded={selected?.id === event.id}
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-left hover:bg-slate-50"
              >
                <span className="flex items-start justify-between gap-2">
                  <span className="block text-sm font-medium text-slate-900">{event.title}</span>
                  <TimingBadge timing={timingOf(event, today)} />
                </span>
                <span className="block text-xs text-slate-500">{formatRange(event.starts_at, event.ends_at)}</span>
              </button>
              {selected?.id === event.id && (
                <div className="mt-2 space-y-2 px-1 text-sm">
                  <p className="text-slate-600">&ldquo;{event.snippet}&rdquo;</p>
                  {event.auto_confirmed && (
                    <p className="text-xs text-slate-500" data-testid="auto-confirmed">
                      Added automatically: the date had already passed when the document was indexed.
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <ClearanceBadge level={event.clearance_level} />
                    {event.department && <span className="text-xs text-slate-500">{event.department.name}</span>}
                  </div>
                  {event.document && (
                    <button
                      type="button"
                      data-testid="event-source"
                      onClick={() =>
                        onOpenSource({
                          document_id: event.document!.id,
                          document_title: event.document!.title,
                          page_number: event.page_number,
                        })
                      }
                      className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-800 hover:bg-indigo-100"
                    >
                      <FileText className="h-3.5 w-3.5" aria-hidden />
                      {event.document.title} • Page {event.page_number}
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ReviewPanel({ pendingCount, onReviewed }: { pendingCount: number; onReviewed: () => void }) {
  const [pending, setPending] = useState<CalendarEvent[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<number, { title: string; starts_at: string; ends_at: string }>>({});

  const load = useCallback(() => {
    api
      .get<{ data: CalendarEvent[] }>("/events/pending")
      .then(({ data }) => setPending(data.data))
      .catch((err) => toast.error(errorMessage(err, "Could not load events waiting for review.")));
  }, []);

  useEffect(() => {
    load();
  }, [load, pendingCount]);

  function draftFor(event: CalendarEvent) {
    return drafts[event.id] ?? { title: event.title, starts_at: event.starts_at, ends_at: event.ends_at ?? "" };
  }

  function edit(event: CalendarEvent, change: Partial<{ title: string; starts_at: string; ends_at: string }>) {
    setDrafts((current) => ({ ...current, [event.id]: { ...draftFor(event), ...change } }));
  }

  async function decide(event: CalendarEvent, action: "confirm" | "reject") {
    if (action === "reject") {
      const confirmed = await confirmAction({
        title: `Reject "${event.title}"?`,
        body: "It will not appear on anyone's calendar. If the document is re-indexed with the same date, it stays rejected.",
        confirmLabel: "Reject",
        tone: "danger",
      });
      if (!confirmed) {
        return;
      }
    }
    const draft = draftFor(event);
    setBusy(event.id);
    try {
      await api.post(
        `/events/${event.id}/${action}`,
        action === "confirm" ? { title: draft.title.trim(), starts_at: draft.starts_at, ends_at: draft.ends_at || null } : undefined,
      );
      setPending((current) => current?.filter((item) => item.id !== event.id) ?? null);
      toast.success(action === "confirm" ? `"${draft.title}" added to the calendar.` : `"${event.title}" rejected.`);
      onReviewed();
    } catch (err) {
      toast.error(errorMessage(err, "Could not save the decision."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" data-testid="review-panel">
      <h2 className="text-sm font-semibold text-slate-900">Waiting for review</h2>
      <p className="mt-0.5 text-xs text-slate-500">
        Dates found in documents. Check each against its source, correct it if needed, then confirm or reject.
      </p>
      {pending === null ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading…
        </p>
      ) : pending.length === 0 ? (
        <p className="mt-3 text-sm text-slate-600">Nothing to review.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {pending.map((event) => {
            const draft = draftFor(event);
            return (
              <li key={event.id} className="rounded-md border border-slate-200 p-3" data-testid="pending-event">
                <p className="text-xs text-slate-500">
                  {event.document?.title} · Page {event.page_number}
                </p>
                <p className="mt-1 text-xs italic text-slate-600">&ldquo;{event.snippet}&rdquo;</p>
                <label className="mt-2 block text-xs font-medium text-slate-700">
                  Title
                  <input
                    value={draft.title}
                    maxLength={200}
                    onChange={(e) => edit(event, { title: e.target.value })}
                    className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900"
                  />
                </label>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <label className="text-xs font-medium text-slate-700">
                    Starts
                    <input
                      type="date"
                      value={draft.starts_at}
                      onChange={(e) => edit(event, { starts_at: e.target.value })}
                      className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900"
                    />
                  </label>
                  <label className="text-xs font-medium text-slate-700">
                    Ends (optional)
                    <input
                      type="date"
                      value={draft.ends_at}
                      min={draft.starts_at}
                      onChange={(e) => edit(event, { ends_at: e.target.value })}
                      className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900"
                    />
                  </label>
                </div>
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => decide(event, "reject")}
                    disabled={busy === event.id}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden /> Reject
                  </button>
                  <button
                    type="button"
                    onClick={() => decide(event, "confirm")}
                    disabled={busy === event.id || !draft.title.trim() || !draft.starts_at}
                    className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-on-accent hover:bg-indigo-500 disabled:opacity-50"
                  >
                    <Check className="h-3.5 w-3.5" aria-hidden /> Confirm
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
