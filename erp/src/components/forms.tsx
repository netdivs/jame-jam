"use client";
// Client form wrapper: pending state, top-level message, and per-field errors from server actions.
import { createContext, startTransition, useActionState, useContext, type FormEvent, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/action";
import { Button, Input, Select, Textarea, type BtnVariant } from "./ui";
import type { ComponentProps } from "react";

const FieldErrors = createContext<Record<string, string>>({});
/** Pending state of the enclosing ActionForm (null outside one: fall back to useFormStatus). */
const FormPending = createContext<boolean | null>(null);
export const useFieldError = (name: string) => useContext(FieldErrors)[name];

export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
}: {
  action: (state: ActionState, fd: FormData) => Promise<ActionState>;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, { ok: false } as ActionState);
  // Dispatched by hand instead of <form action>: React 19 resets a form after its action runs, which wiped what the
  // user typed whenever the server refused it. The form is cleared only on success, and only with resetOnSuccess.
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    const fd = new FormData(e.currentTarget, submitter);
    startTransition(() => formAction(fd));
  }
  return (
    <form onSubmit={onSubmit} className={className} noValidate key={resetOnSuccess && state.ok ? Math.random() : undefined}>
      {state.message && (
        <div
          role={state.ok ? "status" : "alert"}
          className={`col-span-full mb-4 rounded-md border px-3 py-2 text-sm ${state.ok ? "border-success/30 bg-success-bg text-success" : "border-danger/30 bg-danger-bg text-danger"}`}
        >
          {state.message}
        </div>
      )}
      <FormPending.Provider value={pending}>
        <FieldErrors.Provider value={state.fields ?? {}}>{children}</FieldErrors.Provider>
      </FormPending.Provider>
    </form>
  );
}

export function SubmitButton({ children, variant = "primary", pendingText = "Saving…" }: { children: ReactNode; variant?: BtnVariant; pendingText?: string }) {
  const inForm = useContext(FormPending);
  const status = useFormStatus();
  const pending = inForm ?? status.pending;
  return (
    <Button type="submit" variant={variant} disabled={pending} aria-busy={pending}>
      {pending ? pendingText : children}
    </Button>
  );
}

/** Shows the error for a field inside an ActionForm. */
export function FieldError({ name }: { name: string }) {
  const e = useFieldError(name);
  return e ? <p className="mt-1 text-xs text-danger">{e}</p> : null;
}

// Field wrappers that pick up their error from the surrounding ActionForm.

export function FInput(p: Omit<ComponentProps<typeof Input>, "error">) {
  return <Input {...p} error={useFieldError(p.name)} />;
}
export function FSelect(p: Omit<ComponentProps<typeof Select>, "error">) {
  return <Select {...p} error={useFieldError(p.name)} />;
}
export function FTextarea(p: Omit<ComponentProps<typeof Textarea>, "error">) {
  return <Textarea {...p} error={useFieldError(p.name)} />;
}
