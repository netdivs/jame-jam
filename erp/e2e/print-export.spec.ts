// TX-01 / TX-02: document PDFs and report Excel files are served from the page buttons, with view permissions.
import { expect, test, type Page } from "@playwright/test";

const PASSWORD = process.env.E2E_PASSWORD ?? "";
async function loginAs(page: Page, role: "owner" | "sales" | "store") {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill(`${role}@jamejam.local`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("PDF and Excel buttons return real files; permissions apply", async ({ page }) => {
  test.skip(!PASSWORD, "E2E_PASSWORD is not set");
  await loginAs(page, "owner");

  await page.goto("/purchase/orders");
  await page.getByRole("link", { name: /^PO-/ }).first().click();
  const pdfHref = await page.getByRole("link", { name: "PDF", exact: true }).getAttribute("href");
  const pdf = await page.request.get(pdfHref!);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

  await page.goto("/accounts/trial-balance");
  const xlsHref = await page.getByRole("link", { name: "Excel", exact: true }).getAttribute("href");
  const xls = await page.request.get(xlsHref!);
  expect(xls.status()).toBe(200);
  expect(xls.headers()["content-disposition"]).toMatch(/trial-balance-.*\.xlsx/);
  expect((await xls.body()).subarray(0, 2).toString()).toBe("PK"); // xlsx is a zip

  await page.goto("/accounts/vat");
  await expect(page.getByRole("heading", { name: "VAT return" })).toBeVisible();
  await expect(page.getByText(/Ties to the VAT accounts|Does not tie/)).toBeVisible();
  const pack = await page.request.get((await page.getByRole("link", { name: "Accountant pack (Excel)" }).getAttribute("href"))!);
  expect(pack.status()).toBe(200);
  expect(pack.headers()["content-disposition"]).toMatch(/vat-pack-.*\.xlsx/);

  await page.goto("/reports");
  await page.getByRole("link", { name: "Purchase report" }).click();
  await expect(page.getByRole("heading", { name: "Purchase report", level: 1 })).toBeVisible();
  await page.getByLabel("From").fill("2026-01-01");
  await page.getByRole("button", { name: "Show" }).click();
  await expect(page.getByRole("cell", { name: /^PUR-/ }).first()).toBeVisible();
  const rep = await page.request.get((await page.getByRole("link", { name: "Excel", exact: true }).getAttribute("href"))!);
  expect(rep.headers()["content-disposition"]).toMatch(/purchase-report-.*\.xlsx/);

  await page.goto("/accounts/ledgers?type=customer");
  await page.getByRole("link", { name: /\(demo\)$/ }).first().click();
  const st = await page.request.get((await page.getByRole("link", { name: "PDF", exact: true }).getAttribute("href"))!);
  expect((await st.body()).subarray(0, 5).toString()).toBe("%PDF-");

  await loginAs(page, "sales");
  expect((await page.request.get("/api/export/trial-balance")).status()).toBe(403);
  await loginAs(page, "store");
  expect((await page.request.get("/api/export/pdc")).status()).toBe(403);
});
