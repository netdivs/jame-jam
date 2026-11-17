"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { formObject, runAction, type ActionState } from "@/lib/action";
import {
  saveCustomer,
  saveLandedCostCategory,
  saveProduct,
  saveSupplier,
  saveWarehouse,
} from "@/server/masters";

type Saver = (ctx: Parameters<typeof saveCustomer>[0], id: string | null, raw: unknown) => Promise<unknown>;

async function save(path: string, saver: Saver, id: string | null, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (u) => {
    await saver(u.ctx, id, formObject(fd));
  });
  if (!r.ok) return r;
  revalidatePath(path);
  redirect(path);
}

export async function saveCustomerAction(id: string | null, _: ActionState, fd: FormData) {
  return save("/masters/customers", saveCustomer, id, fd);
}
export async function saveSupplierAction(id: string | null, _: ActionState, fd: FormData) {
  return save("/masters/suppliers", saveSupplier, id, fd);
}
export async function saveProductAction(id: string | null, _: ActionState, fd: FormData) {
  return save("/masters/products", saveProduct, id, fd);
}
export async function saveWarehouseAction(id: string | null, _: ActionState, fd: FormData) {
  return save("/masters/warehouses", saveWarehouse, id, fd);
}
export async function saveLandedCostCategoryAction(id: string | null, _: ActionState, fd: FormData) {
  return save("/masters/landed-cost-categories", saveLandedCostCategory, id, fd);
}
