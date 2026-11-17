// Purchase UI helpers (server-safe).
import { Badge, type Tone } from "@/components/ui";
import { prisma } from "@/server/core";
import { titleCase } from "@/lib/format";

const PO_TONE: Record<string, Tone> = {
  DRAFT: "neutral",
  PENDING_APPROVAL: "warning",
  APPROVED: "info",
  PARTIALLY_RECEIVED: "info",
  RECEIVED: "success",
  CLOSED: "neutral",
  CANCELLED: "danger",
};
const PAY_TONE: Record<string, Tone> = { UNPAID: "danger", PARTIAL: "warning", PAID: "success" };
const SHIP_TONE: Record<string, Tone> = { ORDERED: "neutral", IN_TRANSIT: "info", AT_PORT: "warning", COLLECTED: "info", RECEIVED: "success" };

export const PoStatus = ({ s }: { s: string }) => <Badge tone={PO_TONE[s]}>{titleCase(s)}</Badge>;
export const PayStatus = ({ s }: { s: string }) => <Badge tone={PAY_TONE[s]}>{titleCase(s)}</Badge>;
export const ShipStatus = ({ s }: { s: string }) => <Badge tone={SHIP_TONE[s]}>{titleCase(s)}</Badge>;
/** Landed cost expense allocation status. */
export const ExpStatus = ({ s }: { s: string }) =>
  s === "ALLOCATED" ? <Badge tone="success">Allocated</Badge> : <Badge tone="warning">Pending allocation</Badge>;

/** Options for the PO editor. */
export async function poFormOptions() {
  const [suppliers, products, taxes] = await Promise.all([
    prisma.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.product.findMany({ where: { active: true }, orderBy: { itemCode: "asc" } }),
    prisma.taxCode.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
  ]);
  return {
    suppliers: suppliers.map((s) => ({ value: s.id, label: `${s.name} (${s.code})`, type: s.supplierType })),
    products: products.map((p) => ({ value: p.id, label: `${p.itemCode} — ${p.name}`, taxCodeId: p.defaultTaxCodeId })),
    taxes: taxes.map((t) => ({ value: t.id, label: `${t.code} — ${t.name}`, rate: Number(t.rate), type: t.type })),
    defaultTaxId: taxes.find((t) => t.code === "SR")?.id ?? taxes[0]?.id ?? "",
  };
}
