# Roadmap: Phase 2 (proposed)

Proposed 2026-11-18, after all 15 Phase 1 modules were built ([roadmap.md](roadmap.md)).
Nothing here is started. Each module begins only when the owner asks for it.

## Ground rules (same as Phase 1)

- Native Windows only: no Docker, WSL, or Linux-only tooling. Commands in PowerShell.
- RBAC stays inside the search SQL. Anything touching retrieval changes `Document::scopeVisibleTo()`, `scope_filter()` in `ai-service/rag.py` and the evaluator's `Structural.in_scope` together.
- Scope is derived server-side in Laravel; client-sent scope never reaches the AI service.
- `audit_logs` stays append-only. New admin actions are audited with `AuditLog::recordAdminAction()`.
- Every module ships with tests (Pest, pytest, Playwright, and golden-set cases when retrieval changes) and updates `README.md` and `CLAUDE.md`.
- Commit messages follow the format in `CLAUDE.md`.

## Summary

| # | Module | Group | Effort | Depends on |
|---|---|---|---|---|
| 16 | Platform admin and organization onboarding | Gaps | M | – |
| 17 | Document deletion and retention | Gaps | S–M | – |
| 18 | Two-factor sign-in | Gaps | S–M | – |
| 19 | Personal-data export and erasure (PDPA) | Gaps | M | – |
| 20 | Policy acknowledgement | Compliance | M | – |
| 21 | Policy owners and review dates | Compliance | S | – |
| 22 | What changed between versions | Compliance | M | – |
| 23 | Access requests | Compliance | S–M | – |
| 24 | Malay and English | Compliance | M | – |
| 25 | Training quizzes from policies | Compliance | M | 20 |
| 26 | Windows production setup | Operations | M | – |
| 27 | Email notifications | Operations | S | best after 20, 21 |
| 28 | Chat in Teams or Slack | Operations | L | 18 recommended |
| 29 | Event calendar ([full design](module-29-event-calendar.md)) | Compliance | M | – (relates to 20, 21, 27) |

Effort: S is about a focused session, M a phase-sized piece, L several sessions.

---

## A. Gaps in what exists today

### 16. Platform admin and organization onboarding

**What.** A platform level above organizations. A *platform admin* creates an organization with its first administrator and departments, suspends or reactivates an organization, and sees usage per organization (users, documents, questions). Organization admins keep everything they have today.

**Why.** The product is multi-tenant, but an organization can only be created with `php artisan db:seed`. Nobody can onboard a customer.

**Plan.**
- `users.is_platform_admin` (never set through the API; created by an Artisan command `platform:admin {email}`).
- `organizations.suspended_at`; the `active` middleware also rejects users of a suspended organization.
- Endpoints under `/api/platform/...`, guarded by a `platform` middleware. Platform admins never receive a retrieval scope: they cannot chat or read documents.
- Frontend: a separate `/platform` area with its own navigation.

**Tests.** Organization admins get 403 on every platform route; a platform admin cannot read any organization's documents, chats or audit log; suspension signs everyone out of that organization only.

### 17. Document deletion and retention

**What.** Admins (and managers, in their own department) archive a document, which hides it from search and lists, and can permanently delete an archived one, which also removes the stored file and its search chunks. Optional retention rules per organization delete documents a set time after upload or after being superseded.

**Why.** Nothing can be deleted today; wrong uploads and old versions accumulate.

**Plan.**
- `documents.archived_at`; `scopeVisibleTo()` and the AI service's `scope_filter()` exclude archived documents.
- `DELETE /api/documents/{id}` (archived only): the AI service deletes the chunks, Laravel deletes the file and the row. Audited, with title and version.
- Old audit rows keep resolving: the audit page already shows "Deleted document" for missing ids.
- Retention: a scheduled command `documents:apply-retention`, run by Windows Task Scheduler.

**Tests.** An archived document is never retrieved (pytest SQL assertion plus a golden-set case); deletion removes chunks and file; managers cannot delete outside their department; retention deletes only what has expired.

### 18. Two-factor sign-in

**What.** Authenticator-app codes (TOTP) at sign-in, with one-time recovery codes. Required for admins, optional for others. SSO users rely on their identity provider instead.

**Why.** Admins see every department and the full audit log; a password alone is weak protection for that.

**Plan.**
- `users.two_factor_secret` (encrypted cast), `two_factor_confirmed_at`, hashed recovery codes.
- Sign-in returns `two_factor_required` with a short-lived challenge; `POST /api/login/two-factor` exchanges challenge + code for the token.
- Admins without 2FA are sent to a setup page after sign-in, until it is confirmed.
- TOTP implemented with the standard library (HMAC-SHA1, RFC 6238), so no new package is needed.

**Tests.** RFC 6238 test vectors; wrong or reused codes are rejected; recovery codes work once; an admin without 2FA cannot reach admin routes.

### 19. Personal-data export and erasure (PDPA)

**What.** An admin exports everything held about one user (profile, conversations, ratings, audit entries) as a ZIP of JSON and CSV files, and can erase a departed user: their conversations and ratings are deleted, their name and email are replaced with a placeholder, and the audit log keeps its rows (and its integrity) under the anonymised identity.

**Why.** Malaysia's Personal Data Protection Act expects an organization to answer access and deletion requests.

**Plan.** `GET /api/users/{id}/export`, `POST /api/users/{id}/erase` (admin, same organization, only for deactivated users, typed confirmation). The audit triggers stay; erasure changes the `users` row, not `audit_logs`.

**Tests.** The export contains only that user's data; erasure leaves audit rows intact and unreadable as a person; cross-organization requests return 404.

---

## B. Compliance features

### 20. Policy acknowledgement

**What.** An admin or manager asks a group (a department, a role, or everyone at or above a clearance level) to read and confirm a document by a due date. People see "Policies to acknowledge" with a count in the sidebar, open the document, and confirm. Admins see completion per policy and per person, and export it as CSV.

**Why.** "Can you prove everyone read the new policy?" is the first audit question in real compliance work, and the app already has documents, departments, clearance and an audit log to build it on.

**Plan.**
- `acknowledgement_requests` (document, audience rules, due date, created by) and `acknowledgements` (request, user, acknowledged at, document version).
- The audience is resolved server-side, and only from people who can already see the document: an acknowledgement request never widens access.
- A new version of the document can re-open the request.

**Tests.** The audience never includes someone outside the document's scope; acknowledging is idempotent; completion counts are correct; cross-organization 404s.

### 21. Policy owners and review dates

**What.** Every document gets an owner and a "review by" date. A dashboard lists overdue and soon-due policies. When an answer cites an overdue policy, the chat shows a small "due for review" note next to the citation.

**Why.** Out-of-date policies are a compliance risk, and today nothing tracks them.

**Plan.** `documents.owner_id`, `documents.review_due_at` (set at upload, editable); the `sources` event stays unchanged and the frontend looks up review state from the document list it can already see.

**Tests.** Only managers and admins in scope can change owner or date; the overdue list is scoped like every other list.

### 22. What changed between versions

**What.** When a new version replaces an old one, show a readable side-by-side diff of the extracted text and a short model-written summary of the changes. Users can ask "what changed in the Travel Policy?" in chat.

**Why.** Versioning (module 9) replaces documents, but nobody can see what actually changed.

**Plan.** The AI service stores the extracted text per version (a `document_texts` table, scoped like chunks), computes the diff at indexing time, and writes a summary. The summary is shown only to people who can see both versions.

**Tests.** The diff endpoint applies the visibility rule to both versions; the summary is generated from the two texts only.

### 23. Access requests

**What.** A user asks an administrator for a higher clearance or access to another department, with a reason. Admins approve (which updates the user, audited) or decline with a note.

**Why.** Today the only path is an email to IT. A refusal must still never reveal that a document exists, so the request is about the user's access level, not about a document.

**Plan.** `access_requests` table; `POST /api/access-requests`; an admin queue on the Users page. Approval reuses the existing user-update path, so every guard (clearance up to the approver's own) still applies.

**Tests.** Requests never mention document titles or ids; only same-organization admins see and decide them; approval is audited.

### 24. Malay and English

**What.** A Malay question finds an English policy (and the reverse), and the answer comes back in the language of the question.

**Why.** Many users in Malaysia think and type in Malay.

**Plan.** Swap `nomic-embed-text` for a multilingual embedding model available in Ollama (for example `bge-m3`). Its vector size differs from 768, so the `vector(768)` column and the model change together (one migration), and every document is re-indexed. Add Malay cases to the golden set. The scope rule does not change.

**Tests.** Golden-set cases in Malay; the evaluation's RBAC checks stay at zero violations.

### 25. Training quizzes from policies

**What.** Generate a short multiple-choice quiz from a policy, let an admin edit it, attach it to an acknowledgement request (module 20), and record each person's score.

**Why.** Reading a policy is not the same as understanding it; many organizations want a check.

**Plan.** Questions are generated by the AI service from the document's own text only, then saved for an admin to review before use. Scores are stored per acknowledgement.

**Tests.** Generation uses only text the requester can see; people can only take quizzes for documents in their scope.

### 29. Event calendar

**What.** Dates in uploaded documents ("1-2 December 2026 meeting") are extracted at ingest, reviewed by an admin, shown on a `/calendar` page scoped like the source document, and surfaced as in-app reminders.

The full design is in [module-29-event-calendar.md](module-29-event-calendar.md).

---

## C. Operations

### 26. Windows production setup

**What.** Scripts and documentation to run the stack properly on Windows: Laravel under Laragon's Apache or Nginx (so requests run in parallel and a streaming answer no longer blocks other pages), and the queue worker, the AI service and Redis as Windows services that start on boot, plus a `/status` page.

**Why.** `php artisan serve` handles one request at a time, and nothing restarts after a reboot.

**Plan.** A PowerShell setup script (with a dry-run mode) that writes the web-server site config and registers the services; a `docs/deployment.md` runbook.

**Tests.** Script dry-run output reviewed; a live check that two requests run at the same time.

### 27. Email notifications

**What.** Emails for documents held for review, failed processing, policies due for review, and acknowledgement reminders. Each person can turn kinds of email off.

**Why.** Today these only show up if someone opens the right page.

**Plan.** Laravel notifications on the existing queue; mail driver `log` in development, SMTP in production; a daily scheduled command for reminders.

**Tests.** The right people are notified, only in their organization, and opt-outs are respected.

### 28. Chat in Teams or Slack

**What.** Ask the assistant from Microsoft Teams or Slack, with exactly the same answers and scope as in the web app.

**Why.** People ask questions where they already work.

**Plan.** A bot endpoint in Laravel; each chat-platform account is linked once to an app account (signed one-time link); the bot calls the same chat pipeline with that user's server-derived scope. Unlinked accounts get nothing.

**Tests.** Unlinked or deactivated accounts get no answer; the scope is the linked user's; every bot question is audited like a web question.

---

## Suggested build order

| Wave | Modules | Rationale |
|---|---|---|
| 1 | **16, 17** | Make it possible to onboard a customer and clean up mistakes |
| 2 | **21, 20** | Turn Q&A into a compliance tool (owners and review dates first: it is small and 20 builds on it) |
| 3 | **18, 23, 27** | Protect admin accounts, give users a way to ask for access, start notifying |
| 4 | **26** | Run it for real users |
| 5 | **19, 22, 24, 25, 28** | Privacy requests, version diffs, Malay, quizzes, chat platforms |

Module 29 (event calendar) depends on nothing and can be pulled into any wave; it fits naturally after 21, so review dates can join the calendar.
