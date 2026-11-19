import Link from "next/link";
import { Card, Empty, PageHeader, Table } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/core";
import { fmtDate, fmtMoney, titleCase } from "@/lib/format";

export const metadata = { title: "Supplier payments" };

export default async function PaymentsPage() {
  await requirePermission("purchase.view");
  const rows = await prisma.supplierPayment.findMany({
    include: { supplier: true, purchaseOrder: true, landedCostExpense: true },
    orderBy: [{ date: "desc" }, { number: "desc" }],
    take: 300,
  });
  return (
    <>
      <PageHeader title="Supplier payments (PV)" subtitle="Record payments from the PO page (goods) or the landed cost bill (expenses)." />
      <Card pad={false}>
        {rows.length === 0 ? (
          <Empty>No supplier payments yet.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>PV</th>
                <th>Date</th>
                <th>Supplier</th>
                <th>For</th>
                <th>Mode</th>
                <th>Reference</th>
                <th className="num">Amount (AED)</th>
                <th className="num">Held as advance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td className="whitespace-nowrap font-mono text-xs"><a href={`/api/print/pv/${p.id}`} target="_blank" rel="noopener" className="text-primary hover:underline" title="Payment voucher PDF">{p.number}</a></td>
                  <td className="whitespace-nowrap">{fmtDate(p.date)}</td>
                  <td>{p.supplier.name}</td>
                  <td>
                    {p.purchaseOrder ? (
                      <Link href={`/purchase/orders/${p.purchaseOrderId}`} className="text-primary hover:underline">PO {p.purchaseOrder.number}</Link>
                    ) : p.landedCostExpense ? (
                      <Link href={`/purchase/landed-costs/${p.landedCostExpenseId}`} className="text-primary hover:underline">Bill {p.landedCostExpense.billNo}</Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>{titleCase(p.mode)}</td>
                  <td>{p.reference ?? "—"}</td>
                  <td className="num">{fmtMoney(p.amount)}</td>
                  <td className="num">{fmtMoney(p.toAdvance)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
