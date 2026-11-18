# Frontend (Next.js)

Sign-in and SSO callback, chat with history and the citation viewer, documents, users, analytics, processing and the audit log. Port 3000. Talks only to the Laravel API.

Setup, architecture, security model and the API reference are in the [root README](../README.md).

```powershell
npm run dev                        # development server
npm run lint; npm run build        # checks
npx playwright test                # end-to-end tests (Laravel API stubbed)
$env:E2E_LIVE = "1"; npx playwright test   # against the running stack
```
