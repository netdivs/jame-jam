import Link from "next/link";
import type { ExpenseStatus, PaymentStatus, Prisma } from "@prisma/client";
import { Card, Empty, PageHeader, SearchBar, Stat, Table } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { D, prisma } from "@/server/core";
import { fmtAED, fmtDate, fmtMoney, titleCase } from "@/lib/format";
import { ExpStatus, PayStatus } from "../shared";

export const metadata = { title: "Landed costs" };

const STATUSES: ExpenseStatus[] = ["PENDING", "ALLOCATED"];
const PAY: PaymentStatus[] = ["UNPAID", "PARTIAL", "PAID"];

// Landed cost is cost data (spec §5: Owner, Manager, Accountant only), so the screen needs inventory.viewCost.
export default async function LandedCostsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; pay?: string }> }) {
  await requirePermission("inventory.viewCost");
  const { q, status, pay } = await searchParams;
  const where: Prisma.LandedCostExpenseWhereInput = {
    ...(STATUSES.includes(status as ExpenseStatus) ? { status: status as ExpenseStatus } : {}),
    ...(PAY.includes(pay as PaymentStatus) ? { paymentStatus: pay as PaymentStatus } : {}),
    ...(q
      ? {
          OR: [
            { number: { contains: q, mode: "insensitive" } },
            { billNo: { contains: q, mode: "insensitive" } },
            { supplier: { name: { contains: q, mode: "insensitive" } } },
            { purchaseOrder: { number: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  const [rows, pending, open] = await Promise.all([
    prisma.landedCostExpense.findMany({
      where,
      include: { supplier: true, category: true, purchaseOrder: true, shipment: true },
      orderBy: [{ date: "desc" }, { number: "desc" }],
      take: 300,
    }),
    prisma.landedCostExpense.aggregate({ where: { status: "PENDING" }, _sum: { amount: true }, _count: true }),
    prisma.landedCostExpense.aggregate({ where: { paymentStatus: { not: "PAID" } }, _sum: { total: true, paidAmount: true }, _count: true }),
  ]);
  const outstanding = D(open._sum.total ?? 0).minus(D(open._sum.paidAmount ?? 0));

  return (
    <>
      <PageHeader title="Landed costs" subtitle="Freight, duty, clearing and other import expenses. Record a bill on its purchase order, then allocate it to the lots here." />

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Stat label="Waiting for allocation" value={fmtAED(pending._sum.amount)} hint={`${pending._count} bill(s) still in Landed Cost Clearing`} />
        <Stat label="Payable to service suppliers" value={fmtAED(outstanding)} hint={`${open._count} bill(s) not fully paid`} />
      </div>

      <SearchBar placeholder="Doc, bill no., supplier or PO" defaultValue={q}>
        <select name="status" defaultValue={status ?? ""} aria-label="Allocation status" className="min-h-9 rounded-md border border-border bg-surface px-2 text-sm">
          <option value="">Any allocation status</option>
          <option value="PENDING">Pending allocation</option>
          <option value="ALLOCATED">Allocated</option>
        </select>
        <select name="pay" defaultValue={pay ?? ""} aria-label="Payment status" className="min-h-9 rounded-md border border-border bg-surface px-2 text-sm">
          <option value="">Any payment status</option>
          {PAY.map((p) => (
            <option key={p} value={p}>
              {titleCase(p)}
            </option>
          ))}
        </select>
      </SearchBar>

      <Card pad={false}>
        {rows.length === 0 ? (
          <Empty>{q || status || pay ? "No landed cost bills match these filters." : "No landed cost bills yet. Record them from a purchase order."}</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Doc</th>
                <th>Bill date</th>
                <th>Category</th>
                <th>Supplier / bill</th>
                <th>PO / shipment</th>
                <th className="num">Cost (excl. VAT)</th>
                <th className="num">Payable</th>
                <th>Payment</th>
                <th>Allocation</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap">
                    <Link href={`/purchase/landed-costs/${e.id}`} className="font-medium text-primary hover:underline">{e.number}</Link>
                  </td>
                  <td className="whitespace-nowrap">{fmtDate(e.date)}</td>
                  <td>{e.category.name}</td>
                  <td>
                    {e.supplier.name}
                    <div className="text-xs text-muted">{e.billNo}</div>
                  </td>
                  <td className="whitespace-nowrap">
                    <Link href={`/purchase/orders/${e.purchaseOrderId}`} className="text-primary hover:underline">{e.purchaseOrder.number}</Link>
                    {e.shipment && <div className="text-xs text-muted">{e.shipment.number}</div>}
                  </td>
                  <td className="num">{fmtMoney(e.amount)}</td>
                  <td className="num">{fmtMoney(e.total)}</td>
                  <td><PayStatus s={e.paymentStatus} /></td>
                  <td><ExpStatus s={e.status} /></td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
