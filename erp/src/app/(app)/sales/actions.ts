"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { runAction, type ActionState } from "@/lib/action";
import { getSessionUser } from "@/server/auth";
import { AppError } from "@/server/core";
import { cancelSalesOrder, saveSalesOrder } from "@/server/sales/orders";
import { closeProformaInvoice, createProformaInvoice, renewProformaInvoice } from "@/server/sales/proformas";
import { stockOptions, type StockOption } from "@/server/sales/queries";

function json(fd: FormData): unknown {
  try {
    return JSON.parse(String(fd.get("payload") ?? "{}"));
  } catch {
    return {};
  }
}
const soPath = (id: string) => `/sales/orders/${id}`;
const piPath = (id: string) => `/sales/proformas/${id}`;

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
