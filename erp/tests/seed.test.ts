// TS-04: base-only seed for production — no demo users or stock, password rules, never printed, idempotent.
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "../src/server/core";
import { seedBaseOnly } from "../src/server/seed";

describe("base-only seed (TS-04)", () => {
  it("on an existing install: creates no users or stock, keeps role permissions, is idempotent", async () => {
    const [users, lots, journals] = await Promise.all([prisma.user.count(), prisma.lot.count(), prisma.journalEntry.count()]);
    const r1 = await seedBaseOnly(prisma, undefined);
    const r2 = await seedBaseOnly(prisma, undefined);
    expect(r1.ownerCreated).toBe(false);
    expect(r2).toEqual(r1);
    expect(await prisma.user.count()).toBe(users);
    expect(await prisma.lot.count()).toBe(lots);
    expect(await prisma.journalEntry.count()).toBe(journals);
    const owner = await prisma.role.findUniqueOrThrow({ where: { key: "owner" }, include: { permissions: true } });
    expect(owner.permissions.length).toBe(r1.permissions);
  });

  it("first install needs a password of at least 12 characters", async () => {
    const empty = { user: { count: async () => 0 } } as unknown as PrismaClient;
    await expect(seedBaseOnly(empty, undefined)).rejects.toThrow(/SEED_PASSWORD/);
    await expect(seedBaseOnly(empty, "short")).rejects.toThrow(/at least 12/);
  });

  it("the npm entry point runs against the database and never prints the password", () => {
    const out = execFileSync("npx", ["tsx", "prisma/seed-base.ts"], {
      env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL, SEED_PASSWORD: "Never-Print-This-9931" },
      encoding: "utf8",
    });
    expect(out).toMatch(/Base seed complete/);
    expect(out).toMatch(/Existing users unchanged/);
    expect(out).not.toContain("Never-Print-This-9931");
  });
});
