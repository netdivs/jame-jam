"use server";
import type { ShipmentStatus } from "@prisma/client";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { formObject, runAction, type ActionState } from "@/lib/action";
import {
  approvePurchaseOrder,
  cancelPurchaseOrder,
  createShipment,
  rejectPurchaseOrder,
  savePurchaseOrder,
  setShipmentStatus,
  submitPurchaseOrder,
  verifyPoPayment,
} from "@/server/purchase/orders";
import { recordSupplierPayment } from "@/server/purchase/payments";
import { createGoodsReceipt } from "@/server/purchase/receipts";
import { postSupplierInvoice } from "@/server/purchase/invoices";
import { allocateLandedCost, recordLandedCostExpense } from "@/server/purchase/landed-cost";

function json(fd: FormData): unknown {
  try {
    return JSON.parse(String(fd.get("payload") ?? "{}"));
  } catch {
    return {};
  }
}
const poPath = (id: string) => `/purchase/orders/${id}`;

export async function savePoAction(id: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  let poId = id ?? "";
  const r = await runAction(async (u) => {
    poId = (await savePurchaseOrder(u.ctx, id, json(fd))).id;
  });
  if (!r.ok) return r;
  revalidatePath("/purchase/orders");
  redirect(poPath(poId));
}

/** One-click workflow steps on a PO. */
export async function poStepAction(id: string, step: "submit" | "approve" | "verify", _: ActionState, _fd: FormData): Promise<ActionState> {
  const r = await runAction(async (u) => {
    if (step === "submit") {
      const po = await submitPurchaseOrder(u.ctx, id);
      return po.status === "APPROVED" ? "Submitted — approved automatically (no approval needed under current rule)" : "Submitted for approval";
    }
    if (step === "approve") {
      await approvePurchaseOrder(u.ctx, id);
      return "Purchase order approved";
    }
    await verifyPoPayment(u.ctx, id);
    return "100% payment verified — goods can now be collected and received";
  });
  if (r.ok) revalidatePath(poPath(id));
  return r;
}

export async function rejectPoAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (u) => {
    await rejectPurchaseOrder(u.ctx, id, String(fd.get("note") ?? ""));
    return "Returned to draft";
  });
  if (r.ok) revalidatePath(poPath(id));
  return r;
}

export async function cancelPoAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (u) => {
    await cancelPurchaseOrder(u.ctx, id, String(fd.get("reason") ?? ""));
    return "Purchase order cancelled";
  });
  if (r.ok) revalidatePath(poPath(id));
  return r;
}

export async function createShipmentAction(poId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (u) => {
    const s = await createShipment(u.ctx, poId, formObject(fd));
    return `Shipment ${s.number} added`;
  });
  if (r.ok) revalidatePath(poPath(poId));
  return r;
}

export async function shipmentStatusAction(poId: string, shipmentId: string, status: ShipmentStatus, _: ActionState, _fd: FormData): Promise<ActionState> {
  const r = await runAction(async (u) => {
    const s = await setShipmentStatus(u.ctx, shipmentId, status);
    return `Shipment ${s.number}: ${status.toLowerCase().replace(/_/g, " ")}`;
  });
  if (r.ok) revalidatePath(poPath(poId));
  return r;
}

export async function paymentAction(back: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (u) => {
    const pv = await recordSupplierPayment(u.ctx, formObject(fd));
    return `Payment ${pv.number} recorded`;
  });
  if (r.ok) {
    revalidatePath(back);
    revalidatePath("/purchase/payments");
  }
  return r;
}

export async function grnAction(poId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  let grnId = "";
  const r = await runAction(async (u) => {
    grnId = (await createGoodsReceipt(u.ctx, json(fd))).id;
  });
  if (!r.ok) return r;
  revalidatePath(poPath(poId));
  revalidatePath("/inventory");
  redirect(`/purchase/grn/${grnId}`);
}

export async function invoiceAction(poId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  let invId = "";
  const r = await runAction(async (u) => {
    invId = (await postSupplierInvoice(u.ctx, json(fd))).id;
  });
  if (!r.ok) return r;
  revalidatePath(poPath(poId));
  redirect(`/purchase/invoices/${invId}`);
}

export async function expenseAction(poId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (u) => {
    const raw = formObject(fd);
    const e = await recordLandedCostExpense(u.ctx, { ...raw, allocationBasis: raw.allocationBasis || undefined });
    return `Landed cost ${e.number} recorded`;
  });
  if (r.ok) {
    revalidatePath(poPath(poId));
    revalidatePath("/purchase/landed-costs");
  }
  return r;
}

export async function allocateAction(expenseId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  let poId = "";
  const r = await runAction(async (u) => {
    const raw = json(fd) as { overrides?: { lotId: string; amount: string }[]; reason?: string };
    const exp = await allocateLandedCost(u.ctx, expenseId, raw);
    poId = exp.purchaseOrderId;
    return raw.overrides?.length ? "Allocated to lots (manual override recorded in the audit log)" : "Allocated to lots";
  });
  if (r.ok) {
    // Lot costs changed: refresh every screen that shows them.
    revalidatePath(`/purchase/landed-costs/${expenseId}`);
    revalidatePath("/purchase/landed-costs");
    revalidatePath(poPath(poId));
    revalidatePath("/inventory", "layout");
  }
  return r;
}
