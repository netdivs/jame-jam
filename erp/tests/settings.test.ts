// Business policy settings (TD-039): registry defaults, validation, save + audit, permission.
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/server/core";
import { SETTINGS, SETTING_KEYS, getSetting, getSettings, saveSystemSettings } from "../src/server/settings";
import { saveBusinessRules } from "../src/server/masters";
import { ctxFor } from "./helpers";

afterAll(async () => {
  await prisma.systemSetting.deleteMany();
});

describe("system settings", () => {
  it("returns registry defaults when nothing is stored", async () => {
    await prisma.systemSetting.deleteMany();
    const all = await getSettings();
    for (const k of SETTING_KEYS) expect(all[k], k).toEqual(SETTINGS[k].default);
    expect(await getSetting("purchase.receiveBeforePayment")).toBe("NEVER");
    expect(await getSetting("refunds.cashLimit")).toBeNull();
  });

  it("saves only changed values, audits them, and an empty decimal switches a check off", async () => {
    const owner = await ctxFor("owner");
    const r = await saveSystemSettings(owner, { "purchase.receiveBeforePayment": "CREDIT_SUPPLIERS", "refunds.cashLimit": "1,000.50", "purchase.bankChargesTreatment": "LANDED_COST", unknownKey: "x" });
    expect(r.changed.sort()).toEqual(["purchase.receiveBeforePayment", "refunds.cashLimit"]);
    expect(await getSetting("purchase.receiveBeforePayment")).toBe("CREDIT_SUPPLIERS");
    expect(await getSetting("refunds.cashLimit")).toBe("1000.5");
    const log = await prisma.auditLog.findFirstOrThrow({ where: { entity: "SystemSetting" }, orderBy: { createdAt: "desc" } });
    expect(log.before).toEqual({ "purchase.receiveBeforePayment": "NEVER", "refunds.cashLimit": null });
    expect(log.after).toEqual({ "purchase.receiveBeforePayment": "CREDIT_SUPPLIERS", "refunds.cashLimit": "1000.5" });

    await saveSystemSettings(owner, { "refunds.cashLimit": "" });
    expect(await getSetting("refunds.cashLimit")).toBeNull();
    expect((await saveSystemSettings(owner, { "refunds.cashLimit": "" })).changed).toEqual([]);
  });

  it("rejects values outside the definition with a field error", async () => {
    const owner = await ctxFor("owner");
    await expect(saveSystemSettings(owner, { "purchase.receiveBeforePayment": "SOMETIMES" })).rejects.toMatchObject({ code: "VALIDATION", details: { fields: { "purchase.receiveBeforePayment": expect.any(String) } } });
    await expect(saveSystemSettings(owner, { "purchase.invoiceOverPoTolerancePct": "150" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(saveSystemSettings(owner, { "purchase.invoiceOverPoTolerancePct": "2.555" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(saveSystemSettings(owner, { "refunds.cashLimit": "-5" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(saveSystemSettings(owner, {})).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("falls back to the default when a stored value no longer fits", async () => {
    await prisma.systemSetting.upsert({ where: { key: "purchase.receiveBeforePayment" }, create: { key: "purchase.receiveBeforePayment", value: { v: "REMOVED_OPTION" } }, update: { value: { v: "REMOVED_OPTION" } } });
    expect(await getSetting("purchase.receiveBeforePayment")).toBe("NEVER");
    await prisma.systemSetting.deleteMany();
  });

  it("only users with settings.edit can change settings or core rules", async () => {
    for (const role of ["manager", "accountant", "sales", "storekeeper"]) {
      const ctx = await ctxFor(role);
      await expect(saveSystemSettings(ctx, { "refunds.cashLimit": "10" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(saveBusinessRules(ctx, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("saves core rules separately from company details and audits only those fields", async () => {
    const owner = await ctxFor("owner");
    const before = await prisma.companySetting.findUniqueOrThrow({ where: { id: 1 } });
    await saveBusinessRules(owner, { vatRate: "5", defaultPriceMode: "INCLUSIVE", piValidityDays: "20", soReservationDays: String(before.soReservationDays), poApprovalMode: before.poApprovalMode, poApprovalThreshold: before.poApprovalThreshold.toString(), landedCostDefaultBasis: before.landedCostDefaultBasis, pdcReminderDays: String(before.pdcReminderDays) });
    const after = await prisma.companySetting.findUniqueOrThrow({ where: { id: 1 } });
    expect(after.piValidityDays).toBe(20);
    expect(after.displayName).toBe(before.displayName);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { entity: "CompanySetting" }, orderBy: { createdAt: "desc" } });
    expect(Object.keys(log.after as object)).not.toContain("displayName");
    await prisma.companySetting.update({ where: { id: 1 }, data: { piValidityDays: before.piValidityDays } });
  });
});
