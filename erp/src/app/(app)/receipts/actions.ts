"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { formObject, runAction, withPaidFrom, type ActionState } from "@/lib/action";
import { cancelCustomerReceipt, recordCustomerReceipt } from "@/server/receipts/receipts";

export async function receiptAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id = "";
  const r = await runAction(async (u) => {
    id = (await recordCustomerReceipt(u.ctx, withPaidFrom(formObject(fd)))).id;
  });
  if (!r.ok) return r;
  revalidatePath("/receipts");
  revalidatePath("/sales", "layout");
  redirect(`/receipts/${id}`);
}

export async function cancelReceiptAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (u) => {
    const rc = await cancelCustomerReceipt(u.ctx, id, { reason: String(fd.get("reason") ?? ""), date: String(fd.get("date") ?? "") || undefined });
    return `Receipt ${rc.number} cancelled — the reverse entry is posted`;
  });
  if (r.ok) {
    revalidatePath(`/receipts/${id}`);
    revalidatePath("/receipts");
    revalidatePath("/sales", "layout");
  }
  return r;
}
