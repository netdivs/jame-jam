// Reading and saving business policy settings (TD-039). Values are stored as {"v": value} so "off" (null) is a
// normal value; a missing or no-longer-valid row falls back to the registry default.
import { Prisma } from "@prisma/client";
import { AppError, Ctx, D, Tx, assertCan, audit, inTx, prisma } from "../core";
import { SETTINGS, SETTING_KEYS, type SettingDef, type SettingKey, type SettingValue, type SettingValues } from "./registry";

export * from "./registry";

type Db = Tx | typeof prisma;
type Stored = boolean | number | string | null;

/** A stored value if it still fits the definition (options or limits may have changed), else undefined. */
function readStored(def: SettingDef, raw: unknown): Stored | undefined {
  const v = raw && typeof raw === "object" && "v" in raw ? (raw as { v: unknown }).v : undefined;
  if (v === undefined) return undefined;
  try {
    return coerce(def, v, "");
  } catch {
    return undefined;
  }
}

/** Form or JSON input → the stored value, or AppError VALIDATION with the field named by `field`. */
function coerce(def: SettingDef, input: unknown, field: string): Stored {
  const bad = (msg: string): never => {
    throw new AppError("VALIDATION", `${def.label}: ${msg}`, { fields: { [field]: msg } });
  };
  switch (def.kind) {
    case "bool":
      if (typeof input === "boolean") return input;
      if (input === "true" || input === "on" || input === "yes") return true;
      if (input === "false" || input === "off" || input === "no") return false;
      return bad("choose yes or no");
    case "int": {
      const s = String(input ?? "").trim();
      if (!/^-?\d+$/.test(s)) return bad("enter a whole number");
      const n = Number(s);
      if (n < def.min || n > def.max) return bad(`between ${def.min} and ${def.max}`);
      return n;
    }
    case "decimal": {
      if (input === null) return null;
      const s = String(input ?? "").trim().replace(/,/g, "");
      if (s === "") return null;
      if (!/^\d+(\.\d+)?$/.test(s)) return bad("enter a number, or leave it empty to switch the check off");
      const d = D(s);
      if (d.decimalPlaces() > def.dp) return bad(`at most ${def.dp} decimals`);
      if (d.lt(def.min)) return bad(`at least ${def.min}`);
      if (def.max !== undefined && d.gt(def.max)) return bad(`at most ${def.max}`);
      return d.toString();
    }
    case "enum": {
      const s = String(input ?? "");
      if (!def.options.some((o) => o.value === s)) return bad("choose one of the options");
      return s;
    }
  }
}

/** One setting's value (registry default when not set). Pass `tx` inside a transaction. */
export async function getSetting<K extends SettingKey>(key: K, db: Db = prisma): Promise<SettingValue<K>> {
  const row = await db.systemSetting.findUnique({ where: { key } });
  const v = row ? readStored(SETTINGS[key], row.value) : undefined;
  return (v === undefined ? SETTINGS[key].default : v) as SettingValue<K>;
}

/** Every setting's value. */
export async function getSettings(db: Db = prisma): Promise<SettingValues> {
  const rows = await db.systemSetting.findMany();
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const out: Record<string, Stored> = {};
  for (const key of SETTING_KEYS) {
    const v = byKey.has(key) ? readStored(SETTINGS[key], byKey.get(key)) : undefined;
    out[key] = v === undefined ? SETTINGS[key].default : v;
  }
  return out as SettingValues;
}

/**
 * Save the settings present in `raw` (a form sends one group at a time; keys not in the registry are ignored).
 * Only changed values are written and audited.
 */
export async function saveSystemSettings(ctx: Ctx, raw: Record<string, unknown>) {
  assertCan(ctx, "settings.edit");
  const next = new Map<SettingKey, Stored>();
  for (const key of SETTING_KEYS) if (key in raw) next.set(key, coerce(SETTINGS[key], raw[key], key));
  if (next.size === 0) throw new AppError("VALIDATION", "Nothing to save");

  return inTx(async (tx) => {
    const current = await getSettings(tx);
    const before: Record<string, Stored> = {};
    const after: Record<string, Stored> = {};
    for (const [key, value] of next) {
      if (current[key] === value) continue;
      before[key] = current[key];
      after[key] = value;
      const json = { v: value } as Prisma.InputJsonValue;
      await tx.systemSetting.upsert({ where: { key }, create: { key, value: json, updatedById: ctx.userId }, update: { value: json, updatedById: ctx.userId } });
    }
    if (Object.keys(after).length) await audit(tx, ctx, { action: "update", entity: "SystemSetting", entityId: "policy", before, after });
    return { changed: Object.keys(after) as SettingKey[] };
  });
}
