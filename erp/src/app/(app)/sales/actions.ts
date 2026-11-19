"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { runAction, type ActionState } from "@/lib/action";
import { getSessionUser } from "@/server/auth";
import { AppError } from "@/server/core";
import { cancelSalesOrder, saveSalesOrder } from "@/server/sales/orders";
import { closeProformaInvoice, createProformaInvoice, renewProformaInvoice } from "@/server/sales/proformas";
import { stockOptions, type StockOption } from "@/server/sales/queries";
import { applyAdvanceToInvoice, createTaxInvoice } from "@/server/sales/invoices";
import { createDeliveryNote } from "@/server/sales/delivery";
import { createReturnRequest, decideReturnRequest, receiveReturn } from "@/server/sales/returns";
import { createAdjustmentCreditNote, createReturnCreditNote, decideCreditNote } from "@/server/sales/credit-notes";

function json(fd: FormData): unknown {
  try {
    return JSON.parse(String(fd.get("payload") ?? "{}"));
  } catch {
    return {};
  }
}
const soPath = (id: string) => `/sales/orders/${id}`;
const piPath = (id: string) => `/sales/proformas/${id}`;
const tiPath = (id: string) => `/sales/invoices/${id}`;

/** Stock picker data for the SO form (product → available slabs / buckets). */
export async function stockOptionsAction(productId: string, soId: string | null): Promise<{ ok: boolean; options: StockOption[]; message?: string }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, options: [], message: "Your session has expired. Please sign in again." };
  try {
    return { ok: true, options: await stockOptions(user.ctx, productId, soId) };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, options: [], message: e.message };
    console.error(e);
    return { ok: false, options: [], message: "Could not load stock." };
  }
}

export async function saveSoAction(id: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  let soId = id ?? "";
  const r = await runAction(async (u) => {
    soId = (await saveSalesOrder(u.ctx, id, json(fd))).id;
  });
  if (!r.ok) return r;
  revalidatePath("/sales/orders");
  revalidatePath("/inventory", "layout");
  redirect(soPath(soId));
}

export async function cancelSoAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (u) => {
    const so = await cancelSalesOrder(u.ctx, id, String(fd.get("reason") ?? ""));
    return `SO ${so.number} cancelled — its stock reservations were released`;
  });
  if (r.ok) {
    revalidatePath(soPath(id));
    revalidatePath("/sales", "layout");
    revalidatePath("/inventory", "layout");
  }
  return r;
}

/** Create a PI from the SO detail page; per-line SQM fields are named `sqm:<soLineId>`. */
export async function createPiAction(soId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  let piId = "";
  const r = await runAction(async (u) => {
    const lines = [...fd.entries()]
      .filter(([k, v]) => k.startsWith("sqm:") && typeof v === "string")
      .map(([k, v]) => ({ salesOrderItemId: k.slice(4), sqm: String(v).trim() || "0" }));
    const pi = await createProformaInvoice(u.ctx, {
      salesOrderId: soId,
      date: String(fd.get("date") ?? ""),
      terms: String(fd.get("terms") ?? ""),
      notes: String(fd.get("notes") ?? ""),
      lines: lines.length ? lines : undefined,
    });
    piId = pi.id;
  });
  if (!r.ok) return r;
  revalidatePath(soPath(soId));
  revalidatePath("/sales/proformas");
  redirect(piPath(piId));
}

export async function renewPiAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (u) => {
    const pi = await renewProformaInvoice(u.ctx, id, String(fd.get("reason") ?? ""));
    return `Proforma ${pi.number} renewed — valid until ${pi.expiryDate.toISOString().slice(0, 10)}`;
  });
  if (r.ok) {
    revalidatePath(piPath(id));
    revalidatePath("/sales", "layout");
  }
  return r;
}

export async function closePiAction(id: string, kind: "CLOSED" | "CANCELLED", _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (u) => {
    const pi = await closeProformaInvoice(u.ctx, id, kind, String(fd.get("reason") ?? ""));
    return `Proforma ${pi.number} ${kind === "CLOSED" ? "closed" : "cancelled"}`;
  });
  if (r.ok) {
    revalidatePath(piPath(id));
    revalidatePath("/sales", "layout");
  }
  return r;
}

/** Issue a tax invoice from the SO page (fields `sqm:<soLineId>`) or convert a proforma (piId set). */
export async function createTiAction(src: { soId?: string; piId?: string }, _: ActionState, fd: FormData): Promise<ActionState> {
  let tiId = "";
  const r = await runAction(async (u) => {
    const lines = [...fd.entries()]
      .filter(([k, v]) => k.startsWith("sqm:") && typeof v === "string")
      .map(([k, v]) => ({ salesOrderItemId: k.slice(4), sqm: String(v).trim() || "0" }));
    const ti = await createTaxInvoice(u.ctx, {
      salesOrderId: src.soId,
      proformaInvoiceId: src.piId,
      date: String(fd.get("date") ?? ""),
      notes: String(fd.get("notes") ?? ""),
      lines: src.soId && lines.length ? lines : undefined,
    });
    tiId = ti.id;
  });
  if (!r.ok) return r;
  revalidatePath("/sales", "layout");
  redirect(tiPath(tiId));
}

export async function applyAdvanceAction(tiId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (u) => {
    const a = await applyAdvanceToInvoice(u.ctx, tiId, { date: String(fd.get("date") ?? ""), amount: String(fd.get("amount") ?? "") });
    return `AED ${a.amount.toFixed(2)} of advance applied`;
  });
  if (r.ok) revalidatePath(tiPath(tiId));
  return r;
}

/** Issue a delivery note from the TI page; per-line SQM fields are named `dn:<tiLineId>`. */
export async function createDnAction(tiId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  let dnId = "";
  const r = await runAction(async (u) => {
    const lines = [...fd.entries()]
      .filter(([k, v]) => k.startsWith("dn:") && typeof v === "string")
      .map(([k, v]) => ({ taxInvoiceItemId: k.slice(3), sqm: String(v).trim() || "0" }));
    const s = (k: string) => String(fd.get(k) ?? "");
    dnId = (await createDeliveryNote(u.ctx, { taxInvoiceId: tiId, date: s("date"), vehicleNo: s("vehicleNo"), driverName: s("driverName"), receivedBy: s("receivedBy"), remarks: s("remarks"), lines: lines.length ? lines : undefined })).id;
  });
  if (!r.ok) return r;
  revalidatePath("/sales", "layout");
  revalidatePath("/inventory", "layout");
  redirect(`/sales/deliveries/${dnId}`);
}

const prefixed = (fd: FormData, prefix: string) =>
  [...fd.entries()].filter(([k, v]) => k.startsWith(prefix) && typeof v === "string").map(([k, v]) => ({ id: k.slice(prefix.length), value: String(v).trim() }));

/** Raise a return from the TI page; fields `rr:<tiLineId>`. */
export async function createRrAction(tiId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  let id = "";
  const r = await runAction(async (u) => {
    id = (await createReturnRequest(u.ctx, { taxInvoiceId: tiId, date: String(fd.get("date") ?? ""), reason: String(fd.get("reason") ?? ""), lines: prefixed(fd, "rr:").map((l) => ({ taxInvoiceItemId: l.id, sqm: l.value || "0" })) })).id;
  });
  if (!r.ok) return r;
  revalidatePath("/sales", "layout");
  redirect(`/sales/returns/${id}`);
}

export async function decideRrAction(id: string, decision: "APPROVED" | "REJECTED", _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (u) => {
    const rr = await decideReturnRequest(u.ctx, id, decision, String(fd.get("note") ?? ""));
    return `Return ${rr.number} ${decision.toLowerCase()}`;
  });
  if (r.ok) revalidatePath("/sales", "layout");
  return r;
}

/** Record goods back; fields `recv:<rrLineId>` (SQM) and `cond:<rrLineId>`. */
export async function receiveRrAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (u) => {
    const cond = new Map(prefixed(fd, "cond:").map((c) => [c.id, c.value]));
    await receiveReturn(u.ctx, id, { date: String(fd.get("date") ?? ""), notes: String(fd.get("notes") ?? ""), lines: prefixed(fd, "recv:").map((l) => ({ returnRequestItemId: l.id, receivedSqm: l.value || "0", condition: cond.get(l.id) ?? "" })) });
    return "Goods received back";
  });
  if (r.ok) {
    revalidatePath("/sales", "layout");
    revalidatePath("/inventory", "layout");
  }
  return r;
}

export async function returnCnAction(rrId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  let id = "";
  const r = await runAction(async (u) => {
    id = (await createReturnCreditNote(u.ctx, rrId, { date: String(fd.get("date") ?? "") })).id;
  });
  if (!r.ok) return r;
  revalidatePath("/sales", "layout");
  redirect(`/sales/credit-notes/${id}`);
}

/** Adjustment credit note from the TI page; fields `adj:<tiLineId>`. */
export async function adjustmentCnAction(tiId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  let id = "";
  const r = await runAction(async (u) => {
    id = (await createAdjustmentCreditNote(u.ctx, { taxInvoiceId: tiId, date: String(fd.get("date") ?? ""), reason: String(fd.get("reason") ?? ""), lines: prefixed(fd, "adj:").map((l) => ({ taxInvoiceItemId: l.id, amount: l.value || "0" })) })).id;
  });
  if (!r.ok) return r;
  revalidatePath("/sales", "layout");
  redirect(`/sales/credit-notes/${id}`);
}

export async function decideCnAction(id: string, decision: "APPROVED" | "REJECTED", _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (u) => {
    const cn = await decideCreditNote(u.ctx, id, decision, String(fd.get("note") ?? ""));
    return decision === "APPROVED" ? `Credit note ${cn.number} posted` : "Credit note rejected";
  });
  if (r.ok) revalidatePath("/sales", "layout");
  return r;
}
