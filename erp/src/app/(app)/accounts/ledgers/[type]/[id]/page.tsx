import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, DefList, PageHeader, Table, FileButton } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { requirePermission } from "@/server/auth";
import { D, prisma, toDateOnly } from "@/server/core";
import { documentHref, partyStatement, supplierGrni, type PartyType } from "@/server/accounting/ledgers";
import { fmtAED, fmtDate, fmtMoney, todayIso } from "@/lib/format";
import { DateForm } from "../../../report-ui";

export const metadata = { title: "Statement" };

const valid = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);

export default async function StatementPage({ params, searchParams }: { params: Promise<{ type: string; id: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  await requirePermission("accounts.view");
  const { type: t, id } = await params;
  if (t !== "customer" && t !== "supplier") notFound();
  const type: PartyType = t === "customer" ? "CUSTOMER" : "SUPPLIER";
  const sp = await searchParams;
  const toStr = valid(sp.to) ?? todayIso();
  const fromStr = valid(sp.from) ?? `${toStr.slice(0, 4)}-01-01`;
  const party = type === "CUSTOMER" ? await prisma.customer.findUnique({ where: { id } }) : await prisma.supplier.findUnique({ where: { id } });
  if (!party) notFound();
  const from = toDateOnly(fromStr);
  const to = toDateOnly(toStr);
  const st = await partyStatement(type, id, from, to);
  const pvIds = st.rows.filter((r) => r.sourceType === "SUPPLIER_PAYMENT" && r.sourceId).map((r) => r.sourceId!);
  const pvs = pvIds.length ? await prisma.supplierPayment.findMany({ where: { id: { in: pvIds } }, select: { id: true, purchaseOrderId: true } }) : [];
  const poOf = new Map(pvs.filter((p) => p.purchaseOrderId).map((p) => [p.id, p.purchaseOrderId!]));

  const extra =
    type === "CUSTOMER"
      ? await prisma.proformaInvoice.findMany({ where: { customerId: id, receivedAmount: { gt: 0 } }, select: { id: true, number: true, receivedAmount: true, total: true } })
      : await prisma.supplierInvoice.findMany({ where: { purchaseOrder: { supplierId: id }, paymentStatus: { not: "PAID" } }, select: { id: true, number: true, supplierInvoiceNo: true, total: true, settledAmount: true } });
  const grni = type === "SUPPLIER" ? await supplierGrni(id) : null;
  const owedLabel = type === "CUSTOMER" ? "Receivable (AR)" : "Payable (AP)";
  const meaning = (b: { isNegative(): boolean; isZero(): boolean }) =>
    b.isZero() ? "settled" : type === "CUSTOMER" ? (b.isNegative() ? "advance held for the customer" : "the customer owes us") : b.isNegative() ? "our advance with the supplier" : "we owe the supplier";

  return (
    <>
      <PageHeader
        title={`Statement — ${party.name}`}
        subtitle={`${party.code} · ${fmtDate(from)} to ${fmtDate(to)}`}
        back={{ href: `/accounts/ledgers?type=${t}`, label: type === "CUSTOMER" ? "Customer ledgers" : "Supplier ledgers" }}
        actions={<PrintButton />}
      />
      <div className="-mt-2 mb-4 flex flex-wrap gap-2 print:hidden"><FileButton href={`/api/print/statement/${id}?party=${t}&from=${fromStr}&to=${toStr}`} target="_blank" rel="noopener">PDF</FileButton><FileButton href={`/api/export/statement?party=${t}&id=${id}&from=${fromStr}&to=${toStr}`}>Excel</FileButton></div>
      <DateForm fields={[{ name: "from", label: "From", value: fromStr }, { name: "to", label: "To", value: toStr }]} />
      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        <Card title="Closing position">
          <DefList
            items={[
              [owedLabel, fmtAED(st.closingOwed)],
              ["Advance", fmtAED(st.closingAdvance)],
              ["Balance", `${fmtAED(st.closing)} — ${meaning(st.closing)}`],
              ...(grni && !grni.isZero() ? ([["Goods received, not invoiced yet", fmtAED(grni)]] as [string, string][]) : []),
            ]}
          />
        </Card>
        <Card title={type === "CUSTOMER" ? "Money held on proformas" : "Unpaid supplier invoices"}>
          {extra.length === 0 ? (
            <p className="text-sm text-muted">None.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {type === "CUSTOMER"
                ? (extra as { id: string; number: string; receivedAmount: { toString(): string }; total: { toString(): string } }[]).map((p) => (
                    <li key={p.id}>
                      <Link href={`/sales/proformas/${p.id}`} className="text-primary hover:underline">{p.number}</Link> — received {fmtAED(p.receivedAmount)} of {fmtAED(p.total)}
                    </li>
                  ))
                : (extra as { id: string; number: string; supplierInvoiceNo: string; total: { toString(): string }; settledAmount: { toString(): string } }[]).map((i) => (
                    <li key={i.id}>
                      <Link href={`/purchase/invoices/${i.id}`} className="text-primary hover:underline">{i.number}</Link> ({i.supplierInvoiceNo}) — open {fmtAED(D(i.total.toString()).minus(i.settledAmount.toString()))}
                    </li>
                  ))}
            </ul>
          )}
        </Card>
      </div>
      <Card pad={false}>
        <Table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Document</th>
              <th>Details</th>
              <th className="num hidden sm:table-cell">Debit</th>
              <th className="num hidden sm:table-cell">Credit</th>
              <th className="num">Balance</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={3} className="font-medium">Opening balance</td>
              <td className="hidden sm:table-cell" colSpan={2} />
              <td className="num font-medium">{fmtMoney(st.opening)}</td>
            </tr>
            {st.rows.map((r) => (
              <tr key={r.lineId}>
                <td className="whitespace-nowrap">{fmtDate(r.date)}</td>
                <td className="whitespace-nowrap font-mono text-xs">
                  <Link href={documentHref(r, poOf)} className="text-primary hover:underline">{r.number}</Link>
                </td>
                <td>
                  {r.memo}
                  <span className="block text-xs text-muted">{r.account === "owed" ? owedLabel : "Advance"}</span>
                  <span className="num block text-xs sm:hidden">{r.debit.gt(0) ? `Dr ${fmtMoney(r.debit)}` : `Cr ${fmtMoney(r.credit)}`}</span>
                </td>
                <td className="num hidden sm:table-cell">{r.debit.gt(0) ? fmtMoney(r.debit) : ""}</td>
                <td className="num hidden sm:table-cell">{r.credit.gt(0) ? fmtMoney(r.credit) : ""}</td>
                <td className="num">{fmtMoney(r.balance)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td colSpan={3}>Closing balance</td>
              <td className="num hidden sm:table-cell">{fmtMoney(st.totalDebit)}</td>
              <td className="num hidden sm:table-cell">{fmtMoney(st.totalCredit)}</td>
              <td className="num">{fmtMoney(st.closing)}</td>
            </tr>
          </tfoot>
        </Table>
      </Card>
    </>
  );
}
