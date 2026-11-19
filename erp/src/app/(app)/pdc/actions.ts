"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { formObject, runAction, type ActionState } from "@/lib/action";
import { changeChequeStatus, recordIssuedCheque, recordReceivedCheque, replaceReceivedCheque } from "@/server/receipts/cheques";

function refresh() {
  revalidatePath("/pdc", "layout");
  revalidatePath("/sales", "layout");
  revalidatePath("/purchase", "layout");
  revalidatePath("/");
}

export async function recordChequeAction(direction: "RECEIVED" | "ISSUED", _: ActionState, fd: FormData): Promise<ActionState> {
  let id = "";
  const r = await runAction(async (u) => {
    const o = formObject(fd);
    id = (direction === "RECEIVED" ? await recordReceivedCheque(u.ctx, o) : await recordIssuedCheque(u.ctx, o)).id;
  });
  if (!r.ok) return r;
  refresh();
  redirect(`/pdc/${id}`);
}

export async function chequeStatusAction(id: string, action: "deposit" | "clear" | "bounce" | "cancel", _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (u) => {
    const c = await changeChequeStatus(u.ctx, id, { ...formObject(fd), action });
    return `Cheque ${c.chequeNo}: ${c.status.toLowerCase()}`;
  });
  if (r.ok) refresh();
  return r;
}

export async function replaceChequeAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  let newId = "";
  const r = await runAction(async (u) => {
    newId = (await replaceReceivedCheque(u.ctx, id, formObject(fd))).id;
  });
  if (!r.ok) return r;
  refresh();
  redirect(`/pdc/${newId}`);
}
