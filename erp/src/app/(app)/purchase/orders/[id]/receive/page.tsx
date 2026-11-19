import { notFound } from "next/navigation";
import { Card, LinkButton, PageHeader } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { D, prisma } from "@/server/core";
import { isPaidAndVerified, needsPaymentBeforeReceipt } from "@/server/purchase/orders";
import { getSetting } from "@/server/settings";
import { fmtMoney, todayIso } from "@/lib/format";
import { GrnForm } from "./grn-form";

export const metadata = { title: "Receive goods" };

export default async function ReceivePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("purchase.receive");
  const { id } = await params;
  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: { supplier: true, items: { orderBy: { lineNo: "asc" }, include: { product: true } }, shipments: { where: { status: "COLLECTED" } } },
  });
  if (!po) notFound();
  const back = { href: `/purchase/orders/${id}`, label: po.number };

  let blocked = "";
  if (!["APPROVED", "PARTIALLY_RECEIVED"].includes(po.status)) blocked = "This PO is not open for receiving.";
  else if (!needsPaymentBeforeReceipt(po, await getSetting("purchase.receiveBeforePayment"))) blocked = "";
  else if (D(po.paidAmount).lt(po.total)) blocked = `Blocked: the supplier is paid AED ${fmtMoney(po.paidAmount)} of AED ${fmtMoney(po.total)}. Goods are received only after 100% payment.`;
  else if (!isPaidAndVerified(po)) blocked = "Blocked: the 100% payment has not been verified yet.";

  const open = po.items.filter((i) => D(i.sqm).gt(i.receivedSqm));
  if (blocked || open.length === 0) {
    return (
      <>
        <PageHeader title={`Receive goods — ${po.number}`} back={back} />
        <Card>
          <p className="text-sm">{blocked || "Everything on this PO has been received."}</p>
          <LinkButton href={back.href} variant="secondary" className="mt-3">Back to PO</LinkButton>
        </Card>
      </>
    );
  }

  const warehouses = await prisma.warehouse.findMany({ where: { active: true }, orderBy: { code: "asc" } });
  return (
    <>
      <PageHeader
        title={`Receive goods — ${po.number}`}
        subtitle={`${po.supplier.name}. Creates a lot per line (blocks → slabs, or tile SQM) at the PO price; posts Dr Inventory / Cr Goods Received Not Invoiced.`}
        back={back}
      />
      <GrnForm
        poId={po.id}
        items={open.map((i) => ({
          id: i.id,
          lineNo: i.lineNo,
          label: `${i.product.itemCode} — ${i.product.name}`,
          isSlab: i.product.type === "SLAB",
          openSqm: Number(D(i.sqm).minus(i.receivedSqm)),
          unitPrice: fmtMoney(i.unitPrice),
        }))}
        shipments={po.shipments.map((s) => ({ value: s.id, label: `${s.number}${s.reference ? ` · ${s.reference}` : ""}` }))}
        warehouses={warehouses.map((w) => ({ value: w.id, label: w.name }))}
        shipmentRequired={po.supplier.supplierType === "IMPORT"}
        canOverrideSqm={user.ctx.permissions.has("inventory.editSlabSqm")}
        defaultDate={todayIso()}
      />
    </>
  );
}
