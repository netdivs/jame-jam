// TD-056: logo / stamp on documents and petty cash receipt scans, stored in the database.
import { afterAll, describe, expect, it } from "vitest";
import { AppError, prisma, today } from "../src/server/core";
import { attachPettyReceipt, companyImages, readFile, setCompanyImage, sniff } from "../src/server/files";
import { recordPettyExpense, recordPettyTopUp, savePettyCashBox } from "../src/server/accounting/petty-cash";
import { companyHeader } from "../src/server/print/documents";
import { renderPdf } from "../src/server/print/pdf";
import { ctxFor, uid } from "./helpers";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PDF = Buffer.from("%PDF-1.4\n%fake\n");
const NOW = today().toISOString().slice(0, 10);

async function expectError(p: Promise<unknown>, code: string, message?: RegExp) {
  const e = await p.then(() => null, (err: unknown) => err);
  expect(e).toBeInstanceOf(AppError);
  expect((e as AppError).code).toBe(code);
  if (message) expect((e as AppError).message).toMatch(message);
}

afterAll(async () => {
  await prisma.companySetting.update({ where: { id: 1 }, data: { logoFileId: null, stampFileId: null } });
  await prisma.storedFile.deleteMany({ where: { kind: { in: ["LOGO", "STAMP"] } } });
});

describe("uploaded files (TD-056)", () => {
  it("type comes from the bytes, not the name", () => {
    expect(sniff(PNG)?.mime).toBe("image/png");
    expect(sniff(JPG)?.mime).toBe("image/jpeg");
    expect(sniff(PDF)?.mime).toBe("application/pdf");
    expect(sniff(Buffer.from("<svg onload=alert(1)>"))).toBeNull();
  });

  it("logo and stamp: owner only, images only, ≤ 1 MB; replaced and removed; printed on documents", async () => {
    const owner = await ctxFor("owner");
    await expectError(setCompanyImage(await ctxFor("manager"), "LOGO", { name: "l.png", bytes: PNG }), "FORBIDDEN");
    await expectError(setCompanyImage(owner, "LOGO", { name: "logo.png", bytes: Buffer.from("not an image") }), "VALIDATION", /only PNG, JPEG/);
    await expectError(setCompanyImage(owner, "LOGO", { name: "logo.pdf", bytes: PDF }), "VALIDATION", /only PNG, JPEG/);
    await expectError(setCompanyImage(owner, "STAMP", { name: "big.png", bytes: Buffer.concat([PNG, Buffer.alloc(1_000_001)]) }), "VALIDATION", /at most 1 MB/);

    const first = await setCompanyImage(owner, "LOGO", { name: "logo<script>.png", bytes: PNG });
    expect(first!.fileName).toBe("logo_script_.png");
    const second = await setCompanyImage(owner, "LOGO", { name: "logo2.png", bytes: PNG });
    expect(await prisma.storedFile.findUnique({ where: { id: first!.id } })).toBeNull(); // old one deleted
    await setCompanyImage(owner, "STAMP", { name: "stamp.png", bytes: PNG });
    const imgs = await companyImages();
    expect([imgs.logo?.format, imgs.stamp?.format]).toEqual(["png", "png"]);

    // Any signed-in user may read the logo (it is on every document).
    expect((await readFile(await ctxFor("sales"), second!.id)).mimeType).toBe("image/png");

    // A real PDF with logo and stamp.
    const doc = { title: "Test", number: "T-1", fileName: "t", facts: [] as [string, string][], columns: [{ key: "a", label: "A" }], rows: [{ a: "1" }], signatures: ["Prepared by", "Customer"] };
    const pdf = await renderPdf(doc, await companyHeader());
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");

    await setCompanyImage(owner, "LOGO", null);
    expect((await prisma.companySetting.findUniqueOrThrow({ where: { id: 1 } })).logoFileId).toBeNull();
    expect(await prisma.auditLog.count({ where: { entity: "CompanySetting", action: { in: ["upload", "remove"] } } })).toBeGreaterThanOrEqual(4);
  });

  it("petty cash receipt: image or PDF ≤ 2 MB, expenses only; readable only with petty cash access", async () => {
    const owner = await ctxFor("owner");
    const acct = await ctxFor("accountant");
    const box = await savePettyCashBox(owner, null, { name: `Receipts ${uid()}`, active: "true" });
    const top = await recordPettyTopUp(acct, { pettyCashAccountId: box.id, date: NOW, amount: "500", mode: "CASH" });
    const cat = await prisma.expenseCategory.findFirstOrThrow({ where: { active: true } });
    const sr = await prisma.taxCode.findUniqueOrThrow({ where: { code: "SR" } });
    const exp = await recordPettyExpense(acct, { pettyCashAccountId: box.id, date: NOW, amount: "52.50", categoryId: cat.id, taxCodeId: sr.id, payee: "Hardware shop", description: "Hinges" });
    await expectError(attachPettyReceipt(acct, top.id, { name: "r.pdf", bytes: PDF }), "VALIDATION", /attached to expenses/);
    await expectError(attachPettyReceipt(await ctxFor("sales"), exp.id, { name: "r.pdf", bytes: PDF }), "FORBIDDEN");
    await expectError(attachPettyReceipt(acct, exp.id, { name: "r.pdf", bytes: Buffer.concat([PDF, Buffer.alloc(2_000_001)]) }), "VALIDATION", /2 MB/);
    const f = await attachPettyReceipt(acct, exp.id, { name: "receipt.pdf", bytes: PDF });
    expect((await prisma.pettyCashTransaction.findUniqueOrThrow({ where: { id: exp.id } })).attachmentFileId).toBe(f.id);
    expect((await readFile(owner, f.id)).data.subarray(0, 5).toString()).toBe("%PDF-");
    await expectError(readFile(await ctxFor("sales"), f.id), "NOT_FOUND");
    const again = await attachPettyReceipt(acct, exp.id, { name: "photo.jpg", bytes: JPG });
    expect(await prisma.storedFile.findUnique({ where: { id: f.id } })).toBeNull();
    expect(again.mimeType).toBe("image/jpeg");
  });
});
