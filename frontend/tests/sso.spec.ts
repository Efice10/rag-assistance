import { expect, test } from "@playwright/test";

/** Single sign-on, against a stubbed Laravel API and a fake identity provider. */
test.skip(!!process.env.E2E_LIVE, "stubbed only");

const profile = {
  id: 9,
  name: "Nina New",
  email: "nina@acme.test",
  role: "staff",
  clearance_level: 1,
  organization: { id: 1, name: "Acme Manufacturing", slug: "acme" },
  department: { id: 2, name: "Human Resources" },
  can_upload: false,
};

test("signs in through the organization identity provider", async ({ page }) => {
  const callbacks: unknown[] = [];

  await page.route("**/api/sso/start", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ email: "nina@acme.test" });
    // The "identity provider" immediately redirects back with a code.
    await route.fulfill({ json: { authorization_url: "http://localhost:3000/sso/callback?code=abc&state=xyz" } });
  });
  await page.route("**/api/sso/callback", async (route) => {
    callbacks.push(route.request().postDataJSON());
    await route.fulfill({ json: { token: "sso-token", user: profile } });
  });
  await page.route("**/api/me", (route) => route.fulfill({ json: { user: profile } }));
  await page.route("**/api/conversations", (route) => route.fulfill({ json: { data: [] } }));

  await page.goto("/login");
  await page.getByLabel("Work email").fill("nina@acme.test");
  await page.getByRole("button", { name: "Sign in with single sign-on" }).click();

  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.getByTestId("user-name").first()).toHaveText("Nina New");
  expect(callbacks).toEqual([{ code: "abc", state: "xyz" }]);
});

test("explains a refused sign-in", async ({ page }) => {
  await page.route("**/api/sso/callback", (route) =>
    route.fulfill({ status: 403, json: { message: "That account is not part of this organization." } }),
  );

  await page.goto("/sso/callback?code=abc&state=xyz");

  await expect(page.getByText("That account is not part of this organization.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to sign in" })).toBeVisible();
});

test("asks for the email before starting", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Sign in with single sign-on" }).click();

  await expect(page.getByText("Enter your work email first.")).toBeVisible();
});
