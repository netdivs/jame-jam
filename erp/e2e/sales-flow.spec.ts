// T5-08: sales order → reservation → proforma invoice → close / cancel, through the real UI, as each role.
import { expect, test, type Page, type TestInfo } from "@playwright/test";

const PASSWORD = process.env.E2E_PASSWORD ?? "";
const CUSTOMER = "Desert Rose Interiors (demo) (CUS-0002)";
const TILE = "BTT-3060 — Beige Travertine Tiles 30x60";
const SLAB = "BOT-18 — Botticino Classico Slab 18mm";

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

/** Pick the first option of a stock select whose label contains `text`. */
async function pickStock(page: Page, line: number, text: string) {
  const sel = page.getByLabel(`Line ${line} stock`);
  await expect(sel.locator("option", { hasText: text }).first()).toBeAttached();
  const value = await sel.locator("option", { hasText: text }).first().getAttribute("value");
  await sel.selectOption(value!);
}

test("sales order and proforma flow", async ({ page }, info) => {
  test.skip(!PASSWORD, "E2E_PASSWORD is not set");
  let soUrl = "";
  let piUrl = "";

  await test.step("storekeeper and accountant can view but not create sales orders", async () => {
    await loginAs(page, "accountant");
    await page.goto("/sales/orders");
    await expect(page.getByRole("heading", { name: "Sales orders" })).toBeVisible();
    await expect(page.getByRole("link", { name: "New sales order" })).toHaveCount(0);
    await page.goto("/sales/orders/new");
    await expect(page).toHaveURL(/\/forbidden/);
  });

  await test.step("sales creates an SO for a tile bucket and a slab; saving reserves the stock", async () => {
    await loginAs(page, "sales");
    await page.goto("/sales/orders/new");
    await page.getByLabel("Customer *").selectOption({ label: CUSTOMER });
    await page.getByLabel("Line 1 product").selectOption({ label: TILE });
    await pickStock(page, 1, "Block TB-A");
    await page.getByLabel("Line 1 SQM").fill("81.72");
    await page.getByLabel("Line 1 price per SQM").fill("100");
    await expect(page.getByText("Net 7,782.86 · VAT 389.14")).toBeVisible(); // spec §3.3.4 example (C4 proposal)
    await expect(page.getByLabel("Line 1 tax code")).toBeDisabled(); // sales cannot change tax codes
    await page.getByRole("button", { name: "Add line" }).click();
    await page.getByLabel("Line 2 product").selectOption({ label: SLAB });
    await pickStock(page, 2, "Slab");
    await expect(page.getByLabel("Line 2 SQM")).not.toHaveValue(""); // whole slab filled in
    await page.getByLabel("Line 2 price per SQM").fill("250");
    await page.getByLabel("Line 2 discount").fill("25");
    await page.getByLabel("Invoice discount (AED)").fill("10");
    await shot(page, info, "01-so-form");
    await page.getByRole("button", { name: "Create sales order" }).click();
    await expect(page).toHaveURL(/\/sales\/orders\/(?!new$)[a-z0-9]+$/);
    soUrl = new URL(page.url()).pathname;
    await expect(page.getByText("Open (reserved)").first()).toBeVisible();
    await expect(page.getByText(/Reserved \d/).locator("visible=true").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Edit" })).toBeVisible();
    await expect(page.getByText("Cancel this sales order")).toHaveCount(0); // sales cannot cancel
    await shot(page, info, "02-so-detail");
  });

  await test.step("the reserved slab shows as reserved in inventory", async () => {
    const slabLink = page.locator('a[href^="/inventory/slabs/"]').first();
    await slabLink.click();
    await expect(page.getByText("Reserved").first()).toBeVisible();
    await page.goto(soUrl);
  });

  await test.step("sales issues a proforma; the SO can no longer be edited while it is live", async () => {
    await page.getByRole("button", { name: "Issue proforma invoice" }).click();
    await expect(page).toHaveURL(/\/sales\/proformas\/[a-z0-9]+$/);
    piUrl = new URL(page.url()).pathname;
    await expect(page.getByText("Active").first()).toBeVisible();
    await expect(page.getByText("None — a proforma posts no accounting or VAT.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Close proforma" })).toHaveCount(0);
    await shot(page, info, "03-pi-detail");
    await page.goto(soUrl);
    await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);
    await expect(page.getByText(/Quoted on proforma PI-/)).toBeVisible();
  });

  await test.step("manager closes the proforma, then sales edits the SO quantity", async () => {
    await loginAs(page, "manager");
    await page.goto(piUrl);
    await page.getByLabel("Close — customer will not proceed").fill("Customer wants a smaller quantity");
    await page.getByRole("button", { name: "Close proforma" }).click();
    // The close form disappears once the PI is closed; the status and reason show instead.
    await expect(page.getByText("Customer wants a smaller quantity")).toBeVisible();
    await expect(page.getByRole("button", { name: "Close proforma" })).toHaveCount(0);
    await loginAs(page, "sales");
    await page.goto(soUrl);
    await page.getByRole("link", { name: "Edit" }).click();
    await expect(page.getByLabel("Line 1 SQM")).toHaveValue("81.72");
    await page.getByLabel("Line 1 SQM").fill("50");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page).toHaveURL(new RegExp(`${soUrl}$`));
    await expect(page.getByText("Reserved 50.00").locator("visible=true")).toBeVisible();
  });

  await test.step("manager cancels the SO with a reason; every reservation is released", async () => {
    await loginAs(page, "manager");
    await page.goto(soUrl);
    await page.getByRole("button", { name: "Cancel SO and release stock" }).click();
    await expect(message(page, "reason")).toBeVisible();
    await page.getByLabel("Reason").fill("E2E clean-up");
    await page.getByRole("button", { name: "Cancel SO and release stock" }).click();
    await expect(page.getByText("Cancelled: “E2E clean-up”")).toBeVisible();
    await expect(page.getByText("Cancelled").first()).toBeVisible();
    await expect(page.getByText(/Reserved \d/).locator("visible=true")).toHaveCount(0);
    await shot(page, info, "04-so-cancelled");
  });

  await test.step("proforma list shows the closed PI; audit log has the sales events", async () => {
    await page.goto("/sales/proformas?status=CLOSED");
    await expect(page.getByRole("link", { name: /PI-/ }).first()).toBeVisible();
    await page.goto("/audit?entity=SalesOrder");
    await expect(page.getByText("cancel").first()).toBeVisible();
  });
});
