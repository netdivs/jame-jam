// T1-01 (audit F17): per-user permission grants and revokes on top of the role.
import { describe, expect, it } from "vitest";
import { AppError, prisma } from "../src/server/core";
import { loadPermissions } from "../src/server/rbac";
import { setUserPermissionOverrides } from "../src/server/masters";
import { cancelSalesOrder } from "../src/server/sales/orders";
import { ctxFor, uid } from "./helpers";

async function expectError(p: Promise<unknown>, code: string, message?: RegExp) {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(AppError);
  expect((e as AppError).code).toBe(code);
  if (message) expect((e as AppError).message).toMatch(message);
}

describe("user permission overrides (T1-01)", () => {
  it("grants and revokes single permissions; role-equal choices store nothing; audited", async () => {
    const owner = await ctxFor("owner");
    const role = await prisma.role.findUniqueOrThrow({ where: { key: "sales" } });
    const u = await prisma.user.create({ data: { name: `Sales ${uid()}`, email: `ov-${uid()}@test.local`, passwordHash: "x", roleId: role.id } });

    const saved = await setUserPermissionOverrides(owner, u.id, { "sales.cancel": "grant", "receipts.create": "revoke", "sales.view": "grant", "crm.edit": "role" });
    expect(saved.map((s) => s.permissionKey).sort()).toEqual(["receipts.create", "sales.cancel"]); // sales.view: the role already has it
    const perms = await loadPermissions(u.id);
    expect(perms.has("sales.cancel")).toBe(true);
    expect(perms.has("receipts.create")).toBe(false);
    expect(perms.has("crm.edit")).toBe(true);

    // The grant works in a service right away (here: it reaches the business rule, not the permission check).
    await expectError(cancelSalesOrder({ userId: u.id, permissions: perms }, "missing-so", "x"), "NOT_FOUND");

    const log = await prisma.auditLog.findFirstOrThrow({ where: { entity: "User", entityId: u.id, action: "permissions" } });
    expect(log.userId).toBe(owner.userId);

    // Back to the role: everything "role" clears the overrides.
    await setUserPermissionOverrides(owner, u.id, { "sales.cancel": "role", "receipts.create": "role" });
    expect(await prisma.userPermission.count({ where: { userId: u.id } })).toBe(0);
  });

  it("refuses self-changes, unknown permissions and users without users.manage", async () => {
    const owner = await ctxFor("owner");
    const sales = await ctxFor("sales");
    await expectError(setUserPermissionOverrides(owner, owner.userId!, { "users.manage": "revoke" }), "VALIDATION", /your own/);
    await expectError(setUserPermissionOverrides(owner, sales.userId!, { "nope.x": "grant" }), "VALIDATION", /Unknown permission/);
    await expectError(setUserPermissionOverrides(owner, sales.userId!, { "sales.view": "maybe" }), "VALIDATION");
    await expectError(setUserPermissionOverrides(await ctxFor("manager"), sales.userId!, { "sales.cancel": "grant" }), "FORBIDDEN");
  });
});
