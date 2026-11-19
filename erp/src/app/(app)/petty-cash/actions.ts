"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { formObject, runAction, withPaidFrom, type ActionState } from "@/lib/action";
import { attachPettyReceipt } from "@/server/files";
import { cancelPettyTransaction, recordPettyExpense, recordPettyTopUp, saveExpenseCategory, savePettyCashBox } from "@/server/accounting/petty-cash";

export async function pettyAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id = "";
  const r = await runAction(async (u) => {
    const o = formObject(fd);
    id = (o.type === "TOP_UP" ? await recordPettyTopUp(u.ctx, withPaidFrom(o)) : await recordPettyExpense(u.ctx, o)).id;
  });
  if (!r.ok) return r;
  revalidatePath("/petty-cash", "layout");
  redirect(`/petty-cash/${id}`);
}

export async function cancelPettyAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (u) => {
    const t = await cancelPettyTransaction(u.ctx, id, formObject(fd));
    return `${t.number} cancelled — the reverse entry is posted`;
  });
  if (r.ok) revalidatePath("/petty-cash", "layout");
  return r;
}

export async function saveBoxAction(id: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (u) => {
    const b = await savePettyCashBox(u.ctx, id, formObject(fd));
    return `${b.name} saved`;
  });
  if (r.ok) revalidatePath("/petty-cash", "layout");
  return r;
}

export async function saveCategoryAction(id: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (u) => {
    const c = await saveExpenseCategory(u.ctx, id, formObject(fd));
    return `Category ${c.name} saved`;
  });
  if (r.ok) revalidatePath("/petty-cash", "layout");
  return r;
}

/** Attach (or replace) the receipt scan of a petty cash expense; field `file`. */
export async function attachReceiptAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (u) => {
    const f = fd.get("file");
    await attachPettyReceipt(u.ctx, id, f instanceof File ? { name: f.name, bytes: Buffer.from(await f.arrayBuffer()) } : { name: "", bytes: Buffer.alloc(0) });
    return "Receipt attached";
  });
  if (r.ok) revalidatePath(`/petty-cash/${id}`);
  return r;
}
