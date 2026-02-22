import type { BusinessPaymentMethod, SettlementType } from "@/types";

export interface DailyPaymentEntry {
  entry_date: string; // YYYY-MM-DD
  payment_method_id: string;
  amount: number;
}

export interface SettledIncome {
  settlement_date: string; // YYYY-MM-DD — when money enters bank
  payment_method_id: string;
  payment_method_name: string;
  original_entry_date: string;
  gross_amount: number;
  fee_amount: number;
  net_amount: number; // gross - fee
}

interface SettlementRules {
  settlement_type: SettlementType;
  settlement_delay_days: number;
  settlement_day_of_week?: number;
  settlement_day_of_month?: number;
  bimonthly_first_cutoff?: number;
  bimonthly_first_settlement?: number;
  bimonthly_second_settlement?: number;
  commission_rate: number;
  coupon_settlement_date?: number;
  coupon_range_start?: number;
  coupon_range_end?: number;
}

function formatDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Calculate the bank settlement date for a payment entry based on its method's rules.
 */
function calculateSettlementDate(entryDate: string, rules: SettlementRules): string {
  const d = new Date(entryDate + "T00:00:00");
  const type = rules.settlement_type || "daily";

  switch (type) {
    case "same_day":
      return entryDate;

    case "daily": {
      const delay = rules.settlement_delay_days ?? 1;
      d.setDate(d.getDate() + delay);
      return formatDate(d);
    }

    case "weekly": {
      // Find next occurrence of settlement_day_of_week
      const targetDay = rules.settlement_day_of_week ?? 0; // 0=Sunday
      let daysUntil = targetDay - d.getDay();
      if (daysUntil <= 0) daysUntil += 7;
      d.setDate(d.getDate() + daysUntil);
      return formatDate(d);
    }

    case "monthly": {
      // Settles on settlement_day_of_month of the NEXT month
      const settleDay = rules.settlement_day_of_month ?? 1;
      const nextMonth = new Date(d.getFullYear(), d.getMonth() + 1, settleDay);
      return formatDate(nextMonth);
    }

    case "bimonthly": {
      // Two settlement periods per month
      const cutoff = rules.bimonthly_first_cutoff ?? 14;
      const firstSettle = rules.bimonthly_first_settlement ?? 2;
      const secondSettle = rules.bimonthly_second_settlement ?? 8;
      const dayOfMonth = d.getDate();

      if (dayOfMonth <= cutoff) {
        const settleDate = new Date(d.getFullYear(), d.getMonth() + 1, firstSettle);
        return formatDate(settleDate);
      } else {
        const settleDate = new Date(d.getFullYear(), d.getMonth() + 1, secondSettle);
        return formatDate(settleDate);
      }
    }

    case "custom": {
      // Coupons: all entries settle on coupon_settlement_date of next month
      const settleDay = rules.coupon_settlement_date ?? 1;
      const nextMonth = new Date(d.getFullYear(), d.getMonth() + 1, settleDay);
      return formatDate(nextMonth);
    }

    default:
      return entryDate;
  }
}

/**
 * Process daily payment entries through settlement rules to get
 * a map of settlement_date → SettledIncome[]
 */
export function calculateSettledIncome(
  dailyPaymentEntries: DailyPaymentEntry[],
  businessPaymentMethods: BusinessPaymentMethod[],
  paymentMethodNames: Record<string, string>
): Map<string, SettledIncome[]> {
  const methodMap = new Map(businessPaymentMethods.map((m) => [m.payment_method_id, m]));
  const result = new Map<string, SettledIncome[]>();

  for (const entry of dailyPaymentEntries) {
    const method = methodMap.get(entry.payment_method_id);
    // If no business-specific config, use defaults (daily, 1 day delay)
    const rules: SettlementRules = method
      ? {
          settlement_type: (method.settlement_type as SettlementType) || "daily",
          settlement_delay_days: method.settlement_delay_days ?? 1,
          settlement_day_of_week: method.settlement_day_of_week ?? undefined,
          settlement_day_of_month: method.settlement_day_of_month ?? undefined,
          bimonthly_first_cutoff: method.bimonthly_first_cutoff ?? undefined,
          bimonthly_first_settlement: method.bimonthly_first_settlement ?? undefined,
          bimonthly_second_settlement: method.bimonthly_second_settlement ?? undefined,
          commission_rate: Number(method.commission_rate) || 0,
          coupon_settlement_date: method.coupon_settlement_date ?? undefined,
          coupon_range_start: method.coupon_range_start ?? undefined,
          coupon_range_end: method.coupon_range_end ?? undefined,
        }
      : { settlement_type: "daily" as SettlementType, settlement_delay_days: 1, commission_rate: 0 };

    const settlementDate = calculateSettlementDate(entry.entry_date, rules);
    const feeRate = (rules.commission_rate || 0) / 100;
    const feeAmount = entry.amount * feeRate;
    const netAmount = entry.amount - feeAmount;

    const settled: SettledIncome = {
      settlement_date: settlementDate,
      payment_method_id: entry.payment_method_id,
      payment_method_name: paymentMethodNames[entry.payment_method_id] || entry.payment_method_id,
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
