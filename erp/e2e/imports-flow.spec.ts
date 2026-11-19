// T11-02: template download, Check shows each problem, Import saves all rows; storekeeper sees only opening stock.
import { expect, test, type Page } from "@playwright/test";

const PASSWORD = process.env.E2E_PASSWORD ?? "";
async function loginAs(page: Page, role: "owner" | "store") {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill(`${role}@jamejam.local`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("import customers: check, fix, import", async ({ page }, info) => {
  test.skip(!PASSWORD, "E2E_PASSWORD is not set");
  const tag = `${Date.now().toString(36).toUpperCase()}${info.project.name === "mobile" ? "M" : "D"}`;
  await loginAs(page, "owner");
  await page.goto("/settings/imports");
  await page.getByLabel("What to import").selectOption("customers");
  const tpl = await page.request.get("/api/import-template/customers");
  expect(tpl.status()).toBe(200);
  expect((await tpl.body()).subarray(0, 2).toString()).toBe("PK");

  const head = "Code,Name,Contact person,Mobile,Email,Address,TRN,Notes";
  const upload = (body: string) => page.getByLabel(/Filled-in template/).setInputFiles({ name: `customers-${tag}.csv`, mimeType: "text/csv", buffer: Buffer.from(body) });
  await upload(`${head}\n,E2E Import ${tag},,,,,123,\n`);
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "1 problem in 1 rows" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "TRN", exact: true })).toBeVisible();

  await upload(`${head}\n,E2E Import ${tag},,,,,,\n`);
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByRole("status").filter({ hasText: "All 1 rows are valid" })).toBeVisible();
  await page.getByRole("button", { name: "Import" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Imported 1 rows" })).toBeVisible();
  await page.goto(`/masters/customers?q=${encodeURIComponent(`E2E Import ${tag}`)}`);
  await expect(page.getByText(`E2E Import ${tag}`).first()).toBeVisible();

  await loginAs(page, "store");
  await page.goto("/settings/imports");
  await expect(page.getByLabel("What to import").locator("option")).toHaveText(["Opening stock"]);
  expect((await page.request.get("/api/import-template/customers")).status()).toBe(403);
});
