"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { formObject, runAction, type ActionState } from "@/lib/action";
import { saveSettings, saveUser } from "@/server/masters";

export async function saveSettingsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (u) => {
    await saveSettings(u.ctx, formObject(fd));
    return "Settings saved";
  });
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

export async function saveUserAction(id: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (u) => {
    await saveUser(u.ctx, id, formObject(fd));
  });
  if (!r.ok) return r;
  revalidatePath("/settings/users");
  redirect("/settings/users");
}
