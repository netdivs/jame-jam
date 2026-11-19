// T1-01: owner grants one permission to the sales user, the sales user sees it, then it is reverted.
import { expect, test, type Page } from "@playwright/test";

const PASSWORD = process.env.E2E_PASSWORD ?? "";
test.describe.configure({ mode: "serial" });

async function loginAs(page: Page, role: "owner" | "sales") {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill(`${role}@jamejam.local`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function setOverride(page: Page, key: string, value: "role" | "grant") {
  await loginAs(page, "owner");
  await page.goto("/settings/users");
  await page.getByRole("link", { name: "Sales Staff" }).first().click();
  await page.getByLabel(`${key} for this user`).selectOption(value);
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.getByRole("button", { name: "Save permission overrides" }).click()]);
}

test("a granted permission takes effect for the user, and can be reverted", async ({ page }) => {
  test.skip(!PASSWORD, "E2E_PASSWORD is not set");
  try {
    await setOverride(page, "pettyCash.view", "grant");
    await loginAs(page, "sales");
    await page.goto("/petty-cash");
    await expect(page.getByRole("heading", { name: "Petty cash", exact: true })).toBeVisible();
  } finally {
    await setOverride(page, "pettyCash.view", "role");
  }
  await loginAs(page, "sales");
  await page.goto("/petty-cash");
  await expect(page).toHaveURL(/\/forbidden/);
});
