import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/core";
import { isoDate } from "@/lib/format";
import { stockOptions } from "@/server/sales/queries";
import { SoForm } from "../../so-form";
import { soFormOptions } from "../../../shared";

export default async function EditSoPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("sales.edit");
  const { id } = await params;
  const so = await prisma.salesOrder.findUnique({ where: { id }, include: { items: { orderBy: { lineNo: "asc" } } } });
  if (!so) notFound();
  if (so.status !== "OPEN") redirect(`/sales/orders/${id}`);
  const { defaultPriceMode: _d, ...opts } = await soFormOptions();
  const productIds = [...new Set(so.items.map((i) => i.productId))];
  const initialStock = Object.fromEntries(await Promise.all(productIds.map(async (p) => [p, await stockOptions(user.ctx, p, id)] as const)));
  // Products on the order stay selectable even if nothing else of them is in stock.
  const missing = productIds.filter((p) => !opts.products.some((o) => o.value === p));
  if (missing.length) {
    const extra = await prisma.product.findMany({ where: { id: { in: missing } } });
    opts.products.push(...extra.map((p) => ({ value: p.id, label: `${p.itemCode} — ${p.name}`, taxCodeId: p.defaultTaxCodeId ?? opts.defaultTaxId })));
  }
  return (
    <>
      <PageHeader title={`Edit ${so.number}`} subtitle="Saving adjusts the stock reservations to match." back={{ href: `/sales/orders/${id}`, label: so.number }} />
      <SoForm
        id={id}
        initial={{
          customerId: so.customerId,
          date: isoDate(so.date),
          priceMode: so.priceMode,
          discount: so.discount.isZero() ? "" : so.discount.toString(),
          notes: so.notes ?? "",
          lines: so.items.map((i) => ({
            id: i.id,
            productId: i.productId,
            balanceId: i.balanceId,
            description: i.description ?? "",
            sqm: i.sqm.toString(),
            unitPrice: i.unitPrice.toString(),
            discount: i.discount.isZero() ? "" : i.discount.toString(),
            taxCodeId: i.taxCodeId,
            taxReason: i.taxReason ?? "",
          })),
        }}
        initialStock={initialStock}
        canChangeTax={user.ctx.permissions.has("taxCode.change")}
        {...opts}
      />
    </>
  );
}
