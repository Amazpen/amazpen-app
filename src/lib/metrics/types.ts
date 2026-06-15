// Shared types for the server-side metrics module.

/** A calendar date range (inclusive on both ends). */
export interface MetricsDateRange {
  start: Date;
  end: Date;
}

/** Per income-source breakdown of income for the period. */
export interface IncomeSourceMetric {
  id: string;
  name: string;
  /** income_sources.income_type — 'private' (in-place) or 'business' (delivery). */
  incomeType: string;
  amount: number;
  ordersCount: number;
  /**
   * Average ticket. If orders exist, amount / ordersCount; otherwise (e.g.
   * coupons with no orders) amount / entriesCount. 0 when no data.
   */
  avgTicket: number;
}

/** Aggregated income for a channel (in-place or delivery). */
export interface ChannelIncomeMetric {
  amount: number;
  ordersCount: number;
  avgTicket: number;
}

/**
 * Income metrics for a single business over a date range. Replicates the
 * income computation from the dashboard's `fetchDetailedSummary`.
 */
export interface IncomeMetrics {
  /** Sum of daily_entries.total_register over the range. */
  totalIncome: number;
  /** totalIncome / (1 + VAT). */
  incomeBeforeVat: number;
  /** Forecast: (totalIncome / actualWorkDays) * expectedWorkDays. */
  monthlyPace: number;
  /** Sum of goals.revenue_target for the month. */
  revenueTarget: number;
  /** ((monthlyPace / revenueTarget) - 1) * 100. 0 when no target/data. */
  targetDiffPct: number;
  /** Target diff in ILS, prorated by actual vs expected work days. */
  targetDiffIls: number;
  /** % change of forecast vs the full previous calendar month. */
  momChangePct: number;
  /** % change of forecast vs the same month last year (0 if no data). */
  yoyChangePct: number;
  /** Expected work days in the month (schedule + day exceptions). */
  expectedWorkDays: number;
  /** Actual work days in range (sum of daily_entries.day_factor). */
  actualWorkDays: number;
  /** Per income-source breakdown. */
  bySource: IncomeSourceMetric[];
  /** In-place channel (income_type 'private'). */
  inPlace: ChannelIncomeMetric;
  /** Delivery channel (income_type 'business'). */
  delivery: ChannelIncomeMetric;
}

// ---------------------------------------------------------------------------
// Expense metrics
// ---------------------------------------------------------------------------

/** Labor cost (עלות עובדים) for the period. */
export interface LaborCostMetric {
  /** ILS. Estimate = (rawLaborCost + managerCost) * markup; when the month is
   *  closed, actual sum of employee_costs invoices instead. */
  amount: number;
  /** amount / incomeBeforeVat * 100. */
  pct: number;
  /** Target % from goals.labor_cost_target_pct (averaged). */
  targetPct: number;
  /** pct - targetPct (positive = over budget). */
  diffPct: number;
  /** diffPct * incomeBeforeVat / 100 (ILS). */
  diffIls: number;
  /** true when labor_month_close is 'closed' for the business/period. */
  monthClosed: boolean;
}

/** Cost of goods sold (עלות מכר) for the period. */
export interface CogsMetric {
  /** ILS. Sum of goods_purchases invoice subtotals + unlinked delivery notes. */
  amount: number;
  /** amount / incomeBeforeVat * 100. */
  pct: number;
  /** Target % from goals.food_cost_target_pct (averaged). */
  targetPct: number;
  /** pct - targetPct (positive = over budget). */
  diffPct: number;
}

/** Operating expenses (הוצאות שוטפות) for the period. */
export interface OperatingExpensesMetric {
  /** ILS. Sum of current_expenses invoice subtotals. */
  amount: number;
  /** amount / incomeBeforeVat * 100. */
  pct: number;
  /** Target ILS = sum of supplier_budgets for current_expenses suppliers. */
  targetAmount: number;
  /** targetAmount / incomeBeforeVat * 100. */
  targetPct: number;
  /** pct - targetPct (positive = over budget). */
  diffPct: number;
}

/** A managed product (עלות פחית / שווארמה וכו') cost for the period. */
export interface ManagedProductMetric {
  id: string;
  name: string;
  unit: string;
  /** Sum of daily_product_usage.quantity over the range. */
  quantity: number;
  /** Current unit_cost from managed_products. */
  unitCost: number;
  /** unitCost * quantity (ILS). */
  amount: number;
  /** amount / incomeBeforeVat * 100. */
  pct: number;
  /** Target % from managed_products.target_pct (null when unset). */
  targetPct: number | null;
}

/**
 * Expense metrics for a single business over a date range. Replicates the
 * expense computation from the dashboard's `fetchDetailedSummary`.
 */
export interface ExpenseMetrics {
  /** totalIncome / (1 + VAT) — denominator for all expense percentages. */
  incomeBeforeVat: number;
  /** Labor cost (עלות עובדים). */
  laborCost: LaborCostMetric;
  /** Cost of goods sold (עלות מכר). */
  cogs: CogsMetric;
  /** Operating / current expenses (הוצאות שוטפות). */
  operating: OperatingExpensesMetric;
  /** Per managed-product costs. */
  managedProducts: ManagedProductMetric[];
}

// ---------------------------------------------------------------------------
// PAYMENTS metrics — replicates the ניהול תשלומים (payments) page.
// ---------------------------------------------------------------------------

/** Payments that went out for the period, broken down by payment method. */
export interface PaymentMethodMetric {
  /** Raw payment_splits.payment_method key (e.g. 'check', 'credit_card'). */
  method: string;
  /** Hebrew display name (paymentMethodNames lookup; 'אחר' fallback). */
  methodName: string;
  /** Sum of payment_splits.amount (incl VAT) for this method. */
  amount: number;
  /** amount / totalRevenueWithVat * 100 ('% מפדיון'). 0 when no revenue. */
  pctOfRevenue: number;
}

/** "תשלומים שיצאו" — total payments out (incl VAT) + per-method breakdown. */
export interface PaymentsSummary {
  /** Sum of all payment_splits.amount in range (incl VAT). */
  totalPaid: number;
  /** Sum of daily_entries.total_register in range (incl VAT) — divisor for pctOfRevenue. */
  totalRevenue: number;
  /** Per payment-method breakdown, sorted by amount descending. */
  byMethod: PaymentMethodMetric[];
}

/** A single due date within a month, with its summed amount. */
export interface UpcomingDate {
  /** due_date as stored (YYYY-MM-DD, possibly with a time component). */
  date: string;
  /** Sum of payment_splits.amount due on this date. */
  amount: number;
}

/** A month group of upcoming payments. */
export interface UpcomingMonth {
  /** "YYYY-MM" key. */
  month: string;
  /** Hebrew label, e.g. "מאי, 2026". */
  label: string;
  /** Sum of all splits due in this month. */
  total: number;
  /** Per-due-date breakdown, sorted ascending by date. */
  byDate: UpcomingDate[];
}

/** "צפי תשלומים קדימה" — open future payments grouped by month → date. */
export interface UpcomingPayments {
  /** "סה\"כ תשלומים פתוחים" — sum of all future splits (due_date >= today). */
  totalOpen: number;
  /** Per-month groups, sorted ascending by month. */
  byMonth: UpcomingMonth[];
}

/** A month group of past (already debited) payments. */
export interface PaymentHistoryMonth {
  /** "YYYY-MM" key. */
  month: string;
  /** Hebrew label, e.g. "אפריל, 2026". */
  label: string;
  /** Sum of all splits with due_date <= today in this month. */
  totalPaid: number;
}

/** "תשלומי עבר" — past payments history grouped by month (desc). */
export interface PaymentHistory {
  /** "סה\"כ תשלומים שבוצעו" — sum across all past months. */
  totalPaid: number;
  /** Per-month totals, sorted descending (newest first). */
  byMonth: PaymentHistoryMonth[];
}

/** One row in the "תשלומים אחרונים ששולמו" recent payments list. */
export interface RecentPayment {
  /** payments.id. */
  id: string;
  /** payment_date formatted DD.MM.YY (matches the list's date column). */
  date: string;
  /** Raw payment_date (YYYY-MM-DD) for sorting/consumers. */
  rawDate: string;
  /** Supplier name ('לא ידוע' fallback). */
  supplier: string;
  /** Reference: check_number for cheques, else reference_number, else null. */
  ref: string | null;
  /** Number of payment_splits on this payment. */
  splits: number;
  /** Hebrew display name of the (first) split's payment method ('אחר' fallback). */
  method: string;
  /** payments.total_amount (incl VAT). */
  amount: number;
}

// ---------------------------------------------------------------------------
// SUPPLIERS metrics — replicates the ניהול ספקים (suppliers) page.
// ---------------------------------------------------------------------------

/** Expense-type bucket matching the 3 supplier tabs on the page. */
export type SupplierExpenseType =
  | "goods_purchases" // קניות סחורה
  | "current_expenses" // הוצאות שוטפות
  | "employee_costs"; // עלות עובדים

/** One supplier row as shown on a tab card. */
export interface SupplierPayableRow {
  id: string;
  name: string;
  /** suppliers.expense_type. */
  expenseType: string;
  /** "נותר לתשלום" — remaining open balance (can be negative = overpaid). */
  remaining: number;
  /** "% מהכנסות" — yearly purchases (incl VAT) / yearly revenue target * 100. */
  pctOfRevenue: number;
}

/**
 * Total open-to-pay across suppliers, plus the per-supplier breakdown.
 * Mirrors the page header pill (`onboarding-suppliers-total`) and the cards.
 */
export interface SuppliersPayable {
  /** Sum of `remaining` over ALL suppliers (every expense type). */
  totalOpen: number;
  /** Open total split by the 3 supplier expense-type tabs. */
  byExpenseType: Record<SupplierExpenseType, number>;
  /** Per-supplier rows, sorted by remaining descending. */
  suppliers: SupplierPayableRow[];
}

/** Static/meta info about one supplier. */
export interface SupplierDetailMeta {
  id: string;
  name: string;
  expenseType: string;
  /** Expense category name (or null when none). */
  category: string | null;
  /** Parent category name (or null when none/orphan). */
  parentCategory: string | null;
  /** suppliers.requires_vat. */
  requiresVat: boolean | null;
  /** suppliers.monthly_expense_amount when is_fixed_expense, else null. */
  fixedMonthly: number | null;
  /** suppliers.charge_day (day-of-month the fixed expense bills), or null. */
  billingDay: number | null;
}

/** Account-level aggregate for a supplier (top pills on the detail card). */
export interface SupplierDetailAccount {
  /** סה"כ קניות — total purchases incl VAT (invoices + unlinked delivery notes). */
  purchases: number;
  /** סה"כ תשלום — total paid (sum of payments.total_amount). */
  paid: number;
  /** יתרה — open invoices/DNs minus advance overpayment (obligation-aware). */
  balance: number;
}

/** One month row in the supplier detail monthly breakdown. */
export interface SupplierMonthlyRow {
  /** Month key `YYYY-MM`. */
  month: string;
  /** Monthly purchases incl VAT (invoices + unlinked DNs that month). */
  purchases: number;
  /** Monthly paid = sum of this month's paid-status invoices. */
  paid: number;
  /** purchases - paid for the month. */
  balance: number;
}

/** One invoice / delivery-note line item in the supplier detail. */
export interface SupplierInvoiceRow {
  /** invoice_date / delivery_date (ISO string). */
  date: string | null;
  /** invoice_number / delivery_note_number. */
  ref: string | null;
  /** subtotal (before VAT). */
  subtotal: number;
  /** total_amount (incl VAT). */
  total: number;
  /** invoices.status, or 'delivery_note' for unlinked DNs. */
  status: string;
}

/** Full supplier detail (clicking a card). */
export interface SupplierDetail {
  meta: SupplierDetailMeta;
  account: SupplierDetailAccount;
  monthly: SupplierMonthlyRow[];
  invoices: SupplierInvoiceRow[];
}

// ---------------------------------------------------------------------------
// CASHFLOW metrics — replicates the תזרים מזומנים (cashflow) forecast page.
// ---------------------------------------------------------------------------

/** A single day in the cashflow forecast table. */
export interface CashflowDay {
  /** YYYY-MM-DD. */
  date: string;
  /** Money in for the day (settled income + retainers + customer payments), net of fees. */
  in: number;
  /** Money out for the day (sum of payment_splits due that day). */
  out: number;
  /** Running cumulative bank balance after this day's net flow. */
  balance: number;
}

/**
 * Cashflow forecast for a single business. Replicates the projection from the
 * dashboard's cashflow page (`src/app/(dashboard)/cashflow/page.tsx`):
 *   - starting bank balance from cashflow_settings (opening_balance/opening_date)
 *   - projected daily income from settled card/cash entries (settlement rules),
 *     a total_register fallback, active retainers, and paid customer payments
 *   - projected daily expenses from payment_splits grouped by due_date
 *   - a running cumulative balance
 */
export interface CashflowForecast {
  /** Opening bank balance (cashflow_settings.opening_balance, 0 when unset). */
  startingBalance: number;
  /** Start of the forecast range (YYYY-MM-DD) = opening_date (or 1st of current month). */
  startDate: string;
  /** End of the forecast range (YYYY-MM-DD) = today + 3 months. */
  endDate: string;
  /** Sum of all daily `in` amounts over the range. */
  totalIncome: number;
  /** Sum of all daily `out` amounts over the range. */
  totalExpenses: number;
  /** totalIncome - totalExpenses ("הפרש נקי"). */
  netDiff: number;
  /** First date (YYYY-MM-DD) where the running balance < 0, or null if never. */
  firstNegativeDay: string | null;
  /** Per-day rows, ascending by date. */
  daily: CashflowDay[];
}

// ---------------------------------------------------------------------------
// PROFIT & LOSS (רווח והפסד) metrics — replicates the reports page
// (src/app/(dashboard)/reports/page.tsx).
// ---------------------------------------------------------------------------

/** One expense-category parent row from the "פירוט ההוצאות" table. */
export interface ProfitLossExpenseRow {
  /** expense_categories.id (or a virtual id like "__virtual_labor_parent__"). */
  id: string;
  /** Category name (עלות מכר / עלות עובדים / הוצאות שיווק ומכירות / ...). */
  name: string;
  /** "יעד" — target (ILS, ex-VAT). */
  target: number;
  /** "בפועל" — actual spend (ILS, ex-VAT). */
  actual: number;
  /** "הפרש ב-₪" — target - actual (positive = under budget). */
  diffIls: number;
  /**
   * "נותר לניצול" — remaining-to-use, as a percentage:
   * ((target - actual) / target) * 100. 0 when no target.
   */
  remaining: number;
}

/** Revenue block of the P&L ("סה\"כ הכנסות ללא מע\"מ" card). */
export interface ProfitLossRevenue {
  /** "יעד" — revenue target ex-VAT (goals.revenue_target / vatDivisor). */
  target: number;
  /** "בפועל" — actual revenue ex-VAT (sum total_register / vatDivisor). */
  actual: number;
  /** "הפרש ב-₪" — actual - target. */
  diffIls: number;
  /** "הפרש ב-%" — (actual / target) * 100 (the report's % of target). 0 when no target. */
  diffPct: number;
}

/**
 * Profit & loss report for a single business over a date range. Replicates the
 * reports page (`fetchData`). `view` is 'monthly' (the report's default) or
 * 'annual' (full-year actuals against configured targets).
 */
export interface ProfitLossReport {
  /** Which view was computed. */
  view: "monthly" | "annual";
  /** "סה\"כ תוצאות רווח/הפסד" — operating profit (revenue - all expenses), ILS. */
  totalResult: number;
  /** Operating profit as a % of revenue (0 when no revenue). */
  totalResultPct: number;
  /** Revenue block ("סה\"כ הכנסות ללא מע\"מ"). */
  revenue: ProfitLossRevenue;
  /** Per expense-category parent rows ("פירוט ההוצאות"), in report display order. */
  expenses: ProfitLossExpenseRow[];
}

// ---------------------------------------------------------------------------
// GOALS metrics — replicates the יעדים (goals vs actual) page
// (src/app/(dashboard)/goals/page.tsx) and its three tabs.
// ---------------------------------------------------------------------------

/** Which goals view (matches the page's three tabs). */
export type GoalsView =
  | "kpi" // יעדי KPI (% + ₪ KPI rows)
  | "operating" // יעד VS שוטפות (per-category current expenses)
  | "goods"; // יעד VS קניות סחורה (per-supplier goods purchases)

/**
 * Discrete "מצב" status for a goals row, derived from getStatusColor in
 * goals/page.tsx. 'on_target' = actual equals target (white). For cost rows
 * 'under' = under/at budget (green) and 'over' = over budget (red). For income
 * rows 'under' = met/over goal (green) and 'over' = below goal (red).
 */
export type GoalsStatus = "under" | "over" | "on_target";

/** One row in a goals-vs-actual table: קטגוריה / יעד / בפועל / מצב. */
export interface GoalsRow {
  /** Category, supplier, or KPI name (the "קטגוריה"/"שם היעד" column). */
  category: string;
  /** "יעד" target. ₪ for operating/goods + ₪ KPIs; % for percentage KPIs. */
  target: number;
  /** "בפועל" actual, same unit as target. */
  actual: number;
  /**
   * "מצב" remaining budget. For expense rows = target - actual (positive =
   * under budget / saving). For income KPI rows = actual - target (positive =
   * above goal).
   */
  remaining: number;
  /** Status colour bucket (green=under/met, red=over/below, white=on_target). */
  status: GoalsStatus;
  /** Unit of target/actual: '₪' or '%'. Only set for the kpi view. */
  unit?: "₪" | "%";
  /** Whether lower-is-better (cost). true for all operating/goods rows. */
  isExpense?: boolean;
}

/**
 * Goals-vs-actual metrics for a single business over a month, for one view.
 * Replicates the goals page's per-tab table computation so the numbers match.
 */
export interface GoalsVsActual {
  /** Which view these rows belong to. */
  view: GoalsView;
  /** The month/year the goals apply to. */
  period: { month: number; year: number };
  /** Per-category / per-supplier / per-KPI rows. */
  rows: GoalsRow[];
}

// ---------------------------------------------------------------------------
// ANNUAL metric — year-at-a-glance month-by-month view ("נתוני עבר" modals).
//
// IMPORTANT: this view is ACTUAL-based, NOT pace/forecast-based. Each month's
// `amount` is the ACTUAL value for that month, and the comparisons
// (momPct / targetDiffPct) are computed from actuals — they do NOT use the
// pace-based monthlyPace / targetDiffPct / momChangePct fields of
// getIncomeMetrics.
// ---------------------------------------------------------------------------

/** One month row in an annual metric (Jan..Dec). */
export interface AnnualMonthRow {
  /** Month number, 1-12. */
  month: number;
  /** Actual value for the month (ILS, or the metric's natural unit). */
  amount: number;
  /**
   * Percentage of income (ex-VAT) for cost metrics (labor/cogs/operating/
   * product). null for income metrics (sales / source). Actual-based.
   */
  pct: number | null;
  /** Target for the month (ILS) when applicable, else null. */
  target: number | null;
  /**
   * "הפרש מהיעד %". For sales/source: target ? (amount/target - 1)*100 : null.
   * For labor/cogs/operating/product: the actual-based diffPct from the expense
   * function. null when no target/data.
   */
  targetDiffPct: number | null;
  /**
   * "שינוי מחודש קודם %": previous month non-zero ?
   * (amount/prevAmount - 1)*100 : null.
   */
  momPct: number | null;
  /** Only for "source:<name>" — sum of orders_count for the month. */
  ordersCount?: number;
  /** Only for "source:<name>" — average ticket for the month. */
  avgTicket?: number;
}

/**
 * An annual (year-at-a-glance) metric for a single business: 12 month rows of
 * ACTUAL values plus the year total. Powers the "נתוני עבר" historical-data
 * modals. `metric` is one of: "sales", "labor", "cogs", "operating",
 * "source:<name>", or "product:<name>".
 */
export interface AnnualMetric {
  /** The calendar year. */
  year: number;
  /** The requested metric key. */
  metric: string;
  /** Sum of all 12 months' actual amounts. */
  total: number;
  /** Per-month rows, ordered Jan (1) .. Dec (12). */
  months: AnnualMonthRow[];
}
