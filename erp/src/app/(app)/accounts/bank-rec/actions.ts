"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { formObject, runAction, type ActionState } from "@/lib/action";
import {
  addStatementLine,
  autoMatch,
  deleteStatementLine,
  importStatementCsv,
  matchStatementLine,
  postChargeFromStatement,
  reopenReconciliation,
  saveReconciliation,
  unmatchStatementLine,
} from "@/server/accounting/bank-rec";
import { fmtMoney } from "@/lib/format";
import { AppError } from "@/server/core";

const touch = (bankId: string) => {
  revalidatePath(`/accounts/bank-rec/${bankId}`);
  revalidatePath("/accounts/bank-rec");
};

export async function addLineAction(bankId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (u) => {
    await addStatementLine(u.ctx, { ...formObject(fd), bankAccountId: bankId });
    return "Statement line added";
  });
  if (r.ok) touch(bankId);
  return r;
}

export async function deleteLineAction(bankId: string, lineId: string, _: ActionState): Promise<ActionState> {
  const r = await runAction(async (u) => {
    await deleteStatementLine(u.ctx, lineId);
    return "Statement line deleted";
  });
  if (r.ok) touch(bankId);
  return r;
}

export async function matchAction(bankId: string, lineId: string, back: boolean, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (u) => {
    await matchStatementLine(u.ctx, lineId, fd.getAll("journalLineIds").map(String));
    return "Matched";
  });
  if (!r.ok) return r;
  touch(bankId);
  if (back) redirect(`/accounts/bank-rec/${bankId}`);
  return r;
}

export async function unmatchAction(bankId: string, lineId: string, _: ActionState): Promise<ActionState> {
  const r = await runAction(async (u) => {
    await unmatchStatementLine(u.ctx, lineId);
    return "Unmatched";
  });
  if (r.ok) touch(bankId);
  return r;
}

export async function chargeAction(bankId: string, lineId: string, _: ActionState): Promise<ActionState> {
  const r = await runAction(async (u) => {
    const e = await postChargeFromStatement(u.ctx, lineId);
    return `Bank charges posted (${e.number}) and matched`;
  });
  if (r.ok) touch(bankId);
  return r;
}

export async function autoMatchAction(bankId: string, _: ActionState): Promise<ActionState> {
  const r = await runAction(async (u) => {
    const n = await autoMatch(u.ctx, bankId);
    return n === 0 ? "Nothing to match automatically" : `${n} line${n === 1 ? "" : "s"} matched`;
  });
  if (r.ok) touch(bankId);
  return r;
}

export async function saveRecAction(bankId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (u) => {
    await saveReconciliation(u.ctx, { ...formObject(fd), bankAccountId: bankId });
    return "Reconciliation saved — the period is locked";
  });
  if (r.ok) touch(bankId);
  return r;
}

export async function reopenRecAction(bankId: string, recId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (u) => {
    await reopenReconciliation(u.ctx, recId, String(fd.get("reason") ?? ""));
    return "Reconciliation reopened";
  });
  if (r.ok) touch(bankId);
  return r;
}

export async function importAction(bankId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (u) => {
    const res = await importStatementCsv(u.ctx, { ...formObject(fd), bankAccountId: bankId });
    const summary = `${res.lines} line${res.lines === 1 ? "" : "s"} (in ${fmtMoney(res.moneyIn)}, out ${fmtMoney(res.moneyOut)})${res.duplicates ? `, ${res.duplicates} already on file skipped` : ""}`;
    if (res.errors.length) throw new AppError("VALIDATION", `Nothing imported. Fix these lines: ${res.errors.slice(0, 8).join("; ")}${res.errors.length > 8 ? ` … and ${res.errors.length - 8} more` : ""}`);
    return res.imported ? `Imported ${summary}` : `Ready to import ${summary}. Press Import to save them.`;
  });
  if (r.ok && !String(fd.get("dryRun") ?? "").startsWith("true")) touch(bankId);
  return r;
}
