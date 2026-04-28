import type { PaymentMethodType, SettlementPeriod, SettlementType } from "@/types";

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
  settlement_periods?: SettlementPeriod[] | null;
}

interface ResolvedSettlement {
  settlement_date: string;
  fee_rate_pct: number;     // commission as percentage of amount (0–100)
  fee_fixed: number;         // commission as fixed ₪ per entry
}

function formatDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Resolve the bank settlement date AND the per-entry fee for a payment entry,
 * based on its method's rules. `custom_periods` (Wolt / 10bis) carries its own
 * commission per period, so we resolve fees here instead of at call-site.
 */
function calculateSettlement(entryDate: string, rules: SettlementRules): ResolvedSettlement {
  const d = new Date(entryDate + "T00:00:00");
  const type = rules.settlement_type || "daily";

  // Default fee comes from rules.commission_rate (% of amount). custom_periods
  // overrides per-period below.
  const defaultFeePct = Number(rules.commission_rate) || 0;

  switch (type) {
    case "same_day":
      return { settlement_date: entryDate, fee_rate_pct: defaultFeePct, fee_fixed: 0 };

    case "daily": {
      const delay = rules.settlement_delay_days ?? 1;
      d.setDate(d.getDate() + delay);
      return { settlement_date: formatDate(d), fee_rate_pct: defaultFeePct, fee_fixed: 0 };
    }

    case "weekly": {
      const targetDay = rules.settlement_day_of_week ?? 0;
      let daysUntil = targetDay - d.getDay();
      if (daysUntil <= 0) daysUntil += 7;
      d.setDate(d.getDate() + daysUntil);
      return { settlement_date: formatDate(d), fee_rate_pct: defaultFeePct, fee_fixed: 0 };
    }

    case "monthly": {
      const settleDay = rules.settlement_day_of_month ?? 1;
      const nextMonth = new Date(d.getFullYear(), d.getMonth() + 1, settleDay);
      return { settlement_date: formatDate(nextMonth), fee_rate_pct: defaultFeePct, fee_fixed: 0 };
    }

    case "bimonthly": {
      const cutoff = rules.bimonthly_first_cutoff ?? 14;
      const firstSettle = rules.bimonthly_first_settlement ?? 2;
      const secondSettle = rules.bimonthly_second_settlement ?? 8;
      const dayOfMonth = d.getDate();
      const settleDate = dayOfMonth <= cutoff
        ? new Date(d.getFullYear(), d.getMonth() + 1, firstSettle)
        : new Date(d.getFullYear(), d.getMonth() + 1, secondSettle);
      return { settlement_date: formatDate(settleDate), fee_rate_pct: defaultFeePct, fee_fixed: 0 };
    }

    case "custom": {
      const settleDay = rules.coupon_settlement_date ?? 1;
      const nextMonth = new Date(d.getFullYear(), d.getMonth() + 1, settleDay);
      return { settlement_date: formatDate(nextMonth), fee_rate_pct: defaultFeePct, fee_fixed: 0 };
    }

    case "custom_periods": {
      // Wolt / 10bis style — multiple periods per month, each with its own
      // settlement date AND commission. Pick the period whose [range_start,
      // range_end] contains the entry's day-of-month. If none matches, fall
      // through to next-day default.
      const periods = rules.settlement_periods || [];
      const dayOfMonth = d.getDate();
      const period = periods.find((p) => dayOfMonth >= p.range_start && dayOfMonth <= p.range_end);
      if (!period) {
        // No matching period configured — use next-day as a safe default.
        const fallback = new Date(d);
        fallback.setDate(fallback.getDate() + 1);
        return { settlement_date: formatDate(fallback), fee_rate_pct: 0, fee_fixed: 0 };
      }
      // settlement_date in custom_periods is a day-of-month. If the entry was
      // before the cutoff, the money usually arrives in the SAME month if
      // settlement_date >= entry day, otherwise in the NEXT month.
      const settleDay = Math.max(1, Math.min(28, period.settlement_date));
      const targetMonth = settleDay >= dayOfMonth ? d.getMonth() : d.getMonth() + 1;
      const settleDate = new Date(d.getFullYear(), targetMonth, settleDay);
      const feePct = period.commission_type === "percentage" ? Number(period.commission_rate) || 0 : 0;
      const feeFixed = period.commission_type === "fixed" ? Number(period.commission_rate) || 0 : 0;
      return { settlement_date: formatDate(settleDate), fee_rate_pct: feePct, fee_fixed: feeFixed };
    }

    default:
      return { settlement_date: entryDate, fee_rate_pct: defaultFeePct, fee_fixed: 0 };
  }
}

/**
 * Process daily payment entries through settlement rules to get
 * a map of settlement_date → SettledIncome[]
 */
export function calculateSettledIncome(
  dailyPaymentEntries: DailyPaymentEntry[],
  paymentMethods: PaymentMethodType[],
  paymentMethodNames: Record<string, string>
): Map<string, SettledIncome[]> {
  const methodMap = new Map(paymentMethods.map((m) => [m.id, m]));
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
          settlement_periods: method.settlement_periods ?? null,
        }
      : { settlement_type: "daily" as SettlementType, settlement_delay_days: 1, commission_rate: 0 };

    const resolved = calculateSettlement(entry.entry_date, rules);
    const feeAmount = (entry.amount * resolved.fee_rate_pct) / 100 + resolved.fee_fixed;
    const netAmount = entry.amount - feeAmount;

    const settled: SettledIncome = {
      settlement_date: resolved.settlement_date,
      payment_method_id: entry.payment_method_id,
      payment_method_name: paymentMethodNames[entry.payment_method_id] || entry.payment_method_id,
      original_entry_date: entry.entry_date,
      gross_amount: entry.amount,
      fee_amount: feeAmount,
      net_amount: netAmount,
    };

    const existing = result.get(resolved.settlement_date) || [];
    existing.push(settled);
    result.set(resolved.settlement_date, existing);
  }

  return result;
}
