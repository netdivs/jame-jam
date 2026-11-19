// Customer and supplier ledgers and statements (spec §3.4.2, T8-01, TD-030).
//  - A party's ledger is every GL line tagged with that party on its party accounts:
//      customers: Accounts Receivable + Customer Advances; balance = debit − credit (positive = the customer owes us,
//                 negative = we hold their advance);
//      suppliers: Accounts Payable + Supplier Advances; balance = credit − debit (positive = we owe them,
//                 negative = our advance with them).
//    PDC accounts and GRNI are not part of the statement (the cheque's own entry against advances is; goods received
//    but not invoiced are shown as a note, not a balance).
//  - controlCheck() proves spec §11.3: the parties add up to each control account and no line on it lacks a party.
import { Prisma, type PrismaClient } from "@prisma/client";
import { D, Dec, ZERO, prisma } from "../core";

export type PartyType = "CUSTOMER" | "SUPPLIER";
export const PARTY_KEYS: Record<PartyType, { owed: string; advance: string }> = {
  CUSTOMER: { owed: "AR", advance: "CUSTOMER_ADVANCES" },
  SUPPLIER: { owed: "AP", advance: "SUPPLIER_ADVANCES" },
};
const sign = (type: PartyType, debit: Prisma.Decimal | Dec, credit: Prisma.Decimal | Dec) => (type === "CUSTOMER" ? D(debit).minus(credit) : D(credit).minus(debit));

async function partyAccounts(type: PartyType, db: PrismaClient | Prisma.TransactionClient = prisma) {
  const k = PARTY_KEYS[type];
  const accs = await db.account.findMany({ where: { systemKey: { in: [k.owed, k.advance] } } });
  const owed = accs.find((a) => a.systemKey === k.owed)!;
  const advance = accs.find((a) => a.systemKey === k.advance)!;
  return { owed, advance, ids: [owed.id, advance.id] };
}

export type PartyBalance = { partyId: string; owed: Dec; advance: Dec; balance: Dec };

/** Balance of every party with entries, split into the owed account (AR/AP) and the advance account. */
export async function partyBalances(type: PartyType, asOf?: Date): Promise<Map<string, PartyBalance>> {
  const acc = await partyAccounts(type);
  const rows = await prisma.journalLine.groupBy({
    by: ["partyId", "accountId"],
    where: { accountId: { in: acc.ids }, partyType: type, partyId: { not: null }, ...(asOf ? { entry: { date: { lte: asOf } } } : {}) },
    _sum: { debit: true, credit: true },
  });
  const out = new Map<string, PartyBalance>();
  for (const r of rows) {
    const id = r.partyId!;
    const b = out.get(id) ?? { partyId: id, owed: ZERO, advance: ZERO, balance: ZERO };
    const v = sign(type, D(r._sum.debit ?? 0), D(r._sum.credit ?? 0));
    if (r.accountId === acc.owed.id) b.owed = b.owed.plus(v);
    else b.advance = b.advance.plus(v);
    b.balance = b.owed.plus(b.advance);
    out.set(id, b);
  }
  return out;
}

export type StatementRow = {
  lineId: string;
  entryId: string;
  date: Date;
  number: string;
  sourceType: string;
  sourceId: string | null;
  memo: string;
  account: "owed" | "advance";
  debit: Dec;
  credit: Dec;
  balance: Dec;
};
export type Statement = { opening: Dec; rows: StatementRow[]; totalDebit: Dec; totalCredit: Dec; closing: Dec; closingOwed: Dec; closingAdvance: Dec };

/** Statement for one party between two dates (inclusive): opening, every entry with running balance, closing. */
export async function partyStatement(type: PartyType, partyId: string, from: Date, to: Date): Promise<Statement> {
  const acc = await partyAccounts(type);
  const base = { accountId: { in: acc.ids }, partyType: type, partyId };
  const before = await prisma.journalLine.aggregate({ where: { ...base, entry: { date: { lt: from } } }, _sum: { debit: true, credit: true } });
  const opening = sign(type, D(before._sum.debit ?? 0), D(before._sum.credit ?? 0));
  const lines = await prisma.journalLine.findMany({
    where: { ...base, entry: { date: { gte: from, lte: to } } },
    include: { entry: true },
    orderBy: [{ entry: { date: "asc" } }, { entry: { createdAt: "asc" } }, { id: "asc" }],
  });
  let run = opening;
  let totalDebit = ZERO;
  let totalCredit = ZERO;
  const rows: StatementRow[] = lines.map((l) => {
    run = run.plus(sign(type, l.debit, l.credit));
    totalDebit = totalDebit.plus(l.debit);
    totalCredit = totalCredit.plus(l.credit);
    return {
      lineId: l.id,
      entryId: l.entryId,
      date: l.entry.date,
      number: l.entry.number,
      sourceType: l.entry.sourceType,
      sourceId: l.entry.sourceId,
      memo: l.memo ?? l.entry.memo ?? "",
      account: l.accountId === acc.owed.id ? "owed" : "advance",
      debit: D(l.debit),
      credit: D(l.credit),
      balance: run,
    };
  });
  const split = await partyBalances(type, to).then((m) => m.get(partyId));
  return { opening, rows, totalDebit, totalCredit, closing: run, closingOwed: split?.owed ?? ZERO, closingAdvance: split?.advance ?? ZERO };
}

export type ControlCheck = { key: string; name: string; gl: Dec; parties: Dec; untagged: Dec; ok: boolean };

/** Spec §11.3: Σ party balances = control account, and no line on a control account without a party. */
export async function controlCheck(): Promise<ControlCheck[]> {
  const out: ControlCheck[] = [];
  for (const type of ["CUSTOMER", "SUPPLIER"] as PartyType[]) {
    const acc = await partyAccounts(type);
    for (const a of [acc.owed, acc.advance]) {
      const [all, tagged] = await Promise.all([
        prisma.journalLine.aggregate({ where: { accountId: a.id }, _sum: { debit: true, credit: true } }),
        prisma.journalLine.aggregate({ where: { accountId: a.id, partyType: type, partyId: { not: null } }, _sum: { debit: true, credit: true } }),
      ]);
      const gl = sign(type, D(all._sum.debit ?? 0), D(all._sum.credit ?? 0));
      const parties = sign(type, D(tagged._sum.debit ?? 0), D(tagged._sum.credit ?? 0));
      out.push({ key: a.systemKey!, name: a.name, gl, parties, untagged: gl.minus(parties), ok: gl.eq(parties) });
    }
  }
  return out;
}

/** Where a ledger line's document lives in the app (falls back to the journal entry). */
export function documentHref(r: { sourceType: string; sourceId: string | null; entryId: string }, poOf?: Map<string, string>): string {
  const id = r.sourceId;
  if (!id) return `/accounts/journals/${r.entryId}`;
  switch (r.sourceType) {
    case "CUSTOMER_RECEIPT":
    case "CUSTOMER_RECEIPT_CANCEL":
      return `/receipts/${id}`;
    case "REFUND":
    case "REFUND_CANCEL":
      return `/refunds/${id}`;
    case "PDC_RECEIVED":
    case "PDC_ISSUED":
    case "PDC_CLEARED":
    case "PDC_RECEIVED_REVERSAL":
    case "PDC_ISSUED_REVERSAL":
    case "PDC_BOUNCE_CHARGES":
      return `/pdc/${id}`;
    case "SUPPLIER_INVOICE":
    case "ADVANCE_KNOCKOFF":
      return `/purchase/invoices/${id}`;
    case "LANDED_COST":
      return `/purchase/landed-costs/${id}`;
    case "TAX_INVOICE":
    case "INVOICE_ALLOCATION":
      return `/sales/invoices/${id}`;
    case "SUPPLIER_PAYMENT":
      return poOf?.get(id) ? `/purchase/orders/${poOf.get(id)}` : `/accounts/journals/${r.entryId}`;
    default:
      return `/accounts/journals/${r.entryId}`;
  }
}

/** Goods received from a supplier but not invoiced yet (GRNI for that supplier) — shown beside the statement. */
export async function supplierGrni(supplierId: string): Promise<Dec> {
  const a = await prisma.journalLine.aggregate({ where: { account: { systemKey: "GRNI" }, partyType: "SUPPLIER", partyId: supplierId }, _sum: { debit: true, credit: true } });
  return D(a._sum.credit ?? 0).minus(D(a._sum.debit ?? 0));
}
