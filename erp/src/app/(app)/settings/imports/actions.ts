"use server";
import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/server/auth";
import { AppError } from "@/server/core";
import { runImport, type ImportError } from "@/server/imports";

export type ImportState = { ok: boolean; message?: string; errors?: ImportError[]; committed?: boolean };

export async function importAction(_: ImportState, fd: FormData): Promise<ImportState> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: "Your session has expired. Please sign in again." };
  const entity = String(fd.get("entity") ?? "");
  const file = fd.get("file");
  const dryRun = String(fd.get("mode") ?? "check") !== "import";
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose the filled-in template (.xlsx or .csv)" };
  try {
    const r = await runImport(user.ctx, entity, file.name, Buffer.from(await file.arrayBuffer()), dryRun);
    revalidatePath("/settings/imports");
    if (r.errors.length) {
      return { ok: false, errors: r.errors, message: `${r.errors.length} problem${r.errors.length === 1 ? "" : "s"} in ${r.rowsTotal} rows${dryRun ? "" : " — nothing was imported"}. Fix them in the file and check again.` };
    }
    return dryRun
      ? { ok: true, message: `All ${r.rowsTotal} rows are valid. Nothing was saved yet — press Import to save them.` }
      : { ok: true, committed: true, message: `Imported ${r.rowsOk} rows.` };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, message: e.message };
    console.error(e);
    return { ok: false, message: "Something went wrong. Nothing was imported." };
  }
}
