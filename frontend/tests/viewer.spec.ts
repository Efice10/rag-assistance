import { expect, test, type Page } from "@playwright/test";
import { stubBackgroundCalls } from "./stubs";

/** Viewing documents in the app instead of downloading them. Stubbed API. */
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

function doc(id: number, title: string, mime: string) {
  return {
    id, title, mime_type: mime, clearance_level: 1, clearance_label: "Public", status: "indexed", error_message: null,
    version: 1, superseded: false, pii_redactions: 0, approved: false,
    department: { id: 1, name: "Procurement" }, uploaded_by: { id: 2, name: "Mark Manager" },
    created_at: "2026-11-18T08:00:00+00:00",
  };
}

async function signInToDocuments(page: Page) {
  await stubBackgroundCalls(page);
  const downloads: string[] = [];
  await page.route("**/api/login", (route) => route.fulfill({ json: { token: "t", user: manager } }));
  await page.route("**/api/me", (route) => route.fulfill({ json: { user: manager } }));
  await page.route("**/api/conversations", (route) => route.fulfill({ json: { data: [] } }));
  await page.route("**/api/documents", (route) =>
    route.fulfill({
      json: {
        data: [
          doc(20, "Leave Policy", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
          doc(21, "Safety Training", "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
          doc(22, "Procurement SOP", "application/pdf"),
        ],
      },
    }),
  );
  await page.route("**/api/documents/20/preview", (route) =>
    route.fulfill({
      json: { data: { format: "docx", pages: [{ page: 1, text: "Staff are entitled to 14 days of annual leave." }], truncated: false } },
    }),
  );
  await page.route("**/api/documents/21/preview", (route) =>
    route.fulfill({
      json: {
        data: {
          format: "pptx",
          pages: [
            { page: 1, text: "Safety training" },
            { page: 2, text: "Report incidents within 24 hours" },
          ],
          truncated: false,
        },
      },
    }),
  );
  await page.route("**/api/documents/*/download", async (route) => {
    downloads.push(route.request().url());
    await route.fulfill({ status: 200, contentType: "application/pdf", body: "%PDF-1.4\n%%EOF\n" });
  });

  await page.goto("/login");
  await page.getByLabel("Work email").fill(manager.email);
  await page.getByLabel("Password").fill("password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/chat$/);
  await page.getByRole("link", { name: "Documents" }).click();
  return { downloads };
}

test("a Word document opens as text in the app, without a download", async ({ page }) => {
  const { downloads } = await signInToDocuments(page);

  await page.getByRole("button", { name: "View Leave Policy" }).click();

  const viewer = page.getByTestId("source-viewer");
  await expect(viewer).toContainText("Leave Policy");
  await expect(viewer.getByTestId("text-preview")).toContainText("Staff are entitled to 14 days of annual leave.");
  expect(downloads).toEqual([]);

  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
});

test("clicking a title opens it too, and a PDF opens in the browser viewer", async ({ page }) => {
  await signInToDocuments(page);

  await page.getByRole("button", { name: "Procurement SOP", exact: true }).click();

  const viewer = page.getByTestId("source-viewer");
  await expect(viewer.locator("iframe")).toHaveAttribute("src", /^blob:/);
});

test("a citation to slide 2 opens the deck at that slide", async ({ page }) => {
  // Reuse the documents setup, then open the viewer the way a citation does.
  await signInToDocuments(page);
  await page.route("**/api/chat", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body:
        'event: token\ndata: {"text":"Report within 24 hours [Safety Training, Slide 2]."}\n\n' +
        'event: sources\ndata: {"sources":[{"document_id":21,"document_title":"Safety Training","page_number":2}]}\n\n' +
        "event: done\ndata: {}\n\n",
    }),
  );
  await page.getByRole("link", { name: "Chat" }).click();
  await page.getByLabel("Your question").fill("How fast must incidents be reported?");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByTestId("citation").click();

  const viewer = page.getByTestId("source-viewer");
  await expect(viewer).toContainText("Cited slide 2");
  const cited = viewer.locator("[data-cited]");
  await expect(cited).toContainText("Report incidents within 24 hours");
  await expect(cited).toContainText("Slide 2");
});
