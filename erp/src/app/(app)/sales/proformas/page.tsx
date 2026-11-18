import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { Card, Empty, PageHeader, SearchBar, Table } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { prisma, today } from "@/server/core";
import { fmtDate, fmtMoney } from "@/lib/format";
import { PiStatus } from "../shared";

export const metadata = { title: "Proforma invoices" };

const FILTERS = { ACTIVE: "Active", EXPIRED: "Expired", CONVERTED: "Converted", CLOSED: "Closed", CANCELLED: "Cancelled" } as const;
type Filter = keyof typeof FILTERS;

export default async function ProformasPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  await requirePermission("sales.view");
  const { q, status } = await searchParams;
  const now = today();
  // "Expired" includes active PIs already past their expiry date (the daily job may not have run yet).
  const statusWhere: Prisma.ProformaInvoiceWhereInput =
    status === "EXPIRED"
      ? { OR: [{ status: "EXPIRED" }, { status: "ACTIVE", expiryDate: { lt: now }, receivedAmount: 0 }] }
      : status === "ACTIVE"
        ? { status: "ACTIVE", OR: [{ expiryDate: { gte: now } }, { receivedAmount: { gt: 0 } }] }
        : status && status in FILTERS
          ? { status: status as Filter }
          : {};
  const where: Prisma.ProformaInvoiceWhereInput = {
    AND: [statusWhere, q ? { OR: [{ number: { contains: q, mode: "insensitive" } }, { customerName: { contains: q, mode: "insensitive" } }, { salesOrder: { number: { contains: q, mode: "insensitive" } } }] } : {}],
  };
  const rows = await prisma.proformaInvoice.findMany({ where, include: { salesOrder: { select: { id: true, number: true } } }, orderBy: [{ date: "desc" }, { number: "desc" }], take: 300 });
  const expiredCount = await prisma.proformaInvoice.count({ where: { OR: [{ status: "EXPIRED" }, { status: "ACTIVE", expiryDate: { lt: now }, receivedAmount: 0 }] } });

  return (
    <>
      <PageHeader title="Proforma invoices" subtitle="Quotations from a sales order. They expire after the validity period and post no accounting." />
      {expiredCount > 0 && status !== "EXPIRED" && (
        <div className="mb-4 rounded-md border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger">
          {expiredCount} expired proforma{expiredCount === 1 ? "" : "s"} — <Link href="/sales/proformas?status=EXPIRED" className="font-medium underline">show</Link>. They cannot be paid or converted until renewed.
        </div>
      )}
      <SearchBar placeholder="PI, SO or customer" defaultValue={q}>
        <select name="status" defaultValue={status ?? ""} aria-label="Status" className="min-h-9 rounded-md border border-border bg-surface px-2 text-sm">
          <option value="">All statuses</option>
          {Object.entries(FILTERS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </SearchBar>
      <Card pad={false}>
        {rows.length === 0 ? (
          <Empty>No proforma invoices found.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>PI</th>
                <th className="hidden sm:table-cell">SO</th>
                <th>Customer</th>
                <th className="hidden md:table-cell">Date</th>
                <th>Valid until</th>
                <th>Status</th>
                <th className="num">Total (AED)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((pi) => (
                <tr key={pi.id}>
                  <td className="whitespace-nowrap">
                    <Link href={`/sales/proformas/${pi.id}`} className="font-medium text-primary hover:underline">{pi.number}</Link>
                  </td>
                  <td className="hidden whitespace-nowrap sm:table-cell">
                    <Link href={`/sales/orders/${pi.salesOrder.id}`} className="text-primary hover:underline">{pi.salesOrder.number}</Link>
                  </td>
                  <td>{pi.customerName}</td>
                  <td className="hidden whitespace-nowrap md:table-cell">{fmtDate(pi.date)}</td>
                  <td className="whitespace-nowrap">{fmtDate(pi.expiryDate)}</td>
                  <td><PiStatus pi={pi} /></td>
                  <td className="num">{fmtMoney(pi.total)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
