import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, FInput, SubmitButton } from "@/components/forms";
import { Badge, Card, DefList, PageHeader, Table, FileButton } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { D, prisma } from "@/server/core";
import { fmtAED, fmtDate, fmtDateTime, fmtMoney, todayIso } from "@/lib/format";
import { cancelReceiptAction } from "../actions";

export default async function ReceiptDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("receipts.view");
  const { id } = await params;
  const r = await prisma.customerReceipt.findUnique({ where: { id }, include: { customer: true, bankAccount: true, proformaInvoice: { include: { salesOrder: { select: { id: true, number: true } } } } } });
  if (!r) notFound();
  const entries = await prisma.journalEntry.findMany({
    where: { sourceId: r.id, sourceType: { in: ["CUSTOMER_RECEIPT", "CUSTOMER_RECEIPT_CANCEL"] } },
    include: { lines: { include: { account: true } } },
    orderBy: { createdAt: "asc" },
  });
  const showGl = user.ctx.permissions.has("accounts.view");

  return (
    <>
      <PageHeader
        title={`${r.mode === "CASH" ? "Cash receipt" : "Bank receipt"} ${r.number}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {r.customer.name} · {fmtAED(r.amount)} {r.status === "POSTED" ? <Badge tone="success">Posted</Badge> : <Badge tone="danger">Cancelled</Badge>}
          </span>
        }
        back={{ href: "/receipts", label: "Customer receipts" }}
      />
      <div className="-mt-2 mb-4 flex flex-wrap gap-2 print:hidden"><FileButton href={`/api/print/receipt/${r.id}`} target="_blank" rel="noopener">PDF</FileButton></div>
      <Card title="Details" className="mb-5">
        <DefList
          items={[
            ["Customer", r.customer.name],
            ["Date", fmtDate(r.date)],
            ["Amount", fmtAED(r.amount)],
            ["Received into", r.mode === "CASH" ? "Cash" : `${r.bankAccount?.name ?? "Bank"}${r.bankAccount?.bankName ? ` (${r.bankAccount.bankName})` : ""}`],
            ["Reference", r.reference ?? "—"],
            [
              "For",
              r.proformaInvoice ? (
                <span key="pi">
                  Proforma <Link className="text-primary hover:underline" href={`/sales/proformas/${r.proformaInvoice.id}`}>{r.proformaInvoice.number}</Link> · SO{" "}
                  <Link className="text-primary hover:underline" href={`/sales/orders/${r.proformaInvoice.salesOrder.id}`}>{r.proformaInvoice.salesOrder.number}</Link>
                </span>
              ) : (
                "General advance"
              ),
            ],
            ["Applied to invoices", D(r.allocatedAmount).gt(0) ? fmtAED(r.allocatedAmount) : "Not yet — tax invoices come with T5-06"],
            ["Notes", r.notes ?? "—"],
            ...(r.status === "CANCELLED" ? ([["Cancelled", `${r.cancelledAt ? fmtDateTime(r.cancelledAt) : ""} — ${r.cancelReason ?? ""}`]] as [string, string][]) : []),
          ]}
        />
      </Card>
      {showGl &&
        entries.map((e) => (
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
      {r.status === "POSTED" && D(r.allocatedAmount).isZero() && user.ctx.permissions.has("receipts.cancel") && (
        <Card title="Cancel this receipt" className="mb-5">
          <ActionForm action={cancelReceiptAction.bind(null, r.id)} className="grid gap-4 sm:grid-cols-[180px_1fr_auto] sm:items-end">
            <FInput label="Cancellation date" name="date" type="date" required defaultValue={todayIso()} />
            <FInput label="Reason" name="reason" required placeholder="e.g. Cheque returned / entered twice" />
            <SubmitButton variant="danger" pendingText="Cancelling…">Cancel receipt</SubmitButton>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
