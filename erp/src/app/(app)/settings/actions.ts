"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { formObject, runAction, type ActionState } from "@/lib/action";
import { saveSettings, saveUser, setUserPermissionOverrides } from "@/server/masters";

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

/** Per-user permission overrides: fields p_<permission key> = role | grant | revoke. */
export async function userPermissionsAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const o = formObject(fd);
  const values = Object.fromEntries(Object.entries(o).filter(([k]) => k.startsWith("p_")).map(([k, v]) => [k.slice(2), v]));
  const r = await runAction(async (u) => {
    const saved = await setUserPermissionOverrides(u.ctx, id, values);
    return saved.length ? `${saved.length} permission override${saved.length === 1 ? "" : "s"} saved` : "No overrides: the user has exactly their role's permissions";
  });
  if (r.ok) revalidatePath(`/settings/users/${id}`);
  return r;
}
