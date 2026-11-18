import { expect, test, type Page } from "@playwright/test";

/**
 * End-to-end flow: sign in, upload a document, ask a question.
 *
 * By default the Laravel API is stubbed in the browser, so the suite runs
 * anywhere (including CI) without PHP, PostgreSQL or Ollama.
 *
 * Set E2E_LIVE=1 to run the same steps against the real stack. That needs all
 * four services running and the demo seed data (php artisan db:seed).
 */
const LIVE = !!process.env.E2E_LIVE;

const MANAGER = { email: "manager@acme.test", password: "password" };

const managerProfile = {
  id: 2,
  name: "Mark Manager",
  email: MANAGER.email,
  role: "manager",
  clearance_level: 3,
  organization: { id: 1, name: "Acme Manufacturing", slug: "acme" },
  department: { id: 1, name: "Procurement" },
  can_upload: true,
};

const existingDocument = {
  id: 10,
  title: "Procurement SOP",
  mime_type: "application/pdf",
  clearance_level: 2,
  clearance_label: "Internal",
  status: "indexed",
  error_message: null,
  department: { id: 1, name: "Procurement" },
  uploaded_by: { id: 2, name: "Mark Manager" },
  created_at: "2026-11-01T09:00:00+00:00",
};

const sseReply =
  'event: token\ndata: {"text":"Purchases above RM 10,000 need three quotations "}\n\n' +
  'event: token\ndata: {"text":"[Procurement SOP, Page 2]."}\n\n' +
  'event: sources\ndata: {"sources":[{"document_id":10,"document_title":"Procurement SOP","page_number":2}]}\n\n' +
  "event: done\ndata: {}\n\n" +
  'event: saved\ndata: {"conversation_id":5,"title":"How many quotations do I need?","message_id":42}\n\n';

async function stubApi(page: Page) {
  const documents = [existingDocument];
  const chatRequests: unknown[] = [];
  const feedback: unknown[] = [];
  const conversations: { id: number; title: string; last_message_at: string }[] = [];

  await page.route("**/api/login", async (route) => {
    const body = route.request().postDataJSON() as { email: string; password: string };
    if (body.email === MANAGER.email && body.password === MANAGER.password) {
      await route.fulfill({ json: { token: "test-token", user: managerProfile } });
    } else {
      await route.fulfill({
        status: 422,
        json: { message: "The provided credentials are incorrect.", errors: { email: ["The provided credentials are incorrect."] } },
      });
    }
  });
  await page.route("**/api/me", (route) => route.fulfill({ json: { user: managerProfile } }));
  await page.route("**/api/logout", (route) => route.fulfill({ json: { message: "Logged out." } }));
  await page.route("**/api/departments", (route) => route.fulfill({ json: { data: [managerProfile.department] } }));
  await page.route("**/api/documents", async (route) => {
    if (route.request().method() === "POST") {
      const uploaded = { ...existingDocument, id: 11, title: "Travel Policy", clearance_level: 1, clearance_label: "Public", status: "pending" };
      documents.unshift(uploaded);
      await route.fulfill({ status: 201, json: { data: uploaded } });
      // The next poll reports it as indexed, as the queue worker would.
      documents[0] = { ...uploaded, status: "indexed" };
    } else {
      await route.fulfill({ json: { data: documents } });
    }
  });
  await page.route("**/api/chat", async (route) => {
    chatRequests.push(route.request().postDataJSON());
    conversations.splice(0, conversations.length, {
      id: 5,
      title: "How many quotations do I need?",
      last_message_at: "2026-11-18T09:00:00+00:00",
    });
    await route.fulfill({ status: 200, contentType: "text/event-stream", body: sseReply });
  });
  await page.route("**/api/conversations", (route) => route.fulfill({ json: { data: conversations } }));
  await page.route("**/api/messages/42/feedback", async (route) => {
    feedback.push(route.request().postDataJSON());
    await route.fulfill({ status: 201, json: { data: route.request().postDataJSON() } });
  });
  await page.route("**/api/documents/10/download", (route) =>
    route.fulfill({ status: 200, contentType: "application/pdf", body: samplePdf() }),
  );

  return { chatRequests, feedback };
}

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(MANAGER.email);
  await page.getByLabel("Password").fill(MANAGER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/chat$/);
}

function samplePdf(): Buffer {
  // A minimal one-page PDF with a line of real text, so live ingestion has something to index.
  const text = "Travel Policy. Employees must book economy class for flights under six hours.";
  const stream = `BT /F1 12 Tf 50 750 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

test.describe("compliance assistant", () => {
  test("redirects signed-out visitors to the login page", async ({ page }) => {
    await page.goto("/documents");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("shows an error for wrong credentials", async ({ page }) => {
    if (!LIVE) await stubApi(page);
    await page.goto("/login");
    await page.getByLabel("Work email").fill(MANAGER.email);
    await page.getByLabel("Password").fill("not-the-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await expect(page.getByText("The provided credentials are incorrect.")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("signs in, uploads a document, and gets a cited answer in chat", async ({ page }) => {
    const stub = LIVE ? null : await stubApi(page);

    // Login lands on chat and shows who is signed in and at what clearance.
    await signIn(page);
    await expect(page.getByTestId("active-clearance")).toContainText("L3 · Confidential");
    await expect(page.getByRole("link", { name: "Audit logs" })).toHaveCount(0); // managers are not admins

    // Upload a document.
    await page.getByRole("link", { name: "Documents" }).click();
    await expect(page).toHaveURL(/\/documents$/);
    await page.getByRole("button", { name: "Upload document" }).click();
    await page.getByLabel("Document file").setInputFiles({
      name: "travel-policy.pdf",
      mimeType: "application/pdf",
      buffer: samplePdf(),
    });
    await page.getByLabel("Title").fill("Travel Policy");
    await page.getByLabel("Clearance level").selectOption("1");
    await page.getByRole("button", { name: "Upload", exact: true }).click();

    const row = page.getByTestId("document-row").filter({ hasText: "Travel Policy" }).first();
    await expect(row).toBeVisible();
    // The dashboard polls until ingestion finishes.
    await expect(row.locator("[data-status]")).toHaveAttribute("data-status", "indexed", {
      timeout: LIVE ? 120_000 : 15_000,
    });

    // Ask a question.
    await page.getByRole("link", { name: "Chat" }).click();
    await page.getByLabel("Your question").fill(LIVE ? "What class must employees book for flights?" : "How many quotations do I need?");
    await page.getByRole("button", { name: "Send" }).click();

    const reply = page.getByTestId("assistant-message").last();
    await expect(reply.getByTestId("citation").first()).toBeVisible({ timeout: LIVE ? 150_000 : 10_000 });

    if (stub) {
      await expect(reply).toContainText("three quotations");
      await expect(reply.getByTestId("citation")).toHaveText("Procurement SOP • Page 2");
      // The browser sends only the prompt; scope is decided on the server.
      expect(stub.chatRequests).toEqual([{ prompt: "How many quotations do I need?" }]);

      // The turn is saved: it appears in the history list, and follow-ups carry the conversation id.
      await expect(page.getByTestId("conversation-list").first()).toContainText("How many quotations do I need?");
      await page.getByLabel("Your question").fill("And for smaller purchases?");
      await page.getByRole("button", { name: "Send" }).click();
      await expect(page.getByTestId("assistant-message")).toHaveCount(2);
      expect(stub.chatRequests[1]).toEqual({ prompt: "And for smaller purchases?", conversation_id: 5 });

      // Rating an answer.
      await reply.getByRole("button", { name: "Helpful" }).first().click();
      await expect.poll(() => stub.feedback).toEqual([{ helpful: true, comment: null }]);

      // The citation opens the document at the cited page, inside the app.
      await reply.getByTestId("citation").click();
      const viewer = page.getByTestId("source-viewer");
      await expect(viewer).toContainText("Cited page 2");
      await expect(viewer.locator("iframe")).toHaveAttribute("src", /#page=2$/);
      await viewer.getByRole("button", { name: "Close document" }).click();
      await expect(viewer).toHaveCount(0);
    } else {
      await expect(reply.getByTestId("citation").first()).toContainText("Travel Policy");
    }

    // Signing out returns to the login page and clears the session.
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/chat");
    await expect(page).toHaveURL(/\/login$/);
  });
});
