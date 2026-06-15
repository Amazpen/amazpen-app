// Date helpers for the metrics module.
// Ported from src/app/(dashboard)/page.tsx (formatLocalDate, lines ~347-352).

/**
 * Format a local date to a `YYYY-MM-DD` string (avoids timezone shifts that
 * `toISOString()` would introduce). Matches the dashboard's `formatLocalDate`.
 */
export function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
