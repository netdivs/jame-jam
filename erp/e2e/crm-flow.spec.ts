// T10-01 (R9): lead → interaction → convert to customer + opportunity → SO from the opportunity (won) →
// follow-up reminder on the dashboard → done; CRM reports; own-records rule for the accountant (view only).
import { expect, test, type Page, type TestInfo } from "@playwright/test";

const PASSWORD = process.env.E2E_PASSWORD ?? "";
const TILE = "BTT-3060 — Beige Travertine Tiles 30x60";

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
const localInput = (minutes: number) => {
  const n = new Date(Date.now() + minutes * 60_000);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}T${p(n.getHours())}:${p(n.getMinutes())}`;
};

async function pickStock(page: Page, line: number, text: string) {
  const sel = page.getByLabel(`Line ${line} stock`);
  await expect(sel.locator("option", { hasText: text }).first()).toBeAttached();
  const options = await sel.locator("option", { hasText: text }).evaluateAll((os) =>
    os.map((o) => ({ value: (o as HTMLOptionElement).value, sqm: Number(/([\d,.]+) SQM/.exec(o.textContent ?? "")?.[1]?.replace(/,/g, "") ?? 0) })),
  );
  options.sort((a, b) => b.sqm - a.sqm);
  await sel.selectOption(options[0].value);
}

test("CRM: lead → customer → opportunity → sales order; follow-up reminder", async ({ page }, info) => {
  test.skip(!PASSWORD, "E2E_PASSWORD is not set");
  const tag = `${Date.now().toString(36).toUpperCase()}${info.project.name === "mobile" ? "M" : "D"}`;
  const company = `E2E Villas ${tag}`;
  let soUrl = "";
  let cancelled = false;
  try {
    await test.step("sales creates a lead and logs a call (lead becomes Contacted)", async () => {
      await loginAs(page, "sales");
      await page.goto("/crm/leads/new");
      await page.getByLabel("Prospect name").fill(`Ahmed ${tag}`);
      await page.getByLabel("Company").fill(company);
      await page.getByLabel("Mobile").fill("0501234567");
      await page.getByLabel("Source").selectOption("Architect");
      await page.getByLabel("Project / site").fill("Palm villa lobby");
      await page.getByLabel("Expected SQM").fill("120");
      await page.getByRole("button", { name: "Create lead" }).click();
      await expect(page).toHaveURL(/\/crm\/leads\/(?!new$)[a-z0-9]+$/);
      await expect(page.getByText("New", { exact: true }).first()).toBeVisible();
      await page.getByLabel("Notes").fill("Called; wants travertine samples");
      await page.getByRole("button", { name: "Log interaction" }).click();
      await expect(page.getByText("Called; wants travertine samples")).toBeVisible();
      await page.reload();
      await expect(page.getByText("Contacted", { exact: true }).first()).toBeVisible();
      await shot(page, info, "01-lead");
    });

    await test.step("convert the lead: new customer and an opportunity; the 360 page shows it", async () => {
      await page.getByLabel("Expected value (AED)").fill("25000");
      await page.getByRole("button", { name: "Convert lead" }).click();
      await expect(page).toHaveURL(/\/crm\/customers\/[a-z0-9]+$/);
      await expect(page.getByRole("heading", { name: company })).toBeVisible();
      await expect(page.getByText(/Lead LD-\d+ converted/)).toBeVisible();
      await expect(page.getByRole("link", { name: /OP-\d+/ }).first()).toBeVisible();
      await shot(page, info, "02-customer-360");
    });

    await test.step("a follow-up due now shows on the dashboard", async () => {
      await page.getByLabel("Follow up on").fill(localInput(-30));
      await page.getByLabel("What to follow up").fill(`Send quotation ${tag}`);
      await page.getByRole("button", { name: "Schedule follow-up" }).click();
      await expect(page.getByText(`Send quotation ${tag}`).first()).toBeVisible();
      await page.goto("/");
      await expect(page.getByText(/Your follow-ups due/)).toBeVisible();
      await expect(page.getByRole("link", { name: company }).first()).toBeVisible();
      await page.goto("/crm");
      await expect(page.getByText(`Send quotation ${tag}`)).toBeVisible();
    });

    await test.step("create the sales order from the opportunity: it is won", async () => {
      await page.goto("/crm/opportunities");
      await page.getByRole("link", { name: "Palm villa lobby" }).first().click();
      await page.getByRole("link", { name: "Create sales order (won)" }).click();
      await expect(page.getByText(/Saving the order marks the opportunity as won/)).toBeVisible();
      await expect(page.getByLabel("Customer *")).toBeDisabled();
      await page.getByLabel("Line 1 product").selectOption({ label: TILE });
      await pickStock(page, 1, "Block");
      await page.getByLabel("Line 1 SQM").fill("1");
      await page.getByLabel("Line 1 price per SQM").fill("100");
      await page.getByRole("button", { name: "Create sales order" }).click();
      await expect(page).toHaveURL(/\/sales\/orders\/(?!new$)[a-z0-9]+$/);
      soUrl = new URL(page.url()).pathname;
      await page.goBack();
      await page.goto("/crm/opportunities?stage=WON");
      await expect(page.getByRole("link", { name: "Palm villa lobby" }).first()).toBeVisible();
    });

    await test.step("mark the follow-up done from the customer page", async () => {
      await page.goto("/crm");
      await page.getByRole("link", { name: company }).first().click();
      const item = page.locator("li", { hasText: `Send quotation ${tag}` }).first();
      await item.getByText("Mark done / cancel").click();
      await item.getByLabel("Outcome").fill("Quotation sent");
      await item.getByRole("button", { name: "Mark done" }).click();
      await expect(page.getByText("Follow-up done").first()).toBeVisible();
    });

    await test.step("accountant can view CRM and reports but not create leads", async () => {
      await loginAs(page, "accountant");
      await page.goto("/crm/leads");
      await expect(page.getByRole("link", { name: "New lead" })).toHaveCount(0);
      await page.goto("/crm/reports");
      await expect(page.getByText("Open pipeline")).toBeVisible();
      await expect(page.getByText("Activity by sales user")).toBeVisible();
      await shot(page, info, "03-reports");
    });
  } finally {
    if (soUrl && !cancelled) {
      await loginAs(page, "manager");
      await page.goto(soUrl);
      const reason = page.getByLabel("Reason");
      if (await reason.count()) {
        await reason.fill("E2E clean-up");
        await page.getByRole("button", { name: "Cancel SO and release stock" }).click();
        await expect(page.getByText("Cancelled").first()).toBeVisible();
        cancelled = true;
      }
    }
  }
});
