import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, FInput, SubmitButton } from "@/components/forms";
import { Badge, Card, DefList, PageHeader, Table, FileButton } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { D, prisma } from "@/server/core";
import { fmtAED, fmtDate, fmtDateTime, fmtMoney, todayIso } from "@/lib/format";
import { cancelRefundAction } from "../actions";

export default async function RefundDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("accounts.view");
  const { id } = await params;
  const r = await prisma.refund.findUnique({ where: { id }, include: { customer: true, supplier: true, bankAccount: true, proformaInvoice: true, purchaseOrder: true } });
  if (!r) notFound();
  const entries = await prisma.journalEntry.findMany({
    where: { sourceId: r.id, sourceType: { in: ["REFUND", "REFUND_CANCEL"] } },
    include: { lines: { include: { account: true } } },
    orderBy: { createdAt: "asc" },
  });
  const party = r.customer?.name ?? r.supplier?.name ?? "";
  const toCustomer = r.partyType === "CUSTOMER";

  return (
    <>
      <PageHeader
        title={`Refund ${r.number}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {toCustomer ? `Paid to ${party}` : `Received from ${party}`} · {fmtAED(r.amount)} {r.status === "POSTED" ? <Badge tone="success">Posted</Badge> : <Badge tone="danger">Cancelled</Badge>}
          </span>
        }
        back={{ href: "/refunds", label: "Refunds" }}
      />
      <div className="-mt-2 mb-4 flex flex-wrap gap-2 print:hidden"><FileButton href={`/api/print/refund/${r.id}`} target="_blank" rel="noopener">PDF</FileButton></div>
      <Card title="Details" className="mb-5">
        <DefList
          items={[
            [toCustomer ? "Customer" : "Supplier", party],
            ["Date", fmtDate(r.date)],
            ["Amount", fmtAED(r.amount)],
            [toCustomer ? "Paid from" : "Received into", r.mode === "CASH" ? "Cash" : `${r.bankAccount?.name ?? "Bank"}${r.bankAccount?.bankName ? ` (${r.bankAccount.bankName})` : ""}`],
            ["Reference", r.reference ?? "—"],
            [
              "For",
              r.proformaInvoice ? (
                <Link key="pi" className="text-primary hover:underline" href={`/sales/proformas/${r.proformaInvoice.id}`}>Proforma {r.proformaInvoice.number}</Link>
              ) : r.purchaseOrder ? (
                <Link key="po" className="text-primary hover:underline" href={`/purchase/orders/${r.purchaseOrder.id}`}>Advance left on PO {r.purchaseOrder.number}</Link>
              ) : (
                "General customer advance"
              ),
            ],
            ["Reason", r.reason],
            ...(r.status === "CANCELLED" ? ([["Cancelled", `${r.cancelledAt ? fmtDateTime(r.cancelledAt) : ""} — ${r.cancelReason ?? ""}`]] as [string, string][]) : []),
          ]}
        />
      </Card>
      {entries.map((e) => (
        <Card key={e.id} title={<Link href={`/accounts/journals/${e.id}`} className="font-mono text-primary hover:underline">{e.number}</Link>} className="mb-5" pad={false}>
          <Table>
            <tbody>
              {e.lines.map((l) => (
                <tr key={l.id}>
                  <td className="w-20 font-mono text-xs">{l.account.code}</td>
                  <td>{l.account.name}</td>
                  <td className="num">{D(l.debit).gt(0) ? fmtMoney(l.debit) : ""}</td>
                  <td className="num">{D(l.credit).gt(0) ? fmtMoney(l.credit) : ""}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      ))}
      {r.status === "POSTED" && user.ctx.permissions.has("refunds.cancel") && (
        <Card title="Cancel this refund" className="mb-5">
          <ActionForm action={cancelRefundAction.bind(null, r.id)} className="grid gap-4 sm:grid-cols-[180px_1fr_auto] sm:items-end">
            <FInput label="Cancellation date" name="date" type="date" required defaultValue={todayIso()} />
            <FInput label="Reason" name="reason" required placeholder="e.g. Transfer returned by the bank" />
            <SubmitButton variant="danger" pendingText="Cancelling…">Cancel refund</SubmitButton>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
