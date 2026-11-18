// T8-03 / T8-02 / T8-07 / TJ-01 through the UI: bank account, journal voucher + reversal, reports, scheduled jobs.
import { expect, test, type Page, type TestInfo } from "@playwright/test";

const PASSWORD = process.env.E2E_PASSWORD ?? "";
const TAG = Date.now().toString(36).toUpperCase();

test.describe.configure({ mode: "serial" });

async function loginAs(page: Page, role: "owner" | "manager" | "accountant" | "store" | "sales") {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill(`${role}@jamejam.local`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/);
}
const shot = (page: Page, info: TestInfo, name: string) => page.screenshot({ path: info.outputPath(`${info.project.name}-${name}.png`), fullPage: true });
const message = (page: Page, text: string) => page.locator('[role="status"], [role="alert"]').filter({ hasText: text }).first();

test("bank account, journal voucher, reports and jobs", async ({ page }, info) => {
  test.skip(!PASSWORD, "E2E_PASSWORD is not set");
  const tag = `${TAG}${info.project.name === "mobile" ? "M" : "D"}`;
  const bank = `ENBD ${tag}`;

  await test.step("accountant adds a bank account", async () => {
    await loginAs(page, "accountant");
    await page.goto("/accounts/banks");
    await page.getByLabel("Name").fill(bank);
    await page.getByLabel("Bank", { exact: true }).fill("Emirates NBD");
    await page.getByLabel("IBAN").fill("AE07 0331 2345 6789 0123 456");
    await page.getByRole("button", { name: "Add bank account" }).click();
    await expect(message(page, "added")).toBeVisible();
    await expect(page.getByRole("link", { name: bank })).toBeVisible();
    await shot(page, info, "01-banks");
  });

  await test.step("accountant posts a journal voucher, sees it balanced, then reverses it", async () => {
    await page.goto("/accounts/journals/new");
    await page.getByLabel("Narration *").fill(`Rent ${tag}`);
    await page.getByLabel("Line 1 account *").selectOption({ label: "5500 — Rent" });
    await page.getByLabel("Line 1 debit").fill("4500");
    await page.getByLabel("Line 2 account *").selectOption({ label: "1110 — Cash in Hand" });
    await page.getByLabel("Line 2 credit").fill("4000");
    await expect(page.getByText("500.00").last()).toBeVisible(); // difference
    await page.getByRole("button", { name: "Post journal voucher" }).click();
    await expect(message(page, "must be equal")).toBeVisible();
    await page.getByLabel("Line 2 credit").fill("4500");
    await expect(page.getByText("Balanced")).toBeVisible();
    await shot(page, info, "02-jv-form");
    await page.getByRole("button", { name: "Post journal voucher" }).click();
    await expect(page).toHaveURL(/\/accounts\/journals\/(?!new$)[a-z0-9]+$/);
    await expect(page.getByText(`Rent ${tag}`)).toBeVisible();
    await page.getByLabel("Reason").fill("E2E clean-up");
    await page.getByRole("button", { name: "Post reversal" }).click();
    await expect(page.getByText("Reversed by")).toBeVisible();
  });

  await test.step("reports agree", async () => {
    await page.goto("/accounts/trial-balance");
    await expect(page.getByRole("heading", { name: "Trial balance" })).toBeVisible();
    await expect(page.getByText("do not agree")).toHaveCount(0);
    await page.goto("/accounts/balance-sheet");
    await expect(page.getByText("Balanced ✓")).toBeVisible();
    await shot(page, info, "03-balance-sheet");
    await page.goto("/accounts/profit-loss");
    await expect(page.getByText("Total expenses")).toBeVisible();
  });

  await test.step("sales cannot see accounts; manager sees reports but cannot post vouchers", async () => {
    await loginAs(page, "sales");
    await page.goto("/accounts/trial-balance");
    await expect(page).toHaveURL(/\/forbidden/);
    await loginAs(page, "manager");
    await page.goto("/accounts/journals");
    await expect(page.getByRole("link", { name: "New journal voucher" })).toHaveCount(0);
    await page.goto("/accounts/balance-sheet");
    await expect(page.getByText("Balanced ✓")).toBeVisible();
  });

  await test.step("owner runs a scheduled job by hand", async () => {
    await loginAs(page, "owner");
    await page.goto("/settings/jobs");
    await page.locator("section, div").filter({ hasText: /^stock-gl-check/ }).getByRole("button", { name: "Run now" }).first().click();
    await expect(message(page, "stock-gl-check: ok")).toBeVisible();
    await shot(page, info, "04-jobs");
  });
});
