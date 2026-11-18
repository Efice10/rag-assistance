import { expect, test, type Page } from "@playwright/test";

/**
 * Admin user management, against a stubbed Laravel API. Skipped with
 * E2E_LIVE=1 so a live run never creates or deactivates real accounts.
 */
test.skip(!!process.env.E2E_LIVE, "stubbed only: would change real accounts");

const adminProfile = {
  id: 1,
  name: "Alice Admin",
  email: "admin@acme.test",
  role: "admin",
  clearance_level: 4,
  organization: { id: 1, name: "Acme Manufacturing", slug: "acme" },
  department: { id: 3, name: "Compliance" },
  can_upload: true,
};

const departments = [
  { id: 3, name: "Compliance", users_count: 1, documents_count: 0 },
  { id: 2, name: "Human Resources", users_count: 0, documents_count: 1 },
  { id: 1, name: "Procurement", users_count: 1, documents_count: 2 },
];

function row(id: number, name: string, email: string, role: string, clearance: number, department: { id: number; name: string }) {
  return {
    id,
    name,
    email,
    role,
    clearance_level: clearance,
    department,
    active: true,
    deactivated_at: null as string | null,
    created_at: null as string | null,
  };
}

async function stubApi(page: Page) {
  const users = [
    row(1, "Alice Admin", "admin@acme.test", "admin", 4, { id: 3, name: "Compliance" }),
    row(2, "Mark Manager", "manager@acme.test", "manager", 3, { id: 1, name: "Procurement" }),
  ];
  const created: Record<string, unknown>[] = [];

  await page.route("**/api/login", (route) => route.fulfill({ json: { token: "admin-token", user: adminProfile } }));
  await page.route("**/api/me", (route) => route.fulfill({ json: { user: adminProfile } }));
  await page.route("**/api/departments", (route) => route.fulfill({ json: { data: departments } }));
  await page.route("**/api/users?*", (route) =>
    route.fulfill({ json: { data: users, meta: { current_page: 1, last_page: 1, per_page: 20, total: users.length } } }),
  );
  await page.route("**/api/users", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      created.push(body);
      const user = row(3, String(body.name), String(body.email), String(body.role), Number(body.clearance_level), departments[1]);
      users.push(user);
      await route.fulfill({ status: 201, json: { data: user } });
    } else {
      await route.fulfill({ json: { data: users, meta: { current_page: 1, last_page: 1, per_page: 20, total: users.length } } });
    }
  });
  await page.route("**/api/users/2/deactivate", async (route) => {
    users[1] = { ...users[1], active: false, deactivated_at: "2026-11-18T10:00:00+00:00" };
    await route.fulfill({ json: { data: users[1] } });
  });

  return { created };
}

test("an admin adds a user and deactivates another", async ({ page }) => {
  const stub = await stubApi(page);

  await page.goto("/login");
  await page.getByLabel("Work email").fill("admin@acme.test");
  await page.getByLabel("Password").fill("password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/chat$/);

  await page.getByRole("link", { name: "Users" }).click();
  await expect(page).toHaveURL(/\/users$/);
  await expect(page.getByTestId("user-row")).toHaveCount(2);
  await expect(page.getByTestId("department-list")).toContainText("Human Resources");

  // The admin cannot deactivate themselves: their row has no such button.
  const selfRow = page.getByTestId("user-row").filter({ hasText: "Alice Admin" });
  await expect(selfRow.getByRole("button", { name: "Deactivate" })).toHaveCount(0);

  // Add a user.
  await page.getByRole("button", { name: "Add user" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill("Nina New");
  await dialog.getByLabel("Email").fill("nina@acme.test");
  await dialog.getByLabel("Initial password").fill("welcome-123");
  await dialog.getByLabel("Department").selectOption({ label: "Human Resources" });
  await dialog.getByLabel("Clearance").selectOption("2");
  await dialog.getByRole("button", { name: "Add user" }).click();

  await expect(page.getByTestId("user-row").filter({ hasText: "Nina New" })).toBeVisible();
  // The organization comes from the admin's session on the server, never from the form.
  expect(stub.created).toEqual([
    { name: "Nina New", email: "nina@acme.test", password: "welcome-123", role: "staff", department_id: 2, clearance_level: 2 },
  ]);

  // Deactivate the manager, through the confirmation step.
  const managerRow = page.getByTestId("user-row").filter({ hasText: "Mark Manager" });
  await managerRow.getByRole("button", { name: "Deactivate" }).click();
  await expect(managerRow).toContainText("Sign them out and block access?");
  await managerRow.getByRole("button", { name: "Deactivate" }).click();
  await expect(managerRow.getByTestId("user-status")).toHaveText("Deactivated");
  await expect(managerRow.getByRole("button", { name: "Reactivate" })).toBeVisible();
});
