"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useDashboard } from "../../layout";
import { useToast } from "@/components/ui/toast";
import { usePersistedState } from "@/hooks/usePersistedState";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableHeader, TableBody, TableFooter, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

// Types
interface Business {
  id: string;
  name: string;
}

interface Goal {
  id: string;
  business_id: string;
  year: number;
  month: number;
  revenue_target: number | null;
  labor_cost_target_pct: number | null;
  food_cost_target_pct: number | null;
  current_expenses_target: number | null;
  goods_expenses_target: number | null;
  markup_percentage: number | null;
  vat_percentage: number | null;
}

interface IncomeSource {
  id: string;
  name: string;
}

interface IncomeSourceGoal {
  id?: string;
  goal_id: string;
  income_source_id: string;
  avg_ticket_target: number;
  income_source_name?: string;
}

interface Supplier {
  id: string;
  name: string;
  expense_type: string;
  is_fixed_expense: boolean;
  monthly_expense_amount: number | null;
  has_previous_obligations: boolean;
  vat_type: string;
  charge_day: number | null;
}

interface SupplierBudget {
  id?: string;
  supplier_id: string;
  business_id: string;
  year: number;
  month: number;
  budget_amount: number;
  supplier_name?: string;
  expense_type?: string;
}

interface ManagedProduct {
  id: string;
  name: string;
  unit: string;
  unit_cost: number;
  target_pct: number | null;
}

// Hebrew months
const hebrewMonths = [
  { value: 1, label: "ינואר" },
  { value: 2, label: "פברואר" },
  { value: 3, label: "מרץ" },
  { value: 4, label: "אפריל" },
  { value: 5, label: "מאי" },
  { value: 6, label: "יוני" },
  { value: 7, label: "יולי" },
  { value: 8, label: "אוגוסט" },
  { value: 9, label: "ספטמבר" },
  { value: 10, label: "אוקטובר" },
  { value: 11, label: "נובמבר" },
  { value: 12, label: "דצמבר" },
];

export default function AdminGoalsPage() {
  const router = useRouter();
  const { isAdmin } = useDashboard();
  const { showToast } = useToast();

  // State
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [selectedBusinessId, setSelectedBusinessId] = usePersistedState<string>("admin-goals:businessId", "");
  const [selectedYear, setSelectedYear] = usePersistedState<number>("admin-goals:year", 0);
  const [selectedMonth, setSelectedMonth] = usePersistedState<number>("admin-goals:month", 0);

  // Manual goals-email dispatch (David's request — admin button on /admin/goals)
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [sendOverrideTo, setSendOverrideTo] = useState("");
  const [sendInProgress, setSendInProgress] = useState(false);
  // Owners of the selected business — fetched when the dialog opens so the
  // admin can see exactly which addresses the email is going to and tick /
  // untick individuals.
  const [businessOwners, setBusinessOwners] = useState<{ id: string; email: string; fullName: string; role: string }[]>([]);
  const [ownersLoading, setOwnersLoading] = useState(false);
  const [selectedOwnerEmails, setSelectedOwnerEmails] = useState<Set<string>>(new Set());
  const [useCustomEmail, setUseCustomEmail] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  // Initialize date values on client only (only if no saved value)
  useEffect(() => {
    if (!isMounted) {
      if (!selectedYear) setSelectedYear(new Date().getFullYear());
      if (!selectedMonth) setSelectedMonth(new Date().getMonth() + 1);
      setIsMounted(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- selectedMonth/selectedYear are persisted initial values; setSelectedMonth/setSelectedYear are stable setters from usePersistedState. Adding them would cause unnecessary re-runs.
  }, [isMounted]);

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);

  // Conflict popup — when saving budgets that would overwrite existing invoices
  type InvoiceConflict = {
    supplierId: string;
    supplierName: string;
    month: number;
    monthLabel: string;
    existingTotal: number;
    newTotal: number;
    invoiceCount: number;
  };
  const [pendingConflicts, setPendingConflicts] = useState<InvoiceConflict[] | null>(null);
  // David: per-row "skip this update" — keys are `${supplierId}|${month}`.
  // When checked, that conflict's budget is reverted to existingTotal at
  // save-time so the existing invoice stays untouched.
  const [conflictSkips, setConflictSkips] = useState<Set<string>>(new Set());

  // Goal data
  const [goal, setGoal] = useState<Goal | null>(null);
  const [incomeSources, setIncomeSources] = useState<IncomeSource[]>([]);
  const [incomeSourceGoals, setIncomeSourceGoals] = useState<IncomeSourceGoal[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierBudgets, setSupplierBudgets] = useState<SupplierBudget[]>([]);
  const [managedProducts, setManagedProducts] = useState<ManagedProduct[]>([]);

  // Tabs
  const [activeTab, setActiveTab] = usePersistedState<"kpi" | "suppliers" | "goods">("admin-goals:tab", "kpi");
  const [supplierSearch, setSupplierSearch] = useState("");

  // Redirect if not admin
  useEffect(() => {
    if (!isAdmin) {
      router.push("/");
    }
  }, [isAdmin, router]);

  // Load businesses
  useEffect(() => {
    const loadBusinesses = async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("businesses")
        .select("id, name")
        .is("deleted_at", null)
        .eq("status", "active")
        .order("name");

      if (data && data.length > 0) {
        setBusinesses(data);
        // Only set default if no saved value or saved value not in list
        if (!selectedBusinessId || !data.find(b => b.id === selectedBusinessId)) {
          setSelectedBusinessId(data[0].id);
        }
      }
      setIsLoading(false);
    };

    loadBusinesses();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Runs once on mount. selectedBusinessId/setSelectedBusinessId are persisted initial values used for default selection only.
  }, []);

  // Load data when business/month/year changes
  const loadData = useCallback(async (silent = false) => {
    if (!selectedBusinessId || !selectedYear || !selectedMonth) return;

    if (!silent) setIsLoading(true);
    const supabase = createClient();

    try {
      // Load income sources for this business
      const { data: sourcesData } = await supabase
        .from("income_sources")
        .select("id, name")
        .eq("business_id", selectedBusinessId)
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("display_order");

      setIncomeSources(sourcesData || []);

      // Load suppliers (excluding previous obligations)
      const { data: suppliersData } = await supabase
        .from("suppliers")
        .select("id, name, expense_type, is_fixed_expense, monthly_expense_amount, has_previous_obligations, vat_type, charge_day")
        .eq("business_id", selectedBusinessId)
        .eq("has_previous_obligations", false)
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("name");

      setSuppliers(suppliersData || []);

      // Check if goal exists for this month
      const { data: goalData } = await supabase
        .from("goals")
        .select("*")
        .eq("business_id", selectedBusinessId)
        .eq("year", selectedYear)
        .eq("month", selectedMonth)
        .is("deleted_at", null)
        .maybeSingle();

      if (goalData) {
        setGoal(goalData);

        // Load income source goals
        const { data: incomeGoalsData } = await supabase
          .from("income_source_goals")
          .select("*, income_sources(name)")
          .eq("goal_id", goalData.id);

        const mappedIncomeGoals = (incomeGoalsData || []).map((ig: Record<string, unknown>) => ({
          id: ig.id as string,
          goal_id: ig.goal_id as string,
          income_source_id: ig.income_source_id as string,
          avg_ticket_target: Number(ig.avg_ticket_target) || 0,
          income_source_name: (ig.income_sources as Record<string, string>)?.name || "",
        }));
        setIncomeSourceGoals(mappedIncomeGoals);
      } else {
        setGoal(null);
        setIncomeSourceGoals([]);
      }

      // Load supplier budgets for all months of the year
      const { data: budgetsData } = await supabase
        .from("supplier_budgets")
        .select("*, suppliers(name, expense_type)")
        .eq("business_id", selectedBusinessId)
        .eq("year", selectedYear);

      const mappedBudgets = (budgetsData || []).map((b: Record<string, unknown>) => ({
        id: b.id as string,
        supplier_id: b.supplier_id as string,
        business_id: b.business_id as string,
        year: b.year as number,
        month: b.month as number,
        budget_amount: Number(b.budget_amount) || 0,
        supplier_name: (b.suppliers as Record<string, string>)?.name || "",
        expense_type: (b.suppliers as Record<string, string>)?.expense_type || "",
      }));
      setSupplierBudgets(mappedBudgets);

      // Load managed products for this business
      const { data: productsData } = await supabase
        .from("managed_products")
        .select("id, name, unit, unit_cost, target_pct, display_order")
        .eq("business_id", selectedBusinessId)
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("display_order")
        .order("name");

      setManagedProducts((productsData || []).map(p => ({
        id: p.id,
        name: p.name,
        unit: p.unit,
        unit_cost: Number(p.unit_cost) || 0,
        target_pct: p.target_pct !== null ? Number(p.target_pct) : null,
      })));

    } catch (error) {
      console.error("Error loading data:", error);
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [selectedBusinessId, selectedYear, selectedMonth]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Load owners when the send dialog opens — so the admin sees exactly
  // which recipients the email goes to and can untick a specific person.
  useEffect(() => {
    if (!sendDialogOpen || !selectedBusinessId) return;
    let cancelled = false;
    setOwnersLoading(true);
    setBusinessOwners([]);
    setSelectedOwnerEmails(new Set());
    setUseCustomEmail(false);
    setSendOverrideTo("");
    fetch(`/api/admin/business-owners?business_id=${encodeURIComponent(selectedBusinessId)}`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        const owners = Array.isArray(json.owners) ? json.owners : [];
        setBusinessOwners(owners);
        // Default: everyone selected.
        setSelectedOwnerEmails(new Set(owners.map((o: { email: string }) => o.email)));
      })
      .catch((err) => {
        console.error("[goals/owners] failed:", err);
        if (!cancelled) showToast("שגיאה בטעינת בעלי העסק", "error");
      })
      .finally(() => { if (!cancelled) setOwnersLoading(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendDialogOpen, selectedBusinessId]);

  // Initialize goals and budgets for a new month
  const initializeMonth = async () => {
    if (!selectedBusinessId) return;

    setIsInitializing(true);
    const supabase = createClient();

    try {
      // Check if business is active
      const { data: businessCheck } = await supabase
        .from("businesses")
        .select("status")
        .eq("id", selectedBusinessId)
        .single();

      if (businessCheck?.status !== "active") {
        showToast("לא ניתן לפתוח יעדים לעסק לא פעיל", "error");
        setIsInitializing(false);
        return;
      }

      // Calculate previous month
      let prevMonth = selectedMonth - 1;
      let prevYear = selectedYear;
      if (prevMonth === 0) {
        prevMonth = 12;
        prevYear = selectedYear - 1;
      }

      // Get previous month's goal as template + business defaults for markup/vat
      const [{ data: prevGoal }, { data: businessDefaults }] = await Promise.all([
        supabase
          .from("goals")
          .select("*")
          .eq("business_id", selectedBusinessId)
          .eq("year", prevYear)
          .eq("month", prevMonth)
          .is("deleted_at", null)
          .maybeSingle(),
        supabase
          .from("businesses")
          .select("markup_percentage, vat_percentage")
          .eq("id", selectedBusinessId)
          .single(),
      ]);

      // Create new goal
      const newGoalData = {
        business_id: selectedBusinessId,
        year: selectedYear,
        month: selectedMonth,
        revenue_target: prevGoal?.revenue_target || 0,
        labor_cost_target_pct: prevGoal?.labor_cost_target_pct || 0,
        food_cost_target_pct: prevGoal?.food_cost_target_pct || 0,
        current_expenses_target: prevGoal?.current_expenses_target || 0,
        goods_expenses_target: prevGoal?.goods_expenses_target || 0,
        markup_percentage: prevGoal?.markup_percentage ?? businessDefaults?.markup_percentage ?? 1,
        vat_percentage: prevGoal?.vat_percentage ?? businessDefaults?.vat_percentage ?? 0.18,
      };

      const { data: newGoal, error: goalError } = await supabase
        .from("goals")
        .insert(newGoalData)
        .select()
        .single();

      if (goalError) throw goalError;

      // Get previous month's income source goals
      if (prevGoal) {
        const { data: prevIncomeGoals } = await supabase
          .from("income_source_goals")
          .select("*")
          .eq("goal_id", prevGoal.id);

        if (prevIncomeGoals && prevIncomeGoals.length > 0) {
          const newIncomeGoals = prevIncomeGoals.map((ig) => ({
            goal_id: newGoal.id,
            income_source_id: ig.income_source_id,
            avg_ticket_target: ig.avg_ticket_target,
          }));

          await supabase.from("income_source_goals").insert(newIncomeGoals);
        }
      } else {
        // Create default income source goals
        const newIncomeGoals = incomeSources.map((source) => ({
          goal_id: newGoal.id,
          income_source_id: source.id,
          avg_ticket_target: 0,
        }));

        if (newIncomeGoals.length > 0) {
          await supabase.from("income_source_goals").insert(newIncomeGoals);
        }
      }

      // Get previous month's supplier budgets
      const { data: prevBudgets } = await supabase
        .from("supplier_budgets")
        .select("*")
        .eq("business_id", selectedBusinessId)
        .eq("year", prevYear)
        .eq("month", prevMonth);

      if (prevBudgets && prevBudgets.length > 0) {
        // Copy previous budgets
        const newBudgets = prevBudgets.map((b) => ({
          supplier_id: b.supplier_id,
          business_id: selectedBusinessId,
          year: selectedYear,
          month: selectedMonth,
          budget_amount: b.budget_amount,
        }));

        await supabase.from("supplier_budgets").insert(newBudgets);

        // Add budgets for new suppliers that didn't exist in the previous month
        const coveredSupplierIds = new Set(prevBudgets.map((b) => b.supplier_id));
        const missingSuppliers = suppliers.filter(
          (s) => !coveredSupplierIds.has(s.id)
        );

        if (missingSuppliers.length > 0) {
          const missingBudgets = missingSuppliers.map((s) => ({
            supplier_id: s.id,
            business_id: selectedBusinessId,
            year: selectedYear,
            month: selectedMonth,
            budget_amount: s.is_fixed_expense && s.monthly_expense_amount ? s.monthly_expense_amount : 0,
          }));
          await supabase.from("supplier_budgets").insert(missingBudgets);
        }
      } else {
        // Create budgets from supplier fixed expenses
        const newBudgets = suppliers
          .map((s) => ({
            supplier_id: s.id,
            business_id: selectedBusinessId,
            year: selectedYear,
            month: selectedMonth,
            budget_amount: s.is_fixed_expense && s.monthly_expense_amount ? s.monthly_expense_amount : 0,
          }));

        if (newBudgets.length > 0) {
          await supabase.from("supplier_budgets").insert(newBudgets);
        }
      }

      // Generate recurring expense invoices for fixed expense suppliers
      try {
        const res = await fetch("/api/recurring-expenses/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            business_id: selectedBusinessId,
            year: selectedYear,
            month: selectedMonth,
          }),
        });
        const result = await res.json();
        if (result.created > 0) {
          console.log(`Created ${result.created} recurring expense invoices`);
        }
      } catch (recurringError) {
        console.error("Error generating recurring expenses:", recurringError);
        // Don't block - budgets were created successfully
      }

      // Reload data
      await loadData();
      showToast("יעדים ותקציבים נוצרו בהצלחה!", "success");

    } catch (error) {
      console.error("Error initializing month:", error);
      showToast("שגיאה ביצירת יעדים ותקציבים", "error");
    } finally {
      setIsInitializing(false);
    }
  };

  // Update goal field
  const updateGoalField = (field: keyof Goal, value: number | null) => {
    if (!goal) return;
    setGoal({ ...goal, [field]: value });
  };

  // Update income source goal
  const updateIncomeSourceGoal = (incomeSourceId: string, value: number) => {
    setIncomeSourceGoals((prev) => {
      const existing = prev.find((ig) => ig.income_source_id === incomeSourceId);
      if (existing) {
        return prev.map((ig) =>
          ig.income_source_id === incomeSourceId ? { ...ig, avg_ticket_target: value } : ig
        );
      } else {
        return [
          ...prev,
          {
            goal_id: goal?.id || "",
            income_source_id: incomeSourceId,
            avg_ticket_target: value,
          },
        ];
      }
    });
  };

  // Update supplier name or is_fixed_expense — persist immediately to DB
  const updateSupplierField = async (
    supplierId: string,
    field: "name" | "is_fixed_expense",
    value: string | boolean,
  ) => {
    const supabase = createClient();
    const prevSnapshot = suppliers.find(s => s.id === supplierId);
    // Optimistic update
    setSuppliers(prev => prev.map(s => s.id === supplierId ? { ...s, [field]: value } : s));
    const { error } = await supabase
      .from("suppliers")
      .update({ [field]: value })
      .eq("id", supplierId);
    if (error) {
      // Revert on failure
      if (prevSnapshot) {
        setSuppliers(prev => prev.map(s => s.id === supplierId ? prevSnapshot : s));
      }
      showToast(`שגיאה בעדכון הספק: ${error.message}`, "error");
      return;
    }
    showToast(field === "name" ? "שם הספק עודכן" : "סוג ההוצאה עודכן", "success");
  };

  // Update supplier budget for a specific month
  const updateSupplierBudget = (supplierId: string, month: number, value: number) => {
    setSupplierBudgets((prev) => {
      const existing = prev.find((b) => b.supplier_id === supplierId && b.month === month);
      if (existing) {
        return prev.map((b) =>
          b.supplier_id === supplierId && b.month === month ? { ...b, budget_amount: value } : b
        );
      } else {
        const supplier = suppliers.find((s) => s.id === supplierId);
        return [
          ...prev,
          {
            supplier_id: supplierId,
            business_id: selectedBusinessId,
            year: selectedYear,
            month: month,
            budget_amount: value,
            supplier_name: supplier?.name,
            expense_type: supplier?.expense_type,
          },
        ];
      }
    });
  };

  // Update managed product target percentage
  const updateManagedProductTarget = (productId: string, value: number | null) => {
    setManagedProducts((prev) =>
      prev.map((p) =>
        p.id === productId ? { ...p, target_pct: value } : p
      )
    );
  };

  // Save all changes
  // Suppliers eligible for auto-invoice generation: ONLY fixed-expense suppliers.
  // Variable-expense suppliers get budgets stored, but no invoice is auto-created
  // — those invoices come from real-world receipts, not from a forecast.
  // Suppliers with prior obligations are excluded — those are tracked separately.
  const isInvoiceEligible = (s: Supplier): boolean =>
    s.is_fixed_expense && !s.has_previous_obligations;

  // Detect existing invoices that would be overwritten by saving the current
  // budgets. Returns the list of conflicts so the user can confirm.
  const detectInvoiceConflicts = async (): Promise<InvoiceConflict[]> => {
    const supabase = createClient();
    const conflicts: InvoiceConflict[] = [];

    const eligibleBudgets = supplierBudgets.filter(b => {
      const supplier = suppliers.find(s => s.id === b.supplier_id);
      return supplier && isInvoiceEligible(supplier) && b.budget_amount > 0 && b.month === selectedMonth;
    });

    if (eligibleBudgets.length === 0) return conflicts;

    for (const b of eligibleBudgets) {
      const supplier = suppliers.find(s => s.id === b.supplier_id);
      if (!supplier) continue;

      const monthStart = `${b.year || selectedYear}-${String(b.month).padStart(2, "0")}-01`;
      const lastDay = new Date(b.year || selectedYear, b.month, 0).getDate();
      const monthEnd = `${b.year || selectedYear}-${String(b.month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

      const { data: existingInvoices } = await supabase
        .from("invoices")
        .select("id, total_amount")
        .eq("business_id", selectedBusinessId)
        .eq("supplier_id", b.supplier_id)
        .is("deleted_at", null)
        .gte("reference_date", monthStart)
        .lte("reference_date", monthEnd);

      if (existingInvoices && existingInvoices.length > 0) {
        const subtotal = b.budget_amount;
        const vatAmount = supplier.vat_type === "full" ? subtotal * 0.18 : 0;
        const newTotal = subtotal + vatAmount;
        const existingTotal = existingInvoices.reduce((sum, inv) => sum + Number(inv.total_amount || 0), 0);

        // Only flag when the new total actually differs from the existing one
        if (Math.abs(existingTotal - newTotal) > 0.01) {
          conflicts.push({
            supplierId: b.supplier_id,
            supplierName: supplier.name,
            month: b.month,
            monthLabel: hebrewMonths.find(m => m.value === b.month)?.label || String(b.month),
            existingTotal,
            newTotal,
            invoiceCount: existingInvoices.length,
          });
        }
      }
    }

    return conflicts;
  };

  const saveAll = async () => {
    if (!goal) return;

    setIsSaving(true);
    try {
      const conflicts = await detectInvoiceConflicts();
      if (conflicts.length > 0) {
        setPendingConflicts(conflicts);
        setConflictSkips(new Set()); // start with all conflicts approved
        setIsSaving(false);
        return;
      }
      await executeSave();
    } catch (error) {
      console.error("Error checking conflicts:", error);
      showToast("שגיאה בבדיקת התנגשויות", "error");
      setIsSaving(false);
    }
  };

  const executeSave = async () => {
    if (!goal) return;
    setIsSaving(true);
    const supabase = createClient();

    try {
      // David's request: when conflicts pop up, the user can uncheck specific
      // rows to keep the existing invoice amount instead of overwriting it.
      // Translate "skip" rows back to the existing total so the budget row
      // matches the unchanged invoice — that way the invoice-sync loop below
      // sees no diff and does nothing for that supplier+month.
      // Convert subtotal-without-vat from the existingTotal (with vat) using
      // the same vat assumption the conflict detector used.
      const skippedBudgetOverrides = new Map<string, number>();
      if (pendingConflicts && conflictSkips.size > 0) {
        for (const c of pendingConflicts) {
          const key = `${c.supplierId}|${c.month}`;
          if (!conflictSkips.has(key)) continue;
          const supplier = suppliers.find((s) => s.id === c.supplierId);
          if (!supplier) continue;
          // existingTotal is total_amount from invoices; convert to subtotal
          // using the same vat assumption the detector used.
          const subtotal = supplier.vat_type === "full"
            ? c.existingTotal / 1.18
            : c.existingTotal;
          skippedBudgetOverrides.set(key, Math.round(subtotal * 100) / 100);
        }
      }

      // Update goal
      const { error: goalError } = await supabase
        .from("goals")
        .update({
          revenue_target: goal.revenue_target,
          labor_cost_target_pct: goal.labor_cost_target_pct,
          food_cost_target_pct: goal.food_cost_target_pct,
          current_expenses_target: goal.current_expenses_target,
          goods_expenses_target: goal.goods_expenses_target,
          markup_percentage: goal.markup_percentage,
          vat_percentage: goal.vat_percentage,
          updated_at: new Date().toISOString(),
        })
        .eq("id", goal.id);

      if (goalError) throw goalError;

      // Upsert income source goals
      for (const ig of incomeSourceGoals) {
        if (ig.id) {
          await supabase
            .from("income_source_goals")
            .update({ avg_ticket_target: ig.avg_ticket_target, updated_at: new Date().toISOString() })
            .eq("id", ig.id);
        } else {
          await supabase.from("income_source_goals").insert({
            goal_id: goal.id,
            income_source_id: ig.income_source_id,
            avg_ticket_target: ig.avg_ticket_target,
          });
        }
      }

      // Upsert supplier budgets (all months). Apply skipped-conflict
      // overrides so an unchecked row writes the EXISTING amount back —
      // keeping the invoice and the budget in sync.
      const effectiveBudget = (b: SupplierBudget): number => {
        const override = skippedBudgetOverrides.get(`${b.supplier_id}|${b.month}`);
        return override !== undefined ? override : b.budget_amount;
      };
      for (const b of supplierBudgets) {
        if (b.month !== selectedMonth) continue;
        const amount = effectiveBudget(b);
        if (b.id) {
          await supabase
            .from("supplier_budgets")
            .update({ budget_amount: amount })
            .eq("id", b.id);
        } else {
          await supabase.from("supplier_budgets").insert({
            supplier_id: b.supplier_id,
            business_id: selectedBusinessId,
            year: selectedYear,
            month: b.month,
            budget_amount: amount,
          });
        }
      }

      // Sync invoices for every current-expenses supplier with a non-zero budget.
      // If this conflict was skipped, the budget already matches the existing
      // invoice → nothing to update. Skip the whole iteration to avoid no-op
      // round-trips.
      for (const b of supplierBudgets) {
        if (b.month !== selectedMonth) continue;
        const supplier = suppliers.find((s) => s.id === b.supplier_id);
        if (!supplier || !isInvoiceEligible(supplier)) continue;
        if (skippedBudgetOverrides.has(`${b.supplier_id}|${b.month}`)) continue;

        const subtotal = b.budget_amount;
        const vatAmount = supplier.vat_type === "full" ? subtotal * 0.18 : 0;
        const totalAmount = subtotal + vatAmount;

        const monthStart = `${b.year || selectedYear}-${String(b.month).padStart(2, "0")}-01`;
        const lastDay = new Date(b.year || selectedYear, b.month, 0).getDate();
        const monthEnd = `${b.year || selectedYear}-${String(b.month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

        // Find existing invoice for this supplier+month
        const { data: existingInvoices } = await supabase
          .from("invoices")
          .select("id")
          .eq("business_id", selectedBusinessId)
          .eq("supplier_id", b.supplier_id)
          .is("deleted_at", null)
          .gte("reference_date", monthStart)
          .lte("reference_date", monthEnd);

        if (existingInvoices && existingInvoices.length > 0) {
          if (subtotal > 0) {
            // Update existing invoice amount
            for (const inv of existingInvoices) {
              await supabase
                .from("invoices")
                .update({
                  subtotal,
                  vat_amount: vatAmount,
                  total_amount: totalAmount,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", inv.id);
            }
          }
          // subtotal=0 → leave existing invoices alone (we don't auto-delete)
        } else if (subtotal > 0) {
          // Create invoice if budget exists but no invoice yet
          const adjustedDay = Math.min(supplier.charge_day || 1, lastDay);
          const invoiceDate = `${b.year || selectedYear}-${String(b.month).padStart(2, "0")}-${String(adjustedDay).padStart(2, "0")}`;
          const invoiceType = supplier.expense_type === "current_expenses" ? "current" : supplier.expense_type === "goods_purchases" ? "goods" : "employees";

          await supabase.from("invoices").insert({
            business_id: selectedBusinessId,
            supplier_id: b.supplier_id,
            invoice_date: invoiceDate,
            reference_date: invoiceDate,
            subtotal,
            vat_amount: vatAmount,
            total_amount: totalAmount,
            status: "pending",
            invoice_type: invoiceType,
            notes: "הוצאה קבועה - נוצרה אוטומטית",
          });
        }
      }

      // Update managed products target percentages
      for (const product of managedProducts) {
        const { error: productError } = await supabase
          .from("managed_products")
          .update({ target_pct: product.target_pct, updated_at: new Date().toISOString() })
          .eq("id", product.id);

        if (productError) {
          console.error("Error updating product:", product.id, productError);
          throw productError;
        }
      }

      await loadData(true);
      showToast("נשמר בהצלחה!", "success");
      setPendingConflicts(null);

    } catch (error) {
      console.error("Error saving:", error);
      showToast("שגיאה בשמירה", "error");
    } finally {
      setIsSaving(false);
    }
  };

  // Manually trigger the goals email for the currently selected business +
  // year + month. Mirrors the n8n cron "שליחת יעדים 28 לחודש" but lets the
  // admin choose when to push it (David #manual-goals-email).
  const sendGoalsEmail = async () => {
    if (!selectedBusinessId || !selectedYear || !selectedMonth) {
      showToast("יש לבחור עסק, שנה וחודש", "error");
      return;
    }
    // Resolve recipient: either a custom address typed by the admin, or the
    // checked owners from the list. We send `to` as a comma-separated string —
    // the n8n daily-push-email webhook + Gmail node forward that to multiple
    // recipients in one send.
    let resolvedTo = "";
    if (useCustomEmail) {
      resolvedTo = sendOverrideTo.trim();
      if (!resolvedTo) {
        showToast("יש להזין כתובת מייל", "error");
        return;
      }
    } else {
      const picked = Array.from(selectedOwnerEmails);
      if (picked.length === 0) {
        showToast("יש לבחור לפחות נמען אחד", "error");
        return;
      }
      resolvedTo = picked.join(", ");
    }

    setSendInProgress(true);
    try {
      const res = await fetch("/api/admin/send-goals-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_id: selectedBusinessId,
          year: selectedYear,
          month: selectedMonth,
          to: resolvedTo,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(json.error || `שגיאה בשליחה (${res.status})`, "error");
        return;
      }
      showToast(`המייל נשלח ל-${json.sentTo}`, "success");
      setSendDialogOpen(false);
      setSendOverrideTo("");
    } catch (err) {
      console.error("sendGoalsEmail error:", err);
      showToast("שגיאת רשת בשליחת המייל", "error");
    } finally {
      setSendInProgress(false);
    }
  };

  // Get budget for a specific supplier and month
  const getBudget = (supplierId: string, month: number): SupplierBudget | undefined => {
    return supplierBudgets.find((b) => b.supplier_id === supplierId && b.month === month);
  };

  // Calculate total for a specific month (current expenses only)
  const getMonthTotal = (month: number): number => {
    return supplierBudgets
      .filter((b) => b.expense_type === "current_expenses" && b.month === month)
      .reduce((sum, b) => sum + b.budget_amount, 0);
  };

  // Calculate total for a specific supplier across all months
  const getSupplierTotal = (supplierId: string): number => {
    return supplierBudgets
      .filter((b) => b.supplier_id === supplierId)
      .reduce((sum, b) => sum + b.budget_amount, 0);
  };

  // Grand total for all current expenses across all months
  const grandTotal = supplierBudgets
    .filter((b) => b.expense_type === "current_expenses")
    .reduce((sum, b) => sum + b.budget_amount, 0);

  // Goods purchases helpers
  const getGoodsMonthTotal = (month: number) => {
    return supplierBudgets
      .filter((b) => b.expense_type === "goods_purchases" && b.month === month)
      .reduce((sum, b) => sum + b.budget_amount, 0);
  };
  const goodsGrandTotal = supplierBudgets
    .filter((b) => b.expense_type === "goods_purchases")
    .reduce((sum, b) => sum + b.budget_amount, 0);

  // Current expenses suppliers only
  const currentExpensesSuppliers = suppliers.filter((s) => s.expense_type === "current_expenses");
  const goodsSuppliers = suppliers.filter((s) => s.expense_type === "goods_purchases");

  if (!isAdmin) {
    return null;
  }

  return (
    <div dir="rtl" className="min-h-[calc(100vh-52px)] bg-[#0F1535] text-white p-4 md:p-6">
      {/* Header */}
      <div className="mb-6 flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold mb-2">ניהול יעדים ותקציבים</h1>
          <p className="text-white/60">הגדרת יעדי KPI ותקציבי ספקים לכל חודש</p>
        </div>
        <Button
          variant="outline"
          onClick={() => setSendDialogOpen(true)}
          disabled={!selectedBusinessId || !goal || isLoading}
          title={!selectedBusinessId ? "בחר עסק" : !goal ? "אין יעדים לחודש זה" : ""}
          className="border-[#4956D4] text-[#4956D4] hover:bg-[#4956D4]/10 px-4 py-2 rounded-lg disabled:opacity-50"
        >
          📧 שלח יעדים במייל ללקוח
        </Button>
      </div>

      {/* Selectors */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        {/* Business Selector */}
        <div>
          <label className="block text-sm text-white/70 mb-2">עסק</label>
          <Select value={selectedBusinessId} onValueChange={(val) => setSelectedBusinessId(val)}>
            <SelectTrigger className="w-full bg-[#0F1535] border border-[#4C526B] rounded-[10px] h-[50px] px-[12px] text-[14px] text-white text-right">
              <SelectValue placeholder="בחר עסק" />
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

        {/* Year Selector */}
        <div>
          <label className="block text-sm text-white/70 mb-2">שנה</label>
          <Select value={String(selectedYear)} onValueChange={(val) => setSelectedYear(parseInt(val))}>
            <SelectTrigger className="w-full bg-[#0F1535] border border-[#4C526B] rounded-[10px] h-[50px] px-[12px] text-[14px] text-white text-right">
              <SelectValue placeholder="בחר שנה" />
            </SelectTrigger>
            <SelectContent>
              {[2025, 2026, 2027].map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Month Selector */}
        <div>
          <label className="block text-sm text-white/70 mb-2">חודש</label>
          <Select value={String(selectedMonth)} onValueChange={(val) => setSelectedMonth(parseInt(val))}>
            <SelectTrigger className="w-full bg-[#0F1535] border border-[#4C526B] rounded-[10px] h-[50px] px-[12px] text-[14px] text-white text-right">
              <SelectValue placeholder="בחר חודש" />
            </SelectTrigger>
            <SelectContent>
              {hebrewMonths.map((m) => (
                <SelectItem key={m.value} value={String(m.value)}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Action Button */}
        <div className="flex items-end">
          {!goal ? (
            <Button
              variant="default"
              onClick={initializeMonth}
              disabled={isInitializing || isLoading}
              className="w-full bg-[#4956D4] hover:bg-[#5A67E0] text-white font-semibold py-3 px-4 rounded-lg transition-colors disabled:opacity-50"
            >
              {isInitializing ? "יוצר..." : "צור יעדים לחודש"}
            </Button>
          ) : (
            <Button
              variant="default"
              onClick={saveAll}
              disabled={isSaving}
              className="w-full bg-[#17DB4E] hover:bg-[#15C445] text-white font-semibold py-3 px-4 rounded-lg transition-colors disabled:opacity-50"
            >
              {isSaving ? "שומר..." : "שמור שינויים"}
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin w-8 h-8 border-4 border-[#4956D4] border-t-transparent rounded-full"></div>
        </div>
      ) : !goal ? (
        <div className="bg-[#1A1F37] rounded-xl p-8 text-center">
          <svg className="w-16 h-16 mx-auto mb-4 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <h3 className="text-xl font-semibold mb-2">אין יעדים לחודש זה</h3>
          <p className="text-white/60 mb-4">לחץ על הכפתור למעלה כדי ליצור יעדים ותקציבים לחודש הנבחר</p>
        </div>
      ) : (
        <>
          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={(val) => setActiveTab(val as "kpi" | "suppliers" | "goods")} dir="rtl">
            <TabsList className="w-full bg-transparent rounded-[7px] p-0 h-[50px] sm:h-[60px] mb-6 gap-0 border border-[#6B6B6B]">
              <TabsTrigger value="kpi" className="flex-1 text-[14px] sm:text-[20px] font-semibold py-0 h-full rounded-none rounded-r-[7px] border-none data-[state=active]:bg-[#29318A] data-[state=active]:text-white text-[#979797] data-[state=inactive]:bg-transparent px-[4px] sm:px-[8px]">יעדי KPI</TabsTrigger>
              <TabsTrigger value="suppliers" className="flex-1 text-[14px] sm:text-[20px] font-semibold py-0 h-full rounded-none border-none data-[state=active]:bg-[#29318A] data-[state=active]:text-white text-[#979797] data-[state=inactive]:bg-transparent px-[4px] sm:px-[8px]">תקציב הוצאות שוטפות</TabsTrigger>
              <TabsTrigger value="goods" className="flex-1 text-[14px] sm:text-[20px] font-semibold py-0 h-full rounded-none rounded-l-[7px] border-none data-[state=active]:bg-[#29318A] data-[state=active]:text-white text-[#979797] data-[state=inactive]:bg-transparent px-[4px] sm:px-[8px]">תקציב קניות סחורה</TabsTrigger>
            </TabsList>
          </Tabs>

          {activeTab === "kpi" ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Main KPIs */}
              <div className="bg-[#1A1F37] rounded-xl p-6">
                <h3 className="text-lg font-semibold mb-4 pb-3 border-b border-white/10">יעדים ראשיים</h3>

                <div className="space-y-4">
                  {/* Markup & VAT */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm text-white/70 mb-2">העמסה (%)</label>
                      <Input
                        type="number"
                        step="0.1"
                        value={goal.markup_percentage !== null && goal.markup_percentage !== undefined
                          ? Math.round((goal.markup_percentage - 1) * 100)
                          : ""}
                        onChange={(e) => updateGoalField("markup_percentage", e.target.value ? 1 + parseFloat(e.target.value) / 100 : null)}
                        className="w-full bg-[#0F1535] border border-[#29318A] rounded-lg px-4 py-3 text-white text-left focus:outline-none focus:border-[#4956D4]"
                        placeholder="18"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-white/70 mb-2">מע״מ (%)</label>
                      <Input
                        type="number"
                        step="0.1"
                        value={goal.vat_percentage !== null && goal.vat_percentage !== undefined
                          ? Math.round(goal.vat_percentage * 100)
                          : ""}
                        onChange={(e) => updateGoalField("vat_percentage", e.target.value ? parseFloat(e.target.value) / 100 : null)}
                        className="w-full bg-[#0F1535] border border-[#29318A] rounded-lg px-4 py-3 text-white text-left focus:outline-none focus:border-[#4956D4]"
                        placeholder="18"
                      />
                    </div>
                  </div>

                  {/* Revenue Target */}
                  <div>
                    <label className="block text-sm text-white/70 mb-2">הכנסות ברוטו (₪)</label>
                    <Input
                      type="number"
                      value={goal.revenue_target || ""}
                      onChange={(e) => updateGoalField("revenue_target", e.target.value ? parseFloat(e.target.value) : null)}
                      className="w-full bg-[#0F1535] border border-[#29318A] rounded-lg px-4 py-3 text-white text-left focus:outline-none focus:border-[#4956D4]"
                      placeholder="0"
                    />
                  </div>

                  {/* Labor Cost */}
                  <div>
                    <label className="block text-sm text-white/70 mb-2">עלות עובדים (%)</label>
                    <Input
                      type="number"
                      step="0.1"
                      value={goal.labor_cost_target_pct || ""}
                      onChange={(e) => updateGoalField("labor_cost_target_pct", e.target.value ? parseFloat(e.target.value) : null)}
                      className="w-full bg-[#0F1535] border border-[#29318A] rounded-lg px-4 py-3 text-white text-left focus:outline-none focus:border-[#4956D4]"
                      placeholder="0"
                    />
                  </div>

                  {/* Food Cost */}
                  <div>
                    <label className="block text-sm text-white/70 mb-2">עלות מכר (%)</label>
                    <Input
                      type="number"
                      step="0.1"
                      value={goal.food_cost_target_pct || ""}
                      onChange={(e) => updateGoalField("food_cost_target_pct", e.target.value ? parseFloat(e.target.value) : null)}
                      className="w-full bg-[#0F1535] border border-[#29318A] rounded-lg px-4 py-3 text-white text-left focus:outline-none focus:border-[#4956D4]"
                      placeholder="0"
                    />
                  </div>

                </div>
              </div>

              {/* Income Source Averages */}
              <div className="bg-[#1A1F37] rounded-xl p-6">
                <h3 className="text-lg font-semibold mb-4 pb-3 border-b border-white/10">יעדי ממוצע מקורות הכנסה</h3>

                {incomeSources.length === 0 ? (
                  <p className="text-white/60">לא הוגדרו מקורות הכנסה לעסק זה</p>
                ) : (
                  <div className="space-y-4">
                    {incomeSources.map((source) => {
                      const currentGoal = incomeSourceGoals.find(
                        (ig) => ig.income_source_id === source.id
                      );
                      return (
                        <div key={source.id}>
                          <label className="block text-sm text-white/70 mb-2">
                            ממוצע {source.name} (₪)
                          </label>
                          <Input
                            type="number"
                            value={currentGoal?.avg_ticket_target || ""}
                            onChange={(e) =>
                              updateIncomeSourceGoal(
                                source.id,
                                e.target.value ? parseFloat(e.target.value) : 0
                              )
                            }
                            className="w-full bg-[#0F1535] border border-[#29318A] rounded-lg px-4 py-3 text-white text-left focus:outline-none focus:border-[#4956D4]"
                            placeholder="0"
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Managed Products Targets - only show if products exist */}
              {managedProducts.length > 0 && (
              <div className="bg-[#1A1F37] rounded-xl p-6">
                <h3 className="text-lg font-semibold mb-4 pb-3 border-b border-white/10">יעדי מוצרים מנוהלים (%)</h3>

                  <div className="space-y-4">
                    {managedProducts.map((product) => (
                      <div key={product.id}>
                        <label className="block text-sm text-white/70 mb-2">
                          {product.name}
                          <span className="text-xs text-white/40 mr-2">
                            (₪{product.unit_cost.toLocaleString()} ל{product.unit})
                          </span>
                        </label>
                        <Input
                          type="number"
                          step="0.1"
                          value={product.target_pct ?? ""}
                          onChange={(e) =>
                            updateManagedProductTarget(
                              product.id,
                              e.target.value ? parseFloat(e.target.value) : null
                            )
                          }
                          className="w-full bg-[#0F1535] border border-[#29318A] rounded-lg px-4 py-3 text-white text-left focus:outline-none focus:border-[#4956D4]"
                          placeholder="0"
                        />
                      </div>
                    ))}
                  </div>
              </div>
              )}
            </div>
          ) : activeTab === "suppliers" ? (
            /* Supplier Budgets Tab - 12 Month Table */
            <div className="bg-[#1A1F37] rounded-xl overflow-hidden">
              {/* Search bar */}
              <div className="px-4 pt-4 pb-2">
                <Input
                  type="text"
                  placeholder="חיפוש ספק..."
                  value={supplierSearch}
                  onChange={(e) => setSupplierSearch(e.target.value)}
                  className="w-full bg-[#0F1535] border border-[#29318A] rounded-lg px-4 py-3 text-white text-right focus:outline-none focus:border-[#4956D4] placeholder:text-white/30"
                />
              </div>
              <div className="overflow-x-auto">
                <Table className="w-full min-w-[900px] border-collapse">
                  <TableHeader>
                    <TableRow className="bg-[#0F1535]">
                      <TableHead className="sticky right-0 z-10 bg-[#0F1535] text-right px-4 py-3 text-sm font-semibold border-b border-white/10 min-w-[140px]">שם ספק</TableHead>
                      <TableHead className="text-right px-2 py-3 text-sm font-semibold border-b border-white/10 text-white/60 min-w-[70px]">סוג</TableHead>
                      {hebrewMonths.map((m) => (
                        <TableHead key={m.value} className="text-center px-1 py-3 text-xs font-semibold border-b border-white/10 text-white/70 min-w-[80px]">
                          {m.label}
                        </TableHead>
                      ))}
                      <TableHead className="text-center px-2 py-3 text-sm font-semibold border-b border-white/10 text-[#17DB4E] min-w-[90px]">סה״כ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {currentExpensesSuppliers
                      .filter(s => !supplierSearch || s.name.toLowerCase().includes(supplierSearch.toLowerCase()))
                      .sort((a, b) => (a.is_fixed_expense === b.is_fixed_expense ? 0 : a.is_fixed_expense ? -1 : 1))
                      .map((supplier) => (
                      <TableRow key={supplier.id} className={`border-b border-white/5 hover:bg-white/[0.02] ${supplier.is_fixed_expense ? "bg-[#7C3AED]/10" : ""}`}>
                        <TableCell className={`sticky right-0 z-10 px-2 py-1 text-sm font-medium ${supplier.is_fixed_expense ? "bg-[#7C3AED]/15" : "bg-[#1A1F37]"}`}>
                          <Input
                            type="text"
                            defaultValue={supplier.name}
                            onBlur={(e) => {
                              const newName = e.target.value.trim();
                              if (newName && newName !== supplier.name) {
                                updateSupplierField(supplier.id, "name", newName);
                              } else if (!newName) {
                                e.target.value = supplier.name;
                              }
                            }}
                            className={`w-full bg-transparent border border-transparent hover:border-[#29318A]/50 focus:border-[#4956D4] rounded px-2 py-1 text-sm font-medium focus:outline-none ${supplier.is_fixed_expense ? "text-[#C084FC]" : "text-white/90"}`}
                          />
                        </TableCell>
                        <TableCell className="px-2 py-2 text-xs">
                          <select
                            value={supplier.is_fixed_expense ? "fixed" : "variable"}
                            onChange={(e) =>
                              updateSupplierField(supplier.id, "is_fixed_expense", e.target.value === "fixed")
                            }
                            className={`bg-[#0F1535] border border-[#29318A]/50 rounded px-2 py-1 text-xs cursor-pointer focus:outline-none focus:border-[#4956D4] ${supplier.is_fixed_expense ? "text-[#C084FC] font-medium" : "text-white/70"}`}
                          >
                            <option value="fixed">קבוע</option>
                            <option value="variable">משתנה</option>
                          </select>
                        </TableCell>
                        {hebrewMonths.map((m) => {
                          const budget = getBudget(supplier.id, m.value);
                          return (
                            <TableCell key={m.value} className="px-1 py-1">
                              <Input
                                type="number"
                                value={budget?.budget_amount || ""}
                                onChange={(e) =>
                                  updateSupplierBudget(
                                    supplier.id,
                                    m.value,
                                    e.target.value ? parseFloat(e.target.value) : 0
                                  )
                                }
                                className="w-full bg-[#0F1535] border border-[#29318A]/50 rounded px-2 py-1.5 text-white text-center text-sm focus:outline-none focus:border-[#4956D4] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                placeholder="0"
                              />
                            </TableCell>
                          );
                        })}
                        <TableCell className="px-2 py-2 text-center text-sm font-semibold text-white/80">
                          ₪{getSupplierTotal(supplier.id).toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow className="bg-[#0F1535]/60 border-t border-white/10">
                      <TableCell className="sticky right-0 z-10 bg-[#0F1535] px-4 py-3 text-sm font-bold">סה״כ</TableCell>
                      <TableCell></TableCell>
                      {hebrewMonths.map((m) => (
                        <TableCell key={m.value} className="px-1 py-3 text-center text-xs font-semibold text-white">
                          ₪{getMonthTotal(m.value).toLocaleString()}
                        </TableCell>
                      ))}
                      <TableCell className="px-2 py-3 text-center text-sm font-bold text-[#17DB4E]">
                        ₪{grandTotal.toLocaleString()}
                      </TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            </div>
          ) : (
            /* Goods Purchases Tab - 12 Month Table */
            <div className="bg-[#1A1F37] rounded-xl overflow-hidden">
              <div className="px-4 pt-4 pb-2">
                <p className="text-[12px] text-white/50 text-right mb-2">
                  קבע תקציב חודשי מרבי לכל ספק קניות סחורה. כשהספק יחרוג — תישלח התראה אוטומטית למייל.
                </p>
                <Input
                  type="text"
                  placeholder="חיפוש ספק..."
                  value={supplierSearch}
                  onChange={(e) => setSupplierSearch(e.target.value)}
                  className="w-full bg-[#0F1535] border border-[#29318A] rounded-lg px-4 py-3 text-white text-right focus:outline-none focus:border-[#4956D4] placeholder:text-white/30"
                />
              </div>
              <div className="overflow-x-auto">
                <Table className="w-full min-w-[900px] border-collapse">
                  <TableHeader>
                    <TableRow className="bg-[#0F1535]">
                      <TableHead className="sticky right-0 z-10 bg-[#0F1535] text-right px-4 py-3 text-sm font-semibold border-b border-white/10 min-w-[140px]">שם ספק</TableHead>
                      <TableHead className="text-right px-2 py-3 text-sm font-semibold border-b border-white/10 text-white/60 min-w-[70px]">סוג</TableHead>
                      {hebrewMonths.map((m) => (
                        <TableHead key={m.value} className="text-center px-1 py-3 text-xs font-semibold border-b border-white/10 text-white/70 min-w-[80px]">
                          {m.label}
                        </TableHead>
                      ))}
                      <TableHead className="text-center px-2 py-3 text-sm font-semibold border-b border-white/10 text-[#17DB4E] min-w-[90px]">סה״כ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {goodsSuppliers
                      .filter(s => !supplierSearch || s.name.toLowerCase().includes(supplierSearch.toLowerCase()))
                      .sort((a, b) => (a.is_fixed_expense === b.is_fixed_expense ? 0 : a.is_fixed_expense ? -1 : 1))
                      .map((supplier) => (
                      <TableRow key={supplier.id} className={`border-b border-white/5 hover:bg-white/[0.02] ${supplier.is_fixed_expense ? "bg-[#7C3AED]/10" : ""}`}>
                        <TableCell className={`sticky right-0 z-10 px-2 py-1 text-sm font-medium ${supplier.is_fixed_expense ? "bg-[#7C3AED]/15" : "bg-[#1A1F37]"}`}>
                          <Input
                            type="text"
                            defaultValue={supplier.name}
                            onBlur={(e) => {
                              const newName = e.target.value.trim();
                              if (newName && newName !== supplier.name) {
                                updateSupplierField(supplier.id, "name", newName);
                              } else if (!newName) {
                                e.target.value = supplier.name;
                              }
                            }}
                            className={`w-full bg-transparent border border-transparent hover:border-[#29318A]/50 focus:border-[#4956D4] rounded px-2 py-1 text-sm font-medium focus:outline-none ${supplier.is_fixed_expense ? "text-[#C084FC]" : "text-white/90"}`}
                          />
                        </TableCell>
                        <TableCell className="px-2 py-2 text-xs">
                          <select
                            value={supplier.is_fixed_expense ? "fixed" : "variable"}
                            onChange={(e) =>
                              updateSupplierField(supplier.id, "is_fixed_expense", e.target.value === "fixed")
                            }
                            className={`bg-[#0F1535] border border-[#29318A]/50 rounded px-2 py-1 text-xs cursor-pointer focus:outline-none focus:border-[#4956D4] ${supplier.is_fixed_expense ? "text-[#C084FC] font-medium" : "text-white/70"}`}
                          >
                            <option value="fixed">קבוע</option>
                            <option value="variable">משתנה</option>
                          </select>
                        </TableCell>
                        {hebrewMonths.map((m) => {
                          const budget = getBudget(supplier.id, m.value);
                          return (
                            <TableCell key={m.value} className="px-1 py-1">
                              <Input
                                type="number"
                                value={budget?.budget_amount || ""}
                                onChange={(e) =>
                                  updateSupplierBudget(
                                    supplier.id,
                                    m.value,
                                    e.target.value ? parseFloat(e.target.value) : 0
                                  )
                                }
                                className="w-full bg-[#0F1535] border border-[#29318A]/50 rounded px-2 py-1.5 text-white text-center text-sm focus:outline-none focus:border-[#4956D4] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                placeholder="0"
                              />
                            </TableCell>
                          );
                        })}
                        <TableCell className="px-2 py-2 text-center text-sm font-semibold text-white/80">
                          ₪{getSupplierTotal(supplier.id).toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow className="bg-[#0F1535]/60 border-t border-white/10">
                      <TableCell className="sticky right-0 z-10 bg-[#0F1535] px-4 py-3 text-sm font-bold">סה״כ</TableCell>
                      <TableCell></TableCell>
                      {hebrewMonths.map((m) => (
                        <TableCell key={m.value} className="px-1 py-3 text-center text-xs font-semibold text-white">
                          ₪{getGoodsMonthTotal(m.value).toLocaleString()}
                        </TableCell>
                      ))}
                      <TableCell className="px-2 py-3 text-center text-sm font-bold text-[#17DB4E]">
                        ₪{goodsGrandTotal.toLocaleString()}
                      </TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Conflict popup — existing invoices would be overwritten by saving these budgets */}
      <Dialog open={!!pendingConflicts} onOpenChange={(open) => !open && setPendingConflicts(null)}>
        <DialogContent className="bg-[#1A1F37] border border-[#29318A] text-white max-w-[640px]" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-right text-[18px] font-bold text-[#FFA500]">
              חשבוניות קיימות — אישור עדכון
            </DialogTitle>
          </DialogHeader>
          <div className="text-right space-y-3 max-h-[400px] overflow-y-auto py-2">
            <p className="text-[14px] text-white/80">
              עבור הספקים הבאים כבר קיימת חשבונית בחודש המבוקש בסכום שונה מהיעד החדש.
              סמן רק את השורות שברצונך לעדכן — לא מסומנות יישארו על הסכום הקיים.
            </p>
            <div className="flex items-center gap-3 px-1">
              <button
                type="button"
                onClick={() => setConflictSkips(new Set())}
                className="text-[12px] text-[#17DB4E] hover:underline"
              >
                סמן הכל
              </button>
              <span className="text-white/20">|</span>
              <button
                type="button"
                onClick={() => setConflictSkips(new Set((pendingConflicts || []).map(c => `${c.supplierId}|${c.month}`)))}
                className="text-[12px] text-white/70 hover:underline"
              >
                בטל הכל
              </button>
            </div>
            <div className="border border-white/10 rounded-lg overflow-hidden">
              <table className="w-full text-[13px]">
                <thead className="bg-[#0F1535]">
                  <tr>
                    <th className="px-3 py-2 text-center font-semibold w-[44px]">עדכן</th>
                    <th className="px-3 py-2 text-right font-semibold">ספק</th>
                    <th className="px-3 py-2 text-center font-semibold">חודש</th>
                    <th className="px-3 py-2 text-center font-semibold">קיים</th>
                    <th className="px-3 py-2 text-center font-semibold">חדש</th>
                  </tr>
                </thead>
                <tbody>
                  {(pendingConflicts || []).map((c, i) => {
                    const key = `${c.supplierId}|${c.month}`;
                    const skipped = conflictSkips.has(key);
                    const willUpdate = !skipped;
                    return (
                      <tr
                        key={`${c.supplierId}-${c.month}-${i}`}
                        className={`border-t border-white/5 ${skipped ? "opacity-50" : ""}`}
                      >
                        <td className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={willUpdate}
                            onChange={() => {
                              setConflictSkips(prev => {
                                const next = new Set(prev);
                                if (next.has(key)) next.delete(key);
                                else next.add(key);
                                return next;
                              });
                            }}
                            className="w-4 h-4 accent-[#17DB4E] cursor-pointer"
                          />
                        </td>
                        <td className="px-3 py-2 text-right">{c.supplierName}</td>
                        <td className="px-3 py-2 text-center text-white/70">{c.monthLabel}</td>
                        <td className="px-3 py-2 text-center text-white/70">₪{c.existingTotal.toLocaleString()}</td>
                        <td className={`px-3 py-2 text-center font-medium ${skipped ? "text-white/40 line-through" : "text-[#17DB4E]"}`}>
                          ₪{c.newTotal.toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {(() => {
              const total = pendingConflicts?.length || 0;
              const skipped = conflictSkips.size;
              const willUpdate = total - skipped;
              return (
                <p className="text-[12px] text-white/60">
                  {willUpdate} מתוך {total} יעודכנו
                  {skipped > 0 ? ` · ${skipped} יישארו על הסכום הקיים` : ""}.
                </p>
              );
            })()}
          </div>
          <DialogFooter className="flex-row-reverse gap-2 sm:flex-row-reverse">
            <Button
              type="button"
              onClick={() => setPendingConflicts(null)}
              disabled={isSaving}
              className="bg-white/10 hover:bg-white/20 text-white px-5"
            >
              ביטול
            </Button>
            <Button
              type="button"
              onClick={() => executeSave()}
              disabled={isSaving}
              className="bg-[#17DB4E] hover:bg-[#15c544] text-white px-5"
            >
              {isSaving ? "שומר..." : "אישור ושמירה"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Send-goals-email dialog */}
      <Dialog open={sendDialogOpen} onOpenChange={(o) => { if (!sendInProgress) setSendDialogOpen(o); }}>
        <DialogContent className="bg-[#0F1535] border-[#4C526B] text-white sm:max-w-[520px] rounded-[20px] p-[20px]" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-white text-right text-[18px] font-bold">
              שליחת יעדי החודש במייל
            </DialogTitle>
            <DialogDescription className="text-white/70 text-right text-[13px]">
              ייווצר מייל זהה למייל הקבוע שיוצא ב-28 לחודש. ייקח דקה.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-[12px] mt-[10px]">
            <div className="bg-[#1A1F37] rounded-[10px] p-[12px] flex flex-col gap-[4px] text-[13px]">
              <span className="text-white/50">עסק:</span>
              <span className="font-semibold">{businesses.find((b) => b.id === selectedBusinessId)?.name || "—"}</span>
              <span className="text-white/50 mt-[6px]">חודש:</span>
              <span className="font-semibold">{selectedMonth ? `${selectedMonth}/${selectedYear}` : "—"}</span>
            </div>

            {/* Recipient picker — owners list with custom-email override */}
            <div className="flex flex-col gap-[8px]">
              <label className="text-[13px] text-white/70">נמענים</label>

              {ownersLoading ? (
                <div className="text-[13px] text-white/50">טוען בעלי עסק…</div>
              ) : (
                <>
                  {!useCustomEmail && businessOwners.length === 0 && (
                    <div className="text-[13px] text-yellow-400/80 bg-yellow-400/10 rounded-[8px] p-[10px]">
                      לא נמצאו בעלים מוגדרים לעסק. השתמש בכתובת ידנית למטה.
                    </div>
                  )}

                  {!useCustomEmail && businessOwners.length > 0 && (
                    <div className="bg-[#1A1F37] rounded-[10px] p-[10px] flex flex-col gap-[6px]">
                      {businessOwners.map((o) => (
                        <label
                          key={o.email}
                          className="flex items-center gap-[10px] cursor-pointer hover:bg-white/5 rounded-[6px] p-[6px]"
                        >
                          <input
                            type="checkbox"
                            checked={selectedOwnerEmails.has(o.email)}
                            onChange={() => {
                              setSelectedOwnerEmails((prev) => {
                                const next = new Set(prev);
                                if (next.has(o.email)) next.delete(o.email);
                                else next.add(o.email);
                                return next;
                              });
                            }}
                            className="w-4 h-4 accent-[#17DB4E] cursor-pointer"
                            disabled={sendInProgress}
                          />
                          <div className="flex flex-col text-right flex-1 min-w-0">
                            <span className="text-[13px] text-white truncate">
                              {o.fullName || o.email}
                            </span>
                            <span className="text-[11px] text-white/50 truncate">
                              {o.email}
                              {o.role === "admin" && " · אדמין"}
                            </span>
                          </div>
                        </label>
                      ))}
                    </div>
                  )}

                  {useCustomEmail && (
                    <Input
                      type="email"
                      value={sendOverrideTo}
                      onChange={(e) => setSendOverrideTo(e.target.value)}
                      placeholder="example@biz.co.il"
                      className="bg-[#0F1535] border border-[#4C526B] text-white text-right rounded-[10px] h-[44px] px-[12px]"
                      disabled={sendInProgress}
                      autoFocus
                    />
                  )}

                  <button
                    type="button"
                    onClick={() => setUseCustomEmail((v) => !v)}
                    className="text-[12px] text-[#4956D4] hover:underline self-start"
                    disabled={sendInProgress}
                  >
                    {useCustomEmail ? "← בחר מבעלי העסק" : "← הזן כתובת אחרת ידנית"}
                  </button>
                </>
              )}

              <p className="text-[11px] text-white/40">
                CC לדוד מתווסף אוטומטית בכל מקרה.
              </p>
            </div>
          </div>
          <DialogFooter className="mt-[16px] flex flex-row-reverse gap-[8px]">
            <Button
              onClick={sendGoalsEmail}
              disabled={sendInProgress || ownersLoading}
              className="bg-[#4956D4] hover:bg-[#5A67E0] text-white font-semibold py-2 px-4 rounded-lg disabled:opacity-50"
            >
              {sendInProgress ? "שולח..." : "שלח עכשיו"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setSendDialogOpen(false)}
              disabled={sendInProgress}
              className="text-white/70 hover:text-white"
            >
              ביטול
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
