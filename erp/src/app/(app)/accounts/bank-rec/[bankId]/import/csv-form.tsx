"use client";
// CSV statement import: the file is read in the browser only to show its columns; the server parses and validates it.
import { startTransition, useActionState, useState, type FormEvent } from "react";
import { Button, Select } from "@/components/ui";
import type { ActionState } from "@/lib/action";

type Props = { action: (s: ActionState, fd: FormData) => Promise<ActionState>; dateFormats: readonly string[] };

/** First row of a CSV, for the column pickers (quotes handled; the server does the real parse). */
function header(text: string): string[] {
  const line = text.replace(/^﻿/, "").split(/\r?\n/)[0] ?? "";
  const out: string[] = [];
  let f = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        f += '"';
        i++;
      } else if (c === '"') q = false;
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      out.push(f);
      f = "";
    } else f += c;
  }
  out.push(f);
  return out;
}

const guess = (cols: string[], ...words: string[]) => {
  const i = cols.findIndex((c) => words.some((w) => c.toLowerCase().includes(w)));
  return i >= 0 ? String(i) : "";
};

export function CsvImportForm({ action, dateFormats }: Props) {
  const [csv, setCsv] = useState("");
  const [cols, setCols] = useState<string[]>([]);
  const [fileError, setFileError] = useState("");
  const [m, setM] = useState({ hasHeader: true, dateFormat: dateFormats[0], dateCol: "", descriptionCol: "", referenceCol: "", amountCol: "", inCol: "", outCol: "", split: false });
  const set = (k: keyof typeof m) => (e: { target: { value: string } }) => setM((s) => ({ ...s, [k]: e.target.value }));

  async function onFile(file: File | undefined) {
    setFileError("");
    if (!file) return;
    if (file.size > 1_000_000) return setFileError("The file is larger than 1 MB");
    const text = await file.text();
    const h = header(text);
    setCsv(text);
    setCols(h);
    const inCol = guess(h, "credit", "deposit", "money in");
    const outCol = guess(h, "debit", "withdraw", "money out");
    setM((s) => ({
      ...s,
      dateCol: guess(h, "date") || "0",
      descriptionCol: guess(h, "desc", "narration", "details", "particular") || "1",
      referenceCol: guess(h, "ref", "cheque"),
      amountCol: guess(h, "amount"),
      inCol,
      outCol,
      split: Boolean(inCol && outCol && !guess(h, "amount")),
    }));
  }

  // Submitted by hand (not <form action>) so React does not reset the file text and mapping after "Check".
  const [state, formAction, pending] = useActionState(action, { ok: false } as ActionState);
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const fd = new FormData(e.currentTarget, submitter);
    startTransition(() => formAction(fd));
  }

  const options = cols.map((c, i) => ({ value: String(i), label: m.hasHeader ? `${i + 1}. ${c || "(blank)"}` : `Column ${i + 1} (e.g. ${c})` }));

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
      {state.message && (
        <div role={state.ok ? "status" : "alert"} className={`col-span-full rounded-md border px-3 py-2 text-sm ${state.ok ? "border-success/30 bg-success-bg text-success" : "border-danger/30 bg-danger-bg text-danger"}`}>
          {state.message}
        </div>
      )}
      <div className="sm:col-span-2">
        <label htmlFor="file" className="mb-1 block text-sm font-medium">CSV file from the bank</label>
        <input id="file" type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} className="block w-full text-sm" />
        {fileError && <p className="mt-1 text-xs text-danger">{fileError}</p>}
        <input type="hidden" name="csv" value={csv} />
      </div>
      {cols.length > 0 && (
        <>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" name="hasHeader" value="true" checked={m.hasHeader} onChange={(e) => setM((s) => ({ ...s, hasHeader: e.target.checked }))} className="size-4" />
            The first row is the column names
          </label>
          <Select label="Date format" name="dateFormat" value={m.dateFormat} onChange={set("dateFormat")} options={dateFormats.map((f) => ({ value: f, label: f }))} />
          <Select label="Date column" name="dateCol" required value={m.dateCol} onChange={set("dateCol")} options={options} />
          <Select label="Description column" name="descriptionCol" required value={m.descriptionCol} onChange={set("descriptionCol")} options={options} />
          <Select label="Reference column" name="referenceCol" value={m.referenceCol} onChange={set("referenceCol")} placeholder="—" options={options} />
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={m.split} onChange={(e) => setM((s) => ({ ...s, split: e.target.checked }))} className="size-4" />
            Money in and money out are in separate columns
          </label>
          {m.split ? (
            <>
              <Select label="Money in (credit) column" name="inCol" required value={m.inCol} onChange={set("inCol")} placeholder="—" options={options} />
              <Select label="Money out (debit) column" name="outCol" required value={m.outCol} onChange={set("outCol")} placeholder="—" options={options} />
            </>
          ) : (
            <Select label="Amount column (negative = money out)" name="amountCol" required value={m.amountCol} onChange={set("amountCol")} placeholder="—" options={options} />
          )}
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" name="allowDuplicates" value="true" className="size-4" />
            Import lines that look like ones already on file
          </label>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button type="submit" name="dryRun" value="true" variant="secondary" disabled={pending}>Check</Button>
            <Button type="submit" name="dryRun" value="false" disabled={pending}>{pending ? "Working…" : "Import"}</Button>
          </div>
        </>
      )}
    </form>
  );
}
