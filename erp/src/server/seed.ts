// Idempotent base data: permissions, roles, chart of accounts, tax codes, settings, warehouse, users.
import bcrypt from "bcryptjs";
import type { PrismaClient } from "@prisma/client";
import { CHART_OF_ACCOUNTS, LANDED_COST_CATEGORIES, TAX_CODES } from "./accounting/seed-data";
import { PERMISSIONS, ROLES } from "./rbac";

type Acc = (typeof CHART_OF_ACCOUNTS)[number];

export async function seedBase(
  db: PrismaClient,
  opts: { demoUsers: boolean; password: string },
): Promise<void> {
  // Permissions & roles (role permissions are reset to the default matrix)
  for (const [key, description] of Object.entries(PERMISSIONS)) {
    await db.permission.upsert({
      where: { key },
      update: { description, module: key.split(".")[0] },
      create: { key, description, module: key.split(".")[0] },
    });
  }
  for (const r of ROLES) {
    const role = await db.role.upsert({
      where: { key: r.key },
      update: { name: r.name, description: r.description, system: true },
      create: { key: r.key, name: r.name, description: r.description, system: true },
    });
    await db.rolePermission.deleteMany({ where: { roleId: role.id } });
    await db.rolePermission.createMany({
      data: r.permissions.map((permissionKey) => ({ roleId: role.id, permissionKey })),
    });
  }

  // Chart of accounts
  const upsertAcc = async (a: Acc, parentId: string | null): Promise<void> => {
    const isGroup = Boolean(a.children?.length);
    const row = await db.account.upsert({
      where: { code: a.code },
      update: { name: a.name, type: a.type, parentId, isGroup, systemKey: a.key ?? null },
      create: { code: a.code, name: a.name, type: a.type, parentId, isGroup, systemKey: a.key ?? null },
    });
    for (const c of a.children ?? []) await upsertAcc(c as Acc, row.id);
  };
  for (const a of CHART_OF_ACCOUNTS) await upsertAcc(a, null);

  // Default bank account on the "Bank - Main Account" GL account (T8-03)
  const mainBank = await db.account.findUniqueOrThrow({ where: { systemKey: "BANK_MAIN" } });
  if (!(await db.bankAccount.findUnique({ where: { accountId: mainBank.id } }))) {
    await db.bankAccount.create({ data: { id: "bank_main", code: "BANK-0001", name: "Main account", accountId: mainBank.id, isDefault: true } });
  }

  // Tax codes
  for (const t of TAX_CODES) {
    const out = t.output ? await db.account.findUnique({ where: { systemKey: t.output } }) : null;
    const inp = t.input ? await db.account.findUnique({ where: { systemKey: t.input } }) : null;
    await db.taxCode.upsert({
      where: { code: t.code },
      update: { name: t.name, type: t.type, rate: t.rate, outputAccountId: out?.id, inputAccountId: inp?.id },
      create: { code: t.code, name: t.name, type: t.type, rate: t.rate, outputAccountId: out?.id, inputAccountId: inp?.id },
    });
  }

  // Landed cost categories
  for (const name of LANDED_COST_CATEGORIES) {
    await db.landedCostCategory.upsert({ where: { name }, update: {}, create: { name, system: true } });
  }

  // Company settings (placeholders until the client provides real details)
  await db.companySetting.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      displayName: "Jame Jam",
      address: "Dubai, United Arab Emirates",
      trn: "100000000000003",
      bankName: "Demo Bank",
      bankAccountNo: "0000000000",
      iban: "AE000000000000000000000",
      swift: "DEMOAEAD",
    },
  });

  // Warehouse
  await db.warehouse.upsert({
    where: { code: "ALSAJJA" },
    update: {},
    create: { code: "ALSAJJA", name: "Al Sajja Store", location: "Al Sajja, Sharjah, UAE" },
  });

  // Users: one owner always; one per role for the demo
  const hash = await bcrypt.hash(opts.password, 10);
  const users = opts.demoUsers
    ? [
        { email: "owner@jamejam.local", name: "Owner", role: "owner" },
        { email: "manager@jamejam.local", name: "Manager", role: "manager" },
        { email: "accountant@jamejam.local", name: "Accountant", role: "accountant" },
        { email: "sales@jamejam.local", name: "Sales Staff", role: "sales" },
        { email: "store@jamejam.local", name: "Storekeeper", role: "storekeeper" },
      ]
    : [{ email: "owner@jamejam.local", name: "Owner", role: "owner" }];
  for (const u of users) {
    const role = await db.role.findUniqueOrThrow({ where: { key: u.role } });
    await db.user.upsert({
      where: { email: u.email },
      update: {},
      create: { email: u.email, name: u.name, roleId: role.id, passwordHash: hash },
    });
  }
}
