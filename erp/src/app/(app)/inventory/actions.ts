"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { runAction, type ActionState } from "@/lib/action";
import { inTx, toDateOnly } from "@/server/core";
import { createOpeningLot, splitSlab } from "@/server/inventory/lots";
import { adjustStock } from "@/server/inventory/stock";

function json(fd: FormData): unknown {
  try {
    return JSON.parse(String(fd.get("payload") ?? "{}"));
  } catch {
    return {};
  }
}

export async function createOpeningLotAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let lotId = "";
  const r = await runAction(async (u) => {
    lotId = (await createOpeningLot(u.ctx, json(fd))).id;
  });
  if (!r.ok) return r;
  revalidatePath("/inventory");
  redirect(`/inventory/lots/${lotId}`);
}

export async function splitSlabAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let parentId = "";
  const r = await runAction(async (u) => {
    parentId = (await splitSlab(u.ctx, json(fd))).parentId;
  });
  if (!r.ok) return r;
  revalidatePath("/inventory");
  redirect(`/inventory/slabs/${parentId}`);
}

export async function adjustStockAction(balanceId: string, back: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (u) => {
    await inTx((tx) =>
      adjustStock(tx, u.ctx, {
        balanceId,
        sqm: String(fd.get("sqm") ?? ""),
        reason: String(fd.get("reason") ?? ""),
        date: toDateOnly(String(fd.get("date") ?? "")),
      }),
    );
    return "Adjustment posted";
  });
  if (r.ok) revalidatePath(back);
  return r;
}
