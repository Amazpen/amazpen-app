# STATUS — Amazpen

Last updated: 2026-10-06

## Where we are

Production (`master`, deployed via Dokploy app `gwRa6aVPZ7M34yLydoNFx`) is at `094f3f71`. All of David's bug reports from 6.10.2026 are fixed and live:

- **Supplier monthly summary** (Bezeq at פרגו נס ציונה, ייעוץ DBC at פתרונות לחיות). The monthly total now groups invoices by value date (`reference_date ?? invoice_date`), the same way as the expenses page. Commit `75226f76`, in `suppliers/page.tsx` and `lib/metrics/suppliers.ts`.
- **OCR dispute reason** "חסר מספר הקצאה" added. Commit `4bb1c5f7`.
- **Karteset check in OCR.** Earlier invoices that are still open, or that were paid by a payment inside the checked range, now show as "יתרה מתקופה קודמת". Commits `3eab08ea` and `094f3f71`.
- **שכירות חולון (פתרונות לחיות): data fix only.** One ₪191,160 payment was linked to 12 invoices of ₪15,930 each.

## Waiting on David

He received an Excel list of 78 supplier payments that are not linked to any invoice: 10 businesses, ₪726,640. He said on 6.10 that he will go over it "tomorrow" and send it back.

- **Full files:** `C:\Users\netn1\Downloads\amazpen-data\unlinked-payments-2026-10-06\`. This folder is outside the repo because it holds client data.
  - The xlsx has a "טכני" sheet with `payment_id`, `invoice_ids` and allocations.
  - `results.json` holds the same match data.
  - `match.js` and `fetch.js` are the scripts that built it.
- **Important:** paying a supplier before the invoice exists is David's intended workflow, especially for imports (e.g. HAISEN). He links the payment once the invoice arrives. An unlinked payment is not an error on its own.
- **When the file comes back:**
  - For each row David marks "כן", insert `payment_invoice_links` rows and update invoice status (`paid`, or `partial` when the invoice is not fully covered). Re-check that the payment and the invoice are unchanged since 6.10 before writing.
  - Rows marked "מחכה לחשבונית" are left untouched.
- **Suspected duplicate payments:**
  - ראנד מסחר: ₪42,128 on 17/04/2026, business הנקודה הקסומה.
  - רומאו הגברה: ₪650 on 31/05/2026, business שמה שמה אילת.

  In both cases the invoice is already paid by another payment. Delete only with David's explicit OK.
- **Business "הדגמה" is our test business.** It is not part of David's review.
- **Billing:** Netanel decides whether this cleanup is billable after seeing how many rows need fixing.

## Open, not deployed

- **Supplier card "נותר לתשלום".** The card counts invoice status and ignores unlinked prepayments, so a supplier with a deposit looks fully owed.
  - A fix exists on branch `worktree-agent-ab900dea6217382f7` (commit `87cf8950`, new `src/lib/suppliers/openBalance.ts`). It was deliberately **not deployed**: a data check showed 64 suppliers changing and 42 going negative, because unlinked payments were subtracted twice.
  - Revisit only after David's linking is done. It is a behaviour change, not a bug fix, so it needs David's approval and may be billable.
  - `src/lib/metrics/suppliers.ts` still uses the old card balance logic on purpose.
- **Legacy data trap.** About 2,800 old invoices are marked `paid` with no payment record (Bubble import). Never compute an open balance from payments alone.

## Do not start

- Do not link or delete any payment before David returns the approved list.
- Do not deploy `87cf8950` as-is.
