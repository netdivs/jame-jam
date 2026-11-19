// Shared building blocks for every server-side service.
import { AsyncLocalStorage } from "node:async_hooks";
import { Prisma, PrismaClient } from "@prisma/client";

// ── Prisma client (one instance per process; survives Next.js hot reload) ──
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export type Tx = Prisma.TransactionClient;

/** Run fn in one DB transaction. All stock + GL postings for a document must go through here. */
// An outer transaction that services join instead of opening their own (bulk imports, T11-02). Each inTx() inside
// it runs on the same transaction, so a whole import commits or rolls back as one.
const outerTx = new AsyncLocalStorage<Tx>();

export function inTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const outer = outerTx.getStore();
  if (outer) return fn(outer);
  return prisma.$transaction(fn, { timeout: 30_000, maxWait: 10_000 });
}

/** Run `fn` in one transaction that every service call inside it joins. */
export function inOuterTx<T>(fn: (tx: Tx) => Promise<T>, timeoutMs = 300_000): Promise<T> {
  return prisma.$transaction((tx) => outerTx.run(tx, () => fn(tx)), { timeout: timeoutMs, maxWait: 10_000 });
}

// ── Errors ──
export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "VALIDATION"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INSUFFICIENT_STOCK"
  | "PERIOD_LOCKED"
  | "UNBALANCED"
  | "RATE_LIMITED";

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

// ── Actor context: who is doing this, and what may they do ──
export type Ctx = {
  userId: string | null;
  permissions: ReadonlySet<string>;
  /** Seeds, scheduled jobs. Bypasses permission checks; never used for user requests. */
  isSystem?: boolean;
  /** Client IP of the request, written to audit rows (TS-02). */
  ip?: string | null;
};
export const systemCtx: Ctx = { userId: null, permissions: new Set(), isSystem: true };

export function can(ctx: Ctx, permission: string): boolean {
  return ctx.isSystem === true || ctx.permissions.has(permission);
}

export function assertCan(ctx: Ctx, permission: string): void {
  if (!can(ctx, permission)) {
    throw new AppError("FORBIDDEN", `You do not have permission: ${permission}`);
  }
}

// ── Decimal helpers (money = 2 dp, SQM = 4 dp; never use JS floats for either) ──
export const Dec = Prisma.Decimal;
export type Dec = Prisma.Decimal;
export const D = (v: Prisma.Decimal.Value): Dec => new Prisma.Decimal(v);
export const ZERO = D(0);
export const round2 = (d: Dec): Dec => d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
export const round4 = (d: Dec): Dec => d.toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
export const sum = (xs: Dec[]): Dec => xs.reduce((a, b) => a.plus(b), ZERO);

// ── Dates: business dates are date-only, stored as UTC midnight ──
export function toDateOnly(v: string | Date): Date {
  if (v instanceof Date) return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()));
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) throw new AppError("VALIDATION", `Invalid date: ${v}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}
export const today = () => toDateOnly(new Date());

// ── Audit trail (same transaction as the change it records) ──
const toJson = (v: unknown) =>
  v === undefined ? undefined : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue);

export async function audit(
  tx: Tx,
  ctx: Ctx,
  e: { action: string; entity: string; entityId?: string | null; before?: unknown; after?: unknown; meta?: unknown },
): Promise<void> {
  await tx.auditLog.create({
    data: {
      userId: ctx.userId,
      action: e.action,
      entity: e.entity,
      entityId: e.entityId ?? null,
      before: toJson(e.before),
      after: toJson(e.after),
      meta: toJson(e.meta),
      ip: ctx.ip ?? null,
    },
  });
}

// ── Document numbering: PREFIX-YYNNNN, gap-free, restarts yearly ──
export const DOC_PREFIX: Record<string, string> = {
  JE: "JE",
  LOT: "LOT",
  SLAB: "SL",
  SO: "SO",
  PI: "PI",
  TI: "TI",
  DN: "DN",
  RR: "RR",
  CN: "CN",
  CR: "CR",
  RV: "RV",
  PV: "PV",
  PDC: "PDC",
  PO: "PO",
  GRN: "GRN",
  PUR: "PUR",
  SHP: "SHP",
  LCE: "LCE",
};

/**
 * Next number for a yearly document series. Must run inside the caller's transaction:
 * the UPDATE ... RETURNING row lock serialises concurrent callers, and a rollback gives
 * the number back, so the series stays gap-free.
 */
export async function nextDocNumber(tx: Tx, docType: string, date: Date): Promise<string> {
  const year = date.getUTCFullYear();
  const prefix = DOC_PREFIX[docType] ?? docType;
  await tx.$executeRaw`
    INSERT INTO "DocumentSequence" ("docType", "year", "prefix", "lastNumber")
    VALUES (${docType}, ${year}, ${prefix}, 0)
    ON CONFLICT ("docType", "year") DO NOTHING`;
  const rows = await tx.$queryRaw<{ lastNumber: number; prefix: string }[]>`
    UPDATE "DocumentSequence" SET "lastNumber" = "lastNumber" + 1
    WHERE "docType" = ${docType} AND "year" = ${year}
    RETURNING "lastNumber", "prefix"`;
  const { lastNumber, prefix: p } = rows[0];
  return `${p}-${String(year % 100).padStart(2, "0")}${String(lastNumber).padStart(4, "0")}`;
}

/** Master-data codes (no year): CUS-0001, SUP-0001, ... */
export async function nextMasterCode(tx: Tx, prefix: string): Promise<string> {
  const docType = `MASTER_${prefix}`;
  await tx.$executeRaw`
    INSERT INTO "DocumentSequence" ("docType", "year", "prefix", "lastNumber")
    VALUES (${docType}, 0, ${prefix}, 0)
    ON CONFLICT ("docType", "year") DO NOTHING`;
  const rows = await tx.$queryRaw<{ lastNumber: number }[]>`
    UPDATE "DocumentSequence" SET "lastNumber" = "lastNumber" + 1
    WHERE "docType" = ${docType} AND "year" = 0
    RETURNING "lastNumber"`;
  return `${prefix}-${String(rows[0].lastNumber).padStart(4, "0")}`;
}

/** Map Prisma unique-constraint errors to a readable CONFLICT. */
export function rethrowUnique(e: unknown, message: string): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    throw new AppError("CONFLICT", message);
  }
  throw e;
}
