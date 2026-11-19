import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, FInput, FSelect, SubmitButton } from "@/components/forms";
import { Card, Empty, LinkButton, PageHeader, Table } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { D, prisma, toDateOnly } from "@/server/core";
import { reconciliation, suggestMatches } from "@/server/accounting/bank-rec";
import { fmtAED, fmtDate, fmtDateTime, fmtMoney, todayIso } from "@/lib/format";
import { DateForm } from "../../report-ui";
import { addLineAction, autoMatchAction, chargeAction, deleteLineAction, matchAction, reopenRecAction, saveRecAction, unmatchAction } from "../actions";

export const metadata = { title: "Bank reconciliation" };

/** Rows shown per list; the totals always cover everything. */
const SHOW = 100;

const signedCell = (a: { toString(): string }) => {
  const d = D(a.toString());
  return <span className={d.lt(0) ? "text-danger" : ""}>{fmtMoney(d)}</span>;
};

export default async function BankRecPage({ params, searchParams }: { params: Promise<{ bankId: string }>; searchParams: Promise<{ date?: string }> }) {
  const user = await requirePermission("accounts.view");
  const can = user.ctx.permissions.has("bankRec.manage");
  const { bankId } = await params;
  const { date: d } = await searchParams;
  const bank = await prisma.bankAccount.findUnique({ where: { id: bankId } });
  if (!bank) notFound();
  const dateStr = d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : todayIso();
  const date = toDateOnly(dateStr);

  const [rec, unmatched, sugg, matched, saved] = await Promise.all([
    reconciliation(bank.id, date),
    prisma.bankStatementLine.findMany({ where: { bankAccountId: bank.id, matches: { none: {} } }, orderBy: [{ date: "asc" }, { createdAt: "asc" }], take: SHOW + 1 }),
    suggestMatches(bank.id),
    prisma.bankStatementLine.findMany({
      where: { bankAccountId: bank.id, matches: { some: {} } },
      include: { matches: { include: { journalLine: { include: { entry: true } } } } },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 50,
    }),
    prisma.bankReconciliation.findMany({ where: { bankAccountId: bank.id }, orderBy: { statementDate: "desc" }, take: 24 }),
  ]);
  const locked = rec.lockedUntil;
  const isLocked = (dt: Date) => Boolean(locked && dt <= locked);
  const outstanding = rec.items.filter((i) => i.kind === "ledger");
  const users = new Map((await prisma.user.findMany({ where: { id: { in: saved.map((s) => s.createdById ?? "") } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));

  return (
    <>
      <PageHeader
        title={`Reconcile ${bank.name}`}
        subtitle={locked ? `Reconciled up to ${fmtDate(locked)}. Lines on or before that date are locked.` : "Not reconciled yet."}
        back={{ href: "/accounts/bank-rec", label: "Bank reconciliation" }}
        actions={
          can && (
            <div className="flex flex-wrap gap-2">
              <LinkButton href={`/accounts/bank-rec/${bank.id}/import`} variant="secondary">Import CSV</LinkButton>
              <ActionForm action={autoMatchAction.bind(null, bank.id)}>
                <SubmitButton variant="secondary" pendingText="Matching…">Auto-match</SubmitButton>
              </ActionForm>
            </div>
          )
        }
      />

      {can && (
        <Card title="Add statement line" className="mb-5">
          <ActionForm action={addLineAction.bind(null, bank.id)} resetOnSuccess className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <FInput label="Date" name="date" type="date" required defaultValue={todayIso()} />
            <FSelect label="Direction" name="direction" required defaultValue="IN" options={[{ value: "IN", label: "Money in" }, { value: "OUT", label: "Money out" }]} />
            <FInput label="Amount (AED)" name="amount" inputMode="decimal" required />
            <div className="lg:col-span-2">
              <FInput label="Description" name="description" required placeholder="As on the statement" />
            </div>
            <FInput label="Reference" name="reference" />
            <div className="sm:col-span-2 lg:col-span-6">
              <SubmitButton variant="secondary">Add line</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      )}

      <Card title={`Unmatched statement lines${unmatched.length > SHOW ? ` (first ${SHOW})` : ` (${unmatched.length})`}`} className="mb-5" pad={false}>
        {unmatched.length === 0 ? (
          <Empty>Every statement line is matched.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Statement</th>
                <th className="num">Amount</th>
                <th>Possible matches in the books</th>
              </tr>
            </thead>
            <tbody>
              {unmatched.slice(0, SHOW).map((l) => {
                const c = sugg.get(l.id) ?? [];
                const open = can && !isLocked(l.date);
                return (
                  <tr key={l.id}>
                    <td className="whitespace-nowrap">{fmtDate(l.date)}</td>
                    <td>
                      {l.description}
                      {l.reference && <span className="block text-xs text-muted">Ref {l.reference}</span>}
                    </td>
                    <td className="num">{signedCell(l.amount)}</td>
                    <td className="min-w-0">
                      <div className="grid gap-2">
                        {c.slice(0, 3).map((s) => (
                          <div key={s.journalLineId} className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="font-mono">{s.number}</span>
                            <span>{fmtDate(s.date)}</span>
                            <span className="min-w-0 truncate text-muted">{s.memo}</span>
                            {open && (
                              <ActionForm action={matchAction.bind(null, bank.id, l.id, false)}>
                                <input type="hidden" name="journalLineIds" value={s.journalLineId} />
                                <SubmitButton variant="secondary" pendingText="…">Match</SubmitButton>
                              </ActionForm>
                            )}
                          </div>
                        ))}
                        {c.length === 0 && <span className="text-xs text-muted">No ledger line with this amount nearby.</span>}
                        {open && (
                          <div className="flex flex-wrap gap-2">
                            <Link href={`/accounts/bank-rec/${bank.id}/match/${l.id}`} className="text-xs text-primary hover:underline">Match several…</Link>
                            {D(l.amount).lt(0) && (
                              <ActionForm action={chargeAction.bind(null, bank.id, l.id)}>
                                <SubmitButton variant="secondary" pendingText="Posting…">Post as bank charges</SubmitButton>
                              </ActionForm>
                            )}
                            <ActionForm action={deleteLineAction.bind(null, bank.id, l.id)}>
                              <SubmitButton variant="secondary" pendingText="…">Delete</SubmitButton>
                            </ActionForm>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <Card title="Reconciliation" className="mb-5">
        <DateForm fields={[{ name: "date", label: "Statement date", value: dateStr }]} />
        <Table>
          <tbody>
            <tr>
              <td>Balance in the books on {fmtDate(date)}</td>
              <td className="num">{fmtMoney(rec.bookBalance)}</td>
            </tr>
            <tr>
              <td>Less: book entries not yet on the statement ({outstanding.length})</td>
              <td className="num">{fmtMoney(rec.outstanding.negated())}</td>
            </tr>
            <tr>
              <td>Add: statement lines not yet in the books ({rec.items.length - outstanding.length})</td>
              <td className="num">{fmtMoney(rec.unrecorded)}</td>
            </tr>
            <tr className="font-semibold">
              <td>The statement should show</td>
              <td className="num">{fmtAED(rec.expected)}</td>
            </tr>
          </tbody>
        </Table>
        {can && !(locked && date <= locked) && (
          <ActionForm action={saveRecAction.bind(null, bank.id)} className="mt-4 grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
            <input type="hidden" name="statementDate" value={dateStr} />
            <FInput label="Closing balance on the statement (AED)" name="statementBalance" inputMode="decimal" required />
            <FInput label="Notes" name="notes" />
            <SubmitButton pendingText="Saving…">Save reconciliation</SubmitButton>
          </ActionForm>
        )}
      </Card>

      <Card
        title={`Book entries not on the statement by ${fmtDate(date)} (${outstanding.length})`}
        actions={outstanding.length > SHOW && <span className="text-xs text-muted">Oldest {SHOW} shown</span>}
        className="mb-5"
        pad={false}
      >
        {outstanding.length === 0 ? (
          <Empty>None.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Entry</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {outstanding.slice(0, SHOW).map((i) => (
                <tr key={i.id}>
                  <td className="whitespace-nowrap">{fmtDate(i.date)}</td>
                  <td>{i.text}</td>
                  <td className="num">{signedCell(i.amount)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card title="Matched (latest 50)" className="mb-5" pad={false}>
        {matched.length === 0 ? (
          <Empty>Nothing matched yet.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Statement</th>
                <th>Books</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {matched.map((l) => (
                <tr key={l.id}>
                  <td className="whitespace-nowrap">{fmtDate(l.date)}</td>
                  <td>{l.description}</td>
                  <td>
                    {l.matches.map((m) => (
                      <Link key={m.id} href={`/accounts/journals/${m.journalLine.entryId}`} className="mr-2 font-mono text-xs text-primary hover:underline">{m.journalLine.entry.number}</Link>
                    ))}
                    {can && !isLocked(l.date) && (
                      <ActionForm action={unmatchAction.bind(null, bank.id, l.id)}>
                        <SubmitButton variant="secondary" pendingText="…">Unmatch</SubmitButton>
                      </ActionForm>
                    )}
                  </td>
                  <td className="num">{signedCell(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card title="Saved reconciliations" className="mb-5" pad={false}>
        {saved.length === 0 ? (
          <Empty>None saved yet.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Statement date</th>
                <th className="num">Statement</th>
                <th className="num hidden sm:table-cell">Books</th>
                <th className="hidden md:table-cell">Saved</th>
              </tr>
            </thead>
            <tbody>
              {saved.map((s, i) => (
                <tr key={s.id}>
                  <td>
                    {fmtDate(s.statementDate)}
                    {s.notes && <span className="block text-xs text-muted">{s.notes}</span>}
                    {i === 0 && can && (
                      <ActionForm action={reopenRecAction.bind(null, bank.id, s.id)} className="mt-2 flex flex-wrap items-end gap-2">
                        <FInput label="Reason to reopen" name="reason" required />
                        <SubmitButton variant="secondary" pendingText="…">Reopen</SubmitButton>
                      </ActionForm>
                    )}
                  </td>
                  <td className="num">{fmtMoney(s.statementBalance)}</td>
                  <td className="num hidden sm:table-cell">{fmtMoney(s.bookBalance)}</td>
                  <td className="hidden text-xs md:table-cell">{fmtDateTime(s.createdAt)} · {users.get(s.createdById ?? "") ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
