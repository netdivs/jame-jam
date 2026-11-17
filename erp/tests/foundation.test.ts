import { describe, expect, it } from "vitest";
import { AppError, D, inTx, nextDocNumber, prisma, systemCtx } from "../src/server/core";
import { postJournal } from "../src/server/accounting/gl";
import { saveCustomer, saveProduct } from "../src/server/masters";
import { ctxFor, uid } from "./helpers";

describe("document numbering", () => {
  it("issues PREFIX-YYNNNN numbers in sequence, restarting per year", async () => {
    const a = await inTx((tx) => nextDocNumber(tx, "SO", new Date(Date.UTC(2031, 2, 1))));
    const b = await inTx((tx) => nextDocNumber(tx, "SO", new Date(Date.UTC(2031, 5, 1))));
    const c = await inTx((tx) => nextDocNumber(tx, "SO", new Date(Date.UTC(2032, 0, 1))));
    expect([a, b, c]).toEqual(["SO-310001", "SO-310002", "SO-320001"]);
  });

  it("never issues the same number to concurrent transactions", async () => {
    const date = new Date(Date.UTC(2033, 0, 1));
    const nums = await Promise.all(Array.from({ length: 10 }, () => inTx((tx) => nextDocNumber(tx, "TI", date))));
    expect(new Set(nums).size).toBe(10);
  });

  it("gives the number back when the transaction rolls back (gap-free)", async () => {
    const date = new Date(Date.UTC(2034, 0, 1));
    await expect(
      inTx(async (tx) => {
        await nextDocNumber(tx, "PO", date);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await inTx((tx) => nextDocNumber(tx, "PO", date))).toBe("PO-340001");
  });
});

describe("GL posting engine", () => {
  const date = new Date(Date.UTC(2026, 0, 10));

  it("rejects an unbalanced journal", async () => {
    await expect(
      inTx((tx) =>
        postJournal(tx, systemCtx, {
          date,
          sourceType: "TEST",
          lines: [
            { account: "CASH", debit: D(100) },
            { account: "OWNER_CAPITAL", credit: D(99.99) },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "UNBALANCED" });
  });

  it("rejects posting to a group account or an unknown key", async () => {
    await expect(
      inTx((tx) =>
        postJournal(tx, systemCtx, {
          date,
          sourceType: "TEST",
          lines: [
            { account: "NOPE", debit: D(1) },
            { account: "CASH", credit: D(1) },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("posts a balanced journal with a JE number", async () => {
    const je = await inTx((tx) =>
      postJournal(tx, systemCtx, {
        date,
        sourceType: "TEST",
        lines: [
          { account: "CASH", debit: D("250.555") }, // rounds to 250.56
          { account: "OWNER_CAPITAL", credit: D("250.555") },
        ],
      }),
    );
    expect(je.number).toMatch(/^JE-26\d{4}$/);
    expect(je.lines.map((l) => l.debit.toString())).toContain("250.56");
  });

  it("refuses to post into a locked period", async () => {
    const locked = new Date(Date.UTC(2035, 3, 15));
    await inTx((tx) =>
      postJournal(tx, systemCtx, {
        date: locked,
        sourceType: "TEST",
        lines: [
          { account: "CASH", debit: D(1) },
          { account: "OWNER_CAPITAL", credit: D(1) },
        ],
      }),
    );
    await prisma.period.update({ where: { year_month: { year: 2035, month: 4 } }, data: { locked: true } });
    await expect(
      inTx((tx) =>
        postJournal(tx, systemCtx, {
          date: locked,
          sourceType: "TEST",
          lines: [
            { account: "CASH", debit: D(1) },
            { account: "OWNER_CAPITAL", credit: D(1) },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "PERIOD_LOCKED" });
  });
});

describe("masters & permissions", () => {
  it("validates TRN format and auto-numbers customer codes", async () => {
    const owner = await ctxFor("owner");
    await expect(saveCustomer(owner, null, { name: "Bad TRN", trn: "12345" })).rejects.toMatchObject({ code: "VALIDATION" });
    const c = await saveCustomer(owner, null, { name: `Cust ${uid()}`, trn: "100 1234 5678 0003" });
    expect(c!.code).toMatch(/^CUS-\d{4}$/);
    expect(c!.trn).toBe("100123456780003");
  });

  it("blocks users without permission at the service layer", async () => {
    const store = await ctxFor("storekeeper");
    await expect(saveCustomer(store, null, { name: "Nope" })).rejects.toBeInstanceOf(AppError);
    await expect(saveProduct(store, null, { itemCode: "X1", name: "X", type: "TILE" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("writes an audit log row for every master change", async () => {
    const owner = await ctxFor("owner");
    const c = await saveCustomer(owner, null, { name: `Audit ${uid()}` });
    const logs = await prisma.auditLog.findMany({ where: { entity: "Customer", entityId: c!.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0].userId).toBe(owner.userId);
  });
});
