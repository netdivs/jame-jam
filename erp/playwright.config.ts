// Browser end-to-end tests (Playwright). Runs the production build against a dedicated E2E database.
//   E2E_DATABASE_URL  must point at a database whose name ends in _e2e (never dev, test or production)
//   E2E_PASSWORD      the SEED_PASSWORD that database was seeded with
// Prepare once:  DATABASE_URL=$E2E_DATABASE_URL npx prisma migrate deploy && SEED_PASSWORD=... DATABASE_URL=$E2E_DATABASE_URL npx prisma db seed
// Run:           npm run build && npm run test:e2e
import { defineConfig, devices } from "@playwright/test";

const db = process.env.E2E_DATABASE_URL ?? "";
if (!/\/[A-Za-z0-9_]+_e2e(\?|$)/.test(db)) throw new Error("E2E_DATABASE_URL must point at a database named *_e2e");
const PORT = Number(process.env.E2E_PORT ?? 3105);

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/.artifacts",
  fullyParallel: false,
  workers: 1, // one shared database; the flows run one after the other
  timeout: 240_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { outputFolder: "./e2e/.report", open: "never" }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 800 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { DATABASE_URL: db, SESSION_TTL_HOURS: "2" },
  },
});
