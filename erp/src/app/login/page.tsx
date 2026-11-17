import { redirect } from "next/navigation";
import { ActionForm, FInput, SubmitButton } from "@/components/forms";
import type { ActionState } from "@/lib/action";
import { getSessionUser, login } from "@/server/auth";
import { AppError } from "@/server/core";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

async function signIn(_: ActionState, fd: FormData): Promise<ActionState> {
  "use server";
  try {
    await login(String(fd.get("email") ?? ""), String(fd.get("password") ?? ""));
  } catch (e) {
    if (e instanceof AppError) return { ok: false, message: e.message };
    throw e;
  }
  redirect("/");
}

export default async function LoginPage() {
  if (await getSessionUser()) redirect("/");
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-base font-bold text-on-primary">JJ</div>
          <div>
            <h1 className="text-lg font-semibold text-fg">Jame Jam ERP</h1>
            <p className="text-sm text-muted">Sign in to continue</p>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-5">
          <ActionForm action={signIn} className="space-y-4">
            <FInput label="Email" name="email" type="email" autoComplete="username" required autoFocus />
            <FInput label="Password" name="password" type="password" autoComplete="current-password" required />
            <div className="pt-1">
              <SubmitButton pendingText="Signing in…">Sign in</SubmitButton>
            </div>
          </ActionForm>
        </div>
      </div>
    </main>
  );
}
