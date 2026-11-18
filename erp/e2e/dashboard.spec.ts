// T11-04: the dashboard shows each role only its figures, on desktop and phone.
import { expect, test, type Page, type TestInfo } from "@playwright/test";

const PASSWORD = process.env.E2E_PASSWORD ?? "";
async function loginAs(page: Page, role: "owner" | "sales" | "store") {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill(`${role}@jamejam.local`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/);
}
const shot = (page: Page, info: TestInfo, name: string) => page.screenshot({ path: info.outputPath(`${info.project.name}-${name}.png`), fullPage: true });

test("dashboard figures follow the role", async ({ page }, info) => {
  test.skip(!PASSWORD, "E2E_PASSWORD is not set");
  await loginAs(page, "owner");
  const glance = page.getByRole("region", { name: "Business at a glance" });
  for (const label of ["Open sales orders", "Bank", "Receivables", "Payables", "Cheques in hand"]) await expect(glance.getByText(label, { exact: true })).toBeVisible();
  await shot(page, info, "01-owner");

  await loginAs(page, "sales");
  await expect(glance.getByText("Open sales orders", { exact: true })).toBeVisible();
  await expect(glance.getByText("Bank", { exact: true })).toHaveCount(0);
  await expect(glance.getByText("Payables", { exact: true })).toHaveCount(0);

  // The storekeeper sees the open orders (dispatch) but no money figures.
  await loginAs(page, "store");
  await expect(glance.getByText("Open sales orders", { exact: true })).toBeVisible();
  await expect(glance.getByText("Receivables", { exact: true })).toHaveCount(0);
  await expect(glance.getByText("Cheques in hand", { exact: true })).toHaveCount(0);
});
