"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { formObject, runAction, withPaidFrom, type ActionState } from "@/lib/action";
import { cancelAdvanceTransfer, cancelRefund, recordCustomerRefund, recordSupplierRefund, transferSupplierAdvance } from "@/server/refunds/refunds";

function touch() {
  revalidatePath("/refunds");
  revalidatePath("/receipts");
  revalidatePath("/sales", "layout");
  revalidatePath("/purchase", "layout");
}

export async function refundAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id = "";
  const r = await runAction(async (u) => {
    const o = withPaidFrom(formObject(fd));
    id = (o.purchaseOrderId ? await recordSupplierRefund(u.ctx, o) : await recordCustomerRefund(u.ctx, o)).id;
  });
  if (!r.ok) return r;
  touch();
  redirect(`/refunds/${id}`);
}

export async function cancelRefundAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (u) => {
    const rf = await cancelRefund(u.ctx, id, formObject(fd));
    return `Refund ${rf.number} cancelled — the reverse entry is posted`;
  });
  if (r.ok) {
    revalidatePath(`/refunds/${id}`);
    touch();
  }
  return r;
}

export async function transferAction(fromPoId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (u) => {
    const t = await transferSupplierAdvance(u.ctx, { ...formObject(fd), fromPurchaseOrderId: fromPoId });
    return `Advance moved (${t.number})`;
  });
  if (r.ok) touch();
  return r;
}

export async function cancelTransferAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (u) => {
    const t = await cancelAdvanceTransfer(u.ctx, id, formObject(fd));
    return `Transfer ${t.number} cancelled`;
  });
  if (r.ok) touch();
  return r;
}
