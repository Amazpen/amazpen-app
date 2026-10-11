# STATUS — Amazpen

Last updated: 2026-10-11

## Session 2026-10-11 (David's reports via Netanel)

- **Cashflow lost 10bis income (סושי קונה). Fixed and deployed.** The cashflow fetched income entries only 2 months before the display start, so 10bis entries of Jul 26-31 (settling Oct 15, `settlement_month_offset` 3) never loaded. Lookback is now 7 months (editor allows offsets up to 6). Commit `f440aad1`, `src/app/(dashboard)/cashflow/page.tsx`. David also fixed his 10bis periods: they overlapped on day 26, now 1-25 and 26-31.
- **פרגו, חצי חצי, invoice 786: data, not a bug.** The same ₪1,970 transfer was entered twice (אסנת 6.7 unlinked, David 24.9 linked). David deleted אסנת's row on 11.10. Invoice stays `paid`, correct.
- **סושי קונה, אביב קופות shows "מקדמה לספק" -₪407.01.** No May invoice exists any more, but three ₪407.01 card payments do, and two of them (20.7 and 21.7) sit on the July invoice. The 21.7 one (`5fbf37bd-ca00-46d5-bd29-0fc4aa9b8f4f`) was probably for May. Not touched: delete only if David confirms May was never paid.
- **HAISEN (פתרונות לחיות) shows -₪19,612.** That is payments minus invoices. Many payments are unlinked and some look double-counted (March advance ₪3,906 plus full payment; May ₪8,547.12 "השלמה" on an invoice already fully paid; Nov 2025 paid ₪3,039 over the invoice). Asked David for the supplier ledger. The ₪5,790 gap between the card header and its monthly table is explained below.
- **Deleting one of several payments left the invoice `paid`.** David hit it (his point 3 on 11.10). Fixed and deployed the same evening, see below.
- **Second unlinked-payments list sent to David:** 51 payments across all real businesses (excluding "הדגמה"), file `תשלומים-לא-משויכים.xlsx` on Netanel's desktop. David says he will clean them all. He expects 1 at הנקודה הקסומה; there are 3 (טלזר 019 ₪14,539; ראנד מסחר ₪42,128; ש.ד.ר תמיר ₪198, which is really the supplier owing the business). A permanent "unlinked payments" screen does not exist; it would be a new feature (billable).

### Repo moved, and what comes next

- **Working copy moved on 2026-10-11** to `C:\Code\BrainboxAI\1 - projects\amazpen` (fresh clone). Carried over: local-only branches, `.env.local`, `.mcp.json`, `.claude/` hooks/skills/settings, `content-marketing/`, Claude memory. The old stash is now branch `stash/pending-payments-report-wip` (WIP of the "דו"ח ממתינים לתשלום" report). `npm ci` and `tsc --noEmit` pass here; `npm run dev` not tried yet. Old folder `C:\Users\netn1\Downloads\amazpen-new` is a backup only: delete it after Netanel confirms (remove junctions inside first).
- **Open decision (Netanel): issue tracking.** Proposal: every David report becomes an issue, labels `באג` (maintenance, included) / `פיצ'ר` (billable, needs approval) / `נתונים` (data fix) / `מחכה לדוד`, commits close issues with `Fixes #n`, bigger changes go through a branch + PR. Repo `Amazpen/amazpen-app` belongs to the client account (we have WRITE, 0 issues today), so issues there are visible to David. Alternative: keep tickets as files inside the project. Once chosen, open tickets for the open items in this file.
- **Next in order:** (1) David's answers on אביב קופות ₪407 and the HAISEN ledger, (2) his cleanup of the 51 unlinked payments. Netanel has a ready message for David (payment-delete fix + 3 HAISEN questions below); not sent as of 11.10 late evening.

### Later on 2026-10-11 (deployed: commit `8d90fdcf`, live build 11.10 22:29 verified via `sw.js` BUILD_TIME)

- **Deleting one of several payments now recomputes the invoice.** `handleDeletePayment` in `src/app/(dashboard)/payments/page.tsx`: no payment left -> `pending` (as before); payments left -> `paid` if they still cover the invoice (gap < ₪0.01), else `partial` with the real `amount_paid`. Uses `fetchPaidByInvoice` + `openBalanceOf`.
- **Ghost links fixed in `src/lib/payments/paidByInvoice.ts`.** 2,668 `payment_invoice_links` rows have `amount_allocated = 0` (1,610 on the payment's own FK invoice). `fetchPaidByInvoice` treated any link as "counted via links" and dropped the FK, so those invoices looked unpaid (also in the /payments open-invoice picker). Now only links with money suppress the FK, same rule as the /suppliers monthly breakdown. tsc clean, vitest 94/94. No unit test covers `paidByInvoice.ts` yet.
- **HAISEN ₪5,790 gap explained, no code bug.** Card header = sum of all payments; monthly table = full total of each `paid` invoice + `partial` amount_paid + unlinked payments. Gap = HSLJJ260114-08 (₪12,800, only ₪3,970.70 linked; the ₪9,136.90 payment of 21.3 "סוגר את HSLJJ260114-08" is unlinked, so the table counts ₪8,829.30 twice) minus HSLJJ251110-01 (₪14,414 invoice, ₪17,453.56 paid, table shows ₪3,039.56 less). 8,829.30 - 3,039.56 = 5,789.74. Fix is data: link the 21.3 payment to the January invoice, with David's OK. Data has changed since: header now ₪236,927, table ₪242,717, gap unchanged.
- **HAISEN data oddities to ask David about:** a payment dated **10.11.2026** (₪8,273.53, in the future, probably a typo for 10.10), and three ₪0 payments (31.12.2025, 27.1.2026, 16.2.2026).

## Where we are

Production (`master`, deployed via Dokploy app `gwRa6aVPZ7M34yLydoNFx`) is at `59ea82c6` (code fix `8d90fdcf`, deployed and verified 2026-10-11 22:29). Later STATUS.md-only edits are local until the next code change. All of David's bug reports from 6.10.2026 are fixed and live:

- **Supplier monthly summary** (Bezeq at פרגו נס ציונה, ייעוץ DBC at פתרונות לחיות). The monthly total now groups invoices by value date (`reference_date ?? invoice_date`), the same way as the expenses page. Commit `75226f76`, in `suppliers/page.tsx` and `lib/metrics/suppliers.ts`.
- **OCR dispute reason** "חסר מספר הקצאה" added. Commit `4bb1c5f7`.
- **Karteset check in OCR.** Earlier invoices that are still open, or that were paid by a payment inside the checked range, now show as "יתרה מתקופה קודמת". Commits `3eab08ea` and `094f3f71`.
- **שכירות חולון (פתרונות לחיות): data fix only.** One ₪191,160 payment was linked to 12 invoices of ₪15,930 each.

## Waiting on David

- **The 78 unlinked payments list (sent 6.10) is done.** David returned it on 8.10 and it was processed (confirmed by Netanel on 11.10). Source files stay in `C:\Users\netn1\Downloads\amazpen-data\unlinked-payments-2026-10-06\` (outside the repo: client data).
- **Still open with David, all from 11.10:** אביב קופות ₪407 (above), the HAISEN questions (above), and his own cleanup of the 51-payment list.
- **Rule:** paying a supplier before the invoice exists is David's intended workflow, especially for imports (e.g. HAISEN). An unlinked payment is not an error on its own.
- **Business "הדגמה" is our test business.** It is not part of David's review.

## Open, not deployed

- **Supplier card "נותר לתשלום".** The card counts invoice status and ignores unlinked prepayments, so a supplier with a deposit looks fully owed.
  - A fix exists on branch `worktree-agent-ab900dea6217382f7` (commit `87cf8950`, new `src/lib/suppliers/openBalance.ts`). It was deliberately **not deployed**: a data check showed 64 suppliers changing and 42 going negative, because unlinked payments were subtracted twice.
  - Revisit only after David's linking is done. It is a behaviour change, not a bug fix, so it needs David's approval and may be billable.
  - `src/lib/metrics/suppliers.ts` still uses the old card balance logic on purpose.
- **Legacy data trap.** About 2,800 old invoices are marked `paid` with no payment record (Bubble import). Never compute an open balance from payments alone.

## Parked

- **CI/CD (11.10.2026): Netanel chose to wait.** No GitHub Actions exist. State that day: `tsc` clean, `eslint` 0 errors / 3 warnings, vitest 94/94. Key fact: Dokploy auto-deploys on every push to `master`, so CI alone would not stop a broken deploy; that needs autoDeploy off and the deploy triggered from GitHub after checks pass. Proposed plan: step 1 checks only (tsc, lint, vitest, build), step 2 deploy gated on them. Build needs `NEXT_PUBLIC_*` as GitHub secrets; repo is the client's, so David sees it.

## Do not start

- Do not delete any payment without David's explicit OK.
- Do not deploy `87cf8950` as-is.
