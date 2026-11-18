// Master data services: customers, suppliers, products, warehouses, landed cost categories, settings, users.
import bcrypt from "bcryptjs";
import { z } from "zod";
import { AppError, Ctx, assertCan, audit, inTx, nextMasterCode, rethrowUnique } from "./core";
import { decimal, optText, parse, reqText, trn } from "./validation";

const bool = z
  .union([z.boolean(), z.literal("on"), z.literal("true"), z.literal("false"), z.literal("")])
  .optional()
  .transform((v) => v === true || v === "on" || v === "true");

const optDecimal = (opts: Parameters<typeof decimal>[0]) =>
  z.union([decimal(opts), z.literal("").transform(() => undefined)]).optional();

// ── Customers ──
export const customerSchema = z.object({
  code: optText(20),
  name: reqText("Customer name", 160),
  contactPerson: optText(100),
  mobile: optText(30),
  email: z.union([z.string().trim().email("Invalid email"), z.literal("")]).optional().transform((v) => v || undefined),
  address: optText(500),
  trn,
  notes: optText(1000),
  active: bool,
});

export async function saveCustomer(ctx: Ctx, id: string | null, raw: unknown) {
  assertCan(ctx, "customers.edit");
  const data = parse(customerSchema, raw);
  return inTx(async (tx) => {
    try {
      if (id) {
        const before = await tx.customer.findUniqueOrThrow({ where: { id } });
        const after = await tx.customer.update({
          where: { id },
          data: { ...data, code: data.code ?? before.code },
        });
        await audit(tx, ctx, { action: "update", entity: "Customer", entityId: id, before, after });
        return after;
      }
      const code = data.code ?? (await nextMasterCode(tx, "CUS"));
      const after = await tx.customer.create({ data: { ...data, code, active: true } });
      await audit(tx, ctx, { action: "create", entity: "Customer", entityId: after.id, after });
      return after;
    } catch (e) {
      rethrowUnique(e, "A customer with this code already exists");
    }
  });
}

// ── Suppliers ──
export const supplierSchema = z.object({
  code: optText(20),
  name: reqText("Supplier name", 160),
  supplierType: z.enum(["LOCAL", "IMPORT"], { errorMap: () => ({ message: "Choose local or import" }) }),
  contactPerson: optText(100),
  mobile: optText(30),
  email: z.union([z.string().trim().email("Invalid email"), z.literal("")]).optional().transform((v) => v || undefined),
  address: optText(500),
  trn,
  notes: optText(1000),
  active: bool,
});

export async function saveSupplier(ctx: Ctx, id: string | null, raw: unknown) {
  assertCan(ctx, "suppliers.edit");
  const data = parse(supplierSchema, raw);
  return inTx(async (tx) => {
    try {
      if (id) {
        const before = await tx.supplier.findUniqueOrThrow({ where: { id } });
        const after = await tx.supplier.update({ where: { id }, data: { ...data, code: data.code ?? before.code } });
        await audit(tx, ctx, { action: "update", entity: "Supplier", entityId: id, before, after });
        return after;
      }
      const code = data.code ?? (await nextMasterCode(tx, "SUP"));
      const after = await tx.supplier.create({ data: { ...data, code, active: true } });
      await audit(tx, ctx, { action: "create", entity: "Supplier", entityId: after.id, after });
      return after;
    } catch (e) {
      rethrowUnique(e, "A supplier with this code already exists");
    }
  });
}

// ── Products ──
export const productSchema = z.object({
  itemCode: reqText("Item code", 30).transform((v) => v.toUpperCase()),
  name: reqText("Product name", 160),
  type: z.enum(["TILE", "SLAB"], { errorMap: () => ({ message: "Choose tile or slab" }) }),
  category: optText(80),
  stoneType: optText(80),
  finish: optText(80),
  size: optText(40),
  thicknessMm: optDecimal({ gt: 0, max: 500, dp: 2, label: "Thickness (mm)" }),
  defaultTaxCodeId: optText(40),
  active: bool,
});

export async function saveProduct(ctx: Ctx, id: string | null, raw: unknown) {
  assertCan(ctx, "products.edit");
  const data = parse(productSchema, raw);
  return inTx(async (tx) => {
    try {
      if (id) {
        const before = await tx.product.findUniqueOrThrow({ where: { id } });
        if (before.type !== data.type && (await tx.lot.count({ where: { productId: id } })) > 0) {
          throw new AppError("VALIDATION", "Product type cannot change once stock exists");
        }
        const after = await tx.product.update({ where: { id }, data });
        await audit(tx, ctx, { action: "update", entity: "Product", entityId: id, before, after });
        return after;
      }
      const sr = data.defaultTaxCodeId ? null : await tx.taxCode.findUnique({ where: { code: "SR" } });
      const after = await tx.product.create({
        data: { ...data, defaultTaxCodeId: data.defaultTaxCodeId ?? sr?.id, active: true },
      });
      await audit(tx, ctx, { action: "create", entity: "Product", entityId: after.id, after });
      return after;
    } catch (e) {
      rethrowUnique(e, "A product with this item code already exists");
    }
  });
}

// ── Warehouses ──
export const warehouseSchema = z.object({
  code: reqText("Code", 20).transform((v) => v.toUpperCase()),
  name: reqText("Name", 100),
  location: optText(200),
  active: bool,
});

export async function saveWarehouse(ctx: Ctx, id: string | null, raw: unknown) {
  assertCan(ctx, "warehouses.edit");
  const data = parse(warehouseSchema, raw);
  return inTx(async (tx) => {
    try {
      if (id) {
        const before = await tx.warehouse.findUniqueOrThrow({ where: { id } });
        const after = await tx.warehouse.update({ where: { id }, data });
        await audit(tx, ctx, { action: "update", entity: "Warehouse", entityId: id, before, after });
        return after;
      }
      const after = await tx.warehouse.create({ data: { ...data, active: true } });
      await audit(tx, ctx, { action: "create", entity: "Warehouse", entityId: after.id, after });
      return after;
    } catch (e) {
      rethrowUnique(e, "A warehouse with this code already exists");
    }
  });
}

// ── Landed cost categories ──
export const landedCostCategorySchema = z.object({ name: reqText("Name", 80), active: bool });

export async function saveLandedCostCategory(ctx: Ctx, id: string | null, raw: unknown) {
  assertCan(ctx, "landedCostCategories.edit");
  const data = parse(landedCostCategorySchema, raw);
  return inTx(async (tx) => {
    try {
      if (id) {
        const before = await tx.landedCostCategory.findUniqueOrThrow({ where: { id } });
        const after = await tx.landedCostCategory.update({ where: { id }, data });
        await audit(tx, ctx, { action: "update", entity: "LandedCostCategory", entityId: id, before, after });
        return after;
      }
      const after = await tx.landedCostCategory.create({ data: { ...data, active: true } });
      await audit(tx, ctx, { action: "create", entity: "LandedCostCategory", entityId: after.id, after });
      return after;
    } catch (e) {
      rethrowUnique(e, "A category with this name already exists");
    }
  });
}

// ── Company settings ──
export const settingsSchema = z.object({
  displayName: reqText("Display name", 100),
  legalName: optText(160),
  address: optText(500),
  trn,
  tradeLicenseNo: optText(40),
  phone: optText(40),
  email: z.union([z.string().trim().email("Invalid email"), z.literal("")]).optional().transform((v) => v || undefined),
  bankName: optText(100),
  bankBranch: optText(160),
  bankAccountNo: optText(40),
  iban: optText(40),
  swift: optText(20),
  vatRate: decimal({ min: 0, max: 100, dp: 2, label: "VAT rate" }),
  defaultPriceMode: z.enum(["INCLUSIVE", "EXCLUSIVE"]),
  piValidityDays: z.coerce.number().int().min(1, "PI validity must be at least 1 day").max(365),
  soReservationDays: z.coerce.number().int().min(1, "Reservation validity must be at least 1 day").max(365),
  poApprovalMode: z.enum(["ALL", "ABOVE_THRESHOLD", "NONE"]),
  poApprovalThreshold: decimal({ min: 0, dp: 2, label: "PO approval threshold" }),
  landedCostDefaultBasis: z.enum(["SQM", "VALUE", "QUANTITY"]),
  pdcReminderDays: z.coerce.number().int().min(0).max(90),
});

export async function saveSettings(ctx: Ctx, raw: unknown) {
  assertCan(ctx, "settings.edit");
  const data = parse(settingsSchema, raw);
  return inTx(async (tx) => {
    const before = await tx.companySetting.findUniqueOrThrow({ where: { id: 1 } });
    const after = await tx.companySetting.update({
      where: { id: 1 },
      data: {
        ...data,
        legalName: data.legalName ?? null,
        address: data.address ?? null,
        trn: data.trn ?? null,
        tradeLicenseNo: data.tradeLicenseNo ?? null,
        phone: data.phone ?? null,
        email: data.email ?? null,
        bankName: data.bankName ?? null,
        bankBranch: data.bankBranch ?? null,
        bankAccountNo: data.bankAccountNo ?? null,
        iban: data.iban ?? null,
        swift: data.swift ?? null,
      },
    });
    await audit(tx, ctx, { action: "update", entity: "CompanySetting", entityId: "1", before, after });
    return after;
  });
}

// ── Users ──
export const userSchema = z.object({
  name: reqText("Name", 100),
  email: z.string().trim().toLowerCase().email("Invalid email"),
  roleId: reqText("Role"),
  password: z.string().optional().transform((v) => v || undefined),
  active: bool,
});

export async function saveUser(ctx: Ctx, id: string | null, raw: unknown) {
  assertCan(ctx, "users.manage");
  const data = parse(userSchema, raw);
  if (!id && !data.password) throw new AppError("VALIDATION", "Password is required for a new user");
  if (data.password && data.password.length < 8) throw new AppError("VALIDATION", "Password must be at least 8 characters");
  return inTx(async (tx) => {
    if (!(await tx.role.findUnique({ where: { id: data.roleId } }))) throw new AppError("VALIDATION", "Role not found");
    const passwordHash = data.password ? await bcrypt.hash(data.password, 10) : undefined;
    try {
      if (id) {
        if (id === ctx.userId && !data.active) throw new AppError("VALIDATION", "You cannot deactivate your own account");
        const before = await tx.user.findUniqueOrThrow({ where: { id }, omit: { passwordHash: true } });
        const after = await tx.user.update({
          where: { id },
          data: { name: data.name, email: data.email, roleId: data.roleId, active: data.active, ...(passwordHash ? { passwordHash } : {}) },
          omit: { passwordHash: true },
        });
        if (!data.active || passwordHash) await tx.session.deleteMany({ where: { userId: id } });
        await audit(tx, ctx, { action: "update", entity: "User", entityId: id, before, after, meta: { passwordChanged: Boolean(passwordHash) } });
        return after;
      }
      const after = await tx.user.create({
        data: { name: data.name, email: data.email, roleId: data.roleId, passwordHash: passwordHash!, active: true },
        omit: { passwordHash: true },
      });
      await audit(tx, ctx, { action: "create", entity: "User", entityId: after.id, after });
      return after;
    } catch (e) {
      rethrowUnique(e, "A user with this email already exists");
    }
  });
}

// ── Per-user permission overrides (T1-01, audit F17) ──
/**
 * Replace a user's grants and revokes on top of their role. Values per permission key: "role" (no override),
 * "grant" or "revoke". Effective at the user's next request (permissions are loaded per request).
 * Nobody changes their own overrides (no self-escalation, no locking yourself out).
 */
export async function setUserPermissionOverrides(ctx: Ctx, userId: string, raw: Record<string, string>) {
  assertCan(ctx, "users.manage");
  if (userId === ctx.userId) throw new AppError("VALIDATION", "You cannot change your own permissions; ask another administrator");
  const { PERMISSIONS } = await import("./rbac");
  const valid = new Set(Object.keys(PERMISSIONS));
  const wanted: { permissionKey: string; grant: boolean }[] = [];
  for (const [key, v] of Object.entries(raw)) {
    if (!valid.has(key)) throw new AppError("VALIDATION", `Unknown permission: ${key}`);
    if (v === "grant" || v === "revoke") wanted.push({ permissionKey: key, grant: v === "grant" });
    else if (v !== "role" && v !== "") throw new AppError("VALIDATION", `Choose role, grant or revoke for ${key}`);
  }
  return inTx(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, include: { role: { include: { permissions: true } }, overrides: true } });
    if (!user) throw new AppError("NOT_FOUND", "User not found");
    // Overrides that match the role change nothing; keep only real differences.
    const fromRole = new Set(user.role.permissions.map((p) => p.permissionKey));
    const effective = wanted.filter((w) => w.grant !== fromRole.has(w.permissionKey));
    const before = user.overrides.map((o) => ({ key: o.permissionKey, grant: o.grant }));
    await tx.userPermission.deleteMany({ where: { userId } });
    if (effective.length) await tx.userPermission.createMany({ data: effective.map((w) => ({ userId, ...w })) });
    await audit(tx, ctx, { action: "permissions", entity: "User", entityId: userId, before: { overrides: before }, after: { overrides: effective.map((w) => ({ key: w.permissionKey, grant: w.grant })) } });
    return effective;
  });
}
