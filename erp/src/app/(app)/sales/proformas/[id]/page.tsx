import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, FInput, SubmitButton } from "@/components/forms";
import { Badge, Card, DefList, LinkButton, PageHeader, Stat, Table } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { D } from "@/server/core";
import { prisma } from "@/server/core";
import { PI_OPEN, effectivePiStatus } from "@/server/sales/proformas";
import { fmtAED, fmtDate, fmtDateTime, fmtMoney, fmtSqm } from "@/lib/format";
import { closePiAction, renewPiAction } from "../../actions";
import { PiStatus, priceModeLabel } from "../../shared";

export default async function PiDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("sales.view");
  const has = (p: string) => user.ctx.permissions.has(p);
  const { id } = await params;
  const pi = await prisma.proformaInvoice.findUnique({
    where: { id },
    include: { salesOrder: true, items: { orderBy: { lineNo: "asc" }, include: { product: true, taxCode: true } }, receipts: { orderBy: { createdAt: "asc" } } },
  });
  if (!pi) notFound();
  const status = effectivePiStatus(pi);
  const settings = await prisma.companySetting.findUniqueOrThrow({ where: { id: 1 } });
  const renewedBy = pi.renewedById ? await prisma.user.findUnique({ where: { id: pi.renewedById }, select: { name: true } }) : null;

  return (
    <>
      <PageHeader
        title={`Proforma invoice ${pi.number}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {pi.customerName} · {priceModeLabel(pi.priceMode)} · <PiStatus pi={pi} />
          </span>
        }
        back={{ href: "/sales/proformas", label: "Proforma invoices" }}
        actions={
          status === "ACTIVE" &&
          has("receipts.create") &&
          D(pi.total).gt(pi.receivedAmount) && (
            <>
              <LinkButton href={`/receipts/new?pi=${pi.id}`}>Record receipt</LinkButton>
              <LinkButton href={`/pdc/new?direction=RECEIVED&pi=${pi.id}`} variant="secondary">Record cheque</LinkButton>
            </>
          )
        }
      />

      {status === "EXPIRED" && (
        <div className="mb-5 rounded-md border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger" role="alert">
          Expired on {fmtDate(pi.expiryDate)}. It cannot be paid against or converted to a tax invoice until it is renewed{has("sales.renewPi") ? "" : " by an Owner or Manager"}.
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total" value={fmtAED(pi.total)} hint={`Net ${fmtMoney(pi.netTotal)} + VAT ${fmtMoney(pi.vatTotal)}`} />
        <Stat label="Valid until" value={fmtDate(pi.expiryDate)} hint={`${pi.validityDays} days`} />
        <Stat label="Sales order" value={<Link href={`/sales/orders/${pi.salesOrderId}`} className="text-primary hover:underline">{pi.salesOrder.number}</Link>} />
        <Stat label="Received" value={fmtAED(pi.receivedAmount)} hint={D(pi.receivedAmount).gt(0) ? "Held as customer advance; a paid proforma does not expire" : undefined} />
      </div>

      <Card title="Details" className="mb-5">
        <DefList
          items={[
            ["From", [settings.legalName ?? settings.displayName, settings.address, settings.trn ? `TRN ${settings.trn}` : null].filter(Boolean).join(" · ")],
            ["Customer", pi.customerName],
            ["Address", pi.customerAddress ?? "—"],
            ...(pi.customerTrn ? ([["Customer TRN", pi.customerTrn]] as [string, string][]) : []),
            ["PI date", fmtDate(pi.date)],
            ["Renewals", pi.renewCount ? `${pi.renewCount} (last ${pi.renewedAt ? fmtDateTime(pi.renewedAt) : "—"}${renewedBy ? ` by ${renewedBy.name}` : ""})` : "—"],
            ["Prices", priceModeLabel(pi.priceMode)],
            ["Invoice discount", D(pi.discount).gt(0) ? fmtAED(pi.discount) : "—"],
            ["Terms", pi.terms ?? "—"],
            ["Notes", pi.notes ?? "—"],
            ...(pi.closeReason ? ([["Closed / cancelled because", pi.closeReason]] as [string, string][]) : []),
            ["Accounting", "None — a proforma posts no accounting or VAT."],
          ]}
        />
      </Card>

      <Card title="Lines" className="mb-5" pad={false}>
        <Table>
          <thead>
            <tr>
              <th>#</th>
              <th>Description</th>
              <th className="num">SQM</th>
              <th className="num hidden md:table-cell">Price / SQM ({pi.priceMode === "INCLUSIVE" ? "incl." : "excl."})</th>
              <th className="num hidden lg:table-cell">Price / SQM excl. VAT</th>
              <th className="num hidden md:table-cell">Discount</th>
              <th className="hidden sm:table-cell">Tax</th>
              <th className="num hidden sm:table-cell">VAT</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {pi.items.map((i) => (
              <tr key={i.id}>
                <td className="text-muted">{i.lineNo}</td>
                <td>
                  <div className="font-medium">{i.product.name}</div>
                  {i.description && <div className="text-xs text-muted">{i.description}</div>}
                </td>
                <td className="num">{fmtSqm(i.sqm)}</td>
                <td className="num hidden md:table-cell">{fmtMoney(i.unitPrice)}</td>
                <td className="num hidden lg:table-cell">{D(i.sqm).gt(0) ? D(i.netAmount).div(i.sqm).toFixed(4) : "—"}</td>
                <td className="num hidden md:table-cell">{D(i.discount).plus(i.headerDiscount).gt(0) ? fmtMoney(D(i.discount).plus(i.headerDiscount)) : "—"}</td>
                <td className="hidden sm:table-cell">{i.taxCode.code} {D(i.taxCode.rate).gt(0) && i.taxCode.type === "SR" ? `${D(i.taxCode.rate).toString()}%` : ""}</td>
                <td className="num hidden sm:table-cell">{fmtMoney(i.vatAmount)}</td>
                <td className="num font-medium">{fmtMoney(i.grossAmount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border font-semibold">
              <td colSpan={2}>Total (AED)</td>
              <td className="num">{fmtSqm(pi.items.reduce((a, i) => a.plus(i.sqm), D(0)))}</td>
              <td className="hidden md:table-cell" />
              <td className="hidden lg:table-cell" />
              <td className="hidden md:table-cell" />
              <td className="hidden sm:table-cell" />
              <td className="num hidden sm:table-cell">{fmtMoney(pi.vatTotal)}</td>
              <td className="num">{fmtMoney(pi.total)}</td>
            </tr>
          </tfoot>
        </Table>
      </Card>

      {pi.receipts.length > 0 && has("receipts.view") && (
        <Card title="Receipts against this proforma" className="mb-5" pad={false}>
          <Table>
            <tbody>
              {pi.receipts.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/receipts/${r.id}`} className="font-medium text-primary hover:underline">{r.number}</Link>
                  </td>
                  <td>{fmtDate(r.date)}</td>
                  <td>{r.status === "POSTED" ? <Badge tone="success">Posted</Badge> : <Badge tone="danger">Cancelled</Badge>}</td>
                  <td className="num">{fmtMoney(r.amount)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {status === "EXPIRED" && has("sales.renewPi") && (
        <Card title="Renew" className="mb-5">
          <ActionForm action={renewPiAction.bind(null, id)} className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <FInput label="Note (optional)" name="reason" placeholder="e.g. Customer confirmed prices by phone" />
            <SubmitButton pendingText="Renewing…">Renew for {settings.piValidityDays} days from today</SubmitButton>
          </ActionForm>
        </Card>
      )}

      {PI_OPEN.includes(pi.status) && has("sales.cancel") && D(pi.receivedAmount).gt(0) && (
        <p className="mb-5 text-sm text-muted">This proforma holds {fmtAED(pi.receivedAmount)} received. Cancel or refund those receipts before closing or cancelling it.</p>
      )}

      {PI_OPEN.includes(pi.status) && has("sales.cancel") && D(pi.receivedAmount).isZero() && (
        <Card title="Close or cancel" className="mb-5">
          <div className="grid gap-6 md:grid-cols-2">
            <ActionForm action={closePiAction.bind(null, id, "CLOSED")} className="grid gap-3">
              <FInput label="Close — customer will not proceed" name="reason" required placeholder="Reason" />
              <div>
                <SubmitButton variant="secondary" pendingText="Closing…">Close proforma</SubmitButton>
              </div>
            </ActionForm>
            <ActionForm action={closePiAction.bind(null, id, "CANCELLED")} className="grid gap-3">
              <FInput label="Cancel — issued in error" name="reason" required placeholder="Reason" />
              <div>
                <SubmitButton variant="danger" pendingText="Cancelling…">Cancel proforma</SubmitButton>
              </div>
            </ActionForm>
          </div>
          <p className="mt-3 text-xs text-muted">Either way its quantity can be quoted again; the sales order and its reservation stay.</p>
        </Card>
      )}
    </>
  );
}
