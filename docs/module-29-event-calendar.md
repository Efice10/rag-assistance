# Module 29: Event Calendar

Proposed 2026-11-18. **Status: designed, not started.** Build only when the owner asks for it.

Part of [roadmap-phase-2.md](roadmap-phase-2.md) as module 29. Related modules:

- **20, policy acknowledgement:** its due dates could later appear on the same calendar.
- **21, policy review dates:** the same; review-by dates are calendar material.
- **27, email notifications:** email reminders are deferred to it (see the end of this document).

## Summary

Turn dated memos into calendar events. Dates mentioned in uploaded documents (for example "1-2 December 2026 meeting") are extracted at ingest, reviewed by an admin, shown on a calendar page, and surfaced to users as in-app reminders.

## Scope

**In scope:**

- Date extraction during ingest
- `document_events` storage
- Admin review: confirm, edit or reject
- A `/calendar` page
- In-app reminders for upcoming events (banner and navigation badge)
- Per-user reminder dismissal

**Deferred:**

- Email reminders: SMTP is not configured; this belongs to module 27 when it exists.
- Browser push notifications.
- Recurring events.
- `.ics` export: a cheap later win that gives users real notifications through their own Google or Outlook calendar, with no server-side mail.

## Flow

```text
Upload PDF ─▶ ingest: extract text ─▶ PII redaction ─▶ chunks + embeddings (chat, unchanged)
                                        │
                                        └─ events.py extracts dates ─▶ document_events (pending)
                                                                     │
                                              admin confirms / edits / rejects
                                              (same review pattern as flagged documents)
                                                                     │
                                                     confirmed events ─▶ /calendar (RBAC-scoped)
                                                                     │
                                                     in-app reminders: banner + badge + dismissals
```

One ingest serves both purposes: chunks answer chat questions, and events fill the calendar. Both carry the document's `organization_id`, `department_id` and `clearance_level`, so an event is visible to exactly the people who may see its source document.

## 1. Date extraction: `ai-service/events.py` (new)

- **Where it runs.** On the redacted pages (dates are not personal data, so they survive redaction), before chunking. Only on the indexed path: a `flagged` document stores no chunks and no events.
- **Dependency.** `dateparser`, added to the requirements. Installing packages into the venv from a session can be blocked, so the owner may need to run `pip install dateparser` (see `CLAUDE.md`).
- **Forms it must handle:**

  | Text | Result |
  |---|---|
  | "1-2 December 2026" | `starts_at = 2026-12-01`, `ends_at = 2026-12-02` |
  | "3 Dec 2026" | `starts_at = 2026-12-03` |
  | "December 5, 2026" | `starts_at = 2026-12-05` |
  | "5 December" (no year) | The upload year, or the next year if that date has already passed; the resolved year is stored |

- **Event title.** The sentence containing the date, with the date text removed, truncated to about 80 characters. Falls back to the document title.
- **Source.** The raw snippet and `page_number` are stored, so the review panel and the calendar detail can cite `[Document Title, Page N]`.
- **Ignored.** Non-committal text such as "TBC", or "early December" without a day.
- **Sanity cap.** `EVENTS_MAX_PER_DOC` (default 50); more than that suggests mis-parsing.
- **Later, optional.** `llama3.2` could refine event titles from messy memos, behind a config switch. Deterministic extraction ships first: fast, free and testable.

## 2. Storage: migrations (backend)

```text
document_events:
  id, document_id (FK, cascade delete), organization_id, department_id,
  clearance_level,                       -- RBAC columns, like document_chunks
  title, snippet, page_number,
  starts_at DATE, ends_at DATE NULL,     -- date-only, all-day events
  status ENUM(pending|confirmed|rejected), confirmed_by NULL, confirmed_at NULL,
  timestamps

event_dismissals:                        -- silences the reminder banner per user
  id, user_id (FK), event_id (FK), unique(user_id, event_id), created_at
```

- Plain columns only, so the migration needs no PostgreSQL/SQLite branching.
- The AI service writes events **in the same transaction as the chunks**: delete, then insert, per `document_id`, so a re-ingest replaces them. This mirrors the existing chunk pattern.
- Superseded versions lose their events in the same transaction that removes their chunks (`ingest.supersede()`). A revised memo therefore *moves* the meeting instead of duplicating it.

## 3. Backend: endpoints and policy

| Endpoint | Who | What |
|---|---|---|
| `GET /api/events?from=&to=` | any user | Confirmed events in the window, scope-filtered (`organization = ? AND department = ? AND clearance <= ?`; admins drop the department filter). The events twin of `Document::scopeVisibleTo()`. |
| `GET /api/events/upcoming?days=7` | any user | Confirmed events starting within N days, plus ongoing ones (`ends_at >= today`), minus the ones the user dismissed |
| `POST /api/events/{id}/dismiss` | any user | Silence the reminder for a visible event; the event stays on the calendar |
| `GET /api/admin/events/pending` | admin | Pending events in their organization, with document title and snippet |
| `POST /api/events/{id}/confirm` | admin | Confirm, optionally correcting `title`, `starts_at` or `ends_at` (an admin fixing a mis-parse) |
| `POST /api/events/{id}/reject` | admin | Mark as rejected (a junk extraction); never shown |

- "Today" is computed server-side in Laravel. Dates are date-only, so no time zones enter the system.
- Confirm and reject write an audit row with `AuditLog::recordAdminAction()`.
- Events follow `documents.approved_at`: a flagged document has no events until it is approved and re-ingested.
- An event outside the user's scope answers 404, like documents.

## 4. Frontend: `/calendar` page and shell

- **Navigation.** A **Calendar** item (`CalendarDays` icon) in the *Workspace* group of `AppShell`, after Documents, with a numeric badge from `/events/upcoming`.
- **Month grid.** Hand-rolled like the rest of the UI (no calendar library): previous and next month, today highlighted, event chips coloured like the clearance badges, and a click on a day lists that day's events. About 200 lines.
- **Event detail panel.** Title, date range (shown as "1–2 December 2026"), the source `[Document Title, Page N]` opening the citation viewer used in chat, and the existing access-checked Download.
- **Admin review panel** (admins only, same page). Pending events with snippet and document. Each row is editable (title, dates) with Confirm and Reject, the same interaction as approving a held document.
- **Reminder banner** in `AppShell`, fetched once per sign-in like the `/me` refresh: "3 upcoming events in the next 7 days", each entry dismissable, plus a "View calendar" link. Dismissed events never come back as reminders; the calendar still shows them.
- **Conventions.** The visible month survives a refresh through `lib/useUrlParam.ts`; confirmations and messages go through `lib/feedback.ts`; colours use the theme tokens so dark mode works.

## 5. Tests

**pytest**
- Range parsing: "1-2 December 2026" gives two dates.
- Single dates, and year inference when the year is missing.
- "TBC" and month-only text are ignored.
- Title taken from the sentence; page number attached.
- The events cap.
- A flagged document stores no events.
- Re-ingest replaces events; supersede removes the older version's events.

**Pest**
- `/events` and `/events/upcoming` respect organization, department and clearance (staff at L1 never see a Restricted event; other organizations' events are invisible).
- Non-admins get 403 on confirm and reject.
- Dismissal works only for visible events, once per user.
- A confirm with corrections saves the edits and writes an audit row.

**Playwright** (API stubbed)
- The calendar renders a month with an event chip.
- An admin reviews a pending event, confirms it, and it appears on the calendar.
- A signed-in user sees the upcoming-events banner and can dismiss one entry.

**Evaluation.** No change to retrieval, so the golden set stays as it is.

## 6. Effort and dependencies

**Effort: M.** One set of migrations, one extraction module, six endpoints, one page plus shell additions, and tests at each layer.

**Depends on nothing new.** The approval-review pattern, the citation viewer, version superseding and the RBAC conventions all exist already.

**Suggested order inside the module:**
1. Extraction, table, and admin confirm/reject
2. Calendar page
3. Upcoming events: badge, banner and dismissals

## Later, when module 27 (email) exists

- A daily scheduled command (Windows Task Scheduler or `php artisan schedule:work`) finds confirmed events a set number of days away, matches users by event visibility, and queues one email per user.
- Duplicates are prevented by an `event_reminders(user_id, event_id, sent_at)` table.
- This is also the natural moment to add `.ics` export, so users' own calendars do the notifying.
