// Shared zod helpers. Every service validates its own input (backend validation is mandatory).
import { z } from "zod";
import { AppError, D, Dec } from "./core";

/** Decimal from string/number, with bounds. Returns a Prisma Decimal. */
export const decimal = (opts: { min?: number; gt?: number; max?: number; dp?: number; label?: string } = {}) =>
  z
    .union([z.string(), z.number()])
    .transform((v, ctx): Dec => {
      const s = String(v).trim().replace(/,/g, "");
      const label = opts.label ?? "Value";
      if (!/^-?\d+(\.\d+)?$/.test(s)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} must be a number` });
        return z.NEVER;
      }
      const d = D(s);
      if (opts.dp !== undefined && d.decimalPlaces() > opts.dp) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label}: max ${opts.dp} decimals` });
      }
      if (opts.gt !== undefined && !d.gt(opts.gt)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} must be greater than ${opts.gt}` });
      }
      if (opts.min !== undefined && d.lt(opts.min)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} must be at least ${opts.min}` });
      }
      if (opts.max !== undefined && d.gt(opts.max)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} must be at most ${opts.max}` });
      }
      return d;
    });

/** Optional trimmed text: "" → undefined. */
export const optText = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

export const reqText = (label: string, max = 200) =>
  z.string({ error: `${label} is required` }).trim().min(1, `${label} is required`).max(max);

/** UAE TRN: optional, exactly 15 digits when given (format check only — no FTA lookup). */
export const trn = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v.replace(/\s/g, "") : undefined))
  .refine((v) => v === undefined || /^\d{15}$/.test(v), "TRN must be exactly 15 digits");

export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

/** Parse with zod and throw a VALIDATION AppError listing field messages. */
export function parse<T extends z.ZodTypeAny>(schema: T, input: unknown): z.output<T> {
  const r = schema.safeParse(input);
  if (!r.success) {
    const fields: Record<string, string> = {};
    for (const i of r.error.issues) {
      const k = i.path.join(".") || "_";
      if (!fields[k]) fields[k] = i.message;
    }
    throw new AppError("VALIDATION", Object.values(fields)[0] ?? "Invalid input", { fields });
  }
  return r.data;
}
