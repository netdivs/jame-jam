import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { Card, Empty, PageHeader, SearchBar, Table } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/core";
import { salesInvoicingEnabled } from "@/server/sales/invoices";
import { fmtDate, fmtMoney } from "@/lib/format";
import { TiPayStatus } from "../shared";

export const metadata = { title: "Tax invoices" };

const FILTERS = { UNPAID: "Unpaid", PARTIAL: "Partly paid", PAID: "Paid" } as const;

export default async function TaxInvoicesPage({ searchParams }: { searchParams: Promise<{ q?: string; pay?: string }> }) {
  await requirePermission("sales.view");
  const { q, pay } = await searchParams;
  const where: Prisma.TaxInvoiceWhereInput = {
    AND: [
      pay && pay in FILTERS ? { paymentStatus: pay as keyof typeof FILTERS } : {},
      q ? { OR: [{ number: { contains: q, mode: "insensitive" } }, { customerName: { contains: q, mode: "insensitive" } }, { salesOrder: { number: { contains: q, mode: "insensitive" } } }] } : {},
    ],
  };
  const [rows, enabled] = await Promise.all([
    prisma.taxInvoice.findMany({ where, include: { salesOrder: { select: { id: true, number: true } } }, orderBy: [{ date: "desc" }, { number: "desc" }], take: 300 }),
    salesInvoicingEnabled(),
  ]);

  return (
    <>
      <PageHeader title="Tax invoices" subtitle="Issued from a sales order or by converting a proforma. Paid in full unlocks the delivery note." />
      {!enabled && (
        <div className="mb-4 rounded-md border border-warning/30 bg-warning-bg px-3 py-2 text-sm">
          Tax invoicing is switched off (Settings → System → Modules). It is built on the proposed VAT method and waits for the client&apos;s confirmation (C4).
        </div>
      )}
      <SearchBar placeholder="TI, SO or customer" defaultValue={q}>
        <select name="pay" defaultValue={pay ?? ""} aria-label="Payment" className="min-h-9 rounded-md border border-border bg-surface px-2 text-sm">
          <option value="">All</option>
          {Object.entries(FILTERS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </SearchBar>
      <Card pad={false}>
        {rows.length === 0 ? (
          <Empty>No tax invoices found.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>TI</th>
                <th className="hidden sm:table-cell">SO</th>
                <th>Customer</th>
                <th className="hidden md:table-cell">Date</th>
                <th>Payment</th>
                <th className="num hidden sm:table-cell">VAT</th>
                <th className="num">Total (AED)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((ti) => (
                <tr key={ti.id}>
                  <td className="whitespace-nowrap">
                    <Link href={`/sales/invoices/${ti.id}`} className="font-medium text-primary hover:underline">{ti.number}</Link>
                  </td>
                  <td className="hidden whitespace-nowrap sm:table-cell">
                    <Link href={`/sales/orders/${ti.salesOrder.id}`} className="text-primary hover:underline">{ti.salesOrder.number}</Link>
                  </td>
                  <td>{ti.customerName}</td>
                  <td className="hidden whitespace-nowrap md:table-cell">{fmtDate(ti.date)}</td>
                  <td><TiPayStatus s={ti.paymentStatus} /></td>
                  <td className="num hidden sm:table-cell">{fmtMoney(ti.vatTotal)}</td>
                  <td className="num">{fmtMoney(ti.total)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
