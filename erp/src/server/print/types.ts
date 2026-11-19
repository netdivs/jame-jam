// A printable document in a neutral shape (TX-01, TD-035). Builders map stored documents to this; the PDF
// renderer lays it out. Every figure is a pre-formatted string from the stored values (never recomputed).
export type PrintColumn = { key: string; label: string; align?: "left" | "right"; width?: number };
export type PrintDoc = {
  title: string;
  number: string;
  /** Right-hand header facts: date, status, references… */
  facts: [string, string][];
  /** "Bill to", "Supplier", "Customer"… with its lines (name, address, TRN…). */
  party?: { label: string; lines: string[] };
  /** Optional second block (e.g. delivery / shipment details). */
  extra?: { label: string; lines: string[] };
  columns: PrintColumn[];
  rows: Record<string, string>[];
  totals?: [string, string][];
  notes?: string[];
  /** Signature boxes at the bottom (e.g. "Prepared by", "Received by"). */
  signatures?: string[];
  /** File name without extension. */
  fileName: string;
};

export type CompanyImage = { data: Buffer; format: "png" | "jpg" };
export type CompanyHeader = { name: string; lines: string[]; bank?: string[]; logo?: CompanyImage | null; stamp?: CompanyImage | null };
