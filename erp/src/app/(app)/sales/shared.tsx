// Sales UI helpers (server-safe).
import type { PiStatus as PiStatusT, Prisma } from "@prisma/client";
import { Badge, type Tone } from "@/components/ui";
import { prisma } from "@/server/core";
import { titleCase } from "@/lib/format";
import { effectivePiStatus } from "@/server/sales/proformas";

const SO_TONE: Record<string, Tone> = {
  OPEN: "info",
  PARTIALLY_INVOICED: "warning",
  INVOICED: "success",
  DELIVERED: "success",
  CLOSED: "neutral",
  CANCELLED: "danger",
  EXPIRED: "danger",
};
const PI_TONE: Record<string, Tone> = { ACTIVE: "info", EXPIRED: "danger", CONVERTED: "success", CLOSED: "neutral", CANCELLED: "danger" };

export const SoStatus = ({ s }: { s: string }) => <Badge tone={SO_TONE[s]}>{s === "OPEN" ? "Open (reserved)" : titleCase(s)}</Badge>;

/** PI status as the user should see it: an active PI past its expiry date shows as Expired. */
export const PiStatus = ({ pi }: { pi: { status: PiStatusT; expiryDate: Date; receivedAmount?: Prisma.Decimal } }) => {
  const s = effectivePiStatus(pi);
  return <Badge tone={PI_TONE[s]}>{titleCase(s)}</Badge>;
};

export const priceModeLabel = (m: string) => (m === "INCLUSIVE" ? "VAT-inclusive" : "VAT-exclusive");

/** Options for the SO editor. */
export async function soFormOptions() {
  const [customers, products, taxes, settings] = await Promise.all([
    prisma.customer.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.product.findMany({ where: { active: true, balances: { some: { onHandSqm: { gt: 0 } } } }, orderBy: { itemCode: "asc" } }),
    prisma.taxCode.findMany({ where: { active: true, type: { not: "RC" } }, orderBy: { code: "asc" } }),
    prisma.companySetting.findUniqueOrThrow({ where: { id: 1 } }),
  ]);
  const sr = taxes.find((t) => t.type === "SR");
  return {
    customers: customers.map((c) => ({ value: c.id, label: `${c.name} (${c.code})` })),
    products: products.map((p) => ({ value: p.id, label: `${p.itemCode} — ${p.name}`, taxCodeId: p.defaultTaxCodeId && taxes.some((t) => t.id === p.defaultTaxCodeId) ? p.defaultTaxCodeId : (sr?.id ?? "") })),
    taxes: taxes.map((t) => ({ value: t.id, label: `${t.code} — ${t.name}`, rate: t.type === "SR" ? t.rate.toString() : "0", type: t.type })),
    defaultTaxId: sr?.id ?? "",
    defaultPriceMode: settings.defaultPriceMode,
  };
}
