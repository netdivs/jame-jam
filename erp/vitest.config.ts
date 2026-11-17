import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vitest/config";

// Tests always run against TEST_DATABASE_URL (never the dev database).
function loadEnv(): Record<string, string> {
  const file = path.resolve(__dirname, ".env");
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}
const env = { ...loadEnv(), ...process.env } as Record<string, string>;
const testDb = env.TEST_DATABASE_URL;
if (!testDb) throw new Error("TEST_DATABASE_URL is not set");

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    env: { DATABASE_URL: testDb, TEST_DATABASE_URL: testDb },
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
