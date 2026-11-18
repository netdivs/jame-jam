// T6-02: received post-dated cheques through the UI — record (sales), deposit → clear, bounce with charges → replace.
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
const today = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
};

async function recordCheque(page: Page, chequeNo: string, amount: string) {
  await page.goto("/pdc/new?direction=RECEIVED");
  await page.getByLabel("Customer").selectOption({ label: CUSTOMER });
  await page.getByLabel("Cheque number").fill(chequeNo);
  await page.getByLabel("Bank", { exact: true }).fill("ADCB");
  await page.getByLabel("Amount (AED)").fill(amount);
  await page.getByLabel("Cheque date (due)").fill(today());
  await page.getByRole("button", { name: "Record cheque" }).click();
  await expect(page).toHaveURL(/\/pdc\/(?!new$)[a-z0-9]+$/);
  return new URL(page.url()).pathname;
}

test("received PDC: clear, bounce and replace", async ({ page }, info) => {
  test.skip(!PASSWORD, "E2E_PASSWORD is not set");
  const tag = `${Date.now().toString(36).toUpperCase()}${info.project.name === "mobile" ? "M" : "D"}`;
  let first = "";
  let second = "";

  await test.step("sales records two cheques but cannot deposit them", async () => {
    await loginAs(page, "sales");
    first = await recordCheque(page, `A-${tag}`, "1500");
    await expect(page.getByText("Received", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Mark deposited" })).toHaveCount(0);
    second = await recordCheque(page, `B-${tag}`, "800");
  });

  await test.step("accountant deposits and clears the first; the register agrees with the GL", async () => {
    await loginAs(page, "accountant");
    await page.goto(first);
    await page.getByRole("button", { name: "Mark deposited" }).click();
    await expect(page.getByRole("button", { name: "Mark cleared" })).toBeVisible();
    await page.getByRole("button", { name: "Mark cleared" }).click();
    await expect(page.getByText("Cleared", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Received → ").first()).toBeVisible(); // history
    await shot(page, info, "01-cleared");
  });

  await test.step("the second bounces with bank charges and is replaced", async () => {
    await page.goto(second);
    await page.getByRole("button", { name: "Mark deposited" }).click();
    await expect(page.getByRole("button", { name: "Mark bounced" })).toBeVisible();
    await page.getByRole("button", { name: "Mark bounced" }).click();
    await expect(page.locator('[role="alert"]').filter({ hasText: "reason" }).first()).toBeVisible();
    await page.getByLabel("Reason").fill("Insufficient funds");
    await page.getByLabel("Bank charges (AED)").fill("52.50");
    await page.getByRole("button", { name: "Mark bounced" }).click();
    await expect(page.getByText("Insufficient funds").first()).toBeVisible();
    await page.getByLabel("New cheque number").fill(`C-${tag}`);
    await page.getByLabel("Cheque date (due)").fill(today());
    await page.getByRole("button", { name: "Record replacement" }).click();
    await expect(page.getByText("Replaces", { exact: true })).toBeVisible();
    await shot(page, info, "02-replacement");
  });

  await test.step("register: totals agree with the PDC accounts; bounced filter", async () => {
    await page.goto("/pdc");
    await expect(page.getByText("= PDC Receivable ✓")).toBeVisible();
    await page.goto("/pdc?status=BOUNCED");
    await expect(page.getByRole("link", { name: /PDC-/ }).first()).toBeVisible();
    await shot(page, info, "03-register");
  });
});
