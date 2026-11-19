// Tax code rule (spec §3.3.5, T5-09): using anything other than the standard code needs the
// "Change tax code" permission and a reason, which is stored on the line and audited with the document.
//  - Sales lines: the standard code is SR (src/server/sales/orders.ts).
//  - Purchase lines: SR, or RC (reverse charge) from an import supplier, where RC is the normal code (TD-022).
//  - A supplier invoice line keeping its PO line's code needs nothing new (it was justified on the PO).
import { AppError, Ctx, can } from "./core";

export const isStandardPurchaseCode = (taxType: string, supplierType: string) => taxType === "SR" || (taxType === "RC" && supplierType === "IMPORT");

/** Throws unless the user may use this non-standard code and gave a reason. Returns the reason to store. */
export function requireTaxReason(ctx: Ctx, opts: { line: number; code: string; reason?: string | null; field: string }): string {
  if (!can(ctx, "taxCode.change")) throw new AppError("FORBIDDEN", `Line ${opts.line}: only users with "Change tax code" may use ${opts.code}`);
  const reason = opts.reason?.trim();
  if (!reason) throw new AppError("VALIDATION", `Line ${opts.line}: give a reason for using tax code ${opts.code}`, { fields: { [opts.field]: "Reason is required" } });
  return reason;
}
