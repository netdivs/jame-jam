// T8-06: customer refund through the UI — the cap on free advance, record, GL, cancel; Sales cannot refund.
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

test("customer refund: capped at free advance, posts, cancels", async ({ page }, info) => {
  test.skip(!PASSWORD, "E2E_PASSWORD is not set");
  const tag = `${Date.now().toString(36).toUpperCase()}${info.project.name === "mobile" ? "M" : "D"}`;

  await test.step("sales cannot open the refund form", async () => {
    await loginAs(page, "sales");
    await page.goto("/refunds/new");
    await expect(page).toHaveURL(/\/forbidden/);
  });

  let refundUrl = "";
  await test.step("accountant takes a general advance, then refunds it", async () => {
    await loginAs(page, "accountant");
    await page.goto("/receipts/new");
    await page.getByLabel("Customer").selectOption({ label: CUSTOMER });
    await page.getByLabel("Amount (AED)").fill("250");
    await page.getByLabel("Reference").fill(`E2E-${tag}`);
    await page.getByRole("button", { name: "Record receipt" }).click();
    await expect(page).toHaveURL(/\/receipts\/(?!new$)[a-z0-9]+$/);

    await page.goto("/refunds/new");
    await page.getByLabel("Customer").selectOption({ label: CUSTOMER });
    await page.getByLabel("Amount (AED)").fill("99999999");
    await page.getByLabel("Reason").fill(`E2E refund ${tag}`);
    await page.getByRole("button", { name: "Record refund" }).click();
    await expect(page.locator('[role="alert"]').filter({ hasText: "free advance" }).first()).toBeVisible();
    await shot(page, info, "01-capped");

    // A refused submit keeps what was typed (ActionForm does not reset on errors): only the amount changes.
    await expect(page.getByLabel("Reason")).toHaveValue(`E2E refund ${tag}`);
    await page.getByLabel("Amount (AED)").fill("250");
    await page.getByRole("button", { name: "Record refund" }).click();
    await expect(page).toHaveURL(/\/refunds\/(?!new$)[a-z0-9]+$/);
    refundUrl = new URL(page.url()).pathname;
    await expect(page.getByRole("heading", { name: /Refund RF-/ })).toBeVisible();
    await expect(page.getByText("Posted", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Customer Advances").first()).toBeVisible();
    await shot(page, info, "02-refund");
  });

  await test.step("the refund is listed, then cancelled with a reason", async () => {
    await page.goto("/refunds");
    await expect(page.getByRole("link", { name: /RF-/ }).first()).toBeVisible();
    await page.goto(refundUrl);
    await page.getByLabel("Reason").fill("E2E clean-up");
    await page.getByRole("button", { name: "Cancel refund" }).click();
    await expect(page.getByText("Cancelled", { exact: true }).first()).toBeVisible();
    await shot(page, info, "03-cancelled");
  });
});
