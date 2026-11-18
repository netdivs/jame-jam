import { Card, Empty, PageHeader, Table } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/core";
import { fmtDateTime, titleCase } from "@/lib/format";

export const metadata = { title: "Audit log" };

const ENTITIES = ["Customer", "Supplier", "Product", "Warehouse", "LandedCostCategory", "Lot", "Slab", "StockBalance", "StockReservation", "JournalEntry", "Period", "CompanySetting", "User", "PurchaseOrder", "Shipment", "GoodsReceipt", "SupplierInvoice", "SupplierPayment", "LandedCostExpense", "SalesOrder", "ProformaInvoice", "CustomerReceipt", "BankAccount", "JournalVoucher", "Cheque"];

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ entity?: string }> }) {
  await requirePermission("audit.view");
  const { entity } = await searchParams;
  const rows = await prisma.auditLog.findMany({
    where: entity && ENTITIES.includes(entity) ? { entity } : {},
    include: { user: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return (
    <>
      <PageHeader title="Audit log" subtitle="Who did what and when. Written in the same transaction as the change itself." />
      <form className="mb-3 flex gap-2">
        <select name="entity" defaultValue={entity ?? ""} aria-label="Entity" className="min-h-9 rounded-md border border-border bg-surface px-2 text-sm">
          <option value="">All records</option>
          {ENTITIES.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
        <button className="min-h-9 cursor-pointer rounded-md border border-border bg-surface px-3 text-sm hover:bg-surface-2">Filter</button>
      </form>
      <Card pad={false}>
        {rows.length === 0 ? (
          <Empty>No audit entries.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>When</th>
                <th>User</th>
                <th>Action</th>
                <th>Record</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap">{fmtDateTime(r.createdAt)}</td>
                  <td>{r.user?.name ?? "System"}</td>
                  <td>{titleCase(r.action)}</td>
                  <td className="whitespace-nowrap">{r.entity}</td>
                  <td className="max-w-md">
                    <details>
                      <summary className="cursor-pointer text-xs text-primary">View</summary>
                      <pre className="mt-1 max-h-64 overflow-auto rounded bg-surface-2 p-2 text-xs">{JSON.stringify({ before: r.before, after: r.after, meta: r.meta }, null, 2)}</pre>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
