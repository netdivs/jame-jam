import { ActionForm, FInput, FSelect, FTextarea, SubmitButton } from "@/components/forms";
import { Card, DefList, PageHeader } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { D, prisma } from "@/server/core";
import { LIVE } from "@/server/purchase/orders";
import { fmtAED, todayIso } from "@/lib/format";
import { recordChequeAction } from "../actions";

export const metadata = { title: "Record cheque" };

export default async function NewChequePage({ searchParams }: { searchParams: Promise<{ direction?: string; pi?: string; po?: string; opening?: string }> }) {
  const sp = await searchParams;
  const issued = sp.direction === "ISSUED";
  await requirePermission(issued ? "payments.supplier" : "receipts.create");
  const pi = !issued && sp.pi ? await prisma.proformaInvoice.findUnique({ where: { id: sp.pi } }) : null;
  const [customers, pos, banks] = await Promise.all([
    issued || pi ? [] : prisma.customer.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    issued ? prisma.purchaseOrder.findMany({ where: { status: { in: LIVE } }, include: { supplier: true }, orderBy: { date: "desc" }, take: 300 }) : [],
    issued ? prisma.bankAccount.findMany({ where: { active: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] }) : [],
  ]);
  const openPos = pos.filter((p) => D(p.paidAmount).lt(p.total));
  // Issued against an opening supplier invoice (T11-01) instead of a PO.
  const opening = issued && sp.opening ? await prisma.openingItem.findUnique({ where: { id: sp.opening }, include: { supplier: true } }) : null;

  return (
    <>
      <PageHeader
        title={issued ? "Issue a post-dated cheque" : "Record a received post-dated cheque"}
        subtitle={issued ? "The PO counts it as paid only when it clears." : "Held as a customer advance; it counts as payment only when it clears."}
        back={{ href: "/pdc", label: "Post-dated cheques" }}
      />
      {opening && (
        <Card title={`For opening invoice ${opening.refNo}`} className="mb-5">
          <DefList items={[["Supplier", opening.supplier?.name ?? ""], ["Invoice", fmtAED(opening.amount)], ["Already paid", fmtAED(opening.settledAmount)]]} />
        </Card>
      )}
      {pi && (
        <Card title={`For proforma ${pi.number}`} className="mb-5">
          <DefList items={[["Customer", pi.customerName], ["Proforma total", fmtAED(pi.total)], ["Already received", fmtAED(pi.receivedAmount)]]} />
        </Card>
      )}
      <Card>
        <ActionForm action={recordChequeAction.bind(null, issued ? "ISSUED" : "RECEIVED")} className="grid gap-4 sm:grid-cols-2">
          {issued ? (
            <>
              {opening ? (
                <input type="hidden" name="openingItemId" value={opening.id} />
              ) : (
              <div className="sm:col-span-2">
                <FSelect
                  label="Purchase order"
                  name="purchaseOrderId"
                  required
                  defaultValue={sp.po}
                  placeholder="Select PO…"
                  options={openPos.map((p) => ({ value: p.id, label: `${p.number} — ${p.supplier.name} — AED ${D(p.total).minus(p.paidAmount).toFixed(2)} unpaid` }))}
                />
              </div>
              )}
              <FSelect label="Drawn on (our bank)" name="bankAccountId" required options={banks.map((b) => ({ value: b.id, label: b.name }))} />
            </>
          ) : pi ? (
            <input type="hidden" name="proformaInvoiceId" value={pi.id} />
          ) : (
            <div className="sm:col-span-2">
              <FSelect label="Customer" name="customerId" required placeholder="Select customer…" options={customers.map((c) => ({ value: c.id, label: `${c.name} (${c.code})` }))} />
            </div>
          )}
          <FInput label="Cheque number" name="chequeNo" required />
          {!issued && <FInput label="Bank" name="bankName" placeholder="Customer's bank" />}
          {!issued && <FInput label="Branch" name="branch" />}
          <FInput label="Amount (AED)" name="amount" inputMode="decimal" required />
          <FInput label="Received / issued on" name="issueDate" type="date" required defaultValue={todayIso()} />
          <FInput label="Cheque date (due)" name="dueDate" type="date" required />
          <div className="sm:col-span-2">
            <FTextarea label="Remarks" name="remarks" rows={2} />
          </div>
          <div className="sm:col-span-2">
            <SubmitButton pendingText="Recording…">{issued ? "Issue cheque" : "Record cheque"}</SubmitButton>
          </div>
        </ActionForm>
      </Card>
    </>
  );
}
