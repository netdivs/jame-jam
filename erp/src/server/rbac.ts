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
  // Sales
  "sales.view": "View sales orders, proforma invoices and tax invoices",
  "sales.edit": "Create / edit sales orders and issue proforma invoices",
  "sales.cancel": "Cancel sales orders and proforma invoices",
  "sales.renewPi": "Renew an expired proforma invoice",
  "sales.extendReservation": "Extend a sales order's stock reservation",
  "taxCode.change": "Use a tax code other than standard-rated (SR) on a document line",
  "delivery.view": "View delivery notes",
  "delivery.create": "Issue delivery notes (release goods for a fully paid tax invoice)",
  "returns.create": "Raise sales return requests",
  "returns.approve": "Approve or reject sales returns",
  "returns.receive": "Record returned goods received back (SQM and condition)",
  "creditNotes.create": "Create credit notes (return-based, or adjustments that wait for approval)",
  "creditNotes.approve": "Approve or reject adjustment credit notes",
  // Receipts & accounts
  "receipts.view": "View customer receipts and advances",
  "receipts.create": "Record customer receipts (CR / RV)",
  "receipts.cancel": "Cancel a customer receipt (posts a reversal)",
  "bank.manage": "Create / edit company bank accounts",
  "journal.post": "Post and reverse manual journal vouchers",
  "reports.financial": "View financial reports (trial balance, profit & loss, balance sheet)",
  "jobs.run": "View scheduled job runs and run them now",
  "pdc.manage": "Deposit, clear, bounce, cancel and replace post-dated cheques",
  "refunds.create": "Record refund vouchers (pay back a customer advance, take back a supplier advance)",
  "refunds.cancel": "Cancel a refund voucher (posts a reversal)",
  "refunds.overLimit": "Pay a customer refund in cash above the cash refund limit (Settings → System)",
  "pettyCash.view": "View petty cash boxes, transactions and the daily cash report",
  "pettyCash.manage": "Record petty cash top-ups and expenses, cancel them, and manage boxes and expense categories",
  "bankRec.manage": "Enter and import bank statements, match them, post bank charges and save reconciliations",
  "opening.manage": "Enter opening balances (open invoices, advances, cash/bank, opening trial balance) and knock off opening invoices",
  // CRM (spec §3.6; "own" = records assigned to / owned by the user)
  "crm.view": "View own CRM leads, opportunities, follow-ups and customer timelines",
  "crm.viewAll": "View every user's CRM records and CRM reports",
  "crm.edit": "Create and update own leads, opportunities, interactions and follow-ups",
  "crm.editAll": "Edit or reassign any user's CRM records",
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
    // Spec §5: Manager only views payments, receipts, bank and journals.
    permissions: ALL.filter(
      (p) => !["settings.edit", "users.manage", "accounts.periodLock", "payments.supplier", "receipts.create", "receipts.cancel", "bank.manage", "journal.post", "pdc.manage", "refunds.create", "refunds.cancel", "refunds.overLimit", "pettyCash.manage", "bankRec.manage", "opening.manage"].includes(p),
    ),
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
      "sales.view",
      "delivery.view",
      "creditNotes.create",
      "taxCode.change",
      "receipts.view",
      "receipts.create",
      "receipts.cancel",
      "bank.manage",
      "journal.post",
      "reports.financial",
      "pdc.manage",
      "refunds.create",
      "refunds.cancel",
      "pettyCash.view",
      "pettyCash.manage",
      "bankRec.manage",
      "opening.manage",
      "crm.view",
      "crm.viewAll",
    ],
  },
  {
    key: "sales",
    name: "Sales Staff",
    description: "Customers, sales orders and invoices",
    // Spec §5: SO / PI / TI create/edit; no cancel, renew, extend or tax code change.
    permissions: ["customers.view", "customers.edit", "products.view", "inventory.view", "sales.view", "sales.edit", "delivery.view", "returns.create", "receipts.view", "receipts.create", "crm.view", "crm.edit"],
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
      "sales.view",
      "delivery.view",
      "delivery.create",
      "returns.receive",
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
