// Bank reconciliation (spec §3.4.6, T8-05, TD-029).
//  - Statement lines are entered by hand or imported from CSV with column mapping (Excel import waits for TX-02).
//    amount > 0 = money in, < 0 = money out. A line is never edited; an unmatched, unlocked line can be deleted.
//  - A statement line is matched to one or more ledger lines on the bank's GL account whose (debit − credit) add up
//    to its amount exactly. A ledger line is matched at most once. Suggestions: same amount, within ±10 days.
//  - Bank charges on the statement can be posted from the line (Dr Bank Charges, Cr bank) and are matched at once.
//  - Reconciliation at a statement date D:
//      book balance B            = bank GL balance up to D
//      unrecorded U              = statement lines up to D not (yet) matched to ledger lines up to D
//      outstanding O             = ledger lines up to D not matched to a statement line up to D
//      expected statement = B − O + U; difference = statement balance entered − expected.
//    It can be saved only when the difference is zero and D is after the last saved date. Saving locks statement
//    lines and matches dated on or before D for that bank; only the latest saved reconciliation can be reopened.
//  - Lock order: bank account row → statement line rows.
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { AppError, Ctx, D, Dec, Tx, ZERO, assertCan, audit, inTx, prisma, round2, toDateOnly, today } from "../core";
import { postJournal } from "./gl";
import { dateStr, decimal, optText, parse, reqText } from "../validation";

const DAY = 86_400_000;
const SUGGEST_DAYS = 10;

const lineSchema = z.object({
  bankAccountId: reqText("Bank account"),
  date: dateStr,
  description: reqText("Description", 300),
  reference: optText(80),
  direction: z.enum(["IN", "OUT"], { errorMap: () => ({ message: "Money in or out?" }) }),
  amount: decimal({ gt: 0, dp: 2, label: "Amount" }),
});

// ───────────────────────────── Helpers ─────────────────────────────

async function lockBank(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "BankAccount" WHERE "id" = ${id} FOR UPDATE`;
  if (rows.length === 0) throw new AppError("NOT_FOUND", "Bank account not found");
  return tx.bankAccount.findUniqueOrThrow({ where: { id }, include: { account: true } });
}

/** Statement lines and matches dated on or before this date are locked by a saved reconciliation. */
export async function lockedUntil(db: Tx | typeof prisma, bankAccountId: string): Promise<Date | null> {
  const last = await db.bankReconciliation.findFirst({ where: { bankAccountId }, orderBy: { statementDate: "desc" } });
  return last?.statementDate ?? null;
}

function assertOpen(date: Date, locked: Date | null, what: string) {
  if (locked && date <= locked) {
    throw new AppError("VALIDATION", `${what} is dated on or before ${locked.toISOString().slice(0, 10)}, which is covered by a saved reconciliation. Reopen it first.`);
  }
}

const signed = (l: { debit: Prisma.Decimal; credit: Prisma.Decimal }) => D(l.debit).minus(l.credit);
const iso = (d: Date) => d.toISOString().slice(0, 10);

// ───────────────────────────── Statement lines ─────────────────────────────

export async function addStatementLine(ctx: Ctx, raw: unknown) {
  assertCan(ctx, "bankRec.manage");
  const input = parse(lineSchema, raw);
  const date = toDateOnly(input.date);
  if (date > today()) throw new AppError("VALIDATION", "A statement line cannot be dated in the future", { fields: { date: "Not after today" } });
  return inTx(async (tx) => {
    const bank = await lockBank(tx, input.bankAccountId);
    assertOpen(date, await lockedUntil(tx, bank.id), "The line");
    const amount = input.direction === "IN" ? round2(input.amount) : round2(input.amount).negated();
    const line = await tx.bankStatementLine.create({ data: { bankAccountId: bank.id, date, description: input.description, reference: input.reference, amount, createdById: ctx.userId } });
    await audit(tx, ctx, { action: "create", entity: "BankStatementLine", entityId: line.id, after: { bank: bank.name, date: input.date, amount, description: input.description } });
    return line;
  });
}

export async function deleteStatementLine(ctx: Ctx, id: string) {
  assertCan(ctx, "bankRec.manage");
  return inTx(async (tx) => {
    const l0 = await tx.bankStatementLine.findUnique({ where: { id } });
    if (!l0) throw new AppError("NOT_FOUND", "Statement line not found");
    await lockBank(tx, l0.bankAccountId);
    const line = await tx.bankStatementLine.findUniqueOrThrow({ where: { id }, include: { matches: true } });
    assertOpen(line.date, await lockedUntil(tx, line.bankAccountId), "The line");
    if (line.matches.length > 0) throw new AppError("VALIDATION", "Unmatch the line before deleting it");
    await tx.bankStatementLine.delete({ where: { id } });
    await audit(tx, ctx, { action: "delete", entity: "BankStatementLine", entityId: id, before: line });
  });
}

// ───────────────────────────── CSV import ─────────────────────────────

/** RFC 4180-style CSV: commas, quoted fields with "" escapes, CRLF or LF. */
/** keepEmpty: keep blank lines (as []) so row numbers match the spreadsheet (imports). */
export function parseCsv(text: string, keepEmpty = false): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const t = text.replace(/^﻿/, "");
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quoted) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      else if (keepEmpty) rows.push([]);
      row = [];
      field = "";
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
export const DATE_FORMATS = ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD", "DD-MMM-YYYY"] as const;

export function parseStatementDate(s: string, format: (typeof DATE_FORMATS)[number]): Date | null {
  const v = s.trim();
  let y: number, m: number, d: number;
  if (format === "YYYY-MM-DD") {
    const r = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(v);
    if (!r) return null;
    [y, m, d] = [+r[1], +r[2], +r[3]];
  } else if (format === "DD-MMM-YYYY") {
    const r = /^(\d{1,2})[-/. ]([A-Za-z]{3})[A-Za-z]*[-/. ](\d{4})/.exec(v);
    if (!r || !MONTHS[r[2].toLowerCase()]) return null;
    [d, m, y] = [+r[1], MONTHS[r[2].toLowerCase()], +r[3]];
  } else {
    const r = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(v);
    if (!r) return null;
    [d, m, y] = format === "DD/MM/YYYY" ? [+r[1], +r[2], +r[3]] : [+r[2], +r[1], +r[3]];
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt : null;
}

/** "1,234.50", "-12", "(12.00)", "12.00 DR" / "12.00 CR", "AED 5" → Decimal (DR and brackets are negative). */
export function parseStatementAmount(s: string): Dec | null {
  let v = s.trim().toUpperCase().replace(/AED/g, "").replace(/[\s,]/g, "");
  if (v === "" || v === "-") return null;
  let sign = 1;
  if (/^\(.*\)$/.test(v)) {
    sign = -1;
    v = v.slice(1, -1);
  }
  if (v.endsWith("DR")) {
    sign = -sign;
    v = v.slice(0, -2);
  } else if (v.endsWith("CR")) v = v.slice(0, -2);
  if (!/^-?\d+(\.\d+)?$/.test(v)) return null;
  const d = D(v).times(sign);
  return d.decimalPlaces() > 2 ? null : d;
}

const col = z.union([z.literal(""), z.coerce.number().int().min(0)]).optional().transform((v) => (v === "" || v === undefined ? undefined : v));
export const importSchema = z
  .object({
    bankAccountId: reqText("Bank account"),
    csv: z.string().min(1, "Choose a CSV file").max(1_000_000, "The file is larger than 1 MB"),
    dateFormat: z.enum(DATE_FORMATS),
    hasHeader: z.union([z.boolean(), z.literal("on"), z.literal("true"), z.literal("")]).optional().transform((v) => v === true || v === "on" || v === "true"),
    dateCol: z.coerce.number().int().min(0),
    descriptionCol: z.coerce.number().int().min(0),
    referenceCol: col,
    amountCol: col,
    inCol: col,
    outCol: col,
    allowDuplicates: z.union([z.boolean(), z.literal("on"), z.literal("true"), z.literal("")]).optional().transform((v) => v === true || v === "on" || v === "true"),
    dryRun: z.union([z.boolean(), z.literal("true"), z.literal("false"), z.literal("")]).optional().transform((v) => v === true || v === "true"),
  })
  .refine((v) => v.amountCol !== undefined || (v.inCol !== undefined && v.outCol !== undefined), "Choose an amount column, or both a money-in and a money-out column");

export type ImportResult = { lines: number; moneyIn: Dec; moneyOut: Dec; duplicates: number; errors: string[]; imported: number; batch?: string };

export async function importStatementCsv(ctx: Ctx, raw: unknown): Promise<ImportResult> {
  assertCan(ctx, "bankRec.manage");
  const input = parse(importSchema, raw);
  const rows = parseCsv(input.csv).slice(input.hasHeader ? 1 : 0);
  if (rows.length === 0) throw new AppError("VALIDATION", "The file has no lines");
  if (rows.length > 2000) throw new AppError("VALIDATION", "Import at most 2,000 lines at a time");

  const errors: string[] = [];
  const parsed: { date: Date; description: string; reference?: string; amount: Dec }[] = [];
  const first = input.hasHeader ? 2 : 1;
  rows.forEach((r, i) => {
    const n = i + first;
    const date = parseStatementDate(r[input.dateCol] ?? "", input.dateFormat);
    if (!date) return void errors.push(`Line ${n}: date "${r[input.dateCol] ?? ""}" is not ${input.dateFormat}`);
    if (date > today()) return void errors.push(`Line ${n}: date ${iso(date)} is in the future`);
    let amount: Dec | null;
    if (input.amountCol !== undefined) amount = parseStatementAmount(r[input.amountCol] ?? "");
    else {
      const a = parseStatementAmount(r[input.inCol!] ?? "") ?? ZERO;
      const b = parseStatementAmount(r[input.outCol!] ?? "") ?? ZERO;
      amount = a.abs().minus(b.abs());
    }
    if (!amount || amount.isZero()) return void errors.push(`Line ${n}: no amount`);
    const description = (r[input.descriptionCol] ?? "").trim().slice(0, 300);
    if (!description) return void errors.push(`Line ${n}: no description`);
    const reference = input.referenceCol !== undefined ? (r[input.referenceCol] ?? "").trim().slice(0, 80) || undefined : undefined;
    parsed.push({ date, description, reference, amount });
  });

  return inTx(async (tx) => {
    const bank = await lockBank(tx, input.bankAccountId);
    const locked = await lockedUntil(tx, bank.id);
    for (const p of parsed) if (locked && p.date <= locked) errors.push(`${iso(p.date)} ${p.description}: dated within a saved reconciliation`);
    // The same line already on file (bank, date, amount, description) is a duplicate unless allowed.
    let duplicates = 0;
    const keep: typeof parsed = [];
    for (const p of parsed) {
      if (locked && p.date <= locked) continue;
      const dup = await tx.bankStatementLine.findFirst({ where: { bankAccountId: bank.id, date: p.date, amount: p.amount, description: p.description } });
      if (dup && !input.allowDuplicates) duplicates++;
      else keep.push(p);
    }
    const moneyIn = keep.filter((p) => p.amount.gt(0)).reduce((a, p) => a.plus(p.amount), ZERO);
    const moneyOut = keep.filter((p) => p.amount.lt(0)).reduce((a, p) => a.plus(p.amount.abs()), ZERO);
    const result: ImportResult = { lines: keep.length, moneyIn, moneyOut, duplicates, errors, imported: 0 };
    if (input.dryRun || errors.length > 0) return result;
    const batch = `IMP-${Date.now().toString(36).toUpperCase()}`;
    await tx.bankStatementLine.createMany({ data: keep.map((p) => ({ bankAccountId: bank.id, date: p.date, description: p.description, reference: p.reference, amount: p.amount, importBatch: batch, createdById: ctx.userId })) });
    await audit(tx, ctx, { action: "import", entity: "BankStatementLine", entityId: batch, after: { bank: bank.name, lines: keep.length, moneyIn, moneyOut, duplicatesSkipped: duplicates } });
    return { ...result, imported: keep.length, batch };
  });
}

// ───────────────────────────── Matching ─────────────────────────────

export async function matchStatementLine(ctx: Ctx, statementLineId: string, journalLineIds: string[]) {
  assertCan(ctx, "bankRec.manage");
  const ids = [...new Set(journalLineIds.filter(Boolean))];
  if (ids.length === 0) throw new AppError("VALIDATION", "Choose at least one ledger line");
  return inTx(async (tx) => {
    const l0 = await tx.bankStatementLine.findUnique({ where: { id: statementLineId } });
    if (!l0) throw new AppError("NOT_FOUND", "Statement line not found");
    const bank = await lockBank(tx, l0.bankAccountId);
    await tx.$queryRaw`SELECT "id" FROM "BankStatementLine" WHERE "id" = ${statementLineId} FOR UPDATE`;
    const line = await tx.bankStatementLine.findUniqueOrThrow({ where: { id: statementLineId }, include: { matches: true } });
    assertOpen(line.date, await lockedUntil(tx, bank.id), "The statement line");
    if (line.matches.length > 0) throw new AppError("VALIDATION", "This statement line is already matched");
    const gl = await tx.journalLine.findMany({ where: { id: { in: ids } }, include: { bankMatch: true, entry: true } });
    if (gl.length !== ids.length) throw new AppError("VALIDATION", "A ledger line was not found");
    for (const g of gl) {
      if (g.accountId !== bank.accountId) throw new AppError("VALIDATION", `${g.entry.number} is not on ${bank.name}'s ledger`);
      if (g.bankMatch) throw new AppError("VALIDATION", `${g.entry.number} is already matched to another statement line`);
    }
    const total = gl.reduce((a, g) => a.plus(signed(g)), ZERO);
    if (!total.eq(line.amount)) {
      throw new AppError("VALIDATION", `The ledger lines add up to AED ${total.toFixed(2)}; the statement line is AED ${D(line.amount).toFixed(2)}`);
    }
    try {
      await tx.bankMatch.createMany({ data: gl.map((g) => ({ statementLineId: line.id, journalLineId: g.id, matchedById: ctx.userId })) });
    } catch {
      throw new AppError("CONFLICT", "A ledger line was matched by someone else just now; refresh and try again");
    }
    await audit(tx, ctx, { action: "match", entity: "BankStatementLine", entityId: line.id, after: { amount: line.amount, entries: gl.map((g) => g.entry.number) } });
    return line;
  });
}

export async function unmatchStatementLine(ctx: Ctx, statementLineId: string) {
  assertCan(ctx, "bankRec.manage");
  return inTx(async (tx) => {
    const l0 = await tx.bankStatementLine.findUnique({ where: { id: statementLineId } });
    if (!l0) throw new AppError("NOT_FOUND", "Statement line not found");
    const bank = await lockBank(tx, l0.bankAccountId);
    const line = await tx.bankStatementLine.findUniqueOrThrow({ where: { id: statementLineId }, include: { matches: { include: { journalLine: { include: { entry: true } } } } } });
    const locked = await lockedUntil(tx, bank.id);
    assertOpen(line.date, locked, "The statement line");
    if (line.matches.length === 0) throw new AppError("VALIDATION", "This statement line is not matched");
    await tx.bankMatch.deleteMany({ where: { statementLineId } });
    await audit(tx, ctx, { action: "unmatch", entity: "BankStatementLine", entityId: line.id, before: { entries: line.matches.map((m) => m.journalLine.entry.number) } });
  });
}

/** Post a bank charge shown on the statement and match it (the statement line must be money out). */
export async function postChargeFromStatement(ctx: Ctx, statementLineId: string) {
  assertCan(ctx, "bankRec.manage");
  return inTx(async (tx) => {
    const l0 = await tx.bankStatementLine.findUnique({ where: { id: statementLineId } });
    if (!l0) throw new AppError("NOT_FOUND", "Statement line not found");
    const bank = await lockBank(tx, l0.bankAccountId);
    await tx.$queryRaw`SELECT "id" FROM "BankStatementLine" WHERE "id" = ${statementLineId} FOR UPDATE`;
    const line = await tx.bankStatementLine.findUniqueOrThrow({ where: { id: statementLineId }, include: { matches: true } });
    assertOpen(line.date, await lockedUntil(tx, bank.id), "The statement line");
    if (line.matches.length > 0) throw new AppError("VALIDATION", "This statement line is already matched");
    if (!D(line.amount).lt(0)) throw new AppError("VALIDATION", "Only money out can be posted as bank charges");
    if (!bank.account.systemKey) throw new AppError("VALIDATION", `${bank.name} has no posting key`);
    const amount = D(line.amount).abs();
    const entry = await postJournal(tx, ctx, {
      date: line.date,
      sourceType: "BANK_CHARGE",
      sourceId: line.id,
      memo: `Bank charges — ${bank.name}: ${line.description}`,
      lines: [
        { account: "BANK_CHARGES", debit: amount },
        { account: bank.account.systemKey, credit: amount },
      ],
    });
    const gl = await tx.journalLine.findFirstOrThrow({ where: { entryId: entry.id, accountId: bank.accountId } });
    await tx.bankMatch.create({ data: { statementLineId: line.id, journalLineId: gl.id, matchedById: ctx.userId } });
    await audit(tx, ctx, { action: "postCharge", entity: "BankStatementLine", entityId: line.id, after: { entry: entry.number, amount } });
    return entry;
  });
}

export type Suggestion = { journalLineId: string; number: string; date: Date; memo: string; amount: Dec; score: number };

/** Ledger lines that could be a statement line: unmatched, same amount, within ±10 days; best first. */
export async function suggestMatches(bankAccountId: string): Promise<Map<string, Suggestion[]>> {
  const bank = await prisma.bankAccount.findUniqueOrThrow({ where: { id: bankAccountId } });
  const lines = await prisma.bankStatementLine.findMany({ where: { bankAccountId, matches: { none: {} } } });
  const out = new Map<string, Suggestion[]>();
  if (lines.length === 0) return out;
  const min = new Date(Math.min(...lines.map((l) => l.date.getTime())) - SUGGEST_DAYS * DAY);
  const max = new Date(Math.max(...lines.map((l) => l.date.getTime())) + SUGGEST_DAYS * DAY);
  const gl = await prisma.journalLine.findMany({ where: { accountId: bank.accountId, bankMatch: null, entry: { date: { gte: min, lte: max } } }, include: { entry: true } });
  for (const l of lines) {
    const text = `${l.description} ${l.reference ?? ""}`.toUpperCase();
    const c = gl
      .filter((g) => signed(g).eq(l.amount) && Math.abs(g.entry.date.getTime() - l.date.getTime()) <= SUGGEST_DAYS * DAY)
      .map((g) => {
        const memo = g.memo ?? g.entry.memo ?? "";
        const docNo = memo.split(" ")[0]?.toUpperCase();
        const days = Math.abs(g.entry.date.getTime() - l.date.getTime()) / DAY;
        const score = 100 - days * 5 + (docNo && docNo.length > 3 && text.includes(docNo) ? 50 : 0);
        return { journalLineId: g.id, number: g.entry.number, date: g.entry.date, memo, amount: signed(g), score };
      })
      .sort((a, b) => b.score - a.score);
    if (c.length) out.set(l.id, c);
  }
  return out;
}

/** Match every statement line that has exactly one candidate, which no other line also wants. */
export async function autoMatch(ctx: Ctx, bankAccountId: string): Promise<number> {
  assertCan(ctx, "bankRec.manage");
  const locked = await lockedUntil(prisma, bankAccountId);
  const sugg = await suggestMatches(bankAccountId);
  const lines = await prisma.bankStatementLine.findMany({ where: { id: { in: [...sugg.keys()] } } });
  const wanted = new Map<string, number>();
  for (const c of sugg.values()) for (const s of c) wanted.set(s.journalLineId, (wanted.get(s.journalLineId) ?? 0) + 1);
  let n = 0;
  for (const l of lines) {
    if (locked && l.date <= locked) continue;
    const c = sugg.get(l.id)!;
    if (c.length !== 1 || wanted.get(c[0].journalLineId) !== 1) continue;
    try {
      await matchStatementLine(ctx, l.id, [c[0].journalLineId]);
      n++;
    } catch (e) {
      if (!(e instanceof AppError)) throw e; // someone else matched it meanwhile: skip
    }
  }
  return n;
}

// ───────────────────────────── Reconciliation ─────────────────────────────

export type RecItem = { kind: "statement" | "ledger"; id: string; date: Date; text: string; amount: Dec };
export type Reconciliation = { date: Date; bookBalance: Dec; unrecorded: Dec; outstanding: Dec; expected: Dec; items: RecItem[]; lockedUntil: Date | null };

export async function reconciliation(bankAccountId: string, date: Date, db: Tx | typeof prisma = prisma): Promise<Reconciliation> {
  const bank = await db.bankAccount.findUniqueOrThrow({ where: { id: bankAccountId } });
  const gl = await db.journalLine.findMany({
    where: { accountId: bank.accountId, entry: { date: { lte: date } } },
    include: { entry: true, bankMatch: { include: { statementLine: true } } },
  });
  const st = await db.bankStatementLine.findMany({
    where: { bankAccountId, date: { lte: date } },
    include: { matches: { include: { journalLine: { include: { entry: true } } } } },
    orderBy: { date: "asc" },
  });
  const items: RecItem[] = [];
  let book = ZERO;
  let outstanding = ZERO;
  for (const g of gl) {
    const a = signed(g);
    book = book.plus(a);
    if (!g.bankMatch || g.bankMatch.statementLine.date > date) {
      outstanding = outstanding.plus(a);
      items.push({ kind: "ledger", id: g.id, date: g.entry.date, text: `${g.entry.number} — ${g.memo ?? g.entry.memo ?? ""}`, amount: a });
    }
  }
  let unrecorded = ZERO;
  for (const s of st) {
    const inBooks = s.matches.filter((m) => m.journalLine.entry.date <= date).reduce((a, m) => a.plus(signed(m.journalLine)), ZERO);
    const left = D(s.amount).minus(inBooks);
    if (!left.isZero()) {
      unrecorded = unrecorded.plus(left);
      items.push({ kind: "statement", id: s.id, date: s.date, text: s.description, amount: left });
    }
  }
  items.sort((a, b) => a.date.getTime() - b.date.getTime());
  return { date, bookBalance: book, unrecorded, outstanding, expected: book.minus(outstanding).plus(unrecorded), items, lockedUntil: await lockedUntil(db, bankAccountId) };
}

export const saveRecSchema = z.object({
  bankAccountId: reqText("Bank account"),
  statementDate: dateStr,
  statementBalance: decimal({ dp: 2, label: "Statement balance" }),
  notes: optText(500),
});

export async function saveReconciliation(ctx: Ctx, raw: unknown) {
  assertCan(ctx, "bankRec.manage");
  const input = parse(saveRecSchema, raw);
  const date = toDateOnly(input.statementDate);
  if (date > today()) throw new AppError("VALIDATION", "The statement date cannot be in the future");
  return inTx(async (tx) => {
    const bank = await lockBank(tx, input.bankAccountId);
    const locked = await lockedUntil(tx, bank.id);
    if (locked && date <= locked) throw new AppError("VALIDATION", `${bank.name} is already reconciled up to ${iso(locked)}; choose a later statement date`);
    const r = await reconciliation(bank.id, date, tx);
    const diff = round2(input.statementBalance).minus(r.expected);
    if (!diff.isZero()) {
      throw new AppError("VALIDATION", `Not reconciled: the statement shows AED ${round2(input.statementBalance).toFixed(2)}, the books explain AED ${r.expected.toFixed(2)} (difference AED ${diff.toFixed(2)}). Add the missing statement lines or matches first.`);
    }
    const saved = await tx.bankReconciliation.create({
      data: {
        bankAccountId: bank.id,
        statementDate: date,
        statementBalance: round2(input.statementBalance),
        bookBalance: r.bookBalance,
        unrecorded: r.unrecorded,
        outstanding: r.outstanding,
        items: r.items.map((i) => ({ ...i, date: iso(i.date), amount: i.amount.toFixed(2) })),
        notes: input.notes,
        createdById: ctx.userId,
      },
    });
    await audit(tx, ctx, { action: "reconcile", entity: "BankReconciliation", entityId: saved.id, after: { bank: bank.name, date: input.statementDate, statementBalance: saved.statementBalance, bookBalance: r.bookBalance, items: r.items.length } });
    return saved;
  });
}

/** Reopen (remove) the latest saved reconciliation of a bank, which unlocks its period. */
export async function reopenReconciliation(ctx: Ctx, id: string, reason: string) {
  assertCan(ctx, "bankRec.manage");
  const why = reason?.trim();
  if (!why) throw new AppError("VALIDATION", "Give a reason for reopening", { fields: { reason: "Reason is required" } });
  return inTx(async (tx) => {
    const r0 = await tx.bankReconciliation.findUnique({ where: { id } });
    if (!r0) throw new AppError("NOT_FOUND", "Reconciliation not found");
    await lockBank(tx, r0.bankAccountId);
    const latest = await tx.bankReconciliation.findFirstOrThrow({ where: { bankAccountId: r0.bankAccountId }, orderBy: { statementDate: "desc" } });
    if (latest.id !== id) throw new AppError("VALIDATION", `Only the latest reconciliation (${iso(latest.statementDate)}) can be reopened`);
    await tx.bankReconciliation.delete({ where: { id } });
    await audit(tx, ctx, { action: "reopen", entity: "BankReconciliation", entityId: id, before: r0, meta: { reason: why } });
  });
}
