// Sales line and document amounts (spec §3.3.4). Pure functions, no database.
//
// ⚠ Client decision C4 is PENDING. The inclusive method below is the spec's proposal:
//     Gross = Qty × Unit price (incl.) − discount;  VAT = round(Gross × r / (100 + r), 2);  Net = Gross − VAT
//   Exclusive mode:  Net = Qty × Unit price − discount;  VAT = round(Net × r / 100, 2);  Gross = Net + VAT
// Document totals are always the sum of the lines (no round-off), so Σ Net + Σ VAT = Total exactly.
// An invoice-level discount is spread over the lines (largest remainder, by line amount after line discount)
// before VAT, so VAT is always computed after every discount (TD-017).
import type { PriceMode } from "@prisma/client";
import { AppError, D, Dec, ZERO, round2, sum } from "../core";
import { splitAmount } from "../inventory/costing";

export type VatLineInput = {
  sqm: Dec;
  unitPrice: Dec;
  /** Line discount in the document's price mode. */
  discount?: Dec;
  /** VAT rate in percent (5 for SR, 0 for ZR/EX/OS). */
  rate: Dec;
};

export type VatLine = {
  /** Qty × unit price, before any discount (document price mode). */
  amount: Dec;
  discount: Dec;
  headerDiscount: Dec;
  net: Dec;
  vat: Dec;
  gross: Dec;
  /** Unit price excl. VAT after discounts, for printing (4 dp). Zero when sqm is zero. */
  unitPriceExcl: Dec;
};

export type VatTotals = { net: Dec; vat: Dec; total: Dec; discount: Dec; lines: VatLine[] };

function lineFrom(mode: PriceMode, sqm: Dec, amount: Dec, discount: Dec, headerDiscount: Dec, rate: Dec): VatLine {
  const after = amount.minus(discount).minus(headerDiscount);
  let net: Dec, vat: Dec, gross: Dec;
  if (mode === "INCLUSIVE") {
    gross = after;
    vat = round2(gross.times(rate).div(D(100).plus(rate)));
    net = gross.minus(vat);
  } else {
    net = after;
    vat = round2(net.times(rate).div(100));
    gross = net.plus(vat);
  }
  const unitPriceExcl = sqm.gt(0) ? net.div(sqm).toDecimalPlaces(4) : ZERO;
  return { amount, discount, headerDiscount, net, vat, gross, unitPriceExcl };
}

/** Amounts for a whole document. Throws VALIDATION when a discount exceeds what it applies to. */
export function computeDocument(mode: PriceMode, lines: VatLineInput[], headerDiscount: Dec = ZERO): VatTotals {
  if (lines.length === 0) throw new AppError("VALIDATION", "Add at least one line");
  const hd = round2(headerDiscount);
  if (hd.isNegative()) throw new AppError("VALIDATION", "Discount cannot be negative");

  const base = lines.map((l, i) => {
    const amount = round2(l.sqm.times(l.unitPrice));
    const discount = round2(l.discount ?? ZERO);
    if (discount.isNegative()) throw new AppError("VALIDATION", `Line ${i + 1}: discount cannot be negative`);
    if (discount.gt(amount)) {
      throw new AppError("VALIDATION", `Line ${i + 1}: discount AED ${discount.toFixed(2)} is more than the line amount AED ${amount.toFixed(2)}`);
    }
    return { amount, discount, after: amount.minus(discount) };
  });

  const afterTotal = sum(base.map((b) => b.after));
  if (hd.gt(afterTotal)) {
    throw new AppError("VALIDATION", `Invoice discount AED ${hd.toFixed(2)} is more than the lines total AED ${afterTotal.toFixed(2)}`);
  }
  const shares = hd.isZero() ? base.map(() => ZERO) : splitAmount(hd, base.map((b) => b.after));

  const out = lines.map((l, i) => lineFrom(mode, l.sqm, base[i].amount, base[i].discount, shares[i], l.rate));
  return {
    net: sum(out.map((l) => l.net)),
    vat: sum(out.map((l) => l.vat)),
    total: sum(out.map((l) => l.gross)),
    discount: hd,
    lines: out,
  };
}

/** VAT rate that applies to a tax code on a sales document. Reverse charge is for imports only. */
export function salesRate(tax: { code: string; type: string; rate: Dec | string | number }): Dec {
  if (tax.type === "RC") throw new AppError("VALIDATION", `Tax code ${tax.code} (reverse charge) is for import purchases, not sales`);
  if (tax.type === "SR") return D(tax.rate);
  return ZERO; // ZR, EX, OS: no output VAT
}
