import Link from "next/link";
import { Card, FileButton, PageHeader, Stat, Table } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { D, toDateOnly } from "@/server/core";
import { vatReturn, type VatRow } from "@/server/accounting/vat-report";
import { fmtAED, fmtDate, fmtMoney, todayIso } from "@/lib/format";
import { DateForm, isoOr } from "../report-ui";

export const metadata = { title: "VAT return" };

/** Default period: the current calendar quarter (UAE VAT returns are usually quarterly). */
function quarter(today: string) {
  const y = today.slice(0, 4);
  const q = Math.floor((Number(today.slice(5, 7)) - 1) / 3);
  const start = `${y}-${String(q * 3 + 1).padStart(2, "0")}-01`;
  const end = new Date(Date.UTC(Number(y), q * 3 + 3, 0)).toISOString().slice(0, 10);
  return { start, end };
}

function Register({ title, rows }: { title: string; rows: VatRow[] }) {
  return (
    <Card title={`${title} (${rows.length})`} className="mb-5" pad={false}>
      {rows.length === 0 ? (
        <p className="p-4 text-sm text-muted">Nothing in this period.</p>
      ) : (
        <Table>
          <thead>
            <tr><th>Date</th><th>Document</th><th className="hidden md:table-cell">Party</th><th className="hidden sm:table-cell">Code</th><th className="num hidden sm:table-cell">Net</th><th className="num">VAT</th></tr>
          </thead>
          <tbody>
            {rows.slice(0, 200).map((r, i) => (
              <tr key={`${r.number}-${r.code}-${i}`}>
                <td className="whitespace-nowrap">{fmtDate(r.date)}</td>
                <td><Link href={r.href} className="font-medium text-primary hover:underline">{r.number}</Link><span className="block text-xs text-muted">{r.kind}</span></td>
                <td className="hidden md:table-cell">{r.party}{r.trn && <span className="block text-xs text-muted">TRN {r.trn}</span>}</td>
                <td className="hidden sm:table-cell">{r.code}</td>
                <td className="num hidden sm:table-cell">{fmtMoney(r.net)}</td>
                <td className="num">{fmtMoney(r.vat)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {rows.length > 200 && <p className="p-3 text-xs text-muted">First 200 shown — the Excel pack has them all.</p>}
    </Card>
  );
}

export default async function VatPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const user = await requirePermission("reports.financial");
  const sp = await searchParams;
  const q = quarter(todayIso());
  const from = isoOr(sp.from, q.start);
  const to = isoOr(sp.to, q.end);
  const v = await vatReturn(user.ctx, toDateOnly(from), toDateOnly(to));
  const b = v.boxes;
  const rows: [string, string, string | null, string | null, string | null][] = [
    ...b.b1ByEmirate.map((e) => [e.box, `Standard rated supplies in ${e.label}`, fmtMoney(e.net), fmtMoney(e.vat), e.adjustment.isZero() ? null : fmtMoney(e.adjustment)] as [string, string, string | null, string | null, string | null]),
    ["3", "Supplies subject to the reverse charge", fmtMoney(b.b3.net), fmtMoney(b.b3.vat), null],
    ["4", "Zero rated supplies", fmtMoney(b.b4.net), null, null],
    ["5", "Exempt supplies", fmtMoney(b.b5.net), null, null],
    ["6", "Goods imported into the UAE", fmtMoney(b.b6.net), fmtMoney(b.b6.vat), null],
    ["8", "Totals", fmtMoney(b.b8.net), fmtMoney(b.b8.vat), null],
    ["9", "Standard rated expenses", fmtMoney(b.b9.net), fmtMoney(b.b9.vat), null],
    ["10", "Supplies subject to the reverse charge (recoverable)", fmtMoney(b.b10.net), fmtMoney(b.b10.vat), null],
    ["11", "Totals", fmtMoney(b.b11.net), fmtMoney(b.b11.vat), null],
  ];
  const rec = v.reconciliation;
  return (
    <>
      <PageHeader title="VAT return" subtitle={`${fmtDate(v.from)} – ${fmtDate(v.to)} · FTA VAT 201 layout, from the posted documents`} />
      <div className="-mt-2 mb-4 flex flex-wrap gap-2 print:hidden"><FileButton href={`/api/export/vat-pack?from=${from}&to=${to}`}>Accountant pack (Excel)</FileButton></div>
      <DateForm fields={[{ name: "from", label: "From", value: from }, { name: "to", label: "To", value: to }]} />
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Due tax (box 12)" value={fmtAED(b.b12)} />
        <Stat label="Recoverable tax (box 13)" value={fmtAED(b.b13)} />
        <Stat label={b.b14.isNegative() ? "Refundable (box 14)" : "Payable (box 14)"} value={fmtAED(b.b14.abs())} />
      </div>
      <div className={`mb-5 rounded-md border px-3 py-2 text-sm ${rec.ok ? "border-success/30 bg-success-bg" : "border-danger/30 bg-danger-bg text-danger"}`} role="status">
        {rec.ok ? "Ties to the VAT accounts" : "Does not tie to the VAT accounts"}: VAT Output movement {fmtAED(rec.outputGl)}, VAT Input movement {fmtAED(rec.inputGl)}
        {rec.others.length > 0 && <> · {rec.others.length} other entr{rec.others.length === 1 ? "y" : "ies"} (journals, opening, reversals) explain {fmtAED(rec.others.reduce((a, o) => a.plus(o.amount), D(0)))}</>}
      </div>
      <Card title="Return" className="mb-5" pad={false}>
        <Table>
          <thead><tr><th>Box</th><th>Description</th><th className="num">Amount (AED)</th><th className="num">VAT (AED)</th><th className="num hidden sm:table-cell">Adjustment</th></tr></thead>
          <tbody>
            {rows.map(([n, label, net, vat, adj]) => (
              <tr key={n} className={n === "8" || n === "11" ? "font-semibold" : ""}>
                <td className="text-muted">{n}</td><td>{label}</td><td className="num">{net ?? ""}</td><td className="num">{vat ?? ""}</td><td className="num hidden sm:table-cell">{adj ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      {rec.others.length > 0 && (
        <Card title="Other entries on the VAT accounts" className="mb-5" pad={false}>
          <Table>
            <tbody>
              {rec.others.map((o, i) => (
                <tr key={`${o.entryId}-${i}`}>
                  <td className="whitespace-nowrap">{fmtDate(o.date)}</td>
                  <td><Link href={`/accounts/journals/${o.entryId}`} className="text-primary hover:underline">{o.number}</Link><span className="block text-xs text-muted">{o.memo}</span></td>
                  <td>{o.account === "VAT_OUTPUT" ? "Output" : "Input"}</td>
                  <td className="num">{fmtMoney(o.amount)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
      <Register title="Output VAT register" rows={v.output} />
      <Register title="Input VAT register" rows={v.input} />
      <p className="text-xs text-muted">Prepared from the ERP&apos;s documents for review by your tax agent before filing with the FTA.</p>
    </>
  );
}
