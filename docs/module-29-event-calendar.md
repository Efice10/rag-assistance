# Module 29: Event Calendar

Proposed 2026-11-18. **Status: built 2026-11-18** and verified on the live database.

## As built (differences from the design below)

- **No `dateparser` package.** `ai-service/events.py` has its own small date parser covering exactly the forms listed in section 1, plus `2026-12-05` and `05/12/2026` (day first). It needs no install and every rule is unit-tested.
- **"Today"** is computed in Laravel in `CALENDAR_TIMEZONE` (default `Asia/Kuala_Lumpur`), because the app's timestamps are UTC; it is sent to the AI service with each ingest.
- **Review decisions survive re-indexing** by matching on new `extracted_starts_at` / `extracted_ends_at` columns, so a reviewer's date correction does not break the match.
- **The pending list** is `GET /api/events/pending` (admins and managers), not under `/api/admin/`, because managers review too.
- **Tests:** pytest 27 new (extraction and storage), Pest 16, Playwright 4. Live check: extraction skipped an effective date and a TBC date; another department saw nothing; re-index kept a corrected confirmation and a rejection; a new version sent only the moved meeting back to review.

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

## Decisions (owner, 2026-11-18)

| Question | Decision |
|---|---|
| Which dates become events? | **Future dates near event words** only (meeting, training, deadline, due, briefing, audit, and similar). Effective dates, validity periods and past dates are not events. |
| Who reviews extracted events? | **Admins**, for their whole organization, and **managers**, for their own department (only events they can see). |
| Can events skip review? | **No.** Every extracted event waits for a person to confirm it. |
| Who sees an event? | **Exactly the people who can see its source document.** No widening, not even by admins. |
| What happens on re-index or a new version? | **Confirmed and rejected decisions are kept** when the same dates are still in the document (with any title or date corrections). Only new or changed dates go to review; dates that disappeared are removed. |
| Times of day? | **Dates only** for now (all-day events). A time written in the memo stays visible in the snippet. |
| How far ahead do reminders look? | **Set by the admin per organization** (default 7 days). |

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
- **Only event dates.** A date becomes an event only when it is today or later and its sentence contains an event word: meeting, briefing, training, workshop, session, deadline, due, submit, audit, inspection, review, town hall (the list lives in one constant, so it can grow). "Effective 1 January 2027" or "valid until 31 March 2027" are not events.
- **Ignored.** Non-committal text such as "TBC", or "early December" without a day.
- **Times.** Not stored: events are all-day. "9:00 am" stays readable in the snippet.
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

```text
organizations:
  + event_reminder_days  (default 7, between 1 and 60)   -- how far ahead reminders look
```

- Plain columns only, so the migration needs no PostgreSQL/SQLite branching.
- The AI service writes events **in the same transaction as the chunks**, mirroring the existing chunk pattern.
- **Decisions survive re-indexing.** Before replacing a document's events, the AI service reads the existing reviewed events of that document, and of the versions it supersedes. A newly extracted event with the same `starts_at` and `ends_at` as a reviewed one inherits its status (`confirmed` or `rejected`), its corrected title and dates, and `confirmed_by`/`confirmed_at`. Events with new dates are `pending`; reviewed events whose dates no longer appear are deleted.
- Superseded versions lose their own events in the same transaction that removes their chunks (`ingest.supersede()`), after their decisions have been carried over to the new version. A revised memo therefore *moves* the meeting instead of duplicating it, and an unchanged meeting stays confirmed.

## 3. Backend: endpoints and policy

| Endpoint | Who | What |
|---|---|---|
| `GET /api/events?from=&to=` | any user | Confirmed events in the window, scope-filtered (`organization = ? AND department = ? AND clearance <= ?`; admins drop the department filter). The events twin of `Document::scopeVisibleTo()`. |
| `GET /api/events/upcoming` | any user | Confirmed events starting within the organization's `event_reminder_days`, plus ongoing ones (`ends_at >= today`), minus the ones the user dismissed |
| `POST /api/events/{id}/dismiss` | any user | Silence the reminder for a visible event; the event stays on the calendar |
| `GET /api/events/pending` | admin, manager | Pending events the reviewer may decide: the whole organization for admins, their own department (within their clearance) for managers; with document title and snippet |
| `POST /api/events/{id}/confirm` | admin, manager in scope | Confirm, optionally correcting `title`, `starts_at` or `ends_at` (fixing a mis-parse) |
| `POST /api/events/{id}/reject` | admin, manager in scope | Mark as rejected (a junk extraction); never shown |
| `PUT /api/admin/settings` | admin | Set `event_reminder_days` for the organization (audited) |

- Reviewers are the people who can manage the source document (`Document::manageableBy()`): admins in their organization, managers in their own department and within their clearance. Staff never review.

- "Today" is computed server-side in Laravel. Dates are date-only, so no time zones enter the system.
- Confirm and reject write an audit row with `AuditLog::recordAdminAction()`.
- Events follow `documents.approved_at`: a flagged document has no events until it is approved and re-ingested.
- An event outside the user's scope answers 404, like documents.

## 4. Frontend: `/calendar` page and shell

- **Navigation.** A **Calendar** item (`CalendarDays` icon) in the *Workspace* group of `AppShell`, after Documents, with a numeric badge from `/events/upcoming`.
- **Month grid.** Hand-rolled like the rest of the UI (no calendar library): previous and next month, today highlighted, event chips coloured like the clearance badges, and a click on a day lists that day's events. About 200 lines.
- **Event detail panel.** Title, date range (shown as "1–2 December 2026"), the source `[Document Title, Page N]` opening the citation viewer used in chat, and the existing access-checked Download.
- **Review panel** (admins and managers, same page). Pending events they may decide, with snippet and document. Each row is editable (title, dates) with Confirm and Reject, the same interaction as approving a held document. A count of pending events shows on the Calendar nav item for reviewers.
- **Reminder banner** in `AppShell`, fetched once per sign-in like the `/me` refresh: "3 upcoming events in the next 7 days" (using the organization's setting), each entry dismissable, plus a "View calendar" link. Dismissed events never come back as reminders; the calendar still shows them.
- **Setting.** Admins set the reminder window on the Users page, next to the single sign-on settings.
- **Conventions.** The visible month survives a refresh through `lib/useUrlParam.ts`; confirmations and messages go through `lib/feedback.ts`; colours use the theme tokens so dark mode works.

## 5. Tests

**pytest**
- Range parsing: "1-2 December 2026" gives two dates.
- Single dates, and year inference when the year is missing.
- "TBC" and month-only text are ignored.
- Dates without an event word ("effective 1 January 2027") and past dates are ignored.
- Re-index keeps a confirmed event (and its corrected title) when its dates are unchanged, keeps a rejection, makes a new date pending, and removes a date that disappeared; a new version inherits the old version's decisions the same way.
- Title taken from the sentence; page number attached.
- The events cap.
- A flagged document stores no events.
- Re-ingest replaces events; supersede removes the older version's events.

**Pest**
- `/events` and `/events/upcoming` respect organization, department and clearance (staff at L1 never see a Restricted event; other organizations' events are invisible).
- Staff get 403 on confirm and reject; a manager can decide events of their own department only (another department's event answers 404); admins can decide any in their organization.
- `/events/upcoming` uses the organization's reminder window; only admins can change it.
- Dismissal works only for visible events, once per user.
- A confirm with corrections saves the edits and writes an audit row.

**Playwright** (API stubbed)
- The calendar renders a month with an event chip.
- An admin reviews a pending event, confirms it, and it appears on the calendar.
- A signed-in user sees the upcoming-events banner and can dismiss one entry.

**Evaluation.** No change to retrieval, so the golden set stays as it is.

## 6. Effort and dependencies

**Effort: M.** One set of migrations, one extraction module (with the carry-over of review decisions), seven endpoints, one page plus shell additions, and tests at each layer.

**Depends on nothing new.** The approval-review pattern, the citation viewer, version superseding and the RBAC conventions all exist already.

**Suggested order inside the module:**
1. Extraction, table, and admin confirm/reject
2. Calendar page
3. Upcoming events: badge, banner and dismissals

## Later, when module 27 (email) exists

- A daily scheduled command (Windows Task Scheduler or `php artisan schedule:work`) finds confirmed events a set number of days away, matches users by event visibility, and queues one email per user.
- Duplicates are prevented by an `event_reminders(user_id, event_id, sent_at)` table.
- This is also the natural moment to add `.ics` export, so users' own calendars do the notifying.
