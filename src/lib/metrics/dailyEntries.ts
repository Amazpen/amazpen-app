import type { SupabaseClient } from "@supabase/supabase-js";
import { formatLocalDate } from "./dates";

export interface DailyEntryRow {
  id: string;
  entryDate: string; // YYYY-MM-DD
  totalRegister: number;
  laborCost: number;
  laborHours: number;
  discounts: number;
  notes: string | null;
}

/**
 * Fetch a single business's daily entry for a specific date (YYYY-MM-DD).
 * Returns null when no entry exists for that date. Used by the agent so it can
 * read the current values + row id before proposing an EDIT (update).
 */
export async function getDailyEntry(
  supabase: SupabaseClient,
  businessId: string,
  date: string,
): Promise<DailyEntryRow | null> {
  const { data } = await supabase
    .from("daily_entries")
    .select("id, entry_date, total_register, labor_cost, labor_hours, discounts, notes")
    .eq("business_id", businessId)
    .eq("entry_date", date)
    .is("deleted_at", null)
    .maybeSingle();

  if (!data) return null;

  return {
    id: data.id as string,
    entryDate: date,
    totalRegister: Number(data.total_register) || 0,
    laborCost: Number(data.labor_cost) || 0,
    laborHours: Number(data.labor_hours) || 0,
    discounts: Number(data.discounts) || 0,
    notes: (data.notes as string) ?? null,
  };
}

export interface DailyEntriesList {
  range: { start: string; end: string };
  count: number;
  totalRegister: number;
  avgRegister: number;
  entries: DailyEntryRow[];
}

/**
 * List a business's daily entries within a date range, ordered by date ascending.
 * Lets the agent report the data day-by-day (and find strongest/weakest/average).
 */
export async function getDailyEntries(
  supabase: SupabaseClient,
  businessId: string,
  dateRange: { start: Date; end: Date },
): Promise<DailyEntriesList> {
  const startStr = formatLocalDate(dateRange.start);
  const endStr = formatLocalDate(dateRange.end);

  const { data } = await supabase
    .from("daily_entries")
    .select("id, entry_date, total_register, labor_cost, labor_hours, discounts, notes")
    .eq("business_id", businessId)
    .gte("entry_date", startStr)
    .lte("entry_date", endStr)
    .is("deleted_at", null)
    .order("entry_date", { ascending: true });

  const entries: DailyEntryRow[] = (data || []).map((row) => ({
    id: row.id as string,
    entryDate: String(row.entry_date).slice(0, 10),
    totalRegister: Number(row.total_register) || 0,
    laborCost: Number(row.labor_cost) || 0,
    laborHours: Number(row.labor_hours) || 0,
    discounts: Number(row.discounts) || 0,
    notes: (row.notes as string) ?? null,
  }));

  const totalRegister = entries.reduce((s, e) => s + e.totalRegister, 0);

  return {
    range: { start: startStr, end: endStr },
    count: entries.length,
    totalRegister,
    avgRegister: entries.length ? totalRegister / entries.length : 0,
    entries,
  };
}
