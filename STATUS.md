# STATUS — Amazpen

Last updated: 2026-10-21

## Session 2026-10-21

- **David: in "הדגמה" a manual ₪100,000 staffing-company invoice (supplier "עובדים כ\"א", invoice `754ec7e1-afeb-486b-b1d4-e43b8c7d4478`, Oct 2026) showed in ניהול הוצאות but not on the dashboard or the P&L.** First answer ("by design, close the month") was WRONG and is withdrawn: daily entries never include an outside staffing company, so it must add on top of the estimate while the month is open.
- **Fix (commit below, pushed = live):** new `src/lib/labor/openMonthExtras.ts`. Open month: labor = daily estimate + invoices of `employee_costs` suppliers whose category is a SUBCATEGORY of "עלות עובדים"/"עלויות עובדים", excluding close invoices (`labor_close_id`). Applied in dashboard (`(dashboard)/page.tsx`), agent `lib/metrics/expenses.ts`, and P&L totals (`reports/page.tsx`, `lib/metrics/pnl.ts`; the P&L labor ROW already added these, the profit did not). Employee suppliers without a labor subcategory (e.g. פתרונות לחיות pensions) are NOT added: the markup estimate covers them.
- **"סגור חודש" no longer double-counts:** `/api/labor-close` POST now subtracts what manual (non-close) invoices already recorded per supplier that month and invoices only the remainder.
- **Data:** supplier "עובדים כ\"א" (הדגמה) set to category "עלויות כ\"א נוספות". It had no category at all; the supplier form is fine.
- **Live impact:** הדגמה Oct labor ₪66,198 → ₪166,198. סושי קונה: "ויזה עובדים זרים" now counts in dashboard + profit (May ₪8,695, Sep ₪9,755). No other real business affected.
- **Known gaps, not fixed:** weekly email / business-summary-report, metrics/refresh (business_monthly_metrics), multi-business cards (`page.tsx` ~1214), goals page and DailyEntriesModal still show estimate only; "שינוי מחודש קודם" compares against estimate-only months. Message to David sent 21.10 (fix explained, supplier must sit in a labor subcategory). Live build 21.10 20:34 verified via `sw.js` BUILD_TIME.

## Session 2026-10-20

- **The 51 unlinked-payments list is closed.** David returned `תשלומים-לא-משויכים.xlsx` with a note per row. Checked every row against the DB: his "נמחק" / "טופל" rows are really gone or linked, with the exceptions below. We hard-deleted 16 payments (same way as `handleDeletePayment`: splits, links, payment; none had invoice links): 14 of inactive clients (מאמא רסקו 1, שמה שמה אילת 2, תמר שילון 11), פרגו דיב אנד רד ₪1,180 of 30.7 (David: not in the bank; the other five ₪1,180 payments that day each sit on a different month's invoice), and פרגו זאפ גרופ ₪88.09 of 5.6.2025. David asked to link the ₪88.09 to invoice 4017999 and fix it to ₪103.95, but that invoice is already paid by a separate ₪103.95 payment of the same day, so ₪88.09 was a net-of-VAT duplicate; deleting it gives the result he wanted. Backup of every deleted row and David's file: `C:\Users\netn1\Downloads\amazpen-data\unlinked-payments-2026-10-20\` (outside the repo, client data). Message sent to David the same day.
- **Left open on purpose (David):** ש.ד.ר תמיר ₪198 (supplier owes the business), VAT payments סושי קונה ₪33,314 and פתרונות לחיות ₪8,765.
- **Asked David, waiting:** (1) פתרונות לחיות, הובלה יבשתית ₪1,652 of 26.3 (`8830ae4f-ebb1-4962-b463-fbb3165ad147`): he marked it deleted, it is still there, unlinked. (2) אושי אושי, מע"מ ₪62,541 of 24.9 (`a9ae1d6d-dd40-47bf-b6c3-99be8d526be3`): marked "טופל" but still unlinked.
- **יובל סמואל (פתרונות לחיות, supplier `c23d1c57-612c-4db3-8805-3b4c1c194779`): David's own reconciliation, no task for us.** Supplier ledger ₪99,684 vs Amazpen ₪91,510.33. Two invoices are missing in Amazpen (354-1883 ₪1,789, 354-1712 ₪3,834.70; searched invoices and delivery notes, not there, never entered). ₪2,549.97 is left; David asked the supplier for an aging report. Oldest open invoice in Amazpen is 10.8.2026, so if the gap is older it is likely a legacy Bubble invoice marked `paid` with no payment (hypothesis). Matching the ledger line by line for him would be accounting work, outside maintenance (billable); fixing a wrong invoice he points to is maintenance.

## Session 2026-10-12

- Deleting user עידו לוי failed with "cannot update view daily_summary": the delete-user route listed `daily_summary` (a view over `daily_entries`) in its cleanup list. Removed it, commit 8c416774, LIVE (Dokploy deploy done 21:50). Message sent to David to delete him again.
- OPEN (next session, first thing): verify עידו לוי is fully gone. At session end his auth account was already deleted, but `profiles` and 1 `business_members` row for id `d07b791d-a319-4f2e-b335-536029269bcd` were still there (David had not retried yet). Check: `select count(*) from profiles where id='d07b791d-a319-4f2e-b335-536029269bcd'` and the same on `business_members.user_id` should both be 0. If David's retry fails, read the error text: the route continues past "user not found" by design.

## Session 2026-10-11 (David's reports via Netanel)

- **Cashflow lost 10bis income (סושי קונה). Fixed and deployed.** The cashflow fetched income entries only 2 months before the display start, so 10bis entries of Jul 26-31 (settling Oct 15, `settlement_month_offset` 3) never loaded. Lookback is now 7 months (editor allows offsets up to 6). Commit `f440aad1`, `src/app/(dashboard)/cashflow/page.tsx`. David also fixed his 10bis periods: they overlapped on day 26, now 1-25 and 26-31.
- **פרגו, חצי חצי, invoice 786: data, not a bug.** The same ₪1,970 transfer was entered twice (אסנת 6.7 unlinked, David 24.9 linked). David deleted אסנת's row on 11.10. Invoice stays `paid`, correct.
- **סושי קונה, אביב קופות shows "מקדמה לספק" -₪407.01.** No May invoice exists any more, but three ₪407.01 card payments do, and two of them (20.7 and 21.7) sit on the July invoice. The 21.7 one (`5fbf37bd-ca00-46d5-bd29-0fc4aa9b8f4f`) was probably for May. Not touched: delete only if David confirms May was never paid.
- **HAISEN (פתרונות לחיות) shows -₪19,612.** That is payments minus invoices. Many payments are unlinked and some look double-counted (March advance ₪3,906 plus full payment; May ₪8,547.12 "השלמה" on an invoice already fully paid; Nov 2025 paid ₪3,039 over the invoice). Asked David for the supplier ledger. The ₪5,790 gap between the card header and its monthly table is explained below.
- **Deleting one of several payments left the invoice `paid`.** David hit it (his point 3 on 11.10). Fixed and deployed the same evening, see below.
- **Second unlinked-payments list sent to David (closed 20.10, see above):** 51 payments across all real businesses (excluding "הדגמה"), file `תשלומים-לא-משויכים.xlsx` on Netanel's desktop. David says he will clean them all. He expects 1 at הנקודה הקסומה; there are 3 (טלזר 019 ₪14,539; ראנד מסחר ₪42,128; ש.ד.ר תמיר ₪198, which is really the supplier owing the business). A permanent "unlinked payments" screen does not exist; it would be a new feature (billable).

### Repo moved, and what comes next

- **Working copy moved on 2026-10-11** to `C:\Code\BrainboxAI\1 - projects\amazpen` (fresh clone). Carried over: local-only branches, `.env.local`, `.mcp.json`, `.claude/` hooks/skills/settings, `content-marketing/`, Claude memory. The old stash is now branch `stash/pending-payments-report-wip` (WIP of the "דו"ח ממתינים לתשלום" report). `npm ci` and `tsc --noEmit` pass here; `npm run dev` not tried yet. Old folder `C:\Users\netn1\Downloads\amazpen-new` is a backup only: delete it after Netanel confirms (remove junctions inside first).
- **Open decision (Netanel): issue tracking.** Proposal: every David report becomes an issue, labels `באג` (maintenance, included) / `פיצ'ר` (billable, needs approval) / `נתונים` (data fix) / `מחכה לדוד`, commits close issues with `Fixes #n`, bigger changes go through a branch + PR. Repo `Amazpen/amazpen-app` belongs to the client account (we have WRITE, 0 issues today), so issues there are visible to David. Alternative: keep tickets as files inside the project. Once chosen, open tickets for the open items in this file.
- **Next in order:** (1) David's answers on אביב קופות ₪407 and the HAISEN ledger, (2) his two answers from 20.10 (הובלה יבשתית ₪1,652, אושי אושי VAT ₪62,541). The 51-payment cleanup is done (20.10). Note: David deleted the HAISEN ₪9,136.90 payment of 21.3 himself, so the "link it to HSLJJ260114-08" question is moot. Message sent to David on 11.10 late evening: payment-delete fix + 3 HAISEN questions (link the 21.3 ₪9,136.90 payment to HSLJJ260114-08? is 10.11.2026 a typo for 10.10? delete the three ₪0 payments?). Waiting for his answers.

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
- **Still open with David, all from 11.10:** אביב קופות ₪407 (above), the HAISEN questions (above), and (from 20.10) the two leftover rows of the 51-payment list.
- **Rule:** paying a supplier before the invoice exists is David's intended workflow, especially for imports (e.g. HAISEN). An unlinked payment is not an error on its own.
- **Business "הדגמה" is our test business.** It is not part of David's review.
- **18.10: David reported "נתונים במקום" in הדגמה shows 0.00 change. Not a bug.** The row compares average per order, and the demo data has exactly ₪98.07 per order in Sep and Oct; demo data starts Nov 2025, so no prev-year value either. Answer sent; asked him whether to vary the demo data (data only, no code). Showing "אין נתונים" instead of 0 when there is nothing to compare would be a billable feature, not raised yet.

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
