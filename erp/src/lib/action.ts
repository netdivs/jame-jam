// Server-action plumbing: turn service errors into form state the UI can show.
import "server-only";
import { AppError } from "@/server/core";
import { getSessionUser, type SessionUser } from "@/server/auth";

export type ActionState = { ok: boolean; message?: string; fields?: Record<string, string> };
export const initialState: ActionState = { ok: false };

/** Run a mutation for the signed-in user; known errors become form messages. */
export async function runAction(fn: (user: SessionUser) => Promise<string | void>): Promise<ActionState> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: "Your session has expired. Please sign in again." };
  try {
    const message = await fn(user);
    return { ok: true, message: message ?? "Saved" };
  } catch (e) {
    if (e instanceof AppError) {
      const fields = (e.details as { fields?: Record<string, string> } | undefined)?.fields;
      return { ok: false, message: e.message, fields };
    }
    console.error(e);
    return { ok: false, message: "Something went wrong. Nothing was saved." };
  }
}

/** FormData → plain object (repeated keys become arrays). */
export function formObject(fd: FormData): Record<string, string> {
  const o: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string" && !k.startsWith("$ACTION")) o[k] = v;
  return o;
}
