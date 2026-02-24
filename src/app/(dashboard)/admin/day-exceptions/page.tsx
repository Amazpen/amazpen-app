"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";
import { usePersistedState } from "@/hooks/usePersistedState";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Loader2, Trash2 } from "lucide-react";

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

  // Form
  const [newDate, setNewDate] = useState("");
  const [newFactor, setNewFactor] = useState("0");
  const [newNote, setNewNote] = useState("");
  const [isSaving, setIsSaving] = useState(false);

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
      showToast("החריגה נוצרה בהצלחה", "success");
      setNewDate("");
      setNewNote("");
      setNewFactor("0");
      await fetchExceptions();
    }
    setIsSaving(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBusinessId, newDate, newFactor, newNote, userId, fetchExceptions]);

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
                <input
                  type="date"
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                  className="h-[50px] w-full bg-[#0F1535] border border-[#4C526B] text-white rounded-[10px] px-3 outline-none text-center"
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
                {exceptions.map((ex) => (
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
                    <button
                      onClick={() =>
                        handleDelete(ex.id, ex.exception_date)
                      }
                      className="text-red-400/70 hover:text-red-400 transition-colors p-1.5 rounded-md hover:bg-red-400/10 flex-shrink-0"
                      title="מחק חריגה"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <ConfirmDialog />
    </div>
  );
}
