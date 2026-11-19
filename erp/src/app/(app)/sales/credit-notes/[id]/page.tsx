import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, FInput, SubmitButton } from "@/components/forms";
import { Badge, Card, DefList, FileButton, LinkButton, PageHeader, Table } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { D, prisma } from "@/server/core";
import { getSetting } from "@/server/settings";
import { salesInvoicingEnabled } from "@/server/sales/invoices";
import { fmtAED, fmtDate, fmtDateTime, fmtMoney, fmtSqm } from "@/lib/format";
import { decideCnAction } from "../../actions";
import { CN_TONE } from "../../shared";

export default async function CreditNoteDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("sales.view");
  const has = (p: string) => user.ctx.permissions.has(p);
  const { id } = await params;
  const cn = await prisma.creditNote.findUnique({ where: { id }, include: { taxInvoice: true, returnRequest: true, items: { orderBy: { lineNo: "asc" }, include: { taxInvoiceItem: { include: { product: true } } } } } });
  if (!cn) notFound();
  const [enabled, treatment] = await Promise.all([salesInvoicingEnabled(), getSetting("creditNotes.paidInvoiceTreatment")]);
  const decider = cn.decidedById ? await prisma.user.findUnique({ where: { id: cn.decidedById }, select: { name: true } }) : null;
  const refundDue = cn.status === "POSTED" && D(cn.toAdvance).gt(0) && treatment === "REFUND";

  return (
    <>
      <PageHeader
        title={cn.number ? `Credit note ${cn.number}` : "Credit note (not numbered yet)"}
        subtitle={<span className="flex items-center gap-2">{cn.customerName} · {cn.kind === "RETURN" ? "Returned goods" : "Adjustment"} <Badge tone={CN_TONE[cn.status]}>{cn.status.toLowerCase().replace("_", " ")}</Badge></span>}
        back={{ href: "/sales/credit-notes", label: "Credit notes" }}
      />
      {cn.status === "POSTED" && <div className="-mt-2 mb-4 flex flex-wrap gap-2 print:hidden"><FileButton href={`/api/print/cn/${cn.id}`} target="_blank" rel="noopener">PDF</FileButton></div>}
      {refundDue && has("refunds.create") && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-md border border-warning/30 bg-warning-bg px-3 py-2 text-sm">
          {fmtAED(cn.toAdvance)} of this credit note is held for the customer; this business refunds it.
          <LinkButton href={`/refunds/new?customer=${cn.customerId}`} variant="secondary">Refund to customer</LinkButton>
        </div>
      )}
      <Card title="Details" className="mb-5">
        <DefList
          items={[
            ["Tax invoice", <Link key="ti" href={`/sales/invoices/${cn.taxInvoiceId}`} className="text-primary hover:underline">{cn.taxInvoice.number} ({fmtDate(cn.taxInvoice.date)})</Link>],
            ...(cn.returnRequest ? ([["Return", <Link key="rr" href={`/sales/returns/${cn.returnRequest.id}`} className="text-primary hover:underline">{cn.returnRequest.number}</Link>]] as [string, React.ReactNode][]) : []),
            ["Date", fmtDate(cn.date)],
            ["Reason", cn.reason],
            ["Approval", cn.decidedAt ? `${fmtDateTime(cn.decidedAt)}${decider ? ` by ${decider.name}` : ""}${cn.decisionNote ? ` — ${cn.decisionNote}` : ""}` : "Waiting for Owner / Manager"],
            ...(cn.status === "POSTED" ? ([["Applied", `Receivable ${fmtAED(cn.toReceivable)} · customer credit ${fmtAED(cn.toAdvance)}`]] as [string, string][]) : []),
          ]}
        />
      </Card>
      <Card title="Lines" className="mb-5" pad={false}>
        <Table>
          <thead><tr><th>#</th><th>Product</th>{cn.kind === "RETURN" && <th className="num">SQM</th>}<th className="num hidden sm:table-cell">Net</th><th className="num hidden sm:table-cell">VAT</th><th className="num">Total</th></tr></thead>
          <tbody>
            {cn.items.map((i) => (
              <tr key={i.id}>
                <td className="text-muted">{i.lineNo}</td>
                <td>{i.taxInvoiceItem.product.name}</td>
                {cn.kind === "RETURN" && <td className="num">{fmtSqm(i.sqm)}</td>}
                <td className="num hidden sm:table-cell">{fmtMoney(i.netAmount)}</td>
                <td className="num hidden sm:table-cell">{fmtMoney(i.vatAmount)}</td>
                <td className="num font-medium">{fmtMoney(i.grossAmount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border font-semibold"><td colSpan={cn.kind === "RETURN" ? 3 : 2}>Total (AED)</td><td className="num hidden sm:table-cell">{fmtMoney(cn.netTotal)}</td><td className="num hidden sm:table-cell">{fmtMoney(cn.vatTotal)}</td><td className="num">{fmtMoney(cn.total)}</td></tr>
          </tfoot>
        </Table>
      </Card>
      {enabled && cn.status === "PENDING_APPROVAL" && has("creditNotes.approve") && (
        <Card title="Decide" className="mb-5">
          <div className="grid gap-6 md:grid-cols-2">
            <ActionForm action={decideCnAction.bind(null, cn.id, "APPROVED")} className="grid gap-3">
              <FInput id="ap-note" label="Note (optional)" name="note" />
              <div><SubmitButton pendingText="Posting…">Approve and post</SubmitButton></div>
            </ActionForm>
            <ActionForm action={decideCnAction.bind(null, cn.id, "REJECTED")} className="grid gap-3">
              <FInput id="rj-note" label="Reason for rejecting" name="note" required />
              <div><SubmitButton variant="danger" pendingText="Rejecting…">Reject</SubmitButton></div>
            </ActionForm>
          </div>
        </Card>
      )}
    </>
  );
}
