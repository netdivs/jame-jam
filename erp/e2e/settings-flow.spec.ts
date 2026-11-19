// TP-01: Settings → System — the Owner changes a policy setting; others see it read-only. Restores the default.
import { expect, test, type Page, type TestInfo } from "@playwright/test";

const PASSWORD = process.env.E2E_PASSWORD ?? "";

test.describe.configure({ mode: "serial" });

async function loginAs(page: Page, role: "owner" | "manager") {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill(`${role}@jamejam.local`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/);
}
const shot = (page: Page, info: TestInfo, name: string) => page.screenshot({ path: info.outputPath(`${info.project.name}-${name}.png`), fullPage: true });

test("system settings: owner edits a policy, manager reads only", async ({ page }, info) => {
  test.skip(!PASSWORD, "E2E_PASSWORD is not set");
  const limit = page.getByLabel("Cash refund limit (AED)");

  await test.step("owner sets a cash refund limit", async () => {
    await loginAs(page, "owner");
    await page.goto("/settings/system");
    await expect(page.getByRole("heading", { name: "System settings" })).toBeVisible();
    await expect(page.getByLabel("Receive goods before full payment")).toHaveValue("NEVER");
    await limit.fill("250");
    await page.getByRole("button", { name: "Save refunds" }).click();
    await expect(page.getByText(/Saved \(1 changed\)|No changes/)).toBeVisible(); // an interrupted run may have left 250
    await page.reload();
    await expect(limit).toHaveValue("250");
    await shot(page, info, "settings-system");
  });

  await test.step("a bad value shows a field error", async () => {
    await limit.fill("-1");
    await page.getByRole("button", { name: "Save refunds" }).click();
    await expect(page.getByText(/enter a number/).first()).toBeVisible();
  });

  await test.step("manager sees the page read-only", async () => {
    await loginAs(page, "manager");
    await page.goto("/settings/system");
    await expect(limit).toBeDisabled();
    await expect(page.getByRole("button", { name: "Save refunds" })).toHaveCount(0);
  });

  await test.step("owner uploads a logo, sees it, removes it; a non-image is refused", async () => {
    await loginAs(page, "owner");
    await page.goto("/settings/company");
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
    await page.getByLabel("Logo file").setInputFiles({ name: "evil.png", mimeType: "image/png", buffer: Buffer.from("<script>") });
    await page.getByRole("button", { name: "Upload" }).first().click();
    await expect(page.getByText(/only PNG, JPEG/).first()).toBeVisible();
    await page.getByLabel("Logo file").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: png });
    await page.getByRole("button", { name: "Upload" }).first().click();
    await expect(page.getByText(/Logo saved/)).toBeVisible();
    await page.reload();
    await expect(page.getByAltText("Company logo")).toBeVisible();
    await page.getByRole("button", { name: "Remove" }).click();
    await expect(page.getByAltText("Company logo")).toHaveCount(0); // the Remove form goes away with the logo
  });

  await test.step("owner restores the default (no limit)", async () => {
    await loginAs(page, "owner");
    await page.goto("/settings/system");
    await limit.fill("");
    await page.getByRole("button", { name: "Save refunds" }).click();
    await expect(page.getByText(/Saved \(1 changed\)|No changes/)).toBeVisible();
  });
});
