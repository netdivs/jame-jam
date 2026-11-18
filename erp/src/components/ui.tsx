// Presentational building blocks (server-safe: no hooks).
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function PageHeader({ title, subtitle, actions, back }: { title: string; subtitle?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {back && (
          <Link href={back.href} className="mb-1 inline-block text-xs font-medium text-muted hover:text-primary">
            ← {back.label}
          </Link>
        )}
        <h1 className="text-xl font-semibold tracking-tight text-fg">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className, pad = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={cx("rounded-lg border border-border bg-surface", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <h2 className="text-sm font-semibold text-fg">{title}</h2>
          {actions}
        </header>
      )}
      <div className={pad ? "p-4" : ""}>{children}</div>
    </section>
  );
}

const btnBase =
  "inline-flex min-h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60";
const btnVariant = {
  primary: "bg-primary text-on-primary hover:bg-primary-hover",
  secondary: "border border-border bg-surface text-fg hover:bg-surface-2",
  danger: "bg-danger text-white hover:opacity-90",
  ghost: "text-muted hover:bg-surface-2 hover:text-fg",
};
export type BtnVariant = keyof typeof btnVariant;

export function Button({ variant = "primary", className, ...p }: ComponentProps<"button"> & { variant?: BtnVariant }) {
  return <button className={cx(btnBase, btnVariant[variant], className)} {...p} />;
}
export function LinkButton({ variant = "primary", className, ...p }: ComponentProps<typeof Link> & { variant?: BtnVariant }) {
  return <Link className={cx(btnBase, btnVariant[variant], className)} {...p} />;
}

const tones = {
  neutral: "bg-surface-2 text-muted",
  info: "bg-info-bg text-primary",
  success: "bg-success-bg text-success",
  warning: "bg-warning-bg text-warning",
  danger: "bg-danger-bg text-danger",
};
export type Tone = keyof typeof tones;
export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cx("inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>;
}

export const SLAB_STATUS_TONE: Record<string, Tone> = {
  AVAILABLE: "success",
  RESERVED: "info",
  PARTIALLY_SOLD: "warning",
  SOLD: "neutral",
  SPLIT: "neutral",
  RETURNED: "info",
  DAMAGED: "danger",
  REJECTED: "danger",
};

/** Dense, horizontally scrollable table wrapper. */
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("overflow-x-auto", className)}>
      <table className="w-full border-collapse text-sm [&_td]:border-b [&_td]:border-border [&_td]:px-3 [&_td]:py-2 [&_th]:border-b [&_th]:border-border [&_th]:bg-surface-2 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-xs [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-muted [&_th.num]:text-right [&_tbody_tr:hover]:bg-surface-2/60">
        {children}
      </table>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-4 py-10 text-center text-sm text-muted">{children}</div>;
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="num mt-1 text-left text-lg font-semibold text-fg">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function DefList({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs text-muted">{k}</dt>
          <dd className="truncate text-sm text-fg">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

// ── Form fields (labels always visible; errors next to the field) ──
const inputCls =
  "block w-full min-h-9 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-fg placeholder:text-muted/70 focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/30 aria-[invalid=true]:border-danger";

/** `id` defaults to `name`; pass one when the same field name appears in two forms on a page. */
export function Field({ label, name, id, error, hint, required, children }: { label: string; name: string; id?: string; error?: string; hint?: string; required?: boolean; children: ReactNode }) {
  const fid = id ?? name;
  return (
    <div className="min-w-0">
      <label htmlFor={fid} className="mb-1 block text-xs font-medium text-fg">
        {label}
        {required && <span className="text-danger"> *</span>}
      </label>
      {children}
      {error ? (
        <p id={`${fid}-error`} className="mt-1 text-xs text-danger">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

type InputP = ComponentProps<"input"> & { label: string; name: string; error?: string; hint?: string };
export function Input({ label, name, id, error, hint, required, className, ...p }: InputP) {
  const fid = id ?? name;
  return (
    <Field label={label} name={name} id={fid} error={error} hint={hint} required={required}>
      <input id={fid} name={name} required={required} aria-invalid={Boolean(error)} aria-describedby={error ? `${fid}-error` : undefined} className={cx(inputCls, className)} {...p} />
    </Field>
  );
}

type SelectP = ComponentProps<"select"> & { label: string; name: string; error?: string; hint?: string; options: { value: string; label: string }[]; placeholder?: string };
export function Select({ label, name, id, error, hint, required, options, placeholder, className, ...p }: SelectP) {
  const fid = id ?? name;
  return (
    <Field label={label} name={name} id={fid} error={error} hint={hint} required={required}>
      <select id={fid} name={name} required={required} aria-invalid={Boolean(error)} className={cx(inputCls, className)} {...p}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

type TextareaP = ComponentProps<"textarea"> & { label: string; name: string; error?: string; hint?: string };
export function Textarea({ label, name, id, error, hint, required, className, ...p }: TextareaP) {
  const fid = id ?? name;
  return (
    <Field label={label} name={name} id={fid} error={error} hint={hint} required={required}>
      <textarea id={fid} name={name} rows={3} required={required} aria-invalid={Boolean(error)} className={cx(inputCls, className)} {...p} />
    </Field>
  );
}

export function Checkbox({ label, name, defaultChecked, hint }: { label: string; name: string; defaultChecked?: boolean; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm text-fg">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-0.5 h-4 w-4 accent-[var(--primary)]" />
      <span>
        {label}
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  );
}

export function SearchBar({ placeholder, defaultValue, children }: { placeholder: string; defaultValue?: string; children?: ReactNode }) {
  return (
    <form className="mb-3 flex flex-wrap items-center gap-2" role="search">
      <label htmlFor="q" className="sr-only">Search</label>
      <input id="q" name="q" type="search" defaultValue={defaultValue} placeholder={placeholder} className={cx(inputCls, "max-w-xs")} />
      {children}
      <Button type="submit" variant="secondary">Search</Button>
    </form>
  );
}

export const inputClass = inputCls;
