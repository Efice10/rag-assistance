import { expect, test, type Page } from "@playwright/test";
import { stubBackgroundCalls } from "./stubs";

/** Event calendar (module 29), against a stubbed Laravel API. */
test.skip(!!process.env.E2E_LIVE, "stubbed only");

const manager = {
  id: 2,
  name: "Mark Manager",
  email: "manager@acme.test",
  role: "manager",
  clearance_level: 3,
  organization: { id: 1, name: "Acme Manufacturing", slug: "acme" },
  department: { id: 1, name: "Procurement" },
  can_upload: true,
};

function monthKey(offset = 0): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** A date in the current month, so it is always on the default grid. */
const DAY = `${monthKey()}-15`;
const NEXT_DAY = `${monthKey()}-16`;

function calendarEvent(id: number, title: string, status = "confirmed", starts = DAY, ends: string | null = NEXT_DAY) {
  return {
    id,
    title,
    snippet: `${title} on 15-16 this month.`,
    page_number: 2,
    starts_at: starts,
    ends_at: ends,
    status,
    auto_confirmed: false,
    clearance_level: 3,
    document: { id: 10, title: "Board Memo" },
    department: { id: 1, name: "Procurement" },
  };
}

async function setUp(page: Page) {
  await stubBackgroundCalls(page);
  const state = {
    confirmed: [calendarEvent(1, "Q4 planning meeting")],
    pending: [calendarEvent(2, "Budget submission deadline", "pending", DAY, null)],
    dismissed: [] as number[],
    confirmBodies: [] as unknown[],
  };

  await page.route("**/api/login", (route) => route.fulfill({ json: { token: "t", user: manager } }));
  await page.route("**/api/me", (route) => route.fulfill({ json: { user: manager } }));
  await page.route("**/api/conversations", (route) => route.fulfill({ json: { data: [] } }));
  await page.route("**/api/events/upcoming", (route) =>
    route.fulfill({
      json: {
        data: state.confirmed.filter((event) => !state.dismissed.includes(event.id)),
        meta: { days: 7, today: DAY, pending_review: state.pending.length },
      },
    }),
  );
  await page.route("**/api/events?*", (route) => route.fulfill({ json: { data: state.confirmed, meta: {} } }));
  await page.route("**/api/events/pending", (route) => route.fulfill({ json: { data: state.pending } }));
  await page.route("**/api/events/*/dismiss", async (route) => {
    state.dismissed.push(Number(route.request().url().split("/").at(-2)));
    await route.fulfill({ json: { message: "Reminder dismissed." } });
  });
  await page.route("**/api/events/2/confirm", async (route) => {
    const body = route.request().postDataJSON();
    state.confirmBodies.push(body);
    const confirmed = { ...state.pending[0], ...body, status: "confirmed" };
    state.pending = [];
    state.confirmed = [...state.confirmed, confirmed];
    await route.fulfill({ json: { data: confirmed } });
  });
  await page.route("**/api/documents/10/download", (route) =>
    route.fulfill({ status: 200, contentType: "application/pdf", body: "%PDF-1.4\n%%EOF\n" }),
  );

  await page.goto("/login");
  await page.getByLabel("Work email").fill(manager.email);
  await page.getByLabel("Password").fill("password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/chat$/);
  return state;
}

test("upcoming events show as a dismissable banner and a sidebar badge", async ({ page }) => {
  const state = await setUp(page);

  const banner = page.getByTestId("reminder-banner");
  await expect(banner).toContainText("1 upcoming event in the next 7 days");
  await expect(banner).toContainText("Q4 planning meeting");
  await expect(page.locator("aside").first().getByRole("link", { name: /Calendar/ })).toContainText("1");

  await banner.getByRole("button", { name: "Dismiss reminder: Q4 planning meeting" }).click();
  await expect(banner).toHaveCount(0);
  expect(state.dismissed).toEqual([1]);
});

test("the month grid shows events, and a day opens the event with its source", async ({ page }) => {
  await setUp(page);

  await page.getByRole("link", { name: /Calendar/ }).first().click();
  await expect(page).toHaveURL(/\/calendar$/);
  // A two-day event appears on both days.
  await expect(page.getByTestId("event-chip").filter({ hasText: "Q4 planning meeting" })).toHaveCount(2);

  await page.getByTestId("month-grid").getByRole("button", { name: /15/ }).first().click();
  const detail = page.getByTestId("event-detail");
  await expect(detail).toContainText("Q4 planning meeting");
  await expect(detail.getByTestId("event-source")).toHaveText("Board Memo • Page 2");

  await detail.getByTestId("event-source").click();
  await expect(page.getByTestId("source-viewer")).toContainText("Cited page 2");
});

test("a reviewer corrects and confirms a pending event, which then appears", async ({ page }) => {
  const state = await setUp(page);
  await page.goto("/calendar");

  const row = page.getByTestId("pending-event").filter({ hasText: "Budget submission deadline" });
  await expect(row).toContainText("Board Memo · Page 2");
  await row.getByLabel("Title").fill("Budget submissions due");
  await row.getByRole("button", { name: "Confirm" }).click();

  await expect(page.getByTestId("toasts")).toContainText("added to the calendar");
  await expect(page.getByTestId("review-panel")).toContainText("Nothing to review.");
  await expect(page.getByTestId("event-chip").filter({ hasText: "Budget submissions due" })).toHaveCount(1);
  expect(state.confirmBodies).toEqual([{ title: "Budget submissions due", starts_at: DAY, ends_at: null }]);
});

test("the visible month is kept in the address bar", async ({ page }) => {
  await setUp(page);
  await page.goto("/calendar");

  await page.getByRole("button", { name: "Next month" }).click();
  await expect(page).toHaveURL(new RegExp(`/calendar\\?month=${monthKey(1)}$`));
  await page.reload();
  await expect(page).toHaveURL(new RegExp(`month=${monthKey(1)}`));
  await page.getByRole("button", { name: "Today" }).click();
  await expect(page).toHaveURL(/\/calendar$/);
});

test("chips are green for past, red for today and yellow for upcoming, with a key", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-18T10:00:00"));
  const state = await setUp(page);
  state.confirmed = [
    { ...calendarEvent(11, "Safety audit", "confirmed", "2026-11-03", null), auto_confirmed: true },
    calendarEvent(12, "Audit week", "confirmed", "2026-11-16", "2026-11-20"),
    calendarEvent(13, "Board meeting", "confirmed", "2026-11-25", null),
  ];
  await page.goto("/calendar?month=2026-11");

  const chip = (title: string) => page.getByTestId("event-chip").filter({ hasText: title }).first();
  await expect(chip("Safety audit")).toHaveAttribute("data-timing", "past");
  await expect(chip("Audit week")).toHaveAttribute("data-timing", "today"); // running today counts as today
  await expect(chip("Board meeting")).toHaveAttribute("data-timing", "future");
  await expect(page.getByTestId("legend")).toHaveText(/Past.*Today.*Upcoming/);

  // The colours really differ: green, red, yellow backgrounds.
  const background = (title: string) => chip(title).evaluate((el) => getComputedStyle(el).backgroundColor);
  const colours = new Set([await background("Safety audit"), await background("Audit week"), await background("Board meeting")]);
  expect(colours.size).toBe(3);

  await page.getByTestId("month-grid").getByRole("button", { name: /November 3, 2026|3 November 2026/ }).click();
  const detail = page.getByTestId("event-detail");
  await expect(detail.getByTestId("timing-badge")).toHaveText("Past");
  // A day with one event opens it straight away.
  await expect(detail.getByTestId("auto-confirmed")).toContainText("Added automatically");
});
