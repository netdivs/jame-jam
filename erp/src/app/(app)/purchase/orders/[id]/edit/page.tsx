import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/core";
import { isoDate } from "@/lib/format";
import { PoForm } from "../../po-form";
import { poFormOptions } from "../../../shared";

export default async function EditPoPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("purchase.edit");
  const { id } = await params;
  const po = await prisma.purchaseOrder.findUnique({ where: { id }, include: { items: { orderBy: { lineNo: "asc" } } } });
  if (!po) notFound();
  if (po.status !== "DRAFT") redirect(`/purchase/orders/${id}`);
  const opts = await poFormOptions();
  return (
    <>
      <PageHeader title={`Edit ${po.number}`} back={{ href: `/purchase/orders/${id}`, label: po.number }} />
      <PoForm
        id={id}
        initial={{
          supplierId: po.supplierId,
          date: isoDate(po.date),
          expectedDate: po.expectedDate ? isoDate(po.expectedDate) : "",
          terms: po.terms ?? "",
          notes: po.notes ?? "",
          refCurrency: po.refCurrency ?? "",
          refRate: po.refRate?.toString() ?? "",
          lines: po.items.map((i) => ({
            productId: i.productId,
            description: i.description ?? "",
            sqm: i.sqm.toString(),
            unitPrice: i.unitPrice.toString(),
            taxCodeId: i.taxCodeId,
            taxReason: i.taxReason ?? "",
          })),
        }}
        {...opts}
      />
    </>
  );
}
