// Sales order reservation expiry and extension (spec §3.3.1, T5-03). Client decision C2 is PENDING: built on the
// proposal behind setting sales.reservationAutoExpire (default off = reservations never expire, as before).
//  - Validity: the SO's reservationExpiresAt if an Owner/Manager extended it, else SO date + soReservationDays.
//    Valid up to and including that date.
//  - Only OPEN orders expire (nothing invoiced yet): invoiced stock is the customer's and waits for the DN.
//  - An order whose proformas hold money or open cheques never expires (C2 proposal; also TD-025: such a proforma
//    cannot be closed).
//  - Expiry releases every active reservation (status EXPIRED), closes the live proformas, SO → EXPIRED. Audited.
import { z } from "zod";
import { AppError, Ctx, Tx, assertCan, audit, inTx, prisma, systemCtx, toDateOnly, today } from "../core";
import { releaseReservation } from "../inventory/stock";
import { dateStr, optText, parse } from "../validation";
import { getSetting } from "../settings";
import { lockSo, soStatusLabel } from "./orders";
import { addDays } from "./proformas";

type Db = Tx | typeof prisma;

/** Last day the reservation is valid. */
export function reservationValidUntil(so: { date: Date; reservationExpiresAt: Date | null }, days: number): Date {
  return so.reservationExpiresAt ?? addDays(so.date, days);
}

/** Does money held on the order's proformas protect it from expiry? */
async function holdsMoney(db: Db, soId: string) {
  const [pis, cheques] = await Promise.all([
    db.proformaInvoice.count({ where: { salesOrderId: soId, receivedAmount: { gt: 0 } } }),
    db.cheque.count({ where: { proformaInvoice: { salesOrderId: soId }, status: { in: ["RECEIVED", "DEPOSITED"] } } }),
  ]);
  return pis + cheques > 0;
}

/** Open orders and their validity, for the job, the dashboard and the SO page. */
export async function openReservations(db: Db = prisma) {
  const days = (await db.companySetting.findUniqueOrThrow({ where: { id: 1 } })).soReservationDays;
  const sos = await db.salesOrder.findMany({ where: { status: "OPEN" }, select: { id: true, number: true, customerName: true, date: true, reservationExpiresAt: true, total: true }, orderBy: { date: "asc" } });
  const out = [];
  for (const so of sos) out.push({ ...so, validUntil: reservationValidUntil(so, days), protected: await holdsMoney(db, so.id) });
  return out;
}

/** Orders whose reservation ends within the reminder days (dashboard). Empty when auto-expiry is off. */
export async function reservationsExpiring(asOf: Date = today()) {
  if (!(await getSetting("sales.reservationAutoExpire"))) return [];
  const within = await getSetting("sales.reservationReminderDays");
  const limit = addDays(asOf, within);
  return (await openReservations()).filter((r) => !r.protected && r.validUntil >= asOf && r.validUntil <= limit);
}

/** The nightly job. Idempotent: an expired order is no longer OPEN. */
export async function expireSalesOrders(asOf: Date = today(), ctx: Ctx = systemCtx): Promise<{ enabled: boolean; expired: string[]; protectedOrders: number }> {
  if (!(await getSetting("sales.reservationAutoExpire"))) return { enabled: false, expired: [], protectedOrders: 0 };
  const due = (await openReservations()).filter((r) => r.validUntil < asOf);
  const expired: string[] = [];
  for (const r of due.filter((d) => !d.protected)) {
    const done = await inTx(async (tx) => {
      const so = await lockSo(tx, r.id);
      if (so.status !== "OPEN") return false;
      const days = (await tx.companySetting.findUniqueOrThrow({ where: { id: 1 } })).soReservationDays;
      const until = reservationValidUntil(so, days);
      if (until >= asOf) return false; // extended meanwhile
      if (await holdsMoney(tx, so.id)) return false;
      const pis = await tx.$queryRaw<{ id: string; status: string }[]>`SELECT "id", "status" FROM "ProformaInvoice" WHERE "salesOrderId" = ${so.id} AND "status" IN ('ACTIVE', 'EXPIRED') ORDER BY "id" FOR UPDATE`;
      for (const it of so.items) {
        if (!it.reservationId) continue;
        const res = await tx.stockReservation.findUniqueOrThrow({ where: { id: it.reservationId } });
        if (res.status === "ACTIVE") await releaseReservation(tx, ctx, { reservationId: res.id, reason: `SO ${so.number} reservation expired on ${until.toISOString().slice(0, 10)}`, expired: true });
      }
      for (const pi of pis) {
        await tx.proformaInvoice.update({ where: { id: pi.id }, data: { status: "CLOSED", closeReason: `SO ${so.number} reservation expired` } });
        await audit(tx, ctx, { action: "close", entity: "ProformaInvoice", entityId: pi.id, before: { status: pi.status }, after: { status: "CLOSED" }, meta: { viaSalesOrderExpiry: so.number } });
      }
      await tx.salesOrder.update({ where: { id: so.id }, data: { status: "EXPIRED" } });
      await audit(tx, ctx, { action: "expire", entity: "SalesOrder", entityId: so.id, before: { status: "OPEN" }, after: { status: "EXPIRED" }, meta: { validUntil: until, asOf } });
      return true;
    });
    if (done) expired.push(r.number);
  }
  return { enabled: true, expired, protectedOrders: due.filter((d) => d.protected).length };
}

const extendSchema = z.object({ until: dateStr, reason: optText(500) });

/** Owner/Manager move the validity of an open order's reservation (spec §5 "extend SO"). Audited. */
export async function extendReservation(ctx: Ctx, soId: string, raw: unknown) {
  assertCan(ctx, "sales.extendReservation");
  const input = parse(extendSchema, raw);
  const until = toDateOnly(input.until);
  if (until < today()) throw new AppError("VALIDATION", "The new date cannot be in the past", { fields: { until: "Today or later" } });
  if (until > addDays(today(), 365)) throw new AppError("VALIDATION", "At most one year ahead", { fields: { until: "Within a year" } });
  return inTx(async (tx) => {
    const so = await lockSo(tx, soId);
    if (so.status !== "OPEN") throw new AppError("VALIDATION", `SO ${so.number} is ${soStatusLabel(so.status)}; only an open order's reservation can be extended`);
    const days = (await tx.companySetting.findUniqueOrThrow({ where: { id: 1 } })).soReservationDays;
    const before = reservationValidUntil(so, days);
    const after = await tx.salesOrder.update({ where: { id: soId }, data: { reservationExpiresAt: until } });
    await audit(tx, ctx, { action: "extendReservation", entity: "SalesOrder", entityId: soId, before: { validUntil: before }, after: { validUntil: until, reason: input.reason } });
    return after;
  });
}

export const reservationDaysLeft = (until: Date, asOf: Date = today()) => Math.round((until.getTime() - asOf.getTime()) / 86_400_000);
