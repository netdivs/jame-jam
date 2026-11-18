import { notFound } from "next/navigation";
import { Card, LinkButton, PageHeader } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { D, prisma } from "@/server/core";
import { todayIso } from "@/lib/format";
import { InvoiceForm } from "./invoice-form";

export const metadata = { title: "Supplier invoice" };

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("purchase.invoice");
  const { id } = await params;
  const po = await prisma.purchaseOrder.findUnique({ where: { id }, include: { supplier: true, items: { orderBy: { lineNo: "asc" }, include: { product: true } } } });
  if (!po) notFound();
  const back = { href: `/purchase/orders/${id}`, label: po.number };
  const open = po.items.filter((i) => D(i.receivedSqm).gt(i.invoicedSqm));
  if (open.length === 0) {
    return (
      <>
        <PageHeader title={`Supplier invoice — ${po.number}`} back={back} />
        <Card>
          <p className="text-sm">Nothing to invoice: only received goods can be invoiced, and everything received is already invoiced.</p>
          <LinkButton href={back.href} variant="secondary" className="mt-3">Back to PO</LinkButton>
        </Card>
      </>
    );
  }
  const taxes = await prisma.taxCode.findMany({ where: { active: true }, orderBy: { code: "asc" } });
  return (
    <>
      <PageHeader title={`Supplier invoice — ${po.number}`} subtitle={`${po.supplier.name}. Invoice numbers must be unique per supplier.`} back={back} />
      <InvoiceForm
        poId={po.id}
        items={open.map((i) => ({
          id: i.id,
          lineNo: i.lineNo,
          label: `${i.product.itemCode} — ${i.product.name}`,
          openSqm: D(i.receivedSqm).minus(i.invoicedSqm).toString(),
          poPrice: D(i.unitPrice).toString(),
          taxCodeId: i.taxCodeId,
        }))}
        taxes={taxes.map((t) => ({ value: t.id, label: `${t.code} — ${t.name}`, rate: Number(t.rate), type: t.type }))}
        defaultDate={todayIso()}
        importSupplier={po.supplier.supplierType === "IMPORT"}
      />
    </>
  );
}
