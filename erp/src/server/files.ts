// Uploaded files (TD-056): company logo and stamp (printed on documents) and petty cash receipt scans. Kept in the
// database (StoredFile.data): small files, covered by the database backup, no volume to manage.
//  - Type is checked from the file's first bytes (PNG, JPEG, PDF), never from its name or the browser's claim.
//  - Logo / stamp: PNG or JPEG, ≤ 1 MB, settings.edit. Petty receipts: PNG, JPEG or PDF, ≤ 2 MB, pettyCash.manage.
//  - Reading: logo / stamp by any signed-in user (they are on every document); petty receipts with pettyCash.view.
import { createHash } from "node:crypto";
import type { FileKind } from "@prisma/client";
import { AppError, Ctx, assertCan, audit, can, inTx, prisma } from "./core";

type Upload = { name: string; bytes: Buffer };
type Sniffed = { mime: "image/png" | "image/jpeg" | "application/pdf"; ext: "png" | "jpg" | "pdf" };

export function sniff(bytes: Buffer): Sniffed | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: "image/png", ext: "png" };
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString("latin1") === "%PDF-") return { mime: "application/pdf", ext: "pdf" };
  return null;
}

const RULES: Record<FileKind, { types: Sniffed["mime"][]; max: number; label: string }> = {
  LOGO: { types: ["image/png", "image/jpeg"], max: 1_000_000, label: "Logo" },
  STAMP: { types: ["image/png", "image/jpeg"], max: 1_000_000, label: "Stamp" },
  PETTY_RECEIPT: { types: ["image/png", "image/jpeg", "application/pdf"], max: 2_000_000, label: "Receipt" },
};

function check(kind: FileKind, f: Upload, field: string) {
  const r = RULES[kind];
  if (f.bytes.length === 0) throw new AppError("VALIDATION", `${r.label}: choose a file`, { fields: { [field]: "Choose a file" } });
  if (f.bytes.length > r.max) throw new AppError("VALIDATION", `${r.label}: at most ${r.max / 1_000_000} MB`, { fields: { [field]: `At most ${r.max / 1_000_000} MB` } });
  const s = sniff(f.bytes);
  if (!s || !r.types.includes(s.mime)) throw new AppError("VALIDATION", `${r.label}: only ${r.types.map((t) => t.split("/")[1].toUpperCase()).join(", ")} files`, { fields: { [field]: "Unsupported file type" } });
  return s;
}

async function store(tx: Parameters<Parameters<typeof inTx>[0]>[0], ctx: Ctx, kind: FileKind, f: Upload, s: Sniffed) {
  const safeName = f.name.replace(/[^A-Za-z0-9._ -]/g, "_").slice(0, 120) || `file.${s.ext}`;
  return tx.storedFile.create({ data: { kind, fileName: safeName, mimeType: s.mime, size: f.bytes.length, sha256: createHash("sha256").update(f.bytes).digest("hex"), data: new Uint8Array(f.bytes), createdById: ctx.userId } });
}

/** Set (or with `file` null, remove) the company logo or stamp. The old file is deleted. */
export async function setCompanyImage(ctx: Ctx, kind: "LOGO" | "STAMP", file: Upload | null) {
  assertCan(ctx, "settings.edit");
  const s = file ? check(kind, file, kind === "LOGO" ? "logo" : "stamp") : null;
  const col = kind === "LOGO" ? "logoFileId" : "stampFileId";
  return inTx(async (tx) => {
    const settings = await tx.companySetting.findUniqueOrThrow({ where: { id: 1 } });
    const old = settings[col];
    const created = file && s ? await store(tx, ctx, kind, file, s) : null;
    await tx.companySetting.update({ where: { id: 1 }, data: { [col]: created?.id ?? null } });
    if (old) await tx.storedFile.deleteMany({ where: { id: old } });
    await audit(tx, ctx, { action: created ? "upload" : "remove", entity: "CompanySetting", entityId: "1", before: { [col]: old }, after: { [col]: created?.id ?? null, fileName: created?.fileName, size: created?.size } });
    return created;
  });
}

/** Attach (or replace) the receipt scan of a petty cash expense. */
export async function attachPettyReceipt(ctx: Ctx, transactionId: string, file: Upload) {
  assertCan(ctx, "pettyCash.manage");
  const s = check("PETTY_RECEIPT", file, "file");
  return inTx(async (tx) => {
    const t = await tx.pettyCashTransaction.findUnique({ where: { id: transactionId } });
    if (!t) throw new AppError("NOT_FOUND", "Petty cash entry not found");
    if (t.type !== "EXPENSE") throw new AppError("VALIDATION", "Receipts are attached to expenses");
    const created = await store(tx, ctx, "PETTY_RECEIPT", file, s);
    await tx.pettyCashTransaction.update({ where: { id: t.id }, data: { attachmentFileId: created.id } });
    if (t.attachmentFileId) await tx.storedFile.deleteMany({ where: { id: t.attachmentFileId } });
    await audit(tx, ctx, { action: "attach", entity: "PettyCashTransaction", entityId: t.id, before: { attachmentFileId: t.attachmentFileId }, after: { attachmentFileId: created.id, fileName: created.fileName, size: created.size } });
    return created;
  });
}

/** A file the user may open, or NOT_FOUND (also when not allowed, so ids cannot be probed). */
export async function readFile(ctx: Ctx, id: string) {
  const f = await prisma.storedFile.findUnique({ where: { id } });
  const allowed = f && (f.kind === "PETTY_RECEIPT" ? can(ctx, "pettyCash.view") : true);
  if (!f || !allowed) throw new AppError("NOT_FOUND", "File not found");
  return { ...f, data: Buffer.from(f.data) };
}

/** Logo and stamp for printed documents (images only; null when not set). */
export async function companyImages(): Promise<{ logo: { data: Buffer; format: "png" | "jpg" } | null; stamp: { data: Buffer; format: "png" | "jpg" } | null }> {
  const s = await prisma.companySetting.findUnique({ where: { id: 1 }, select: { logoFileId: true, stampFileId: true } });
  const load = async (id: string | null | undefined) => {
    if (!id) return null;
    const f = await prisma.storedFile.findUnique({ where: { id } });
    return f ? { data: Buffer.from(f.data), format: (f.mimeType === "image/png" ? "png" : "jpg") as "png" | "jpg" } : null;
  };
  return { logo: await load(s?.logoFileId), stamp: await load(s?.stampFileId) };
}
