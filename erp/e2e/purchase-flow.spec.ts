// T4-11 / T4-16: the Step 4 purchase & import flow through the real UI, as each role, on desktop and phone.
// Import PO (2 lines) → approval → 2 shipments → partial payment (collection blocked) → 100% + verification →
// collection → GRN per shipment → supplier invoice with a price increase → landed cost bills (shipment-level and
// PO-level) → default allocation, manual override, bill payment → dashboard reconciliation.
import { expect, test, type Page, type TestInfo } from "@playwright/test";

const PASSWORD = process.env.E2E_PASSWORD ?? "";
const TAG = `${Date.now().toString(36).toUpperCase()}`;
const SUPPLIER = "Apuan Quarries Srl (demo) (SUP-0002)";
const FORWARDER = "Gulf Stone Traders (demo)";
const SLAB = "CAL-20 — Calacatta White Marble Slab 20mm";
const TILE = "BTT-60120 — Beige Travertine Tiles 60x120";

test.describe.configure({ mode: "serial" });

async function loginAs(page: Page, role: "owner" | "manager" | "accountant" | "store" | "sales") {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill(`${role}@jamejam.local`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function shot(page: Page, info: TestInfo, name: string) {
  await page.screenshot({ path: info.outputPath(`${info.project.name}-${name}.png`), fullPage: true });
}

/** A success/error message rendered by ActionForm that contains `text` (earlier messages stay on screen). */
const message = (page: Page, text: string) => page.locator('[role="status"], [role="alert"]').filter({ hasText: text }).first();

test("purchase & import flow, end to end", async ({ page }, info) => {
  test.skip(!PASSWORD, "E2E_PASSWORD is not set");
  const tag = `${TAG}${info.project.name === "mobile" ? "M" : "D"}`;
  let poUrl = "";

  await test.step("access: sales has no Purchase menu and is refused", async () => {
    await loginAs(page, "sales");
    await page.goto("/purchase/orders");
    await expect(page).toHaveURL(/\/forbidden/);
  });

  await test.step("accountant creates an import PO and submits it", async () => {
    await loginAs(page, "accountant");
    await page.goto("/purchase/orders/new");
    await page.getByLabel("Supplier *").selectOption({ label: SUPPLIER });
    await page.getByLabel("Line 1 product").selectOption({ label: SLAB });
    await page.getByLabel("Line 1 SQM").fill("30");
    await page.getByLabel("Line 1 price per SQM").fill("150");
    await page.getByRole("button", { name: "Add line" }).click();
    await page.getByLabel("Line 2 product").selectOption({ label: TILE });
    await page.getByLabel("Line 2 SQM").fill("100");
    await page.getByLabel("Line 2 price per SQM").fill("40");
    await page.getByLabel("Notes").fill(`E2E ${tag}`);
    await expect(page.getByText("8,500.00").first()).toBeVisible(); // payable; reverse charge VAT not payable
    await shot(page, info, "01-po-form");
    await page.getByRole("button", { name: "Create draft PO" }).click();
    await expect(page).toHaveURL(/\/purchase\/orders\/(?!new$)[a-z0-9]+$/);
    poUrl = new URL(page.url()).pathname;
    await page.getByRole("button", { name: "Submit for approval" }).click();
    await expect(page.getByText("Pending Approval").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
  });

  await test.step("manager approves", async () => {
    await loginAs(page, "manager");
    await page.goto(poUrl);
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(page.getByText("Waiting for approval")).toHaveCount(0);
    await expect(page.getByText("Pay the supplier 100%")).toBeVisible();
  });

  await test.step("accountant adds two shipments and moves the first to port", async () => {
    await loginAs(page, "accountant");
    await page.goto(poUrl);
    for (const ref of [`BL-${tag}-1`, `BL-${tag}-2`]) {
      await page.getByLabel("Reference / B/L no.").fill(ref);
      await page.getByRole("button", { name: "Add shipment" }).click();
      await expect(page.getByRole("cell", { name: ref })).toBeVisible();
    }
    await page.getByRole("button", { name: "Mark In Transit" }).first().click();
    await expect(page.getByText("In Transit").first()).toBeVisible();
    await page.getByRole("button", { name: "Mark At Port" }).first().click();
    await expect(page.getByRole("button", { name: "Mark In Transit" })).toHaveCount(1); // only shipment 2 left
  });

  await test.step("partial payment blocks collection; 100% + verification unblocks it", async () => {
    await page.getByLabel("Amount (AED)").fill("5000");
    await page.getByLabel("Reference").last().fill(`TT-${tag}-1`);
    await page.getByRole("button", { name: "Record payment" }).click();
    await expect(message(page, "recorded")).toBeVisible();
    await loginAs(page, "store");
    await page.goto(poUrl);
    await page.getByRole("button", { name: "Mark Collected" }).click();
    await expect(message(page, "blocked")).toBeVisible();
    await loginAs(page, "accountant");
    await page.goto(poUrl);
    await page.getByLabel("Amount (AED)").fill("3500.01");
    await page.getByRole("button", { name: "Record payment" }).click();
    await expect(message(page, "at most")).toBeVisible();
    await page.getByLabel("Amount (AED)").fill("3500");
    await page.getByRole("button", { name: "Record payment" }).click();
    await page.getByRole("button", { name: "Verify 100% payment" }).click();
    await expect(page.getByText(/payment verified/).first()).toBeVisible();
    await shot(page, info, "02-po-paid-verified");
  });

  async function receive(shipmentLabel: string, slabs: string, tileSqm: string) {
    await loginAs(page, "store");
    await page.goto(poUrl);
    const before = await page.getByRole("button", { name: "Mark Collected" }).count();
    await page.getByRole("button", { name: "Mark Collected" }).first().click();
    // Wait for the server action: the link is already visible before it finishes.
    await expect(page.getByRole("button", { name: "Mark Collected" })).toHaveCount(before - 1);
    await expect(page.getByRole("link", { name: "Receive goods (GRN)" })).toBeVisible();
    await page.getByRole("link", { name: "Receive goods (GRN)" }).click();
    await page.getByLabel("Shipment *").selectOption({ label: shipmentLabel });
    const slabLine = page.locator("section").filter({ hasText: "Line 1:" }).first();
    await slabLine.getByRole("checkbox").check();
    await slabLine.getByLabel("Block no. *").fill(`BLK-${tag}-${slabs}`);
    await slabLine.getByLabel("Number of slabs").fill(slabs);
    await slabLine.getByLabel("Bulk length (cm)").fill("300");
    await slabLine.getByLabel("Bulk width (cm)").fill("100");
    await slabLine.getByRole("button", { name: "Add slabs" }).click();
    const tileLine = page.locator("section").filter({ hasText: "Line 2:" }).first();
    await tileLine.getByRole("checkbox").check();
    await tileLine.getByLabel("Lot SQM *").fill(tileSqm);
    await page.getByRole("button", { name: "Post goods receipt" }).click();
    await expect(page).toHaveURL(/\/purchase\/grn\/[a-z0-9]+$/);
  }

  await test.step("storekeeper collects shipment 1 and receives it (GRN)", async () => {
    await receive(`${await shipmentNo(1)} · BL-${tag}-1`, "6", "60");
    await shot(page, info, "03-grn");
  });

  await test.step("shipment 2 arrives and is received; the PO is fully received", async () => {
    await loginAs(page, "accountant");
    await page.goto(poUrl);
    await page.getByRole("button", { name: "Mark In Transit" }).click();
    await page.getByRole("button", { name: "Mark At Port" }).click();
    await expect(page.getByRole("button", { name: "Mark Collected" })).toBeVisible();
    await receive(`${await shipmentNo(2)} · BL-${tag}-2`, "4", "40");
    await page.goto(poUrl);
    await expect(page.getByText("Received", { exact: true }).first()).toBeVisible();
  });

  await test.step("accountant posts the supplier invoice with a price increase and pays the difference", async () => {
    await loginAs(page, "accountant");
    await page.goto(poUrl);
    await page.getByRole("link", { name: "Enter supplier invoice" }).click();
    await page.getByLabel("Supplier invoice no. *").fill(`INV-${tag}`);
    await page.getByLabel("Line 1 price").fill("155");
    await expect(page.getByText(/Price difference vs PO: AED 150\.00/)).toBeVisible();
    await shot(page, info, "04-invoice");
    await page.getByRole("button", { name: "Post supplier invoice" }).click();
    await expect(page).toHaveURL(/\/purchase\/invoices\/[a-z0-9]+$/);
    await page.goto(poUrl);
    await expect(page.getByLabel("Amount (AED)")).toHaveValue("150.00");
    await page.getByRole("button", { name: "Record payment" }).click();
    await expect(page.getByText("Closed").first()).toBeVisible();
  });

  await test.step("accountant records landed cost bills (freight on shipment 1, duty on the PO)", async () => {
    await expenseBill("Freight", "1800", "SR", `${await shipmentNo(1)} · BL-${tag}-1`);
    await expenseBill("Customs Duty", "425", "OS", null);
  });

  await test.step("landed cost list and shipment-scoped allocation preview", async () => {
    if (info.project.name === "mobile") {
      await page.getByRole("button", { name: "Open menu" }).click();
    }
    await page.getByRole("link", { name: "Landed costs" }).click();
    await expect(page).toHaveURL(/\/purchase\/landed-costs$/);
    await page.getByRole("searchbox").fill(`FRT-${tag}`);
    await page.getByRole("button", { name: "Search" }).click();
    await shot(page, info, "05-landed-cost-list");
    await page.getByRole("link", { name: /^LCE-/ }).first().click();
    await expect(page.getByText("Allocation preview")).toBeVisible();
    // Freight is linked to shipment 1, so only shipment 1's two lots are in the preview.
    await expect(page.locator("table").filter({ hasText: "SQM in stock" }).locator("tbody tr")).toHaveCount(3); // 2 lots + total
    await expect(page.getByText("Manual allocation (override)")).toHaveCount(0); // accountant has no override permission
    await shot(page, info, "06-allocation-preview");
    await page.getByRole("button", { name: "Allocate as shown" }).click();
    await expect(page.getByRole("heading", { name: "Allocation", exact: true })).toBeVisible();
    await page.getByLabel("Amount (AED)").fill("1000");
    await page.getByRole("button", { name: "Record payment" }).click();
    await expect(message(page, "recorded")).toBeVisible();
    await expect(page.getByText("Accounting entries")).toBeVisible();
    await shot(page, info, "07-allocated-paid");
  });

  await test.step("manager allocates customs duty manually to the marble lots only", async () => {
    await loginAs(page, "manager");
    await page.goto(`/purchase/landed-costs?q=CD-${tag}`);
    await page.getByRole("link", { name: /^LCE-/ }).first().click();
    const amounts = page.getByLabel(/^Amount for /);
    await expect(amounts).toHaveCount(4); // 2 slab lots + 2 tile lots
    const labels = await amounts.evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
    for (let i = 0; i < labels.length; i++) await amounts.nth(i).fill(labels[i].includes("Calacatta") ? "212.50" : "0");
    await expect(page.getByText("Amounts add up to the expense.")).toBeVisible();
    await page.getByLabel(/^Reason/).fill("Duty assessed on the marble only");
    await shot(page, info, "08-manual-override");
    await page.getByRole("button", { name: "Allocate manually" }).click();
    await expect(page.getByText("Manual allocation reason:")).toBeVisible();
    await expect(page.getByRole("button", { name: "Record payment" })).toHaveCount(0); // Manager: payments are view-only
  });

  await test.step("dashboard: stock is reconciled with the Inventory GL", async () => {
    await page.goto("/");
    await expect(page.getByText("Reconciled with GL")).toBeVisible();
    await shot(page, info, "09-dashboard");
  });

  // ── helpers bound to this page ──
  async function shipmentNo(n: 1 | 2): Promise<string> {
    const p = await page.context().newPage();
    await p.goto(poUrl);
    const cell = p.getByRole("row").filter({ hasText: `BL-${tag}-${n}` }).getByRole("cell").first();
    const no = (await cell.textContent())?.trim() ?? "";
    await p.close();
    return no;
  }

  async function expenseBill(category: string, amount: string, tax: string, shipment: string | null) {
    await loginAs(page, "accountant");
    await page.goto(poUrl);
    const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Record expense" }) });
    await form.getByLabel("Category *").selectOption({ label: category });
    await form.getByLabel("Paid to (supplier) *").selectOption({ label: FORWARDER });
    await form.getByLabel("Bill no. *").fill(`${category === "Freight" ? "FRT" : "CD"}-${tag}`);
    await form.getByLabel("Amount excl. VAT (AED) *").fill(amount);
    const taxSelect = form.getByLabel("Tax code *");
    const taxLabel = await taxSelect.locator("option").filter({ hasText: new RegExp(`^${tax} — `) }).textContent();
    await taxSelect.selectOption({ label: taxLabel ?? "" });
    if (shipment) await form.getByLabel("Shipment").selectOption({ label: shipment });
    await form.getByRole("button", { name: "Record expense" }).click();
    await expect(message(page, "recorded")).toBeVisible();
  }
});
