// Permissions and the default role matrix (spec §5). Checks are enforced in services.
import { prisma } from "./core";

export const PERMISSIONS = {
  // Admin
  "settings.view": "View company settings",
  "settings.edit": "Edit company settings",
  "users.manage": "Create users, assign roles, reset passwords",
  "audit.view": "View the audit log",
  // Accounts
  "accounts.view": "View chart of accounts and journals",
  "accounts.periodLock": "Lock / unlock accounting periods",
  // Masters
  "customers.view": "View customers",
  "customers.edit": "Create / edit customers",
  "suppliers.view": "View suppliers",
  "suppliers.edit": "Create / edit suppliers",
  "products.view": "View products",
  "products.edit": "Create / edit products",
  "warehouses.edit": "Create / edit warehouses",
  "landedCostCategories.edit": "Create / edit landed cost categories",
  // Inventory
  "inventory.view": "View stock, lots, blocks, slabs, movements",
  "inventory.viewCost": "View stock cost and valuation",
  "inventory.openingStock": "Enter opening stock (lots / blocks / slabs)",
  "inventory.split": "Split (cut) slabs",
  "inventory.adjust": "Post stock adjustments (breakage, wastage, count)",
  "inventory.editSlabSqm": "Override auto-calculated slab SQM",
  // Purchase & import
  "purchase.view": "View purchase orders, shipments, GRNs and supplier invoices",
  "purchase.edit": "Create / edit / submit purchase orders and update shipments",
  "purchase.approve": "Approve or reject purchase orders",
  "purchase.receive": "Receive goods (GRN) and enter slabs",
  "purchase.invoice": "Post supplier invoices",
  "purchase.verifyPayment": "Verify that a PO is 100% paid (unblocks collection and GRN)",
  "payments.supplier": "Record supplier payments (PV)",
  "landedCost.edit": "Record and allocate landed cost expenses",
  "landedCost.override": "Manually override landed cost allocation",
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;

const ALL = Object.keys(PERMISSIONS) as PermissionKey[];

export const ROLES: { key: string; name: string; description: string; permissions: PermissionKey[] }[] = [
  {
    key: "owner",
    name: "Owner / Super Admin",
    description: "Full access, including settings, users and period locking",
    permissions: ALL,
  },
  {
    key: "manager",
    name: "Manager",
    description: "Runs operations; approves returns and POs",
    // Spec §5: Manager only views payments.
    permissions: ALL.filter((p) => !["settings.edit", "users.manage", "accounts.periodLock", "payments.supplier"].includes(p)),
  },
  {
    key: "accountant",
    name: "Accountant",
    description: "Accounts, payments, VAT and financial reports",
    permissions: [
      "settings.view",
      "audit.view",
      "accounts.view",
      "customers.view",
      "customers.edit",
      "suppliers.view",
      "suppliers.edit",
      "products.view",
      "inventory.view",
      "inventory.viewCost",
      "purchase.view",
      "purchase.edit",
      "purchase.invoice",
      "purchase.verifyPayment",
      "payments.supplier",
      "landedCost.edit",
    ],
  },
  {
    key: "sales",
    name: "Sales Staff",
    description: "Customers, sales orders and invoices",
    permissions: ["customers.view", "customers.edit", "products.view", "inventory.view"],
  },
  {
    key: "storekeeper",
    name: "Storekeeper",
    description: "Receiving, slab entry, cutting and dispatch",
    permissions: [
      "products.view",
      "suppliers.view",
      "inventory.view",
      "inventory.openingStock",
      "inventory.split",
      "purchase.view",
      "purchase.receive",
    ],
  },
];

/** Effective permissions = role permissions + user grants − user revokes. */
export async function loadPermissions(userId: string): Promise<Set<string>> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { role: { include: { permissions: true } }, overrides: true },
  });
  const set = new Set(user.role.permissions.map((p) => p.permissionKey));
  for (const o of user.overrides) {
    if (o.grant) set.add(o.permissionKey);
    else set.delete(o.permissionKey);
  }
  return set;
}
