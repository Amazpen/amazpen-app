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

  // Goal data
  const [goal, setGoal] = useState<Goal | null>(null);
  const [incomeSources, setIncomeSources] = useState<IncomeSource[]>([]);
  const [incomeSourceGoals, setIncomeSourceGoals] = useState<IncomeSourceGoal[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierBudgets, setSupplierBudgets] = useState<SupplierBudget[]>([]);
  const [managedProducts, setManagedProducts] = useState<ManagedProduct[]>([]);

  // Tabs
  const [activeTab, setActiveTab] = usePersistedState<"kpi" | "suppliers">("admin-goals:tab", "kpi");

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
        .select("id, name, unit, unit_cost, target_pct")
        .eq("business_id", selectedBusinessId)
        .eq("is_active", true)
        .is("deleted_at", null)
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
  const saveAll = async () => {
    if (!goal) return;

    setIsSaving(true);
    const supabase = createClient();

    try {
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

      // Upsert supplier budgets (all months)
      for (const b of supplierBudgets) {
        if (b.id) {
          await supabase
            .from("supplier_budgets")
            .update({ budget_amount: b.budget_amount })
            .eq("id", b.id);
        } else {
          await supabase.from("supplier_budgets").insert({
            supplier_id: b.supplier_id,
            business_id: selectedBusinessId,
            year: selectedYear,
            month: b.month,
            budget_amount: b.budget_amount,
          });
        }
      }

      // Sync fixed expense invoices with updated budget amounts
      const fixedSupplierIds = new Set(
        suppliers.filter((s) => s.is_fixed_expense && !s.has_previous_obligations).map((s) => s.id)
      );

      for (const b of supplierBudgets) {
        if (!fixedSupplierIds.has(b.supplier_id)) continue;

        const supplier = suppliers.find((s) => s.id === b.supplier_id);
        if (!supplier) continue;

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
          .gte("invoice_date", monthStart)
          .lte("invoice_date", monthEnd);

        if (existingInvoices && existingInvoices.length > 0) {
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
        } else if (subtotal > 0) {
          // Create invoice if budget exists but no invoice yet
          const adjustedDay = Math.min(supplier.charge_day || 1, lastDay);
          const invoiceDate = `${b.year || selectedYear}-${String(b.month).padStart(2, "0")}-${String(adjustedDay).padStart(2, "0")}`;
          const invoiceType = supplier.expense_type === "current_expenses" ? "current" : supplier.expense_type === "goods_purchases" ? "goods" : "employees";

          await supabase.from("invoices").insert({
            business_id: selectedBusinessId,
            supplier_id: b.supplier_id,
            invoice_date: invoiceDate,
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

    } catch (error) {
      console.error("Error saving:", error);
      showToast("שגיאה בשמירה", "error");
    } finally {
      setIsSaving(false);
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

  // Current expenses suppliers only
  const currentExpensesSuppliers = suppliers.filter((s) => s.expense_type === "current_expenses");

  if (!isAdmin) {
    return null;
  }

  return (
    <div dir="rtl" className="min-h-[calc(100vh-52px)] bg-[#0F1535] text-white p-4 md:p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl md:text-3xl font-bold mb-2">ניהול יעדים ותקציבים</h1>
        <p className="text-white/60">הגדרת יעדי KPI ותקציבי ספקים לכל חודש</p>
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
          <Tabs value={activeTab} onValueChange={(val) => setActiveTab(val as "kpi" | "suppliers")} dir="rtl">
            <TabsList className="w-full bg-transparent rounded-[7px] p-0 h-[50px] sm:h-[60px] mb-6 gap-0 border border-[#6B6B6B]">
              <TabsTrigger value="kpi" className="flex-1 text-[14px] sm:text-[20px] font-semibold py-0 h-full rounded-none rounded-r-[7px] border-none data-[state=active]:bg-[#29318A] data-[state=active]:text-white text-[#979797] data-[state=inactive]:bg-transparent px-[4px] sm:px-[8px]">יעדי KPI</TabsTrigger>
              <TabsTrigger value="suppliers" className="flex-1 text-[14px] sm:text-[20px] font-semibold py-0 h-full rounded-none rounded-l-[7px] border-none data-[state=active]:bg-[#29318A] data-[state=active]:text-white text-[#979797] data-[state=inactive]:bg-transparent px-[4px] sm:px-[8px]">תקציב הוצאות שוטפות</TabsTrigger>
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
          ) : (
            /* Supplier Budgets Tab - 12 Month Table */
            <div className="bg-[#1A1F37] rounded-xl overflow-hidden">
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
                    {currentExpensesSuppliers.map((supplier) => (
                      <TableRow key={supplier.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                        <TableCell className="sticky right-0 z-10 bg-[#1A1F37] px-4 py-2 text-sm text-white/90 font-medium">{supplier.name}</TableCell>
                        <TableCell className="px-2 py-2 text-xs text-white/40">{supplier.is_fixed_expense ? "קבוע" : "משתנה"}</TableCell>
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
          )}
        </>
      )}
    </div>
  );
}
