// T11-01 (R8): opening customer invoice knocked off by an advance, opening supplier invoice paid by a PV,
// opening trial balance posted, summary checks visible. Manager can view but not post.
import { expect, test, type Page, type TestInfo } from "@playwright/test";

const PASSWORD = process.env.E2E_PASSWORD ?? "";
const CUSTOMER = "Al Noor Building Contracting (demo) (CUS-0001)";
const SUPPLIER = "Gulf Stone Traders (demo) (SUP-0003)";

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

test("opening balances: AR knocked off, AP paid, trial balance", async ({ page }, info) => {
  test.skip(!PASSWORD, "E2E_PASSWORD is not set");
  const tag = `${Date.now().toString(36).toUpperCase()}${info.project.name === "mobile" ? "M" : "D"}`;

  await test.step("manager sees the opening summary but cannot post", async () => {
    await loginAs(page, "manager");
    await page.goto("/accounts/opening");
    await expect(page.getByText("Opening Balance Equity").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Post opening balance" })).toHaveCount(0);
  });

  await test.step("opening customer invoice, knocked off by a receipt applied as advance", async () => {
    await loginAs(page, "accountant");
    await page.goto("/accounts/opening?kind=CUSTOMER_INVOICE");
    await page.getByLabel("Customer").selectOption({ label: CUSTOMER });
    await page.getByLabel("Invoice no.").fill(`OI-${tag}`);
    await page.getByLabel("Amount still open (AED)").fill("300");
    await page.getByRole("button", { name: "Post opening balance" }).click();
    const row = page.locator("tr", { hasText: `OI-${tag}` });
    await expect(row).toBeVisible();
    await expect(row.getByText("Open", { exact: true })).toBeVisible();

    await page.goto("/receipts/new");
    await page.getByLabel("Customer").selectOption({ label: CUSTOMER });
    await page.getByLabel("Amount (AED)").fill("300");
    await page.getByRole("button", { name: "Record receipt" }).click();
    await expect(page).toHaveURL(/\/receipts\/(?!new$)[a-z0-9]+$/);

    await page.goto(`/accounts/opening?kind=CUSTOMER_INVOICE&q=OI-${tag}`);
    await row.getByText("Actions").click();
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), row.getByRole("button", { name: "Apply advance" }).click()]);
    await page.reload();
    await expect(page.locator("tr", { hasText: `OI-${tag}` }).getByText("Settled", { exact: true })).toBeVisible();
    await shot(page, info, "01-ar-settled");
  });

  await test.step("opening supplier invoice paid by a PV", async () => {
    await page.goto("/accounts/opening?kind=SUPPLIER_INVOICE");
    await page.getByLabel("Supplier").selectOption({ label: SUPPLIER });
    await page.getByLabel("Invoice no.").fill(`OS-${tag}`);
    await page.getByLabel("Amount still open (AED)").fill("450");
    await page.getByRole("button", { name: "Post opening balance" }).click();
    const row = page.locator("tr", { hasText: `OS-${tag}` });
    await expect(row).toBeVisible();
    await row.getByText("Actions").click();
    // The row re-renders after the payment (its form state goes), so check the result on the page.
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), row.getByRole("button", { name: "Record payment (PV)" }).click()]);
    await page.reload();
    await expect(page.locator("tr", { hasText: `OS-${tag}` }).getByText("Settled", { exact: true })).toBeVisible();
  });

  await test.step("opening trial balance posts the difference to Opening Balance Equity", async () => {
    await page.goto("/accounts/opening/trial-balance");
    await page.getByLabel("2310 credit").fill("1.00");
    await page.getByRole("button", { name: "Post opening trial balance" }).click();
    await expect(page.getByText(/Opening trial balance posted \(JE-/)).toBeVisible();
    await page.goto("/accounts/opening");
    await expect(page.getByText("Parties = AR / AP")).toBeVisible();
    await shot(page, info, "02-summary");
  });
});
