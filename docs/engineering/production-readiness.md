# Production Readiness Checklist

Status at 17 Nov 2026, from the [repository audit](../audit/2026-11-17-repository-audit.md) and code reading. ✅ done · ⚠️ partial · ❌ not done. Server state was not inspected; items marked "server" must be verified on the host.

Production currently runs Steps 1–3 **with demo data**. "Go-live" below means entering real business data.

## 1. Quality and release

| Item | Status | Note |
|---|---|---|
| Typecheck, lint, tests (46/46), build, migration drift green | ✅ | 17 Nov 2026, Step 4 completion ([testing-strategy.md](testing-strategy.md)) |
| Production build verified for the release commit | ⚠️ | not run at audit start; required for every deploy |
| Migration drift check clean | ✅ | |
| Migrations additive | ✅ | `init`, `purchase_import` |
| CI pipeline | ❌ | Recommendation |
| Browser E2E smoke tests | ❌ | Recommendation |
| User acceptance testing (UAT) with the client on spec §11 criteria | ❌ | D1–D5, R1–R10; Step 4 needs C1/C5/C6 confirmation |
| Rollback plan documented | ✅ | [deployment.md](deployment.md#6-rollback) |
| Deployed commits tagged | ❌ | Recommendation |

## 2. Data protection

| Item | Status | Note |
|---|---|---|
| Automated daily backups | ❌ | **Blocker** (spec §8) — [backup-recovery.md](backup-recovery.md) |
| Off-site, encrypted backup copy | ❌ | Blocker together with the above |
| Restore drill performed and recorded | ❌ | Blocker ("tested restore") |
| Pre-deploy dump in procedure | ✅ | documented |

## 3. Security

| Item | Status | Note |
|---|---|---|
| HTTPS (Cloudflare) | ✅ | server |
| App bound to localhost, DB not exposed | ✅ | compose |
| Secrets only in `.env.production` on server | ✅ | never in git/image |
| Strong unique DB password | ⚠️ | server — verify |
| Login rate limit / lockout | ❌ | Recommendation (should be done before go-live) |
| Failed-login audit | ❌ | Recommendation |
| Security headers | ❌ | `next.config.ts` empty |
| Non-root container | ❌ | `Dockerfile` |
| `npm audit` reviewed | ❌ | |
| Demo users removed or disabled; real users with strong passwords | ❌ | **Blocker** — demo accounts exist in production |
| Production seed path that cannot create demo users/stock | ❌ | see [deployment.md §4](deployment.md#4-base-seed-when-and-what-it-does) |

## 4. Data readiness

| Item | Status | Note |
|---|---|---|
| Demo stock, demo masters and their journals removed | ❌ | **Blocker**: production DB has demo inventory. Safest: fresh database (new volume) + base seed without demo data, then real opening data — needs user approval |
| Legal name, TRN, bank details (OI-15) | ❌ | placeholders from the seed (`CompanySetting`); required on printed documents |
| Opening balances (AR/AP/bank/TB) and opening stock import | ⚠️ | opening stock entry exists; balances/templates Planned (Step 11, BD-13) |
| Chart of accounts reviewed by the client's accountant | ❌ | default UAE template 💡 |
| Accounting periods before go-live locked | ❌ | after opening balances |

## 5. Operations

| Item | Status | Note |
|---|---|---|
| Health endpoint + uptime alert | ❌ | [monitoring.md](monitoring.md) |
| Log rotation | ❌ | |
| Disk / DB size monitoring | ❌ | |
| Scheduled jobs (PI/SO expiry, PDC/CRM reminders) | ❌ | not needed until Steps 5–6/10; SO expiry blocked by C2 |
| Nightly Inventory = GL check | ❌ | Recommendation |
| Timezone policy (`today()` uses server local time; container is UTC) | ⚠️ | decide `TZ=Asia/Dubai` or explicit Dubai date handling before go-live |

## 6. Functional scope and decisions

| Item | Status | Note |
|---|---|---|
| Steps 1–3 (foundation, masters, inventory) | ✅ | live |
| Step 4 purchase & import | ⚠️ | built, not deployed; C1, C5, C6 implemented as proposals awaiting client confirmation |
| Sales, receipts/DN, returns/CN (Steps 5–7) | ❌ | blocked by C2, C4, C7 |
| Accounts, VAT reports, CRM, opening setup (Steps 8–11) | ❌ | Planned |
| PDF printing (PO, GRN, …) | ❌ | Planned (audit F7) |
| Demo date (OI-16), real costing samples (OI-17), HRM scope (OI-18) | ❌ | pending client |

## 7. Go-live gate

Real data may be entered only when every **Blocker** above is ✅, UAT is signed off for the modules in use, the pending decisions affecting those modules are confirmed in [DECISIONS.md](../../DECISIONS.md), and the user approves the go-live.
