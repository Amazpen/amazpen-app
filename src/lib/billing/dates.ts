/** Days in a given month (month is 1-12). */
function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate(); // month index 'month' = next month, day 0 = last day of 'month'
}

/**
 * Advance an ISO date (YYYY-MM-DD) by one calendar month, anchoring to
 * `dayOfMonth` and clamping to the target month's last day when needed.
 * Works purely on integers — no timezone drift.
 */
export function addOneMonthClamped(isoDate: string, dayOfMonth: number): string {
  const [y, m] = isoDate.split("-").map(Number); // m is 1-12
  let year = y;
  let month = m + 1;
  if (month > 12) {
    month = 1;
    year += 1;
  }
  const lastDay = daysInMonth(year, month);
  const day = Math.min(dayOfMonth, lastDay);
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/** True if `nextChargeDate` (YYYY-MM-DD) is on or before `today` (YYYY-MM-DD). */
export function isDueOn(nextChargeDate: string, today: string): boolean {
  return nextChargeDate <= today; // ISO date strings compare lexicographically
}
