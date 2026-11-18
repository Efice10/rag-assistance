"use client";

import { useSyncExternalStore } from "react";
import { api } from "./api";
import type { CalendarEvent } from "./types";

/**
 * Upcoming events and the review count, shared by the reminder banner, the
 * navigation badges and the calendar page (module 29). Loaded once per
 * sign-in and refreshed after a review or a dismissal.
 */
export interface UpcomingState {
  loaded: boolean;
  events: CalendarEvent[];
  days: number;
  pendingReview: number | null;
}

const EMPTY: UpcomingState = { loaded: false, events: [], days: 7, pendingReview: null };
const listeners = new Set<() => void>();
let state: UpcomingState = EMPTY;

function emit(next: UpcomingState) {
  state = next;
  listeners.forEach((listener) => listener());
}

export async function refreshUpcoming(): Promise<void> {
  try {
    const { data } = await api.get<{
      data: CalendarEvent[];
      meta: { days: number; pending_review: number | null };
    }>("/events/upcoming");
    emit({ loaded: true, events: data.data, days: data.meta.days, pendingReview: data.meta.pending_review });
  } catch {
    // Reminders are a convenience: a failure leaves the last known state.
  }
}

/** Silence one reminder. The event stays on the calendar. */
export async function dismissReminder(id: number): Promise<void> {
  emit({ ...state, events: state.events.filter((event) => event.id !== id) });
  await api.post(`/events/${id}/dismiss`);
}

export function resetUpcoming() {
  emit(EMPTY);
}

export function useUpcoming(): UpcomingState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
    () => EMPTY,
  );
}

const MONTH_FORMAT = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "long", year: "numeric" });

/** Parse YYYY-MM-DD as a local calendar day (never shifted by time zones). */
export function parseDay(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function toDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** "3 December 2026", "1–2 December 2026", "30 November – 2 December 2026". */
export function formatRange(starts: string, ends: string | null): string {
  const start = parseDay(starts);
  if (!ends || ends === starts) {
    return MONTH_FORMAT.format(start);
  }
  const end = parseDay(ends);
  if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
    return `${start.getDate()}–${MONTH_FORMAT.format(end)}`;
  }
  const short = new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "long",
    ...(start.getFullYear() === end.getFullYear() ? {} : { year: "numeric" }),
  });
  return `${short.format(start)} – ${MONTH_FORMAT.format(end)}`;
}
