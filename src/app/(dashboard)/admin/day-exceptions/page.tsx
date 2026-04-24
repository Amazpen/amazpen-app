"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";
import { usePersistedState } from "@/hooks/usePersistedState";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { useMultiTableRealtime } from "@/hooks/useRealtimeSubscription";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { DatePickerField } from "@/components/ui/date-picker-field";
import { Loader2, Trash2, Pencil, Check, X } from "lucide-react";

// ===== Types =====

interface Business {
  id: string;
  name: string;
}

interface DayException {
  id: string;
  business_id: string;
  exception_date: string;
  day_factor: number;
  note: string | null;
  created_at: string;
}

// ===== Helpers =====

function formatDate(dateStr: string): string {
  if (!dateStr) return "-";
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}/${y}`;
}

function formatFactor(factor: number): string {
  if (factor === 0) return "סגור (0)";
  if (factor === 1) return "יום מלא (1)";
  return `${factor} (${Math.round(factor * 100)}%)`;
}

// ===== Component =====

export default function DayExceptionsPage() {
  const supabase = createClient();
  const { showToast } = useToast();
  const { confirm, ConfirmDialog } = useConfirmDialog();

  // Auth & admin
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  // Business selection
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [selectedBusinessId, setSelectedBusinessId] =
    usePersistedState<string>("admin-day-exceptions:businessId", "");

  // Exceptions
  const [exceptions, setExceptions] = useState<DayException[]>([]);
  const [isLoadingExceptions, setIsLoadingExceptions] = useState(false);

  // Month/Year summary
  const now = new Date();
  const [summaryMonth, setSummaryMonth] = useState(String(now.getMonth() + 1));
  const [summaryYear, setSummaryYear] = useState(String(now.getFullYear()));
  const [scheduleWorkDays, setScheduleWorkDays] = useState(0);
  const [effectiveWorkDays, setEffectiveWorkDays] = useState(0);
  const [calendarDays, setCalendarDays] = useState(0);
  const [isLoadingSummary, setIsLoadingSummary] = useState(false);

  // Form
  const [newDate, setNewDate] = useState("");
  const [newFactor, setNewFactor] = useState("0");
  const [newNote, setNewNote] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Inline edit state — one row at a time
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editFactor, setEditFactor] = useState("0");
  const [editNote, setEditNote] = useState("");
  const [isEditSaving, setIsEditSaving] = useState(false);

  // ===== Auth check =====
  useEffect(() => {
    async function checkAdmin() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setIsLoading(false);
        return;
      }
      setUserId(user.id);

      const { data: profile } = await supabase
        .from("profiles")
        .select("is_admin")
        .eq("id", user.id)
        .maybeSingle();

      setIsAdmin(profile?.is_admin === true);
      setIsLoading(false);
    }
    checkAdmin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===== Fetch businesses =====
  useEffect(() => {
    if (!isAdmin) return;
    async function fetchBusinesses() {
      const { data } = await supabase
        .from("businesses")
        .select("id, name")
        .order("name");
      if (data) setBusinesses(data);
    }
    fetchBusinesses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  // ===== Fetch exceptions =====
  const fetchExceptions = useCallback(async () => {
    if (!selectedBusinessId) {
      setExceptions([]);
      return;
    }
    setIsLoadingExceptions(true);
    const { data, error } = await supabase
      .from("business_day_exceptions")
      .select("id, business_id, exception_date, day_factor, note, created_at")
      .eq("business_id", selectedBusinessId)
      .order("exception_date", { ascending: true });

    if (error) {
      showToast("שגיאה בטעינת חריגות", "error");
    }
    setExceptions(data || []);
    setIsLoadingExceptions(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBusinessId]);

  useEffect(() => {
    if (isAdmin) fetchExceptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBusinessId, isAdmin]);

  // Realtime — day-exception rows and the underlying schedule can be edited
  // elsewhere; refresh here so the list stays in sync.
  useMultiTableRealtime(
    ["business_day_exceptions", "business_schedule"],
    fetchExceptions,
    !!(isAdmin && selectedBusinessId),
  );

  // ===== Month summary: schedule work days vs effective (with exceptions) =====
  useEffect(() => {
    if (!selectedBusinessId || !summaryMonth || !summaryYear) return;
    const year = parseInt(summaryYear);
    const month = parseInt(summaryMonth);
    if (isNaN(year) || isNaN(month)) return;

    async function calcSummary() {
      setIsLoadingSummary(true);
      // 1. Get business schedule
      const { data: schedule } = await supabase
        .from("business_schedule")
        .select("day_of_week, day_factor")
        .eq("business_id", selectedBusinessId);

      // 2. Get exceptions for this month
      const firstDay = `${year}-${String(month).padStart(2, "0")}-01`;
      const lastDay = new Date(year, month, 0);
      const lastDayStr = `${year}-${String(month).padStart(2, "0")}-${String(lastDay.getDate()).padStart(2, "0")}`;

      const { data: monthExceptions } = await supabase
        .from("business_day_exceptions")
        .select("exception_date, day_factor")
        .eq("business_id", selectedBusinessId)
        .gte("exception_date", firstDay)
        .lte("exception_date", lastDayStr);

      // Build schedule map: day_of_week → day_factor
      const scheduleMap: Record<number, number> = {};
      (schedule || []).forEach(s => {
        scheduleMap[s.day_of_week] = Number(s.day_factor) || 0;
      });

      // Build exceptions map: date string → day_factor
      const exceptionsMap = new Map<string, number>();
      (monthExceptions || []).forEach(ex => {
        const d = String(ex.exception_date).substring(0, 10);
        exceptionsMap.set(d, Number(ex.day_factor));
      });

      // Calculate days
      const totalDays = lastDay.getDate();
      let scheduleDays = 0;
      let effectiveDays = 0;

      for (let d = 1; d <= totalDays; d++) {
        const date = new Date(year, month - 1, d);
        const dow = date.getDay();
        const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        const scheduleFactor = scheduleMap[dow] ?? 0;

        scheduleDays += scheduleFactor;

        // If there's an exception for this date, use it; otherwise use schedule
        if (exceptionsMap.has(dateStr)) {
          effectiveDays += exceptionsMap.get(dateStr)!;
        } else {
          effectiveDays += scheduleFactor;
        }
      }

      setCalendarDays(totalDays);
      setScheduleWorkDays(scheduleDays);
      setEffectiveWorkDays(effectiveDays);
      setIsLoadingSummary(false);
    }

    calcSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBusinessId, summaryMonth, summaryYear, exceptions]);

  // ===== Create =====
  const handleCreate = useCallback(async () => {
    if (!selectedBusinessId || !newDate) {
      showToast("יש לבחור עסק ותאריך", "error");
      return;
    }
    const factorNum = parseFloat(newFactor);
    if (isNaN(factorNum) || factorNum < 0 || factorNum > 1) {
      showToast("מקדם יום חייב להיות בין 0 ל-1", "error");
      return;
    }
    setIsSaving(true);
    const { error } = await supabase
      .from("business_day_exceptions")
      .insert({
        business_id: selectedBusinessId,
        exception_date: newDate,
        day_factor: factorNum,
        note: newNote.trim() || null,
        created_by: userId,
      });

    if (error) {
      if (error.code === "23505") {
        showToast("כבר קיימת חריגה לתאריך זה", "error");
      } else {
        showToast("שגיאה ביצירת חריגה", "error");
      }
    } else {
      // Exception overrides the day — sync matching daily_entries.day_factor so
      // manager-cost / labor-cost calculations downstream honour the new factor.
      // (entry keeps total_register/labor_cost/etc; only day_factor is re-set.)
      const updatePayload: Record<string, unknown> = { day_factor: factorNum };
      if (factorNum === 0) updatePayload.manager_daily_cost = 0;
      await supabase
        .from("daily_entries")
        .update(updatePayload)
        .eq("business_id", selectedBusinessId)
        .eq("entry_date", newDate)
        .is("deleted_at", null);

      showToast("החריגה נוצרה בהצלחה", "success");
      setNewDate("");
      setNewNote("");
      setNewFactor("0");
      await fetchExceptions();
    }
    setIsSaving(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBusinessId, newDate, newFactor, newNote, userId, fetchExceptions]);

  // ===== Edit (inline) =====
  const startEdit = useCallback((ex: DayException) => {
    setEditingId(ex.id);
    setEditDate(String(ex.exception_date).substring(0, 10));
    setEditFactor(String(ex.day_factor));
    setEditNote(ex.note || "");
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditDate("");
    setEditFactor("0");
    setEditNote("");
  }, []);

  const handleUpdate = useCallback(async (ex: DayException) => {
    if (!editDate) {
      showToast("יש לבחור תאריך", "error");
      return;
    }
    const factorNum = parseFloat(editFactor);
    if (isNaN(factorNum) || factorNum < 0 || factorNum > 1) {
      showToast("מקדם יום חייב להיות בין 0 ל-1", "error");
      return;
    }

    setIsEditSaving(true);
    const { error } = await supabase
      .from("business_day_exceptions")
      .update({
        exception_date: editDate,
        day_factor: factorNum,
        note: editNote.trim() || null,
      })
      .eq("id", ex.id);

    if (error) {
      if (error.code === "23505") {
        showToast("כבר קיימת חריגה לתאריך זה", "error");
      } else {
        showToast("שגיאה בעדכון החריגה", "error");
      }
      setIsEditSaving(false);
      return;
    }

    // Side effects on daily_entries.
    // 1) If date changed: restore the OLD date's entry to its weekly schedule
    //    factor so it isn't left carrying the now-moved exception.
    const oldDate = String(ex.exception_date).substring(0, 10);
    if (oldDate !== editDate && selectedBusinessId) {
      const dow = new Date(oldDate + "T00:00:00").getDay();
      const { data: sched } = await supabase
        .from("business_schedule")
        .select("day_factor")
        .eq("business_id", selectedBusinessId)
        .eq("day_of_week", dow)
        .maybeSingle();
      const restoredFactor = sched?.day_factor != null ? Number(sched.day_factor) : 1;
      await supabase
        .from("daily_entries")
        .update({ day_factor: restoredFactor })
        .eq("business_id", selectedBusinessId)
        .eq("entry_date", oldDate)
        .is("deleted_at", null);
    }

    // 2) Apply the new exception's factor to the NEW (or same) date so
    //    downstream cost calcs pick it up — same logic as handleCreate.
    if (selectedBusinessId) {
      const updatePayload: Record<string, unknown> = { day_factor: factorNum };
      if (factorNum === 0) updatePayload.manager_daily_cost = 0;
      await supabase
        .from("daily_entries")
        .update(updatePayload)
        .eq("business_id", selectedBusinessId)
        .eq("entry_date", editDate)
        .is("deleted_at", null);
    }

    showToast("החריגה עודכנה בהצלחה", "success");
    cancelEdit();
    await fetchExceptions();
    setIsEditSaving(false);
  }, [editDate, editFactor, editNote, selectedBusinessId, supabase, showToast, fetchExceptions, cancelEdit]);

  // ===== Delete =====
  const handleDelete = useCallback(
    (id: string, date: string) => {
      confirm(`האם למחוק את החריגה לתאריך ${formatDate(date)}?`, async () => {
        const { error } = await supabase
          .from("business_day_exceptions")
          .delete()
          .eq("id", id);

        if (error) {
          showToast("שגיאה במחיקת החריגה", "error");
        } else {
          // Exception removed — restore the daily_entry's day_factor from the
          // weekly business_schedule for that weekday (falls back to 1).
          if (selectedBusinessId) {
            const dow = new Date(date + "T00:00:00").getDay();
            const { data: sched } = await supabase
              .from("business_schedule")
              .select("day_factor")
              .eq("business_id", selectedBusinessId)
              .eq("day_of_week", dow)
              .maybeSingle();
            const restoredFactor = sched?.day_factor != null ? Number(sched.day_factor) : 1;
            await supabase
              .from("daily_entries")
              .update({ day_factor: restoredFactor })
              .eq("business_id", selectedBusinessId)
              .eq("entry_date", date)
              .is("deleted_at", null);
          }

          showToast("החריגה נמחקה", "success");
          await fetchExceptions();
        }
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [confirm, fetchExceptions]
  );

  // ===== Render =====

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="animate-spin w-8 h-8 text-white/40" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div
        dir="rtl"
        className="flex flex-col items-center justify-center min-h-[calc(100vh-52px)] text-white px-[20px]"
      >
        <h2 className="text-[20px] font-bold mb-[10px]">אין לך הרשאת ניהול</h2>
        <p className="text-[14px] text-white/60 text-center">
          רק מנהלי מערכת יכולים לגשת לדף זה
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 max-w-3xl mx-auto" dir="rtl">
      {/* Page header */}
      <h1 className="text-white text-xl lg:text-2xl font-bold mb-6">
        חריגה ביום עסקים
      </h1>

      {/* Business selector */}
      <div className="mb-6">
        <label className="block text-sm text-white/70 mb-2">בחר עסק</label>
        <Select
          value={selectedBusinessId}
          onValueChange={(val) => setSelectedBusinessId(val)}
        >
          <SelectTrigger className="w-full bg-[#0F1535] border border-[#4C526B] rounded-[10px] h-[50px] px-[12px] text-[14px] text-white text-right">
            <SelectValue placeholder="בחר עסק..." />
          </SelectTrigger>
          <SelectContent>
            {businesses.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* No business selected */}
      {!selectedBusinessId ? (
        <div className="text-center py-16 text-white/40 text-lg">
          יש לבחור עסק
        </div>
      ) : (
        <>
          {/* Create form */}
          <div className="bg-[#111056]/60 border border-white/10 rounded-[10px] p-5 mb-6">
            <h2 className="text-white font-semibold text-base mb-4">
              יצירת חריגה חדשה
            </h2>
            <div className="flex flex-col gap-4">
              {/* Date */}
              <div>
                <label className="text-white/70 text-sm mb-1.5 block">
                  בחירת תאריך חריגה
                </label>
                <DatePickerField
                  value={newDate}
                  onChange={(val) => setNewDate(val)}
                />
              </div>

              {/* Day factor */}
              <div>
                <label className="text-white/70 text-sm mb-1.5 block">
                  יום מלא/חלקי (0 = סגור, 1 = יום מלא)
                </label>
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  value={newFactor}
                  onChange={(e) => setNewFactor(e.target.value)}
                  className="h-[50px] w-full bg-[#0F1535] border border-[#4C526B] text-white rounded-[10px] px-3 outline-none text-center"
                  inputMode="decimal"
                />
              </div>

              {/* Note */}
              <div>
                <label className="text-white/70 text-sm mb-1.5 block">
                  הסבר (אופציונלי)
                </label>
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="למשל: ראש השנה, יום שישי קצר..."
                  rows={2}
                  className="w-full bg-[#0F1535] border border-[#4C526B] text-white rounded-[10px] px-3 py-2.5 outline-none resize-none placeholder:text-white/30 text-right"
                />
              </div>

              {/* Submit */}
              <Button
                onClick={handleCreate}
                disabled={isSaving || !newDate}
                className="h-[50px] bg-[#4A56D4] hover:bg-[#5A66E4] text-white rounded-[10px] font-medium w-full"
              >
                {isSaving ? (
                  <Loader2 className="animate-spin w-4 h-4" />
                ) : (
                  "יצירת חריגה"
                )}
              </Button>
            </div>
          </div>

          {/* Month Summary */}
          <div className="bg-[#111056]/60 border border-white/10 rounded-[10px] p-5 mb-6">
            <h2 className="text-white font-semibold text-base mb-4">סיכום ימי עבודה חודשי</h2>
            <div className="flex gap-3 mb-4">
              <div className="flex-1">
                <label className="text-white/70 text-sm mb-1.5 block">חודש</label>
                <Select value={summaryMonth} onValueChange={setSummaryMonth}>
                  <SelectTrigger className="w-full bg-[#0F1535] border border-[#4C526B] rounded-[10px] h-[42px] px-[12px] text-[14px] text-white text-right">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"].map((name, i) => (
                      <SelectItem key={i + 1} value={String(i + 1)}>{name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1">
                <label className="text-white/70 text-sm mb-1.5 block">שנה</label>
                <Select value={summaryYear} onValueChange={setSummaryYear}>
                  <SelectTrigger className="w-full bg-[#0F1535] border border-[#4C526B] rounded-[10px] h-[42px] px-[12px] text-[14px] text-white text-right">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[2024, 2025, 2026, 2027].map(y => (
                      <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {isLoadingSummary ? (
              <div className="flex justify-center py-4">
                <Loader2 className="animate-spin w-5 h-5 text-white/40" />
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-[#0F1535] rounded-[10px] p-3 text-center">
                  <span className="text-white/50 text-xs block mb-1">ימים בחודש</span>
                  <span className="text-white text-lg font-bold">{calendarDays}</span>
                </div>
                <div className="bg-[#0F1535] rounded-[10px] p-3 text-center">
                  <span className="text-white/50 text-xs block mb-1">לפי לוח עסקי</span>
                  <span className="text-white text-lg font-bold">{scheduleWorkDays % 1 === 0 ? scheduleWorkDays : scheduleWorkDays.toFixed(1)}</span>
                </div>
                <div className={`rounded-[10px] p-3 text-center ${effectiveWorkDays !== scheduleWorkDays ? 'bg-[#29318A]' : 'bg-[#0F1535]'}`}>
                  <span className="text-white/50 text-xs block mb-1">בפועל (עם חריגות)</span>
                  <span className={`text-lg font-bold ${effectiveWorkDays !== scheduleWorkDays ? 'text-[#FFA412]' : 'text-white'}`}>
                    {effectiveWorkDays % 1 === 0 ? effectiveWorkDays : effectiveWorkDays.toFixed(1)}
                  </span>
                  {effectiveWorkDays !== scheduleWorkDays && (
                    <span className="text-[#FFA412] text-xs block mt-0.5">
                      ({effectiveWorkDays > scheduleWorkDays ? '+' : ''}{(effectiveWorkDays - scheduleWorkDays) % 1 === 0 ? effectiveWorkDays - scheduleWorkDays : (effectiveWorkDays - scheduleWorkDays).toFixed(1)} ימים)
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Exceptions list */}
          <div className="bg-[#111056]/60 border border-white/10 rounded-[10px] p-5">
            <h2 className="text-white font-semibold text-base mb-4">
              חריגות קיימות
            </h2>
            {isLoadingExceptions ? (
              <div className="flex justify-center py-8">
                <Loader2 className="animate-spin w-6 h-6 text-white/40" />
              </div>
            ) : exceptions.length === 0 ? (
              <p className="text-white/40 text-center py-8">
                אין חריגות רשומות לעסק זה
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {exceptions.map((ex) => {
                  const isEditing = editingId === ex.id;
                  if (isEditing) {
                    return (
                      <div
                        key={ex.id}
                        className="flex flex-col gap-3 bg-[#0F1535]/60 border border-[#4A56D4]/40 rounded-[10px] p-4"
                      >
                        <div>
                          <label className="text-white/70 text-xs mb-1.5 block">תאריך</label>
                          <DatePickerField value={editDate} onChange={setEditDate} />
                        </div>
                        <div>
                          <label className="text-white/70 text-xs mb-1.5 block">
                            מקדם יום (0 = סגור, 1 = יום מלא)
                          </label>
                          <input
                            type="number"
                            min="0"
                            max="1"
                            step="0.05"
                            value={editFactor}
                            onChange={(e) => setEditFactor(e.target.value)}
                            className="h-[42px] w-full bg-[#0F1535] border border-[#4C526B] text-white rounded-[10px] px-3 outline-none text-center"
                            inputMode="decimal"
                          />
                        </div>
                        <div>
                          <label className="text-white/70 text-xs mb-1.5 block">הסבר</label>
                          <textarea
                            value={editNote}
                            onChange={(e) => setEditNote(e.target.value)}
                            rows={2}
                            className="w-full bg-[#0F1535] border border-[#4C526B] text-white rounded-[10px] px-3 py-2 outline-none resize-none placeholder:text-white/30 text-right text-sm"
                          />
                        </div>
                        <div className="flex gap-2">
                          <Button
                            onClick={() => handleUpdate(ex)}
                            disabled={isEditSaving || !editDate}
                            className="flex-1 h-[42px] bg-[#4A56D4] hover:bg-[#5A66E4] text-white rounded-[10px] font-medium gap-2"
                          >
                            {isEditSaving ? (
                              <Loader2 className="animate-spin w-4 h-4" />
                            ) : (
                              <>
                                <Check className="w-4 h-4" />
                                שמור
                              </>
                            )}
                          </Button>
                          <Button
                            onClick={cancelEdit}
                            disabled={isEditSaving}
                            className="flex-1 h-[42px] bg-white/10 hover:bg-white/20 text-white rounded-[10px] font-medium gap-2"
                          >
                            <X className="w-4 h-4" />
                            ביטול
                          </Button>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div
                      key={ex.id}
                      className="flex items-center justify-between gap-3 bg-[#0F1535]/60 border border-white/10 rounded-[10px] px-4 py-3"
                    >
                      <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                        <span className="text-white font-medium text-sm">
                          {formatDate(ex.exception_date)}
                        </span>
                        <span className="text-white/50 text-xs">
                          {formatFactor(ex.day_factor)}
                        </span>
                        {ex.note && (
                          <span className="text-white/40 text-xs truncate">
                            {ex.note}
                          </span>
                        )}
                      </div>
                      <div className="flex gap-1 flex-shrink-0">
                        <button
                          onClick={() => startEdit(ex)}
                          className="text-white/60 hover:text-white transition-colors p-1.5 rounded-md hover:bg-white/10"
                          title="ערוך חריגה"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(ex.id, ex.exception_date)}
                          className="text-red-400/70 hover:text-red-400 transition-colors p-1.5 rounded-md hover:bg-red-400/10"
                          title="מחק חריגה"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      <ConfirmDialog />
    </div>
  );
}
