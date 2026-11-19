"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { formObject, runAction, type ActionState } from "@/lib/action";
import { saveBankAccount } from "@/server/accounting/banks";
import { postManualJournal, reverseManualJournal } from "@/server/accounting/journals";

export async function saveBankAction(id: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (u) => {
    const b = await saveBankAccount(u.ctx, id, formObject(fd));
    return id ? `Bank account ${b.name} saved` : `Bank account ${b.name} added (${b.code})`;
  });
  if (r.ok) {
    revalidatePath("/accounts/banks");
    revalidatePath("/accounts/chart");
  }
  return r;
}

function json(fd: FormData): unknown {
  try {
    return JSON.parse(String(fd.get("payload") ?? "{}"));
  } catch {
    return {};
  }
}

export async function postJvAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id = "";
  const r = await runAction(async (u) => {
    id = (await postManualJournal(u.ctx, json(fd))).id;
  });
  if (!r.ok) return r;
  revalidatePath("/accounts", "layout");
  redirect(`/accounts/journals/${id}`);
}

export async function reverseJvAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (u) => {
    const rev = await reverseManualJournal(u.ctx, id, { date: String(fd.get("date") ?? ""), reason: String(fd.get("reason") ?? "") });
    return `Reversed by ${rev.number}`;
  });
  if (r.ok) revalidatePath("/accounts", "layout");
  return r;
}
