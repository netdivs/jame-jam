"use server";
import { revalidatePath } from "next/cache";
import { formObject, runAction, type ActionState } from "@/lib/action";
import { applyAdvanceToOpeningInvoice, cancelOpeningItem, postOpeningTrialBalance, recordOpeningItem } from "@/server/accounting/opening";

const touch = () => {
  revalidatePath("/accounts/opening", "layout");
  revalidatePath("/accounts/ledgers", "layout");
};

export async function openingItemAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (u) => {
    const item = await recordOpeningItem(u.ctx, formObject(fd));
    return `Opening balance ${item.number} posted`;
  });
  if (r.ok) touch();
  return r;
}

export async function applyAdvanceAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (u) => {
    await applyAdvanceToOpeningInvoice(u.ctx, id, formObject(fd));
    return "Advance applied to the invoice";
  });
  if (r.ok) touch();
  return r;
}

export async function cancelOpeningAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (u) => {
    const item = await cancelOpeningItem(u.ctx, id, String(fd.get("reason") ?? ""));
    return `${item.number} cancelled — the reverse entry is posted`;
  });
  if (r.ok) touch();
  return r;
}

/** Trial balance sheet: fields dr_<accountId> / cr_<accountId>. */
export async function openingTbAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const o = formObject(fd);
  const ids = new Set(Object.keys(o).filter((k) => /^(dr|cr)_/.test(k)).map((k) => k.slice(3)));
  const lines = [...ids].map((accountId) => ({ accountId, debit: o[`dr_${accountId}`] || undefined, credit: o[`cr_${accountId}`] || undefined })).filter((l) => l.debit || l.credit);
  const r = await runAction(async (u) => {
    const e = await postOpeningTrialBalance(u.ctx, { date: o.date, memo: o.memo, lines });
    return `Opening trial balance posted (${e.number})`;
  });
  if (r.ok) touch();
  return r;
}
