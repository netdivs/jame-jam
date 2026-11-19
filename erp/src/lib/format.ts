// Display formatting. Values arrive as Prisma Decimals, strings or numbers.
type Num = { toString(): string } | string | number | null | undefined;

const str = (v: Num) => (v === null || v === undefined ? "0" : v.toString());

function group(fixed: string): string {
  const [i, f] = fixed.split(".");
  const neg = i.startsWith("-");
  const digits = neg ? i.slice(1) : i;
  const g = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${g}${f !== undefined ? `.${f}` : ""}`;
}

function toFixed(v: Num, dp: number): string {
  // Decimal-safe rounding without floats for typical ERP magnitudes.
  const s = str(v);
  if (!/^-?\d+(\.\d+)?$/.test(s)) return s;
  const neg = s.startsWith("-");
  const [i, f = ""] = (neg ? s.slice(1) : s).split(".");
  const padded = (f + "0".repeat(dp + 1)).slice(0, dp + 1);
  let n = BigInt(i + padded.slice(0, dp));
  if (Number(padded[dp]) >= 5) n += BigInt(1);
  let out = n.toString().padStart(dp + 1, "0");
  out = dp > 0 ? `${out.slice(0, -dp)}.${out.slice(-dp)}` : out;
  return neg && /[1-9]/.test(out) ? `-${out}` : out;
}

export const fmtSqm = (v: Num) => group(toFixed(v, 2));
export const fmtSqm4 = (v: Num) => group(toFixed(v, 4));
export const fmtMoney = (v: Num) => group(toFixed(v, 2));
export const fmtAED = (v: Num) => `AED ${fmtMoney(v)}`;

export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const x = typeof d === "string" ? new Date(d) : d;
  return x.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}
export function fmtDateTime(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
export const isoDate = (d: Date) => d.toISOString().slice(0, 10);
export const todayIso = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
};
export const titleCase = (s: string) =>
  s.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
/** Value for an <input type="datetime-local"> in the server's local time, `minutes` from now (rounded to 5 min). */
export const localDateTimeInput = (minutes = 0) => {
  const n = new Date(Date.now() + minutes * 60_000);
  n.setMinutes(Math.round(n.getMinutes() / 5) * 5, 0, 0);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}T${p(n.getHours())}:${p(n.getMinutes())}`;
};
