// Recreate the test database from migrations and load base data once per test run.
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { seedBase } from "../src/server/seed";

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !/_test\b/.test(url)) throw new Error(`Refusing to reset a non-test database: ${url}`);
  execSync("npx prisma migrate reset --force --skip-seed --skip-generate", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
  });
  const db = new PrismaClient({ datasources: { db: { url } } });
  await seedBase(db, { demoUsers: true, password: "test-password-123" });
  await db.$disconnect();
}
