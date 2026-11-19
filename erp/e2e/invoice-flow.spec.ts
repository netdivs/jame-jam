// T5-06 / T5-07 in the browser: the Owner switches the module on, sales converts a paid proforma into a tax invoice
// (the advance is applied), a receipt pays the rest. The module is switched off again at the end.
import { expect, test, type Page, type TestInfo } from "@playwright/test";

const PASSWORD = process.env.E2E_PASSWORD ?? "";
const CUSTOMER = "Desert Rose Interiors (demo) (CUS-0002)";
const TILE = "BTT-3060 — Beige Travertine Tiles 30x60";

test.describe.configure({ mode: "serial" });

async function loginAs(page: Page, role: "owner" | "sales" | "store" | "manager" | "accountant") {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill(`${role}@jamejam.local`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/);
}
const shot = (page: Page, info: TestInfo, name: string) => page.screenshot({ path: info.outputPath(`${info.project.name}-${name}.png`), fullPage: true });

async function setModule(page: Page, on: boolean) {
  await loginAs(page, "owner");
  await page.goto("/settings/system");
  await page.getByLabel("Tax invoices, delivery notes, returns and credit notes").selectOption(on ? "true" : "false");
  await page.getByRole("button", { name: "Save modules" }).click();
  await expect(page.getByText(/Saved|No changes/).first()).toBeVisible();
}

test("tax invoice: convert a paid proforma, receive the rest, deliver, return", async ({ page }, info) => {
  test.skip(!PASSWORD, "E2E_PASSWORD is not set");
  let piUrl = "";
  let tiUrl = "";
  try {
    await test.step("owner switches tax invoicing on", async () => {
      await setModule(page, true);
    });

    await test.step("sales creates an SO and a proforma, and records an advance of AED 100", async () => {
      await loginAs(page, "sales");
      await page.goto("/sales/orders/new");
      await page.getByLabel("Customer *").selectOption({ label: CUSTOMER });
      await page.getByLabel("Line 1 product").selectOption({ label: TILE });
      const sel = page.getByLabel("Line 1 stock");
      await expect(sel.locator("option", { hasText: "SQM" }).first()).toBeAttached();
      const values = await sel.locator("option", { hasText: "SQM" }).evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
      await sel.selectOption(values[0]);
      await page.getByLabel("Line 1 SQM").fill("2");
      await page.getByLabel("Line 1 price per SQM").fill("105");
      await page.getByRole("button", { name: "Create sales order" }).click();
      await expect(page).toHaveURL(/\/sales\/orders\/(?!new$)[a-z0-9]+$/);
      await page.getByRole("button", { name: "Issue proforma invoice" }).click();
      await expect(page).toHaveURL(/\/sales\/proformas\/[a-z0-9]+$/);
      piUrl = new URL(page.url()).pathname;
      await page.getByRole("link", { name: "Record receipt" }).click();
      await page.getByLabel("Amount (AED)").fill("100");
      await page.getByLabel("Received into").selectOption("CASH");
      await page.getByRole("button", { name: "Record receipt" }).click();
      await expect(page).toHaveURL(/\/receipts\/(?!new)[a-z0-9]+$/);
      await page.goto(piUrl);
    });

    await test.step("sales converts the proforma; the advance is applied", async () => {
      await page.getByRole("button", { name: "Issue tax invoice for this proforma" }).click();
      await expect(page).toHaveURL(/\/sales\/invoices\/[a-z0-9]+$/);
      tiUrl = new URL(page.url()).pathname;
      await expect(page.getByRole("heading", { name: /Tax invoice TI-/ })).toBeVisible();
      await expect(page.getByText("Partly paid").first()).toBeVisible();
      await expect(page.getByText(/Advance received on PI-/)).toBeVisible();
      await shot(page, info, "ti-partly-paid");
    });

    await test.step("a receipt against the invoice pays the rest", async () => {
      await page.getByRole("link", { name: "Record receipt" }).click();
      await expect(page.getByLabel("Amount (AED)")).toHaveValue("110.00");
      await page.getByLabel("Received into").selectOption("CASH");
      await page.getByRole("button", { name: "Record receipt" }).click();
      await expect(page).toHaveURL(/\/receipts\/(?!new)[a-z0-9]+$/);
      await page.goto(tiUrl);
      await expect(page.getByText("Paid in full", { exact: true })).toBeVisible();
      await shot(page, info, "ti-paid");
    });

    await test.step("the storekeeper releases the goods with a delivery note", async () => {
      await loginAs(page, "store");
      await page.goto(tiUrl);
      await page.getByLabel("Received by").fill("Site foreman");
      await page.getByLabel("Vehicle no.").fill("D 12345");
      await page.getByRole("button", { name: "Issue delivery note" }).click();
      await expect(page).toHaveURL(/\/sales\/deliveries\/[a-z0-9]+$/);
      await expect(page.getByRole("heading", { name: /Delivery note DN-/ })).toBeVisible();
      await expect(page.getByText("Goods released")).toBeVisible();
      await shot(page, info, "dn");
      await page.goto(tiUrl);
      await expect(page.getByText("Everything on this invoice has been delivered.")).toBeVisible();
    });

    let rrUrl = "";
    await test.step("sales raises a return; the manager approves; the store receives it", async () => {
      await loginAs(page, "sales");
      await page.goto(tiUrl);
      await page.getByLabel("Line 1 — SQM to return").fill("1");
      await page.getByLabel("Reason").fill("Excess tiles");
      await page.getByRole("button", { name: "Raise return request" }).click();
      await expect(page).toHaveURL(/\/sales\/returns\/[a-z0-9]+$/);
      rrUrl = new URL(page.url()).pathname;
      await expect(page.getByRole("button", { name: "Approve return" })).toHaveCount(0);
      await loginAs(page, "manager");
      await page.goto(rrUrl);
      await page.getByRole("button", { name: "Approve return" }).click();
      await expect(page.getByText(/approved/).first()).toBeVisible();
      await loginAs(page, "store");
      await page.goto(rrUrl);
      await page.getByRole("button", { name: "Record goods received" }).click();
      await expect(page.getByText("Goods received back")).toBeVisible();
    });

    await test.step("the accountant issues the return credit note", async () => {
      await loginAs(page, "accountant");
      await page.goto(rrUrl);
      await page.getByRole("button", { name: "Issue return credit note" }).click();
      await expect(page).toHaveURL(/\/sales\/credit-notes\/[a-z0-9]+$/);
      await expect(page.getByRole("heading", { name: /Credit note CN-/ })).toBeVisible();
      await expect(page.getByText(/customer credit AED 105.00/)).toBeVisible();
      await shot(page, info, "cn");
    });
  } finally {
    await setModule(page, false);
  }
});
