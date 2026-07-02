import type { SettledIncome } from "./settlement";

// ---------------------------------------------------------------------------
// Income overrides (cashflow_income_overrides)
//
// An override replaces the calculated net amount of ONE settled income item:
// it is keyed by settlement_date + payment_method_id + original_entry_date.
// Several entry days of the same method can settle on the same bank day
// (e.g. 15 Wolt days all paying out on the 1st) — original_entry_date is what
// tells them apart, so an edit to one day must not touch its siblings.
//
// Shared by cashflow/page.tsx and lib/metrics/cashflow.ts so the page and the
// metrics forecast apply overrides identically.
// ---------------------------------------------------------------------------

export interface IncomeOverrideRow {
  settlement_date: string;
  payment_method_id: string;
  original_entry_date: string | null;
  override_amount: number | string;
  note?: string | null;
}

export interface IncomeOverride {
  amount: number;
  note: string | null;
}

// DATE columns normally arrive as "YYYY-MM-DD", but some paths serialize them
// as full timestamps — key off the date part only.
const dateOnly = (v: unknown) => String(v ?? "").substring(0, 10);

export function overrideKey(
  settlementDate: string,
  paymentMethodId: string,
  originalEntryDate: string
): string {
  return `${dateOnly(settlementDate)}|${paymentMethodId}|${dateOnly(originalEntryDate)}`;
}

export function buildOverrideMap(rows: IncomeOverrideRow[]): Map<string, IncomeOverride> {
  const map = new Map<string, IncomeOverride>();
  for (const row of rows) {
    // Legacy rows saved before original_entry_date existed can't be matched to
    // a single item — skip them rather than override the whole method/day.
    if (!row.original_entry_date) continue;
    map.set(overrideKey(row.settlement_date, row.payment_method_id, row.original_entry_date), {
      amount: Number(row.override_amount),
      note: row.note ?? null,
    });
  }
  return map;
}

export function applyIncomeOverrides(
  items: SettledIncome[],
  overrides: Map<string, IncomeOverride>,
  settlementDate: string
): SettledIncome[] {
  return items.map((item) => {
    const ov = overrides.get(
      overrideKey(settlementDate, item.payment_method_id, item.original_entry_date)
    );
    if (!ov) return item;
    return {
      ...item,
      net_amount: ov.amount,
      fee_amount: item.gross_amount - ov.amount,
      override_note: ov.note,
    };
  });
}
