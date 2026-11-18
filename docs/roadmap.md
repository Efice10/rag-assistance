# Roadmap: Phase 1 (complete)

All five build phases from `knowledge/introduction.md` and the 15 modules below were built between
2026-11-16 and 2026-11-18. The proposals for what comes next are in [roadmap-phase-2.md](roadmap-phase-2.md).

The original, longer proposal for each module is in this file's git history
(`git log --follow docs/roadmap.md`).

## Modules

| # | Module | What it does | Notes on how it was built |
|---|---|---|---|
| 1 | Admin users and departments | Admins create, edit, deactivate and reactivate users; create and rename departments | Deactivated via `deactivated_at`, never deleted; the last-admin guard is structural (no self role change or self-deactivation) |
| 2 | Conversation history | Every chat turn is saved for the user who asked it | Answers citing documents the user can no longer access are withheld on screen and from follow-up history |
| 3 | RAG evaluation | Golden question set scored for answers, citations, refusals and RBAC safety | `ai-service/eval/`; structural tier runs in CI, live tier against the real stack |
| 4 | Hybrid search | Exact codes, numbers and acronyms also run a scoped full-text search, fused with the vector search | `tsv` covers title and content; all exact terms must match |
| 5 | Document-trust defenses | Injection screening, PII masking, excerpts wrapped as data | Suspicious documents are held (`flagged`) until an admin approves, audited |
| 6 | Analytics | Questions per day, no-answer rate, helpful rate, most-cited documents | `/analytics`, admin only |
| 7 | Audit CSV export | The filtered audit log as a CSV file | Streamed; cells that could run as spreadsheet formulas are defused |
| 8 | Citation viewer | A citation opens the PDF at the cited page | Uses the browser's built-in PDF viewer (`#page=N`) |
| 9 | Versioning and reindex | Same title in the same department becomes a new version; reindex on demand | The old version's chunks are swapped out inside the indexing transaction |
| 10 | OCR | Scanned PDF pages are read with Tesseract | Optional install (`requirements-ocr.txt`); verified end to end |
| 11 | More formats | XLSX, PPTX, TXT and MD alongside PDF and DOCX | Office formats parsed with the Python standard library |
| 12 | Follow-up context | Follow-up questions keep the conversation's context | Retrieval embeds the question plus the previous user question |
| 13 | Processing screen | Failed and stuck documents, failed queue jobs, retry | Broadened from the planned failed-jobs screen; jobs matched to an organization without unserializing them |
| 14 | Answer feedback | Thumbs up or down with an optional comment | Thumbs-down answers are listed on analytics as golden-set candidates |
| 15 | Single sign-on | Per-organization OpenID Connect sign-in | Built on Laravel's HTTP client; PKCE; HTTPS-only providers; tested with a fake provider only |

## Also done in Phase 1

- **UI polish** (from `knowledge/design.md`): confirm dialogs and toasts, dark mode, grouped and collapsible sidebar, filters kept in the URL, error page, loading skeleton, growing chat box.
- **Speed:** database moved to Singapore; one network round trip per query in Laravel; pooled connections in the AI service.
- **Source accuracy:** chat sources list only the documents the answer cites (live citation precision 0.61 to 1.0).

## Open items

- Test single sign-on against a real identity provider.
- Push the branch and let GitHub Actions run the full suite for the first time.
- Pages under `app/(app)/` log a dev-only "instant navigation" console error (see `CLAUDE.md`); production builds are unaffected.
