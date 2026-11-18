import type { Page } from "@playwright/test";

/**
 * Background calls every signed-in page makes. Stubbed for all tests so a
 * fake token never reaches a real backend (whose 401 would sign the test
 * user out). A test can register its own route afterwards to override these:
 * Playwright uses the most recently added matching route.
 */
export async function stubBackgroundCalls(page: Page) {
  if (process.env.E2E_LIVE) {
    return; // the live run talks to the real API
  }
  await page.route("**/api/events/upcoming", (route) =>
    route.fulfill({ json: { data: [], meta: { days: 7, today: "2026-11-18", pending_review: null } } }),
  );
  await page.route("**/api/admin/settings", (route) => route.fulfill({ json: { data: { event_reminder_days: 7 } } }));
  // The viewer asks for a preview first; by default every document is a PDF.
  await page.route("**/api/documents/*/preview", (route) =>
    route.fulfill({ json: { data: { format: "pdf", pages: [], truncated: false } } }),
  );
}
