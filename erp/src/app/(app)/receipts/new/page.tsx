import Link from "next/link";
import { ActionForm, FInput, FSelect, FTextarea, SubmitButton } from "@/components/forms";
import { Card, DefList, PageHeader } from "@/components/ui";
import { PaidFromSelect } from "@/components/paid-from";
import { requirePermission } from "@/server/auth";
import { D, prisma } from "@/server/core";
import { effectivePiStatus } from "@/server/sales/proformas";
import { fmtAED, fmtDate, todayIso } from "@/lib/format";
import { receiptAction } from "../actions";

export const metadata = { title: "Record receipt" };

export default async function NewReceiptPage({ searchParams }: { searchParams: Promise<{ pi?: string; ti?: string }> }) {
  await requirePermission("receipts.create");
  const { pi: piId, ti: tiId } = await searchParams;
  const pi = piId ? await prisma.proformaInvoice.findUnique({ where: { id: piId }, include: { salesOrder: { select: { number: true } } } }) : null;
  const ti = !pi && tiId ? await prisma.taxInvoice.findUnique({ where: { id: tiId } }) : null;
  const customers = pi || ti ? [] : await prisma.customer.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  const open = pi ? D(pi.total).minus(pi.receivedAmount) : ti ? D(ti.total).minus(ti.settledAmount) : null;
  const status = pi ? effectivePiStatus(pi) : null;

  return (
    <>
      <PageHeader
        title="Record customer receipt"
        subtitle="The amount is held as a customer advance until a tax invoice takes it."
        back={pi ? { href: `/sales/proformas/${pi.id}`, label: pi.number } : ti ? { href: `/sales/invoices/${ti.id}`, label: ti.number } : { href: "/receipts", label: "Customer receipts" }}
      />
      {pi && (
        <Card title={`Against proforma ${pi.number}`} className="mb-5">
          <DefList
            items={[
              ["Customer", pi.customerName],
              ["Sales order", pi.salesOrder.number],
              ["Proforma total", fmtAED(pi.total)],
              ["Already received", fmtAED(pi.receivedAmount)],
              ["Valid until", `${fmtDate(pi.expiryDate)}${status === "EXPIRED" ? " — expired, renew it first" : ""}`],
            ]}
          />
        </Card>
      )}
      {ti && (
        <Card title={`Payment of tax invoice ${ti.number}`} className="mb-5">
          <DefList
            items={[
              ["Customer", ti.customerName],
              ["Invoice total", fmtAED(ti.total)],
              ["Already paid", fmtAED(ti.settledAmount)],
              ["The receipt is applied to the invoice at once", "Paid in full unlocks the delivery note."],
            ]}
          />
        </Card>
      )}
      <Card>
        <ActionForm action={receiptAction} className="grid gap-4 sm:grid-cols-2">
          {pi ? (
            <input type="hidden" name="proformaInvoiceId" value={pi.id} />
          ) : ti ? (
            <input type="hidden" name="taxInvoiceId" value={ti.id} />
          ) : (
            <div className="sm:col-span-2">
              <FSelect label="Customer" name="customerId" required placeholder="Select customer…" options={customers.map((c) => ({ value: c.id, label: `${c.name} (${c.code})` }))} />
              <p className="mt-1 text-xs text-muted">
                Paying against a proforma? Open the proforma and use <span className="font-medium">Record receipt</span> there, or see <Link href="/sales/proformas" className="text-primary hover:underline">proformas</Link>.
              </p>
            </div>
          )}
          <FInput label="Date" name="date" type="date" required defaultValue={todayIso()} />
          <FInput label="Amount (AED)" name="amount" inputMode="decimal" required defaultValue={open && open.gt(0) ? open.toFixed(2) : ""} hint={open ? `Up to ${open.toFixed(2)} on this ${pi ? "proforma" : "invoice"}` : undefined} />
          <PaidFromSelect label="Received into" />
          <FInput label="Reference" name="reference" placeholder="TT / cheque / slip no." />
          <div className="sm:col-span-2">
            <FTextarea label="Notes" name="notes" rows={2} />
          </div>
          <div className="sm:col-span-2">
            <SubmitButton pendingText="Recording…">Record receipt</SubmitButton>
          </div>
        </ActionForm>
      </Card>
    </>
  );
}
