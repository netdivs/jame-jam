"use server";
import { revalidatePath } from "next/cache";
import { runAction, type ActionState } from "@/lib/action";
import { runJobNow } from "@/server/jobs";

export async function runJobAction(job: string, _: ActionState, _fd: FormData): Promise<ActionState> {
  const r = await runAction(async (u) => {
    const out = await runJobNow(u.ctx, job);
    if (out.status === "FAILED") throw new Error(out.error);
    return `${job}: ${out.status.toLowerCase()} — ${JSON.stringify(out.result)}`;
  });
  if (r.ok) revalidatePath("/settings/jobs");
  return r;
}
