// T8-04: petty cash through the UI — top-up, expense with input VAT, the below-zero guard, daily cash report, cancel.
import { expect, test, type Page, type TestInfo } from "@playwright/test";

const PASSWORD = process.env.E2E_PASSWORD ?? "";

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

test("petty cash: top-up, expense with VAT, daily report, cancel", async ({ page }, info) => {
  test.skip(!PASSWORD, "E2E_PASSWORD is not set");
  const tag = `${Date.now().toString(36).toUpperCase()}${info.project.name === "mobile" ? "M" : "D"}`;

  await test.step("manager sees petty cash but cannot record", async () => {
    await loginAs(page, "manager");
    await page.goto("/petty-cash");
    await expect(page.getByRole("heading", { name: "Petty cash", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Record expense" })).toHaveCount(0);
  });

  let expenseUrl = "";
  await test.step("accountant tops up and records an expense with 5% VAT", async () => {
    await loginAs(page, "accountant");
    await page.goto("/petty-cash/new?type=TOP_UP");
    await page.getByLabel("Amount (AED)").fill("500");
    await page.getByLabel("Taken from").selectOption("CASH");
    await page.getByRole("button", { name: "Record top-up" }).click();
    await expect(page).toHaveURL(/\/petty-cash\/(?!new)[a-z0-9]+$/);

    await page.goto("/petty-cash/new?type=EXPENSE");
    await page.getByLabel("Category").selectOption({ label: "General & office" });
    await page.getByLabel("Amount paid (AED, incl. VAT)").fill("105");
    await page.getByRole("combobox", { name: /^VAT/ }).selectOption({ label: "SR — 5% tax invoice (claim input VAT)" });
    await page.getByLabel("Description").fill(`E2E stationery ${tag}`);
    await page.getByRole("button", { name: "Record expense" }).click();
    await expect(page).toHaveURL(/\/petty-cash\/(?!new)[a-z0-9]+$/);
    expenseUrl = new URL(page.url()).pathname;
    await expect(page.getByText("AED 5.00 (SR)")).toBeVisible();
    await expect(page.getByText("VAT Input").first()).toBeVisible();
    await shot(page, info, "01-expense");
  });

  await test.step("an expense larger than the box is refused", async () => {
    await page.goto("/petty-cash/new?type=EXPENSE");
    await page.getByLabel("Category").selectOption({ label: "Utilities" });
    await page.getByLabel("Amount paid (AED, incl. VAT)").fill("99999999");
    await page.getByLabel("Description").fill("Too much");
    await page.getByRole("button", { name: "Record expense" }).click();
    await expect(page.locator('[role="alert"]').filter({ hasText: "top it up first" }).first()).toBeVisible();
  });

  await test.step("daily cash report shows the expense; cancel it", async () => {
    await page.goto("/petty-cash/daily");
    await expect(page.getByText(`E2E stationery ${tag}`).first()).toBeVisible();
    await expect(page.getByText("Closing balance").first()).toBeVisible();
    await shot(page, info, "02-daily");
    await page.goto(expenseUrl);
    await page.getByLabel("Reason").fill("E2E clean-up");
    await page.getByRole("button", { name: "Cancel transaction" }).click();
    await expect(page.getByText("Cancelled", { exact: true }).first()).toBeVisible();
  });
});
