import { redirect } from "next/navigation";
import { AppShell, type NavGroup } from "@/components/shell";
import { logout, requireUser } from "@/server/auth";
import { prisma } from "@/server/core";

export const dynamic = "force-dynamic";

async function logoutAction() {
  "use server";
  await logout();
  redirect("/login");
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const has = (p: string) => user.ctx.permissions.has(p);
  const settings = await prisma.companySetting.findUnique({ where: { id: 1 } });

  const nav: NavGroup[] = [
    { label: "Overview", items: [{ href: "/", label: "Dashboard", icon: "dashboard" }] },
    {
      label: "Inventory",
      items: has("inventory.view")
        ? [
            { href: "/inventory", label: "Stock summary", icon: "stock" },
            { href: "/inventory/lots", label: "Lots & blocks", icon: "lots" },
            { href: "/inventory/slabs", label: "Slabs", icon: "slabs" },
            { href: "/inventory/movements", label: "Stock movements", icon: "movements" },
          ]
        : [],
    },
    {
      label: "Sales",
      items: [
        ...(has("sales.view")
          ? [
              { href: "/sales/orders", label: "Sales orders", icon: "salesOrders" as const },
              { href: "/sales/proformas", label: "Proforma invoices", icon: "proformas" as const },
            ]
          : []),
        ...(has("receipts.view") ? [{ href: "/receipts", label: "Customer receipts", icon: "receipts" as const }] : []),
        ...(has("receipts.view") ? [{ href: "/pdc", label: "Post-dated cheques", icon: "cheques" as const }] : []),
      ],
    },
    {
      label: "CRM",
      items: has("crm.view")
        ? [
            { href: "/crm", label: "Follow-ups", icon: "followUps" as const },
            { href: "/crm/leads", label: "Leads", icon: "leads" as const },
            { href: "/crm/opportunities", label: "Opportunities", icon: "opportunities" as const },
            { href: "/crm/reports", label: "CRM reports", icon: "reports" as const },
          ]
        : [],
    },
    {
      label: "Purchase",
      items: [
        ...(has("purchase.view")
          ? [
              { href: "/purchase/orders", label: "Purchase orders", icon: "purchaseOrders" as const },
              { href: "/purchase/grn", label: "Goods receipts", icon: "grn" as const },
              { href: "/purchase/invoices", label: "Supplier invoices", icon: "supplierInvoices" as const },
              { href: "/purchase/payments", label: "Supplier payments", icon: "supplierPayments" as const },
            ]
          : []),
        // Landed cost is cost data: Owner, Manager, Accountant (spec §5).
        ...(has("inventory.viewCost") ? [{ href: "/purchase/landed-costs", label: "Landed costs", icon: "landedCosts" as const }] : []),
      ],
    },
    {
      label: "Masters",
      items: [
        ...(has("customers.view") ? [{ href: "/masters/customers", label: "Customers", icon: "customers" as const }] : []),
        ...(has("suppliers.view") ? [{ href: "/masters/suppliers", label: "Suppliers", icon: "suppliers" as const }] : []),
        ...(has("products.view") ? [{ href: "/masters/products", label: "Products", icon: "products" as const }] : []),
        ...(has("warehouses.edit") ? [{ href: "/masters/warehouses", label: "Warehouses", icon: "warehouses" as const }] : []),
        ...(has("landedCostCategories.edit")
          ? [{ href: "/masters/landed-cost-categories", label: "Landed cost categories", icon: "landed" as const }]
          : []),
      ],
    },
    {
      label: "Accounts",
      items: [
        ...(has("accounts.view")
          ? [
              { href: "/accounts/chart", label: "Chart of accounts", icon: "coa" as const },
              { href: "/accounts/journals", label: "Journal entries", icon: "journals" as const },
              { href: "/accounts/banks", label: "Bank accounts", icon: "banks" as const },
              { href: "/accounts/ledgers", label: "Customer & supplier ledgers", icon: "ledgers" as const },
              { href: "/accounts/bank-rec", label: "Bank reconciliation", icon: "bankRec" as const },
              { href: "/refunds", label: "Refunds", icon: "refunds" as const },
            ]
          : []),
        ...(has("pettyCash.view") ? [{ href: "/petty-cash", label: "Petty cash", icon: "pettyCash" as const }] : []),
        ...(has("reports.financial")
          ? [
              { href: "/accounts/trial-balance", label: "Trial balance", icon: "reports" as const },
              { href: "/accounts/profit-loss", label: "Profit & loss", icon: "reports" as const },
              { href: "/accounts/balance-sheet", label: "Balance sheet", icon: "reports" as const },
            ]
          : []),
        ...(has("accounts.view") ? [{ href: "/accounts/periods", label: "Periods", icon: "periods" as const }] : []),
        ...(has("accounts.view") ? [{ href: "/accounts/opening", label: "Opening balances", icon: "opening" as const }] : []),
      ],
    },
    {
      label: "Administration",
      items: [
        ...(has("settings.view") ? [{ href: "/settings/company", label: "Company settings", icon: "company" as const }] : []),
        ...(has("settings.view") ? [{ href: "/settings/tax-codes", label: "Tax codes", icon: "tax" as const }] : []),
        ...(has("users.manage") ? [{ href: "/settings/users", label: "Users", icon: "users" as const }] : []),
        ...(has("users.manage") ? [{ href: "/settings/roles", label: "Roles & permissions", icon: "roles" as const }] : []),
        ...(has("audit.view") ? [{ href: "/audit", label: "Audit log", icon: "audit" as const }] : []),
        ...(has("jobs.run") ? [{ href: "/settings/jobs", label: "Scheduled jobs", icon: "periods" as const }] : []),
      ],
    },
  ].filter((g) => g.items.length > 0) as NavGroup[];

  return (
    <AppShell nav={nav} user={{ name: user.name, roleName: user.roleName }} company={settings?.displayName ?? "Jame Jam"} logoutAction={logoutAction}>
      {children}
    </AppShell>
  );
}
