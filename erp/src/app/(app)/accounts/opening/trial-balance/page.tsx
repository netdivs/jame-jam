import Link from "next/link";
import { ActionForm, FInput, SubmitButton } from "@/components/forms";
import { Card, PageHeader, Table, inputClass } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/core";
import { isTbExcluded } from "@/server/accounting/opening";
import { fmtDate, todayIso } from "@/lib/format";
import { openingTbAction } from "../actions";

export const metadata = { title: "Opening trial balance" };

export default async function OpeningTbPage() {
  const user = await requirePermission("accounts.view");
  const can = user.ctx.permissions.has("opening.manage");
  const [accounts, entries] = await Promise.all([
    prisma.account.findMany({ where: { isGroup: false, active: true }, orderBy: { code: "asc" } }),
    prisma.journalEntry.findMany({ where: { sourceType: "OPENING_TB" }, orderBy: { createdAt: "asc" } }),
  ]);
  const eligible = accounts.filter((a) => !isTbExcluded(a.systemKey));

  return (
    <>
      <PageHeader
        title="Opening trial balance"
        subtitle="Balances of the remaining accounts at go-live (fixed assets, accruals, VAT, capital, retained earnings…). The difference is posted to Opening Balance Equity. AR, AP, advances, cash, banks, petty cash, PDCs and stock come from their own opening entries."
        back={{ href: "/accounts/opening", label: "Opening balances" }}
      />
      {entries.length > 0 && (
        <Card title="Posted" className="mb-5">
          <ul className="space-y-1 text-sm">
            {entries.map((e) => (
              <li key={e.id}><Link href={`/accounts/journals/${e.id}`} className="font-mono text-primary hover:underline">{e.number}</Link> · {fmtDate(e.date)} · {e.memo}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">To correct one, reverse it from the journal entry page and post again.</p>
        </Card>
      )}
      {can && (
        <ActionForm action={openingTbAction} className="space-y-4">
          <Card>
            <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
              <FInput label="As at (opening date)" name="date" type="date" required defaultValue={todayIso()} />
              <FInput label="Memo" name="memo" defaultValue="Opening trial balance" />
            </div>
          </Card>
          <Card pad={false}>
            <Table>
              <thead>
                <tr>
                  <th>Account</th>
                  <th className="num">Debit (AED)</th>
                  <th className="num">Credit (AED)</th>
                </tr>
              </thead>
              <tbody>
                {eligible.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <span className="font-mono text-xs text-muted">{a.code}</span> {a.name}
                    </td>
                    <td className="num"><input name={`dr_${a.id}`} aria-label={`${a.code} debit`} inputMode="decimal" className={`${inputClass} text-right`} /></td>
                    <td className="num"><input name={`cr_${a.id}`} aria-label={`${a.code} credit`} inputMode="decimal" className={`${inputClass} text-right`} /></td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
          <SubmitButton pendingText="Posting…">Post opening trial balance</SubmitButton>
        </ActionForm>
      )}
    </>
  );
}
