// TS-02: security headers on every page, and the sign-in lock after repeated failures.
import { expect, test } from "@playwright/test";

test("security headers are sent", async ({ request }) => {
  const res = await request.get("/login");
  const h = res.headers();
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["referrer-policy"]).toBe("same-origin");
  expect(h["strict-transport-security"]).toContain("max-age=");
  expect(h["x-powered-by"]).toBeUndefined();
});

test("sign-in locks after five failures for an email", async ({ page }, info) => {
  const email = `locked-${Date.now()}-${info.project.name}@test.local`;
  await page.goto("/login");
  // Wait for each POST to finish: the previous "Invalid" message is still on screen while the next one runs.
  const attempt = async () => {
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("wrong-password");
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.getByRole("button", { name: "Sign in" }).click()]);
  };
  for (let i = 0; i < 5; i++) {
    await attempt();
    await expect(page.locator('[role="alert"]').filter({ hasText: "Invalid email or password" })).toBeVisible();
  }
  await attempt();
  await expect(page.locator('[role="alert"]').filter({ hasText: "Too many failed sign-ins" })).toBeVisible();
});
