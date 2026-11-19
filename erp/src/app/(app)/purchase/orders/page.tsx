import Link from "next/link";
import type { PoStatus as PoStatusT, Prisma } from "@prisma/client";
import { Card, Empty, LinkButton, PageHeader, SearchBar, Table } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/core";
import { fmtDate, fmtMoney, titleCase } from "@/lib/format";
import { PayStatus, PoStatus } from "../shared";

export const metadata = { title: "Purchase orders" };

const STATUSES: PoStatusT[] = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED", "CANCELLED"];

export default async function PurchaseOrdersPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const user = await requirePermission("purchase.view");
  const { q, status } = await searchParams;
  const where: Prisma.PurchaseOrderWhereInput = {
    ...(STATUSES.includes(status as PoStatusT) ? { status: status as PoStatusT } : {}),
    ...(q ? { OR: [{ number: { contains: q, mode: "insensitive" } }, { supplier: { name: { contains: q, mode: "insensitive" } } }] } : {}),
  };
  const rows = await prisma.purchaseOrder.findMany({ where, include: { supplier: true }, orderBy: [{ date: "desc" }, { number: "desc" }], take: 300 });

  return (
    <>
      <PageHeader
        title="Purchase orders"
        subtitle="PO → approval → 100% payment (verified) → collection → GRN → supplier invoice"
        actions={user.ctx.permissions.has("purchase.edit") && <LinkButton href="/purchase/orders/new">New purchase order</LinkButton>}
      />
      <SearchBar placeholder="PO number or supplier" defaultValue={q}>
        <select name="status" defaultValue={status ?? ""} aria-label="Status" className="min-h-9 rounded-md border border-border bg-surface px-2 text-sm">
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {titleCase(s)}
            </option>
          ))}
        </select>
      </SearchBar>
      <Card pad={false}>
        {rows.length === 0 ? (
          <Empty>No purchase orders yet.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>PO</th>
                <th>Date</th>
                <th>Supplier</th>
                <th>Status</th>
                <th className="num">Total (AED)</th>
                <th className="num">Paid (AED)</th>
                <th>Payment</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((po) => (
                <tr key={po.id}>
                  <td className="whitespace-nowrap">
                    <Link href={`/purchase/orders/${po.id}`} className="font-medium text-primary hover:underline">{po.number}</Link>
                  </td>
                  <td className="whitespace-nowrap">{fmtDate(po.date)}</td>
                  <td>{po.supplier.name}</td>
                  <td><PoStatus s={po.status} /></td>
                  <td className="num">{fmtMoney(po.total)}</td>
                  <td className="num">{fmtMoney(po.paidAmount)}</td>
                  <td>
                    <PayStatus s={po.paymentStatus} />
                    {po.paymentVerifiedAt && <span className="ml-1 text-xs text-success">✓ verified</span>}
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
