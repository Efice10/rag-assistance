import { expect, test, type Page } from "@playwright/test";
import { stubBackgroundCalls } from "./stubs";

test.beforeEach(async ({ page }) => {
  await stubBackgroundCalls(page);
});

/** Theme, sidebar, confirm dialog and URL-kept filters, against a stubbed API. */
test.skip(!!process.env.E2E_LIVE, "stubbed only");

const admin = {
  id: 1,
  name: "Alice Admin",
  email: "admin@acme.test",
  role: "admin",
  clearance_level: 4,
  organization: { id: 1, name: "Acme Manufacturing", slug: "acme" },
  department: { id: 3, name: "Compliance" },
  can_upload: true,
};

async function signIn(page: Page) {
  await page.route("**/api/login", (route) => route.fulfill({ json: { token: "t", user: admin } }));
  await page.route("**/api/me", (route) => route.fulfill({ json: { user: admin } }));
  await page.route("**/api/conversations", (route) =>
    route.fulfill({ json: { data: [{ id: 4, title: "Old chat", last_message_at: "2026-11-18T09:00:00+00:00" }] } }),
  );
  await page.goto("/login");
  await page.getByLabel("Work email").fill(admin.email);
  await page.getByLabel("Password").fill("password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/chat$/);
}

test("the theme switch applies dark mode and remembers it", async ({ page }) => {
  await signIn(page);
  const html = page.locator("html");
  await expect(html).not.toHaveClass(/dark/);

  await page.getByRole("radio", { name: "Dark" }).click();
  await expect(html).toHaveClass(/dark/);
  // Cards switch to the dark surface.
  const background = await page.locator("aside").first().evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(background).not.toBe("rgb(255, 255, 255)");

  await page.reload();
  await expect(html).toHaveClass(/dark/);
  await page.getByRole("radio", { name: "Light" }).click();
  await expect(html).not.toHaveClass(/dark/);
});

test("the sidebar groups admin pages and collapses to icons", async ({ page }) => {
  await signIn(page);
  const sidebar = page.locator("aside").first();
  await expect(sidebar).toContainText("Workspace");
  await expect(sidebar).toContainText("Administration");

  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect.poll(() => sidebar.evaluate((el) => el.getBoundingClientRect().width)).toBeLessThan(80);
  // Links keep their accessible names when only the icon shows.
  await expect(sidebar.getByRole("link", { name: "Documents" })).toBeVisible();

  await page.reload();
  await expect.poll(() => page.locator("aside").first().evaluate((el) => el.getBoundingClientRect().width)).toBeLessThan(80);
  await page.getByRole("button", { name: "Expand sidebar" }).click();
});

test("deleting a conversation asks first, and Escape cancels", async ({ page }) => {
  const deletes: string[] = [];
  await page.route("**/api/conversations/4", async (route) => {
    deletes.push(route.request().method());
    await route.fulfill({ json: { message: "Conversation deleted." } });
  });
  await signIn(page);

  const item = page.getByTestId("conversation-list").first();
  await item.getByRole("button", { name: "Delete conversation Old chat" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Delete this conversation?");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect(deletes).toEqual([]);

  await item.getByRole("button", { name: "Delete conversation Old chat" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByTestId("toasts")).toContainText("Conversation deleted.");
  expect(deletes).toEqual(["DELETE"]);
});

test("audit log search and page are kept in the address bar", async ({ page }) => {
  const requests: string[] = [];
  await page.route("**/api/audit-logs?*", async (route) => {
    requests.push(new URL(route.request().url()).search);
    await route.fulfill({ json: { data: [], meta: { current_page: 1, last_page: 1, per_page: 20, total: 0 } } });
  });
  await signIn(page);

  await page.getByRole("link", { name: "Audit logs" }).click();
  await page.getByLabel("Search prompts or users").fill("travel");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/\/audit-logs\?q=travel$/);

  await page.reload();
  await expect(page.getByLabel("Search prompts or users")).toHaveValue("travel");
  await expect.poll(() => requests.at(-1)).toContain("q=travel");
});
