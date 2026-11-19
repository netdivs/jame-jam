// Business policy settings (TD-039). Every behaviour that differs between businesses is a setting here, not code:
// the registry holds each key's type, default, limits and help text; SystemSetting rows hold only the values that
// differ from the default. Rule for new settings: the default keeps the behaviour the system had before the setting
// existed, so adding a setting never changes a running business.
//
// Adding a setting = one entry below + reading it with getSetting() where the rule is enforced. The settings page
// renders it from this registry.

export type SettingGroup = "purchase" | "landedCost" | "refunds";

export const SETTING_GROUPS: { key: SettingGroup; title: string; description: string }[] = [
  { key: "purchase", title: "Purchasing", description: "When goods may be received and how supplier invoices and payments are checked." },
  { key: "landedCost", title: "Landed cost", description: "How import costs are treated." },
  { key: "refunds", title: "Refunds", description: "Controls on paying money back." },
];

type Base = { group: SettingGroup; label: string; help: string };
export type BoolDef = Base & { kind: "bool"; default: boolean };
export type IntDef = Base & { kind: "int"; default: number; min: number; max: number; unit?: string };
/** A decimal with "off" (null) allowed: an empty field switches the rule off. Kept as a string for Decimal. */
export type DecimalDef = Base & { kind: "decimal"; default: string | null; min: number; max?: number; dp: number; unit?: string };
export type EnumDef<V extends string = string> = Base & { kind: "enum"; default: V; options: readonly { value: V; label: string }[] };
export type SettingDef = BoolDef | IntDef | DecimalDef | EnumDef;

export const SETTINGS = {
  "purchase.receiveBeforePayment": {
    group: "purchase",
    kind: "enum",
    label: "Receive goods before full payment",
    help: "Never: goods are collected and received (GRN) only after the PO is 100% paid and the payment verified. Credit suppliers: suppliers marked \"credit allowed\" skip that check; the bill is paid later from Accounts Payable. Always: no supplier needs prior payment.",
    default: "NEVER",
    options: [
      { value: "NEVER", label: "Never — 100% paid and verified first" },
      { value: "CREDIT_SUPPLIERS", label: "Only suppliers with credit allowed" },
      { value: "ALWAYS", label: "Always allowed" },
    ],
  },
  "purchase.invoiceOverPoTolerancePct": {
    group: "purchase",
    kind: "decimal",
    label: "Supplier invoice above PO — tolerance (%)",
    help: "A supplier invoice for a PO whose invoiced total goes more than this % above the PO total can be posted only by a user who can approve POs, with a reason. Empty = no check.",
    default: null,
    min: 0,
    max: 100,
    dp: 2,
    unit: "%",
  },
  "purchase.bankChargesTreatment": {
    group: "landedCost",
    kind: "enum",
    label: "Bank charges on supplier payments",
    help: "Landed cost: record them as a landed cost bill (category Bank Charges) so they are added to the stock cost. Expense: enter them on the supplier payment; they post to the Bank Charges expense account.",
    default: "LANDED_COST",
    options: [
      { value: "LANDED_COST", label: "Landed cost (added to stock cost)" },
      { value: "EXPENSE", label: "Expense (Bank Charges account)" },
    ],
  },
  "refunds.cashLimit": {
    group: "refunds",
    kind: "decimal",
    label: "Cash refund limit (AED)",
    help: "A refund paid in cash above this amount needs the \"refund above the cash limit\" permission. Empty = no limit.",
    default: null,
    min: 0,
    dp: 2,
    unit: "AED",
  },
} as const satisfies Record<string, SettingDef>;

export type SettingKey = keyof typeof SETTINGS;

type ValueOfDef<D> = D extends { kind: "bool" }
  ? boolean
  : D extends { kind: "int" }
    ? number
    : D extends { kind: "decimal" }
      ? string | null
      : D extends { kind: "enum"; options: readonly { value: infer V }[] }
        ? V
        : never;

export type SettingValue<K extends SettingKey> = ValueOfDef<(typeof SETTINGS)[K]>;
export type SettingValues = { [K in SettingKey]: SettingValue<K> };

export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];
export const settingDef = (key: SettingKey): SettingDef => SETTINGS[key];
