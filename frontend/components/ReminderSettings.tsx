"use client";

import { BellRing, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { refreshUpcoming } from "@/lib/events";
import { toast } from "@/lib/feedback";

/** Admin setting: how many days ahead the event reminder banner looks. */
export function ReminderSettings() {
  const [days, setDays] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .get<{ data: { event_reminder_days: number } }>("/admin/settings")
      .then(({ data }) => setDays(data.data.event_reminder_days))
      .catch((err) => toast.error(errorMessage(err, "Could not load organization settings.")));
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (days === null) {
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.put<{ data: { event_reminder_days: number } }>("/admin/settings", {
        event_reminder_days: days,
      });
      setDays(data.data.event_reminder_days);
      toast.success(`Reminders now look ${data.data.event_reminder_days} days ahead.`);
      refreshUpcoming();
    } catch (err) {
      toast.error(errorMessage(err, "Could not save the setting."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="reminder-heading" className="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 id="reminder-heading" className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        <BellRing className="h-4 w-4 text-slate-500" aria-hidden /> Event reminders
      </h2>
      <p className="mt-1 text-xs text-slate-500">
        Everyone sees a reminder for confirmed events coming up within this many days.
      </p>
      <form onSubmit={save} className="mt-3 flex items-end gap-2">
        <label className="text-sm font-medium text-slate-700">
          Days ahead
          <input
            type="number"
            min={1}
            max={60}
            required
            value={days ?? ""}
            disabled={days === null}
            onChange={(e) => setDays(e.target.value === "" ? null : Number(e.target.value))}
            className="mt-1 block w-24 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900"
          />
        </label>
        <button
          type="submit"
          disabled={saving || days === null}
          className="flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-on-accent hover:bg-indigo-500 disabled:opacity-50"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Save
        </button>
      </form>
    </section>
  );
}
