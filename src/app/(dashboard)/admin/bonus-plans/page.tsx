"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";
import { usePersistedState } from "@/hooks/usePersistedState";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { resolveBonusPlanStatus } from "@/lib/bonusPlanResolver";
import { DATA_SOURCE_OPTIONS } from "@/types/bonus";
import type { BonusPlan, BonusPlanStatus } from "@/types/bonus";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Loader2, Trash2, Pencil, Plus, X, Trophy } from "lucide-react";

// ===== Types =====

interface Business {
  id: string;
  name: string;
}

interface Employee {
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  role: string;
}

// ===== Helpers =====

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatValue(value: number | null, type: "percentage" | "currency"): string {
  if (value === null) return "—";
  if (type === "percentage") return `${value.toFixed(1)}%`;
  return formatCurrency(value);
}

function tierBadgeColor(tier: 1 | 2 | 3 | null): string {
  if (tier === 3) return "bg-green-500/20 text-green-400 border-green-500/30";
  if (tier === 2) return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
  if (tier === 1) return "bg-blue-500/20 text-blue-400 border-blue-500/30";
  return "bg-white/5 text-white/40 border-white/10";
}

// ===== Component =====

export default function BonusPlansPage() {
  const supabase = createClient();
  const { showToast } = useToast();
  const { confirm, ConfirmDialog } = useConfirmDialog();

  // Auth & access
  const [hasAccess, setHasAccess] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  // Business selection
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [selectedBusinessId, setSelectedBusinessId] =
    usePersistedState<string>("admin-bonus-plans:businessId", "");

  // Employees for selected business
  const [employees, setEmployees] = useState<Employee[]>([]);

  // Plans
  const [plans, setPlans] = useState<BonusPlan[]>([]);
  const [planStatuses, setPlanStatuses] = useState<Record<string, BonusPlanStatus>>({});
  const [isLoadingPlans, setIsLoadingPlans] = useState(false);

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Form fields
  const [formEmployeeId, setFormEmployeeId] = useState("");
  const [formAreaName, setFormAreaName] = useState("");
  const [formDataSource, setFormDataSource] = useState("");
  const [formMeasurementType, setFormMeasurementType] = useState<"percentage" | "currency">("percentage");
  const [formIsLowerBetter, setFormIsLowerBetter] = useState(true);
  const [formCustomLabel, setFormCustomLabel] = useState("");
  const [formTier1Label, setFormTier1Label] = useState("עמידה ביעד");
  const [formTier1Threshold, setFormTier1Threshold] = useState("");
  const [formTier1Amount, setFormTier1Amount] = useState("");
  const [formTier2Label, setFormTier2Label] = useState("שיפור קטן");
  const [formTier2Threshold, setFormTier2Threshold] = useState("");
  const [formTier2Amount, setFormTier2Amount] = useState("");
  const [formTier3Label, setFormTier3Label] = useState("שיפור משמעותי");
  const [formTier3Threshold, setFormTier3Threshold] = useState("");
  const [formTier3Amount, setFormTier3Amount] = useState("");
  const [formPushEnabled, setFormPushEnabled] = useState(true);
  const [formPushHour, setFormPushHour] = useState("8");
  const [formNotes, setFormNotes] = useState("");

  // ===== Auth check — admin OR business owner/manager =====
  useEffect(() => {
    async function checkAccess() {
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

      const admin = profile?.is_admin === true;
      setIsAdmin(admin);

      if (admin) {
        setHasAccess(true);
        setIsLoading(false);
        return;
      }

      // Check if user is owner/manager of any business
      const { data: memberships } = await supabase
        .from("business_members")
        .select("business_id, role")
        .eq("user_id", user.id)
        .in("role", ["owner", "manager"])
        .is("deleted_at", null);

      setHasAccess((memberships && memberships.length > 0) || false);
      setIsLoading(false);
    }
    checkAccess();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===== Fetch businesses =====
  useEffect(() => {
    if (!hasAccess) return;
    async function fetchBusinesses() {
      if (isAdmin) {
        // Admin sees all businesses
        const { data } = await supabase
          .from("businesses")
          .select("id, name")
          .order("name");
        if (data) setBusinesses(data);
      } else {
        // Owner/manager sees only their businesses
        const { data: memberships } = await supabase
          .from("business_members")
          .select("business_id, businesses(id, name)")
          .eq("user_id", userId!)
          .in("role", ["owner", "manager"])
          .is("deleted_at", null);
        if (memberships) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const bizList = memberships.map((m: any) => m.businesses).filter(Boolean);
          setBusinesses(bizList);
        }
      }
    }
    fetchBusinesses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAccess, isAdmin, userId]);

  // ===== Fetch employees for selected business =====
  useEffect(() => {
    if (!hasAccess || !selectedBusinessId) {
      setEmployees([]);
      return;
    }
    async function fetchEmployees() {
      const { data } = await supabase
        .from("business_members")
        .select("user_id, role, profiles(id, full_name, avatar_url)")
        .eq("business_id", selectedBusinessId)
        .is("deleted_at", null)
        .order("role", { ascending: true });

      if (data) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mapped: Employee[] = data.map((m: any) => ({
          user_id: m.user_id,
          full_name: m.profiles?.full_name || "ללא שם",
          avatar_url: m.profiles?.avatar_url || null,
          role: m.role,
        }));
        setEmployees(mapped);
      }
    }
    fetchEmployees();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAccess, selectedBusinessId]);

  // ===== Fetch plans =====
  const fetchPlans = useCallback(async () => {
    if (!selectedBusinessId) {
      setPlans([]);
      setPlanStatuses({});
      return;
    }
    setIsLoadingPlans(true);
    const { data, error } = await supabase
      .from("bonus_plans")
      .select("*")
      .eq("business_id", selectedBusinessId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (error) {
      showToast("שגיאה בטעינת תכניות בונוסים", "error");
      setIsLoadingPlans(false);
      return;
    }

    const plansList = (data || []) as BonusPlan[];
    setPlans(plansList);

    // Resolve statuses for all plans
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const statuses: Record<string, BonusPlanStatus> = {};

    for (const plan of plansList) {
      statuses[plan.id] = await resolveBonusPlanStatus(supabase, plan, year, month);
    }
    setPlanStatuses(statuses);
    setIsLoadingPlans(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBusinessId]);

  useEffect(() => {
    if (hasAccess) fetchPlans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBusinessId, hasAccess]);

  // ===== Reset form =====
  const resetForm = useCallback(() => {
    setShowForm(false);
    setEditingPlanId(null);
    setFormEmployeeId("");
    setFormAreaName("");
    setFormDataSource("");
    setFormMeasurementType("percentage");
    setFormIsLowerBetter(true);
    setFormCustomLabel("");
    setFormTier1Label("עמידה ביעד");
    setFormTier1Threshold("");
    setFormTier1Amount("");
    setFormTier2Label("שיפור קטן");
    setFormTier2Threshold("");
    setFormTier2Amount("");
    setFormTier3Label("שיפור משמעותי");
    setFormTier3Threshold("");
    setFormTier3Amount("");
    setFormPushEnabled(true);
    setFormPushHour("8");
    setFormNotes("");
  }, []);

  // ===== Open edit form =====
  const openEdit = useCallback((plan: BonusPlan) => {
    setEditingPlanId(plan.id);
    setFormEmployeeId(plan.employee_user_id);
    setFormAreaName(plan.area_name);
    setFormDataSource(plan.data_source);
    setFormMeasurementType(plan.measurement_type);
    setFormIsLowerBetter(plan.is_lower_better);
    setFormCustomLabel(plan.custom_source_label || "");
    setFormTier1Label(plan.tier1_label);
    setFormTier1Threshold(plan.tier1_threshold?.toString() || "");
    setFormTier1Amount(plan.tier1_amount.toString());
    setFormTier2Label(plan.tier2_label);
    setFormTier2Threshold(plan.tier2_threshold?.toString() || "");
    setFormTier2Amount(plan.tier2_amount.toString());
    setFormTier3Label(plan.tier3_label);
    setFormTier3Threshold(plan.tier3_threshold?.toString() || "");
    setFormTier3Amount(plan.tier3_amount.toString());
    setFormPushEnabled(plan.push_enabled);
    setFormPushHour(plan.push_hour.toString());
    setFormNotes(plan.notes || "");
    setShowForm(true);
  }, []);

  // ===== Handle data source change =====
  const handleDataSourceChange = useCallback((value: string) => {
    setFormDataSource(value);
    const option = DATA_SOURCE_OPTIONS.find((o) => o.value === value);
    if (option && value !== "custom") {
      setFormMeasurementType(option.measurementType);
      setFormIsLowerBetter(option.isLowerBetter);
    }
  }, []);

  // ===== Save plan =====
  const handleSave = useCallback(async () => {
    if (!selectedBusinessId || !formEmployeeId || !formAreaName || !formDataSource) {
      showToast("יש למלא את כל השדות הנדרשים", "error");
      return;
    }

    const tier1Amt = parseFloat(formTier1Amount);
    const tier2Amt = parseFloat(formTier2Amount);
    const tier3Amt = parseFloat(formTier3Amount);

    if (isNaN(tier1Amt) || isNaN(tier2Amt) || isNaN(tier3Amt)) {
      showToast("סכומי הבונוס חייבים להיות מספרים", "error");
      return;
    }

    setIsSaving(true);

    const payload = {
      business_id: selectedBusinessId,
      employee_user_id: formEmployeeId,
      area_name: formAreaName,
      measurement_type: formMeasurementType,
      data_source: formDataSource,
      is_lower_better: formIsLowerBetter,
      custom_source_label: formDataSource === "custom" ? formCustomLabel || null : null,
      tier1_label: formTier1Label,
      tier1_threshold: formTier1Threshold ? parseFloat(formTier1Threshold) : null,
      tier1_amount: tier1Amt,
      tier2_label: formTier2Label,
      tier2_threshold: formTier2Threshold ? parseFloat(formTier2Threshold) : null,
      tier2_amount: tier2Amt,
      tier3_label: formTier3Label,
      tier3_threshold: formTier3Threshold ? parseFloat(formTier3Threshold) : null,
      tier3_amount: tier3Amt,
      push_enabled: formPushEnabled,
      push_hour: parseInt(formPushHour),
      notes: formNotes.trim() || null,
      updated_at: new Date().toISOString(),
    };

    let error;
    if (editingPlanId) {
      ({ error } = await supabase
        .from("bonus_plans")
        .update(payload)
        .eq("id", editingPlanId));
    } else {
      ({ error } = await supabase.from("bonus_plans").insert(payload));
    }

    if (error) {
      showToast("שגיאה בשמירת התכנית", "error");
    } else {
      showToast(editingPlanId ? "התכנית עודכנה" : "התכנית נוצרה בהצלחה", "success");
      resetForm();
      await fetchPlans();
    }
    setIsSaving(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedBusinessId, formEmployeeId, formAreaName, formDataSource,
    formMeasurementType, formIsLowerBetter, formCustomLabel,
    formTier1Label, formTier1Threshold, formTier1Amount,
    formTier2Label, formTier2Threshold, formTier2Amount,
    formTier3Label, formTier3Threshold, formTier3Amount,
    formPushEnabled, formPushHour, formNotes,
    editingPlanId, resetForm, fetchPlans,
  ]);

  // ===== Delete plan =====
  const handleDelete = useCallback(
    (plan: BonusPlan, employeeName: string) => {
      confirm(
        `האם למחוק את תכנית הבונוס "${plan.area_name}" של ${employeeName}?`,
        async () => {
          const { error } = await supabase
            .from("bonus_plans")
            .update({ deleted_at: new Date().toISOString() })
            .eq("id", plan.id);

          if (error) {
            showToast("שגיאה במחיקת התכנית", "error");
          } else {
            showToast("התכנית נמחקה", "success");
            await fetchPlans();
          }
        }
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [confirm, fetchPlans]
  );

  // ===== Toggle active =====
  const toggleActive = useCallback(
    async (plan: BonusPlan) => {
      const { error } = await supabase
        .from("bonus_plans")
        .update({ is_active: !plan.is_active, updated_at: new Date().toISOString() })
        .eq("id", plan.id);

      if (error) {
        showToast("שגיאה בעדכון סטטוס", "error");
      } else {
        await fetchPlans();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fetchPlans]
  );

  // ===== Helpers =====
  const getEmployeeName = useCallback(
    (userId: string) => employees.find((e) => e.user_id === userId)?.full_name || "—",
    [employees]
  );

  const getDataSourceLabel = useCallback((source: string) => {
    return DATA_SOURCE_OPTIONS.find((o) => o.value === source)?.label || source;
  }, []);

  // ===== Render =====

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="animate-spin w-8 h-8 text-white/40" />
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div
        dir="rtl"
        className="flex flex-col items-center justify-center min-h-[calc(100vh-52px)] text-white px-[20px]"
      >
        <h2 className="text-[20px] font-bold mb-[10px]">אין לך הרשאה</h2>
        <p className="text-[14px] text-white/60 text-center">
          רק מנהלים ובעלי עסקים יכולים לגשת לדף זה
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 max-w-4xl mx-auto" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-white text-xl lg:text-2xl font-bold">
          תכניות בונוסים ותגמול
        </h1>
        {selectedBusinessId && !showForm && (
          <Button
            onClick={() => {
              resetForm();
              setShowForm(true);
            }}
            className="h-[40px] bg-[#4A56D4] hover:bg-[#5A66E4] text-white rounded-[10px] font-medium gap-1.5"
          >
            <Plus className="w-4 h-4" />
            תכנית חדשה
          </Button>
        )}
      </div>

      {/* Business selector */}
      <div className="mb-6">
        <label className="block text-sm text-white/70 mb-2">בחר עסק</label>
        <Select
          value={selectedBusinessId}
          onValueChange={(val) => {
            setSelectedBusinessId(val);
            resetForm();
          }}
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
          {/* Create/Edit form */}
          {showForm && (
            <div className="bg-[#111056]/60 border border-white/10 rounded-[10px] p-5 mb-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-white font-semibold text-base">
                  {editingPlanId ? "עריכת תכנית" : "תכנית בונוס חדשה"}
                </h2>
                <button onClick={resetForm} className="text-white/40 hover:text-white/70 transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex flex-col gap-4">
                {/* Employee */}
                <div>
                  <label className="text-white/70 text-sm mb-1.5 block">עובד</label>
                  <Select value={formEmployeeId} onValueChange={setFormEmployeeId}>
                    <SelectTrigger className="w-full bg-[#0F1535] border border-[#4C526B] rounded-[10px] h-[50px] px-[12px] text-[14px] text-white text-right">
                      <SelectValue placeholder="בחר עובד..." />
                    </SelectTrigger>
                    <SelectContent>
                      {employees.map((e) => (
                        <SelectItem key={e.user_id} value={e.user_id}>
                          {e.full_name} ({e.role})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Area name */}
                <div>
                  <label className="text-white/70 text-sm mb-1.5 block">שם תחום אחריות</label>
                  <input
                    type="text"
                    value={formAreaName}
                    onChange={(e) => setFormAreaName(e.target.value)}
                    placeholder="למשל: ניהול עלות עובדים"
                    className="h-[50px] w-full bg-[#0F1535] border border-[#4C526B] text-white rounded-[10px] px-3 outline-none text-right placeholder:text-white/30"
                  />
                </div>

                {/* Data source */}
                <div>
                  <label className="text-white/70 text-sm mb-1.5 block">מקור נתונים</label>
                  <Select value={formDataSource} onValueChange={handleDataSourceChange}>
                    <SelectTrigger className="w-full bg-[#0F1535] border border-[#4C526B] rounded-[10px] h-[50px] px-[12px] text-[14px] text-white text-right">
                      <SelectValue placeholder="בחר מקור נתונים..." />
                    </SelectTrigger>
                    <SelectContent>
                      {DATA_SOURCE_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Custom source label */}
                {formDataSource === "custom" && (
                  <>
                    <div>
                      <label className="text-white/70 text-sm mb-1.5 block">הסבר מה נמדד</label>
                      <input
                        type="text"
                        value={formCustomLabel}
                        onChange={(e) => setFormCustomLabel(e.target.value)}
                        placeholder="למשל: מספר אפסיילים יומי"
                        className="h-[50px] w-full bg-[#0F1535] border border-[#4C526B] text-white rounded-[10px] px-3 outline-none text-right placeholder:text-white/30"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-white/70 text-sm mb-1.5 block">סוג מדידה</label>
                        <Select value={formMeasurementType} onValueChange={(v) => setFormMeasurementType(v as "percentage" | "currency")}>
                          <SelectTrigger className="w-full bg-[#0F1535] border border-[#4C526B] rounded-[10px] h-[50px] px-[12px] text-[14px] text-white text-right">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="percentage">אחוז (%)</SelectItem>
                            <SelectItem value="currency">סכום (₪)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <label className="text-white/70 text-sm mb-1.5 block">כיוון</label>
                        <Select
                          value={formIsLowerBetter ? "lower" : "higher"}
                          onValueChange={(v) => setFormIsLowerBetter(v === "lower")}
                        >
                          <SelectTrigger className="w-full bg-[#0F1535] border border-[#4C526B] rounded-[10px] h-[50px] px-[12px] text-[14px] text-white text-right">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="lower">נמוך = טוב (עלות)</SelectItem>
                            <SelectItem value="higher">גבוה = טוב (הכנסה)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </>
                )}

                {/* Tiers */}
                <div>
                  <label className="text-white/70 text-sm mb-2 block">רמות בונוס</label>
                  <div className="flex flex-col gap-3">
                    {/* Tier 1 */}
                    <div className="grid grid-cols-3 gap-2">
                      <input
                        type="text"
                        value={formTier1Label}
                        onChange={(e) => setFormTier1Label(e.target.value)}
                        placeholder="שם רמה"
                        className="h-[45px] bg-[#0F1535] border border-[#4C526B] text-white rounded-[10px] px-3 outline-none text-right text-sm placeholder:text-white/30"
                      />
                      <input
                        type="number"
                        value={formTier1Threshold}
                        onChange={(e) => setFormTier1Threshold(e.target.value)}
                        placeholder={formMeasurementType === "percentage" ? "סף %" : "סף ₪"}
                        step="0.1"
                        className="h-[45px] bg-[#0F1535] border border-[#4C526B] text-white rounded-[10px] px-3 outline-none text-center text-sm placeholder:text-white/30"
                        inputMode="decimal"
                      />
                      <input
                        type="number"
                        value={formTier1Amount}
                        onChange={(e) => setFormTier1Amount(e.target.value)}
                        placeholder="בונוס ₪"
                        className="h-[45px] bg-[#0F1535] border border-[#4C526B] text-white rounded-[10px] px-3 outline-none text-center text-sm placeholder:text-white/30"
                        inputMode="numeric"
                      />
                    </div>
                    {/* Tier 2 */}
                    <div className="grid grid-cols-3 gap-2">
                      <input
                        type="text"
                        value={formTier2Label}
                        onChange={(e) => setFormTier2Label(e.target.value)}
                        placeholder="שם רמה"
                        className="h-[45px] bg-[#0F1535] border border-[#4C526B] text-white rounded-[10px] px-3 outline-none text-right text-sm placeholder:text-white/30"
                      />
                      <input
                        type="number"
                        value={formTier2Threshold}
                        onChange={(e) => setFormTier2Threshold(e.target.value)}
                        placeholder={formMeasurementType === "percentage" ? "סף %" : "סף ₪"}
                        step="0.1"
                        className="h-[45px] bg-[#0F1535] border border-[#4C526B] text-white rounded-[10px] px-3 outline-none text-center text-sm placeholder:text-white/30"
                        inputMode="decimal"
                      />
                      <input
                        type="number"
                        value={formTier2Amount}
                        onChange={(e) => setFormTier2Amount(e.target.value)}
                        placeholder="בונוס ₪"
                        className="h-[45px] bg-[#0F1535] border border-[#4C526B] text-white rounded-[10px] px-3 outline-none text-center text-sm placeholder:text-white/30"
                        inputMode="numeric"
                      />
                    </div>
                    {/* Tier 3 */}
                    <div className="grid grid-cols-3 gap-2">
                      <input
                        type="text"
                        value={formTier3Label}
                        onChange={(e) => setFormTier3Label(e.target.value)}
                        placeholder="שם רמה"
                        className="h-[45px] bg-[#0F1535] border border-[#4C526B] text-white rounded-[10px] px-3 outline-none text-right text-sm placeholder:text-white/30"
                      />
                      <input
                        type="number"
                        value={formTier3Threshold}
                        onChange={(e) => setFormTier3Threshold(e.target.value)}
                        placeholder={formMeasurementType === "percentage" ? "סף %" : "סף ₪"}
                        step="0.1"
                        className="h-[45px] bg-[#0F1535] border border-[#4C526B] text-white rounded-[10px] px-3 outline-none text-center text-sm placeholder:text-white/30"
                        inputMode="decimal"
                      />
                      <input
                        type="number"
                        value={formTier3Amount}
                        onChange={(e) => setFormTier3Amount(e.target.value)}
                        placeholder="בונוס ₪"
                        className="h-[45px] bg-[#0F1535] border border-[#4C526B] text-white rounded-[10px] px-3 outline-none text-center text-sm placeholder:text-white/30"
                        inputMode="numeric"
                      />
                    </div>
                  </div>
                </div>

                {/* Push settings */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-white/70 text-sm mb-1.5 block">פוש יומי</label>
                    <Select
                      value={formPushEnabled ? "on" : "off"}
                      onValueChange={(v) => setFormPushEnabled(v === "on")}
                    >
                      <SelectTrigger className="w-full bg-[#0F1535] border border-[#4C526B] rounded-[10px] h-[50px] px-[12px] text-[14px] text-white text-right">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="on">מופעל</SelectItem>
                        <SelectItem value="off">כבוי</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-white/70 text-sm mb-1.5 block">שעת שליחה</label>
                    <Select value={formPushHour} onValueChange={setFormPushHour}>
                      <SelectTrigger className="w-full bg-[#0F1535] border border-[#4C526B] rounded-[10px] h-[50px] px-[12px] text-[14px] text-white text-right">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 24 }, (_, i) => (
                          <SelectItem key={i} value={i.toString()}>
                            {i.toString().padStart(2, "0")}:00
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Notes */}
                <div>
                  <label className="text-white/70 text-sm mb-1.5 block">הערות (אופציונלי)</label>
                  <textarea
                    value={formNotes}
                    onChange={(e) => setFormNotes(e.target.value)}
                    placeholder="הערות נוספות..."
                    rows={2}
                    className="w-full bg-[#0F1535] border border-[#4C526B] text-white rounded-[10px] px-3 py-2.5 outline-none resize-none placeholder:text-white/30 text-right"
                  />
                </div>

                {/* Submit */}
                <Button
                  onClick={handleSave}
                  disabled={isSaving || !formEmployeeId || !formAreaName || !formDataSource}
                  className="h-[50px] bg-[#4A56D4] hover:bg-[#5A66E4] text-white rounded-[10px] font-medium w-full"
                >
                  {isSaving ? (
                    <Loader2 className="animate-spin w-4 h-4" />
                  ) : editingPlanId ? (
                    "עדכון תכנית"
                  ) : (
                    "יצירת תכנית"
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* Plans list */}
          <div>
            {isLoadingPlans ? (
              <div className="flex justify-center py-8">
                <Loader2 className="animate-spin w-6 h-6 text-white/40" />
              </div>
            ) : plans.length === 0 ? (
              <div className="text-center py-16 text-white/40">
                אין תכניות בונוסים לעסק זה
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {plans.map((plan) => {
                  const status = planStatuses[plan.id];
                  const empName = getEmployeeName(plan.employee_user_id);

                  return (
                    <div
                      key={plan.id}
                      className={`bg-[#111056]/60 border rounded-[10px] p-4 ${
                        plan.is_active ? "border-white/10" : "border-white/5 opacity-50"
                      }`}
                    >
                      {/* Header row */}
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span className="text-white font-semibold text-sm">{empName}</span>
                          <span className="text-white/40 text-xs">·</span>
                          <span className="text-white/60 text-sm">{plan.area_name}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => toggleActive(plan)}
                            className={`text-xs px-2 py-1 rounded-md border transition-colors ${
                              plan.is_active
                                ? "bg-green-500/10 text-green-400 border-green-500/20"
                                : "bg-white/5 text-white/40 border-white/10"
                            }`}
                          >
                            {plan.is_active ? "פעיל" : "מושבת"}
                          </button>
                          <button
                            onClick={() => openEdit(plan)}
                            className="text-white/40 hover:text-white/70 transition-colors p-1.5 rounded-md hover:bg-white/5"
                            title="עריכה"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(plan, empName)}
                            className="text-red-400/70 hover:text-red-400 transition-colors p-1.5 rounded-md hover:bg-red-400/10"
                            title="מחיקה"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Data source */}
                      <div className="text-white/40 text-xs mb-3">
                        מקור: {getDataSourceLabel(plan.data_source)}
                        {plan.data_source === "custom" && plan.custom_source_label && (
                          <span> — {plan.custom_source_label}</span>
                        )}
                        {" · "}
                        {plan.measurement_type === "percentage" ? "%" : "₪"}
                        {" · "}
                        {plan.is_lower_better ? "נמוך = טוב" : "גבוה = טוב"}
                      </div>

                      {/* Tiers */}
                      <div className="grid grid-cols-3 gap-2 mb-3">
                        {[
                          { label: plan.tier1_label, threshold: plan.tier1_threshold, amount: plan.tier1_amount, tier: 1 as const },
                          { label: plan.tier2_label, threshold: plan.tier2_threshold, amount: plan.tier2_amount, tier: 2 as const },
                          { label: plan.tier3_label, threshold: plan.tier3_threshold, amount: plan.tier3_amount, tier: 3 as const },
                        ].map((t) => (
                          <div
                            key={t.tier}
                            className={`border rounded-lg p-2 text-center ${
                              status?.qualifiedTier === t.tier
                                ? tierBadgeColor(t.tier)
                                : "border-white/10 text-white/50"
                            }`}
                          >
                            <div className="text-[11px] mb-0.5">{t.label}</div>
                            {t.threshold != null && (
                              <div className="text-[10px] opacity-70">
                                {plan.is_lower_better ? "≤" : "≥"}{" "}
                                {formatValue(t.threshold, plan.measurement_type)}
                              </div>
                            )}
                            <div className="font-semibold text-sm mt-0.5">{formatCurrency(t.amount)}</div>
                          </div>
                        ))}
                      </div>

                      {/* Current month status */}
                      {status && plan.is_active && (
                        <div className={`flex items-center gap-2 rounded-lg px-3 py-2 ${tierBadgeColor(status.qualifiedTier)} border`}>
                          <Trophy className="w-4 h-4 flex-shrink-0" />
                          <div className="text-sm">
                            {status.currentValue !== null ? (
                              <>
                                <span className="font-medium">
                                  מצב נוכחי: {formatValue(status.currentValue, plan.measurement_type)}
                                </span>
                                {status.goalValue !== null && (
                                  <span className="opacity-70">
                                    {" "}(יעד: {formatValue(status.goalValue, plan.measurement_type)})
                                  </span>
                                )}
                                {status.qualifiedTier ? (
                                  <span className="font-semibold"> → {formatCurrency(status.bonusAmount)}</span>
                                ) : (
                                  <span className="opacity-70"> — לא עומד בסף</span>
                                )}
                              </>
                            ) : (
                              <span className="opacity-70">אין נתונים לחודש הנוכחי</span>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Push info */}
                      {plan.push_enabled && (
                        <div className="text-white/30 text-[11px] mt-2">
                          פוש יומי בשעה {plan.push_hour.toString().padStart(2, "0")}:00
                        </div>
                      )}
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
