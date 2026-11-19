import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, FInput, FSelect, SubmitButton } from "@/components/forms";
import { Card, DefList, PageHeader } from "@/components/ui";
import { PaidFromSelect } from "@/components/paid-from";
import { requirePermission } from "@/server/auth";
import { D, Dec, prisma } from "@/server/core";
import { customerAdvancePosition } from "@/server/refunds/refunds";
import { fmtAED, todayIso } from "@/lib/format";
import { refundAction } from "../actions";

export const metadata = { title: "Record refund" };

export default async function NewRefundPage({ searchParams }: { searchParams: Promise<{ pi?: string; customer?: string; po?: string }> }) {
  await requirePermission("refunds.create");
  const sp = await searchParams;

  // Supplier refund: the advance left on a closed PO.
  if (sp.po) {
    const po = await prisma.purchaseOrder.findUnique({ where: { id: sp.po }, include: { supplier: true } });
    if (!po) notFound();
    return (
      <>
        <PageHeader title="Refund from supplier" subtitle="The supplier pays back the advance left on this PO." back={{ href: `/purchase/orders/${po.id}`, label: po.number }} />
        <Card title={`PO ${po.number}`} className="mb-5">
          <DefList
            items={[
              ["Supplier", po.supplier.name],
              ["Status", po.status === "CLOSED" ? "Closed (all goods received and invoiced)" : `${po.status} — only a closed PO's advance can be refunded`],
              ["Advance left", fmtAED(po.advanceBalance)],
            ]}
          />
        </Card>
        <Card>
          <ActionForm action={refundAction} className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="purchaseOrderId" value={po.id} />
            <FInput label="Date" name="date" type="date" required defaultValue={todayIso()} />
            <FInput label="Amount (AED)" name="amount" inputMode="decimal" required defaultValue={D(po.advanceBalance).gt(0) ? D(po.advanceBalance).toFixed(2) : ""} />
            <PaidFromSelect label="Received into" />
            <FInput label="Reference" name="reference" placeholder="TT / cheque no." />
            <div className="sm:col-span-2">
              <FInput label="Reason" name="reason" required placeholder="e.g. Invoice lower than the amount paid" />
            </div>
            <div className="sm:col-span-2">
              <SubmitButton pendingText="Recording…">Record refund</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      </>
    );
  }

  // Customer refund: from a proforma, or from the customer's free advance.
  const pi = sp.pi ? await prisma.proformaInvoice.findUnique({ where: { id: sp.pi }, include: { salesOrder: { select: { number: true } } } }) : null;
  if (sp.pi && !pi) notFound();
  const customerId = pi?.customerId ?? sp.customer;
  const customer = customerId ? await prisma.customer.findUnique({ where: { id: customerId } }) : null;
  const pos = customer ? await customerAdvancePosition(customer.id) : null;
  const customers = customer ? [] : await prisma.customer.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  const cap = pi ? D(pi.receivedAmount) : pos ? Dec.max(pos.free, 0) : null;

  return (
    <>
      <PageHeader
        title="Refund to customer"
        subtitle="Pays back money held as a customer advance. A refund is final; a wrong one is cancelled with a reason."
        back={pi ? { href: `/sales/proformas/${pi.id}`, label: pi.number } : { href: "/refunds", label: "Refunds" }}
      />
      {customer && pos && (
        <Card title={pi ? `From proforma ${pi.number}` : customer.name} className="mb-5">
          <DefList
            items={[
              ["Customer", customer.name],
              ...(pi ? ([["Sales order", pi.salesOrder.number], ["Received on this proforma", fmtAED(pi.receivedAmount)]] as [string, string][]) : []),
              ["Customer advance", fmtAED(pos.balance)],
              ["Cheques not yet cleared", fmtAED(pos.pendingCheques)],
              ["Held on proformas", fmtAED(pos.onProformas)],
              ["Free advance", fmtAED(Dec.max(pos.free, 0))],
            ]}
          />
          {!pi && pos.onProformas.gt(0) && <p className="mt-3 text-xs text-muted">Money held on a proforma is refunded from that proforma (open it and use Refund).</p>}
        </Card>
      )}
      <Card>
        <ActionForm action={refundAction} className="grid gap-4 sm:grid-cols-2">
          {pi && <input type="hidden" name="proformaInvoiceId" value={pi.id} />}
          {customer ? (
            <input type="hidden" name="customerId" value={customer.id} />
          ) : (
            <div className="sm:col-span-2">
              <FSelect label="Customer" name="customerId" required placeholder="Select customer…" options={customers.map((c) => ({ value: c.id, label: `${c.name} (${c.code})` }))} />
              <p className="mt-1 text-xs text-muted">
                Refunding money paid against a proforma? Open the <Link href="/sales/proformas" className="text-primary hover:underline">proforma</Link> and use Refund there.
              </p>
            </div>
          )}
          <FInput label="Date" name="date" type="date" required defaultValue={todayIso()} />
          <FInput label="Amount (AED)" name="amount" inputMode="decimal" required defaultValue={cap && cap.gt(0) ? cap.toFixed(2) : ""} hint={cap ? `Up to ${cap.toFixed(2)}` : undefined} />
          <PaidFromSelect label="Paid from" />
          <FInput label="Reference" name="reference" placeholder="TT / cheque no." />
          <div className="sm:col-span-2">
            <FInput label="Reason" name="reason" required placeholder="e.g. Order cancelled by customer" />
          </div>
          <div className="sm:col-span-2">
            <SubmitButton pendingText="Recording…">Record refund</SubmitButton>
          </div>
        </ActionForm>
      </Card>
    </>
  );
}
