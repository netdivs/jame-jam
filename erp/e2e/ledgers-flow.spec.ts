// T8-01: customer and supplier ledgers — list with the control check, statement with running balance.
import { expect, test, type Page, type TestInfo } from "@playwright/test";

const PASSWORD = process.env.E2E_PASSWORD ?? "";
const CUSTOMER = "Palm Coast Villas (demo) (CUS-0003)";

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

test("ledgers: control check, customer statement after a receipt, supplier list", async ({ page }, info) => {
  test.skip(!PASSWORD, "E2E_PASSWORD is not set");
  const tag = `${Date.now().toString(36).toUpperCase()}${info.project.name === "mobile" ? "M" : "D"}`;

  await test.step("sales cannot open ledgers", async () => {
    await loginAs(page, "sales");
    await page.goto("/accounts/ledgers");
    await expect(page).toHaveURL(/\/forbidden/);
  });

  await test.step("a receipt shows on the customer's statement with the running balance", async () => {
    await loginAs(page, "accountant");
    await page.goto("/receipts/new");
    await page.getByLabel("Customer").selectOption({ label: CUSTOMER });
    await page.getByLabel("Amount (AED)").fill("123.45");
    await page.getByLabel("Notes").fill(`E2E ledger ${tag}`);
    await page.getByRole("button", { name: "Record receipt" }).click();
    await expect(page).toHaveURL(/\/receipts\/(?!new$)[a-z0-9]+$/);

    await page.goto("/accounts/ledgers?type=customer");
    await expect(page.getByText(/customers = Accounts Receivable ✓/)).toBeVisible();
    await expect(page.getByText(/customers = Customer Advances ✓/)).toBeVisible();
    await page.getByRole("link", { name: "Palm Coast Villas (demo)" }).click();
    await expect(page.getByRole("heading", { name: /Statement — Palm Coast Villas/ })).toBeVisible();
    await expect(page.getByText("Opening balance", { exact: true })).toBeVisible();
    await expect(page.getByText("123.45").locator("visible=true").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Print / save as PDF" })).toBeVisible();
    await shot(page, info, "01-statement");
  });

  await test.step("supplier ledgers agree with AP and Supplier Advances", async () => {
    await page.goto("/accounts/ledgers?type=supplier");
    await expect(page.getByText(/suppliers = Accounts Payable ✓/)).toBeVisible();
    await expect(page.getByText(/suppliers = Supplier Advances ✓/)).toBeVisible();
  });
});
