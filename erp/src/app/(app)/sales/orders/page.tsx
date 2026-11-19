import Link from "next/link";
import type { Prisma, SoStatus as SoStatusT } from "@prisma/client";
import { Card, Empty, LinkButton, PageHeader, SearchBar, Table } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/core";
import { fmtDate, fmtMoney, fmtSqm, titleCase } from "@/lib/format";
import { SoStatus } from "../shared";

export const metadata = { title: "Sales orders" };

const STATUSES: SoStatusT[] = ["OPEN", "PARTIALLY_INVOICED", "INVOICED", "DELIVERED", "CLOSED", "CANCELLED"];

export default async function SalesOrdersPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const user = await requirePermission("sales.view");
  const { q, status } = await searchParams;
  const where: Prisma.SalesOrderWhereInput = {
    ...(STATUSES.includes(status as SoStatusT) ? { status: status as SoStatusT } : {}),
    ...(q ? { OR: [{ number: { contains: q, mode: "insensitive" } }, { customerName: { contains: q, mode: "insensitive" } }] } : {}),
  };
  const rows = await prisma.salesOrder.findMany({ where, include: { items: { select: { sqm: true } } }, orderBy: [{ date: "desc" }, { number: "desc" }], take: 300 });

  return (
    <>
      <PageHeader
        title="Sales orders"
        subtitle="SO (reserves stock) → proforma / tax invoice → full payment → delivery note"
        actions={user.ctx.permissions.has("sales.edit") && <LinkButton href="/sales/orders/new">New sales order</LinkButton>}
      />
      <SearchBar placeholder="SO number or customer" defaultValue={q}>
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
          <Empty>No sales orders yet.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>SO</th>
                <th>Date</th>
                <th>Customer</th>
                <th>Status</th>
                <th className="num">SQM</th>
                <th className="num">Total (AED)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((so) => (
                <tr key={so.id}>
                  <td className="whitespace-nowrap">
                    <Link href={`/sales/orders/${so.id}`} className="font-medium text-primary hover:underline">{so.number}</Link>
                  </td>
                  <td className="whitespace-nowrap">{fmtDate(so.date)}</td>
                  <td>{so.customerName}</td>
                  <td><SoStatus s={so.status} /></td>
                  <td className="num">{fmtSqm(so.items.reduce((a, i) => a + Number(i.sqm), 0))}</td>
                  <td className="num">{fmtMoney(so.total)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
