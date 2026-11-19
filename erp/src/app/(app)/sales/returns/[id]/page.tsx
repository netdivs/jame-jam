import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, FInput, FSelect, SubmitButton } from "@/components/forms";
import { Badge, Card, DefList, PageHeader, Table } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/core";
import { salesInvoicingEnabled } from "@/server/sales/invoices";
import { fmtDate, fmtDateTime, fmtMoney, fmtSqm, todayIso } from "@/lib/format";
import { decideRrAction, receiveRrAction, returnCnAction } from "../../actions";
import { RR_TONE } from "../../shared";

export default async function ReturnDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("sales.view");
  const has = (p: string) => user.ctx.permissions.has(p);
  const { id } = await params;
  const rr = await prisma.returnRequest.findUnique({
    where: { id },
    include: { taxInvoice: true, creditNote: true, items: { orderBy: { lineNo: "asc" }, include: { taxInvoiceItem: { include: { product: true } } } } },
  });
  if (!rr) notFound();
  const enabled = await salesInvoicingEnabled();
  const names = await prisma.user.findMany({ where: { id: { in: [rr.decidedById, rr.receivedById].filter((x): x is string => Boolean(x)) } }, select: { id: true, name: true } });
  const nameOf = (uid: string | null) => names.find((n) => n.id === uid)?.name ?? "";
  const received = ["RECEIVED", "CREDITED"].includes(rr.status);

  return (
    <>
      <PageHeader title={`Return ${rr.number}`} subtitle={<span className="flex items-center gap-2">{rr.customerName} <Badge tone={RR_TONE[rr.status]}>{rr.status.toLowerCase()}</Badge></span>} back={{ href: "/sales/returns", label: "Sales returns" }} />
      <Card title="Details" className="mb-5">
        <DefList
          items={[
            ["Tax invoice", <Link key="ti" href={`/sales/invoices/${rr.taxInvoiceId}`} className="text-primary hover:underline">{rr.taxInvoice.number}</Link>],
            ["Date", fmtDate(rr.date)],
            ["Reason", rr.reason],
            ["Decision", rr.decidedAt ? `${rr.status === "REJECTED" ? "Rejected" : "Approved"} ${fmtDateTime(rr.decidedAt)} by ${nameOf(rr.decidedById)}${rr.decisionNote ? ` — ${rr.decisionNote}` : ""}` : "Waiting for Owner / Manager"],
            ["Received", rr.receivedAt ? `${fmtDateTime(rr.receivedAt)} by ${nameOf(rr.receivedById)}` : "—"],
            ["Credit note", rr.creditNote ? <Link key="cn" href={`/sales/credit-notes/${rr.creditNote.id}`} className="text-primary hover:underline">{rr.creditNote.number}</Link> : "—"],
          ]}
        />
      </Card>
      <Card title="Lines" className="mb-5" pad={false}>
        <Table>
          <thead>
            <tr><th>#</th><th>Product</th><th className="num">Asked back</th>{received && <><th className="num">Received</th><th>Condition</th><th className="num hidden sm:table-cell">Stock value</th></>}</tr>
          </thead>
          <tbody>
            {rr.items.map((i) => (
              <tr key={i.id}>
                <td className="text-muted">{i.lineNo}</td>
                <td>{i.taxInvoiceItem.product.name}</td>
                <td className="num">{fmtSqm(i.sqm)}</td>
                {received && <><td className="num">{fmtSqm(i.receivedSqm)}</td><td>{i.condition?.toLowerCase()}</td><td className="num hidden sm:table-cell">{fmtMoney(i.value)}</td></>}
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      {enabled && rr.status === "PENDING" && has("returns.approve") && (
        <Card title="Decide" className="mb-5">
          <div className="grid gap-6 md:grid-cols-2">
            <ActionForm action={decideRrAction.bind(null, rr.id, "APPROVED")} className="grid gap-3">
              <FInput id="ap-note" label="Note (optional)" name="note" />
              <div><SubmitButton pendingText="Approving…">Approve return</SubmitButton></div>
            </ActionForm>
            <ActionForm action={decideRrAction.bind(null, rr.id, "REJECTED")} className="grid gap-3">
              <FInput id="rj-note" label="Reason for rejecting" name="note" required />
              <div><SubmitButton variant="danger" pendingText="Rejecting…">Reject return</SubmitButton></div>
            </ActionForm>
          </div>
        </Card>
      )}

      {enabled && rr.status === "APPROVED" && has("returns.receive") && (
        <Card title="Goods received back" className="mb-5">
          <ActionForm action={receiveRrAction.bind(null, rr.id)} className="grid gap-4 sm:grid-cols-2">
            <FInput id="rc-date" label="Date" name="date" type="date" required defaultValue={todayIso()} />
            <div />
            {rr.items.map((i) => (
              <fieldset key={i.id} className="grid gap-3 rounded-md border border-border p-3 sm:col-span-2 sm:grid-cols-2">
                <legend className="px-1 text-xs font-medium">Line {i.lineNo} — {i.taxInvoiceItem.product.name}</legend>
                <FInput label="SQM received" name={`recv:${i.id}`} inputMode="decimal" defaultValue={i.sqm.toString()} hint={`Approved ${fmtSqm(i.sqm)}`} />
                <FSelect label="Condition" name={`cond:${i.id}`} defaultValue="GOOD" options={[{ value: "GOOD", label: "Good — back to stock" }, { value: "DAMAGED", label: "Damaged — back to stock, marked damaged" }, { value: "REJECTED", label: "Rejected — not taken back" }]} />
              </fieldset>
            ))}
            <div className="sm:col-span-2"><SubmitButton pendingText="Saving…">Record goods received</SubmitButton></div>
          </ActionForm>
        </Card>
      )}

      {enabled && rr.status === "RECEIVED" && has("creditNotes.create") && (
        <Card title="Credit the customer" className="mb-5">
          <ActionForm action={returnCnAction.bind(null, rr.id)} className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <FInput id="cn-date" label="Credit note date" name="date" type="date" required defaultValue={todayIso()} />
            <SubmitButton pendingText="Posting…">Issue return credit note</SubmitButton>
          </ActionForm>
          <p className="mt-2 text-xs text-muted">Credits the SQM accepted back (good or damaged) at the invoice prices.</p>
        </Card>
      )}
    </>
  );
}
