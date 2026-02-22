import type { IncomeSource } from "@/types";

export interface DailyIncomeEntry {
  entry_date: string; // YYYY-MM-DD
  income_source_id: string;
  amount: number;
}

export interface SettledIncome {
  settlement_date: string; // YYYY-MM-DD — when money enters bank
  income_source_id: string;
  income_source_name: string;
  original_entry_date: string;
  gross_amount: number;
  fee_amount: number;
  net_amount: number; // gross - fee
}

function formatDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Calculate the bank settlement date for an income entry based on its source's rules.
 */
function calculateSettlementDate(entryDate: string, source: IncomeSource): string {
  const d = new Date(entryDate + "T00:00:00");
  const type = source.settlement_type || "daily";

  switch (type) {
    case "same_day":
      return entryDate;

    case "daily": {
      const delay = source.settlement_delay_days ?? 1;
      d.setDate(d.getDate() + delay);
      return formatDate(d);
    }

    case "weekly": {
      // Find next occurrence of settlement_day_of_week
      const targetDay = source.settlement_day_of_week ?? 0; // 0=Sunday
      let daysUntil = targetDay - d.getDay();
      if (daysUntil <= 0) daysUntil += 7;
      d.setDate(d.getDate() + daysUntil);
      return formatDate(d);
    }

    case "monthly": {
      // Settles on settlement_day_of_month of the NEXT month
      const settleDay = source.settlement_day_of_month ?? 1;
      const nextMonth = new Date(d.getFullYear(), d.getMonth() + 1, settleDay);
      return formatDate(nextMonth);
    }

    case "bimonthly": {
      // Two settlement periods per month
      const cutoff = source.bimonthly_first_cutoff ?? 14;
      const firstSettle = source.bimonthly_first_settlement ?? 2;
      const secondSettle = source.bimonthly_second_settlement ?? 8;
      const dayOfMonth = d.getDate();

      if (dayOfMonth <= cutoff) {
        // First half → settles on firstSettle of next month
        const settleDate = new Date(d.getFullYear(), d.getMonth() + 1, firstSettle);
        return formatDate(settleDate);
      } else {
        // Second half → settles on secondSettle of next month
        const settleDate = new Date(d.getFullYear(), d.getMonth() + 1, secondSettle);
        return formatDate(settleDate);
      }
    }

    case "custom": {
      // Coupons: all entries settle on coupon_settlement_date of next month
      const settleDay = source.coupon_settlement_date ?? 1;
      const nextMonth = new Date(d.getFullYear(), d.getMonth() + 1, settleDay);
      return formatDate(nextMonth);
    }

    default:
      return entryDate;
  }
}

/**
 * Process all daily income entries through settlement rules to get
 * a map of settlement_date → SettledIncome[]
 */
export function calculateSettledIncome(
  dailyIncomeEntries: DailyIncomeEntry[],
  incomeSources: IncomeSource[]
): Map<string, SettledIncome[]> {
  const sourceMap = new Map(incomeSources.map((s) => [s.id, s]));
  const result = new Map<string, SettledIncome[]>();

  for (const entry of dailyIncomeEntries) {
    const source = sourceMap.get(entry.income_source_id);
    if (!source) continue;

    const settlementDate = calculateSettlementDate(entry.entry_date, source);
    const feeRate = (source.commission_rate || 0) / 100;
    const feeAmount = entry.amount * feeRate;
    const netAmount = entry.amount - feeAmount;

    const settled: SettledIncome = {
      settlement_date: settlementDate,
      income_source_id: entry.income_source_id,
      income_source_name: source.name,
      original_entry_date: entry.entry_date,
      gross_amount: entry.amount,
      fee_amount: feeAmount,
      net_amount: netAmount,
    };

    const existing = result.get(settlementDate) || [];
    existing.push(settled);
    result.set(settlementDate, existing);
  }

  return result;
}
