// T8-05: bank reconciliation through the UI on the main bank — manual line + one-click match, CSV import,
// bank charges from the statement, save a reconciliation and reopen it (so later runs are not locked out).
import { expect, test, type Page, type TestInfo } from "@playwright/test";

const PASSWORD = process.env.E2E_PASSWORD ?? "";
const CUSTOMER = "Palm Coast Villas (demo) (CUS-0003)";
const BANK = "/accounts/bank-rec/bank_main";

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
const today = () => {
  const n = new Date();
  return { iso: `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`, dmy: `${String(n.getDate()).padStart(2, "0")}/${String(n.getMonth() + 1).padStart(2, "0")}/${n.getFullYear()}` };
};

test("bank reconciliation: match, import, charges, save and reopen", async ({ page }, info) => {
  test.skip(!PASSWORD, "E2E_PASSWORD is not set");
  const tag = `${Date.now().toString(36).toUpperCase()}${info.project.name === "mobile" ? "M" : "D"}`;
  // A cent amount unlikely to collide with older runs: 1,000.xx–1,999.xx
  const amount = `${1000 + (Date.now() % 1000)}.${String(Date.now() % 97).padStart(2, "0")}`;

  await test.step("manager can view but not change", async () => {
    await loginAs(page, "manager");
    await page.goto(BANK);
    await expect(page.getByRole("heading", { name: /Reconcile/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add line" })).toHaveCount(0);
  });

  await test.step("a bank receipt is matched to a statement line in one click", async () => {
    await loginAs(page, "accountant");
    await page.goto("/receipts/new");
    await page.getByLabel("Customer").selectOption({ label: CUSTOMER });
    await page.getByLabel("Amount (AED)").fill(amount);
    await page.getByLabel("Received into").selectOption({ index: 0 }); // default bank first
    await page.getByRole("button", { name: "Record receipt" }).click();
    await expect(page).toHaveURL(/\/receipts\/(?!new$)[a-z0-9]+$/);

    await page.goto(BANK);
    await page.getByLabel("Direction").selectOption("IN");
    await page.getByLabel("Amount (AED)").fill(amount);
    await page.getByLabel("Description").fill(`E2E deposit ${tag}`);
    await page.getByRole("button", { name: "Add line" }).click();
    const row = page.locator("tr", { hasText: `E2E deposit ${tag}` }).first();
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Match" }).first().click();
    await expect(page.locator("tr", { hasText: `E2E deposit ${tag}` }).getByRole("button", { name: "Unmatch" })).toBeVisible();
    await shot(page, info, "01-matched");
  });

  await test.step("CSV import with column mapping, then post its charge line", async () => {
    await page.goto(`${BANK}/import`);
    const csv = `Date,Narration,Debit,Credit\n${today().dmy},E2E charge ${tag},12.34,\n`;
    await page.getByLabel("CSV file from the bank").setInputFiles({ name: "statement.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await expect(page.getByLabel("Money out (debit) column")).toHaveValue("2");
    await page.getByRole("button", { name: "Check" }).click();
    await expect(page.getByText(/Ready to import 1 line/)).toBeVisible();
    await page.getByRole("button", { name: "Import" }).click();
    await expect(page.getByText(/Imported 1 line/)).toBeVisible();

    await page.goto(BANK);
    const row = page.locator("tr", { hasText: `E2E charge ${tag}` }).first();
    await row.getByRole("button", { name: "Post as bank charges" }).click();
    await expect(page.locator("tr", { hasText: `E2E charge ${tag}` }).getByRole("button", { name: "Unmatch" })).toBeVisible();
  });

  await test.step("save the reconciliation at the explained balance, then reopen it", async () => {
    await page.goto(`${BANK}?date=${today().iso}`);
    const expected = (await page.locator("tr", { hasText: "The statement should show" }).locator("td").nth(1).innerText()).replace(/[^\d.-]/g, "");
    const wrong = (Number(expected) + 1).toFixed(2);
    await page.getByLabel("Closing balance on the statement (AED)").fill(wrong);
    await page.getByRole("button", { name: "Save reconciliation" }).click();
    await expect(page.locator('[role="alert"]').filter({ hasText: "Not reconciled" }).first()).toBeVisible();
    await page.getByLabel("Closing balance on the statement (AED)").fill(expected);
    await page.getByRole("button", { name: "Save reconciliation" }).click();
    await expect(page.getByText(/Reconciled up to/)).toBeVisible();
    await shot(page, info, "02-saved");
    await page.getByLabel("Reason to reopen").fill("E2E clean-up");
    await page.getByRole("button", { name: "Reopen" }).click();
    await expect(page.getByText("None saved yet.").or(page.getByText(/Reconciled up to/))).toBeVisible();
    await expect(page.getByRole("button", { name: "Save reconciliation" })).toBeVisible();
  });
});
