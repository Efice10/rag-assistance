---
name: verify-env
description: Check that the Windows toolchain for the Enterprise RAG Assistant is installed and running (PHP pgsql extensions, Composer, Memurai, Ollama models, Python, Node, Git). Use before starting or resuming any build phase, or when a service fails to start.
---

Verify the native Windows environment described in `knowledge/blueprint.md` (section 8). Run each check in PowerShell, one command per call so a failure in one does not hide the others. These are read-only checks: do not install, download, or change configuration as part of this skill.

| Check | Command | Passes when |
|---|---|---|
| PHP version | `php -v` | 8.2 or newer |
| PHP PostgreSQL extensions | `php -m \| findstr pgsql` | both `pdo_pgsql` and `pgsql` listed |
| Composer | `composer --version` | prints a version |
| Memurai (Redis) | `memurai-cli ping` | `PONG` |
| Ollama models | `ollama list` | `llama3.2` and `nomic-embed-text` listed |
| Python | `python --version` | 3.11.x or 3.12.x |
| Node.js | `node -v` | v20.x or v22.x |
| Git | `git --version` | prints a version |
| Project root | `Test-Path C:\laragon\www\enterprise-rag-assistant` | `True` (may be `False` before Phase 1) |

Notes:

- If `php` or `composer` is not found, Laragon's binaries are probably not on PATH. Look under `C:\laragon\bin\php\` and `C:\laragon\bin\composer\` and report the path rather than treating PHP as missing.
- If `ollama list` cannot connect, Ollama is installed but not running; say so separately from a missing model.
- Supabase cannot be checked from here without the connection URI. Report it as "not checked" unless a `.env` with `DB_HOST` exists in `backend/`, in which case report only whether the keys are present, never their values.

Report a table of check, result (pass / fail / not checked), and the observed value. For each failure give the exact fix from `knowledge/blueprint.md` (download link, `php.ini` line to uncomment, or `ollama pull <model>`), and leave running the fix to the owner unless they ask.
