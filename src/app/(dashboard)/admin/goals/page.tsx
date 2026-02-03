"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useDashboard } from "../../layout";
import { useToast } from "@/components/ui/toast";

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
  const [selectedBusinessId, setSelectedBusinessId] = useState<string>("");
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth() + 1);

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
  const [activeTab, setActiveTab] = useState<"kpi" | "suppliers">("kpi");

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
        .order("name");

      if (data && data.length > 0) {
        setBusinesses(data);
        setSelectedBusinessId(data[0].id);
      }
      setIsLoading(false);
    };

    loadBusinesses();
  }, []);

  // Load data when business/month/year changes
  const loadData = useCallback(async () => {
    if (!selectedBusinessId) return;

    setIsLoading(true);
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
        .select("id, name, expense_type, is_fixed_expense, monthly_expense_amount, has_previous_obligations")
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
        .single();

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

      // Load supplier budgets for this month
      const { data: budgetsData } = await supabase
        .from("supplier_budgets")
        .select("*, suppliers(name, expense_type)")
        .eq("business_id", selectedBusinessId)
        .eq("year", selectedYear)
        .eq("month", selectedMonth);

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
      setIsLoading(false);
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
      // Calculate previous month
      let prevMonth = selectedMonth - 1;
      let prevYear = selectedYear;
      if (prevMonth === 0) {
        prevMonth = 12;
        prevYear = selectedYear - 1;
      }

      // Get previous month's goal as template
      const { data: prevGoal } = await supabase
        .from("goals")
        .select("*")
        .eq("business_id", selectedBusinessId)
        .eq("year", prevYear)
        .eq("month", prevMonth)
        .is("deleted_at", null)
        .single();

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
      } else {
        // Create budgets from supplier fixed expenses
        const newBudgets = suppliers
          .filter((s) => !s.has_previous_obligations)
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

  // Update supplier budget
  const updateSupplierBudget = (supplierId: string, value: number) => {
    setSupplierBudgets((prev) => {
      const existing = prev.find((b) => b.supplier_id === supplierId);
      if (existing) {
        return prev.map((b) =>
          b.supplier_id === supplierId ? { ...b, budget_amount: value } : b
        );
      } else {
        const supplier = suppliers.find((s) => s.id === supplierId);
        return [
          ...prev,
          {
            supplier_id: supplierId,
            business_id: selectedBusinessId,
            year: selectedYear,
            month: selectedMonth,
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

      // Upsert supplier budgets
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
            month: selectedMonth,
            budget_amount: b.budget_amount,
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

      showToast("נשמר בהצלחה!", "success");
      await loadData();

    } catch (error) {
      console.error("Error saving:", error);
      showToast("שגיאה בשמירה", "error");
    } finally {
      setIsSaving(false);
    }
  };

  // Calculate totals
  const totalCurrentExpensesBudget = supplierBudgets
    .filter((b) => b.expense_type === "current_expenses")
    .reduce((sum, b) => sum + b.budget_amount, 0);

  const totalGoodsBudget = supplierBudgets
    .filter((b) => b.expense_type === "goods_purchases")
    .reduce((sum, b) => sum + b.budget_amount, 0);

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
          <select
            title="בחר עסק"
            value={selectedBusinessId}
            onChange={(e) => setSelectedBusinessId(e.target.value)}
            className="w-full bg-[#1A1F37] border border-[#29318A] rounded-lg px-4 py-3 text-white focus:outline-none focus:border-[#4956D4]"
          >
            {businesses.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>

        {/* Year Selector */}
        <div>
          <label className="block text-sm text-white/70 mb-2">שנה</label>
          <select
            title="בחר שנה"
            value={selectedYear}
            onChange={(e) => setSelectedYear(parseInt(e.target.value))}
            className="w-full bg-[#1A1F37] border border-[#29318A] rounded-lg px-4 py-3 text-white focus:outline-none focus:border-[#4956D4]"
          >
            {[2025, 2026, 2027].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>

        {/* Month Selector */}
        <div>
          <label className="block text-sm text-white/70 mb-2">חודש</label>
          <select
            title="בחר חודש"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
            className="w-full bg-[#1A1F37] border border-[#29318A] rounded-lg px-4 py-3 text-white focus:outline-none focus:border-[#4956D4]"
          >
            {hebrewMonths.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        {/* Action Button */}
        <div className="flex items-end">
          {!goal ? (
            <button
              onClick={initializeMonth}
              disabled={isInitializing || isLoading}
              className="w-full bg-[#4956D4] hover:bg-[#5A67E0] text-white font-semibold py-3 px-4 rounded-lg transition-colors disabled:opacity-50"
            >
              {isInitializing ? "יוצר..." : "צור יעדים לחודש"}
            </button>
          ) : (
            <button
              onClick={saveAll}
              disabled={isSaving}
              className="w-full bg-[#17DB4E] hover:bg-[#15C445] text-white font-semibold py-3 px-4 rounded-lg transition-colors disabled:opacity-50"
            >
              {isSaving ? "שומר..." : "שמור שינויים"}
            </button>
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
          <div className="flex gap-2 mb-6">
            <button
              onClick={() => setActiveTab("kpi")}
              className={`px-6 py-3 rounded-lg font-semibold transition-colors ${
                activeTab === "kpi"
                  ? "bg-[#4956D4] text-white"
                  : "bg-[#1A1F37] text-white/60 hover:text-white"
              }`}
            >
              יעדי KPI
            </button>
            <button
              onClick={() => setActiveTab("suppliers")}
              className={`px-6 py-3 rounded-lg font-semibold transition-colors ${
                activeTab === "suppliers"
                  ? "bg-[#4956D4] text-white"
                  : "bg-[#1A1F37] text-white/60 hover:text-white"
              }`}
            >
              תקציבי ספקים
            </button>
          </div>

          {activeTab === "kpi" ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Main KPIs */}
              <div className="bg-[#1A1F37] rounded-xl p-6">
                <h3 className="text-lg font-semibold mb-4 pb-3 border-b border-white/10">יעדים ראשיים</h3>

                <div className="space-y-4">
                  {/* Revenue Target */}
                  <div>
                    <label className="block text-sm text-white/70 mb-2">הכנסות ברוטו (₪)</label>
                    <input
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
                    <input
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
                    <input
                      type="number"
                      step="0.1"
                      value={goal.food_cost_target_pct || ""}
                      onChange={(e) => updateGoalField("food_cost_target_pct", e.target.value ? parseFloat(e.target.value) : null)}
                      className="w-full bg-[#0F1535] border border-[#29318A] rounded-lg px-4 py-3 text-white text-left focus:outline-none focus:border-[#4956D4]"
                      placeholder="0"
                    />
                  </div>

                  {/* Current Expenses Target */}
                  <div>
                    <label className="block text-sm text-white/70 mb-2">
                      הוצאות שוטפות (₪)
                      <span className="text-xs text-white/40 mr-2">
                        (סה״כ תקציבי ספקים: ₪{totalCurrentExpensesBudget.toLocaleString()})
                      </span>
                    </label>
                    <input
                      type="number"
                      value={goal.current_expenses_target || ""}
                      onChange={(e) => updateGoalField("current_expenses_target", e.target.value ? parseFloat(e.target.value) : null)}
                      className="w-full bg-[#0F1535] border border-[#29318A] rounded-lg px-4 py-3 text-white text-left focus:outline-none focus:border-[#4956D4]"
                      placeholder="0"
                    />
                  </div>

                  {/* Goods Expenses Target */}
                  <div>
                    <label className="block text-sm text-white/70 mb-2">
                      קניות סחורה (₪)
                      <span className="text-xs text-white/40 mr-2">
                        (סה״כ תקציבי ספקים: ₪{totalGoodsBudget.toLocaleString()})
                      </span>
                    </label>
                    <input
                      type="number"
                      value={goal.goods_expenses_target || ""}
                      onChange={(e) => updateGoalField("goods_expenses_target", e.target.value ? parseFloat(e.target.value) : null)}
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
                          <input
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

              {/* Managed Products Targets */}
              <div className="bg-[#1A1F37] rounded-xl p-6">
                <h3 className="text-lg font-semibold mb-4 pb-3 border-b border-white/10">יעדי מוצרים מנוהלים (%)</h3>

                {managedProducts.length === 0 ? (
                  <p className="text-white/60">לא הוגדרו מוצרים מנוהלים לעסק זה</p>
                ) : (
                  <div className="space-y-4">
                    {managedProducts.map((product) => (
                      <div key={product.id}>
                        <label className="block text-sm text-white/70 mb-2">
                          {product.name}
                          <span className="text-xs text-white/40 mr-2">
                            (₪{product.unit_cost.toLocaleString()} ל{product.unit})
                          </span>
                        </label>
                        <input
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
                )}
              </div>
            </div>
          ) : (
            /* Supplier Budgets Tab */
            <div className="bg-[#1A1F37] rounded-xl overflow-hidden">
              {/* Table Header */}
              <div className="grid grid-cols-12 gap-4 p-4 bg-[#0F1535] font-semibold text-sm">
                <div className="col-span-5">שם ספק</div>
                <div className="col-span-3">סוג הוצאה</div>
                <div className="col-span-4">תקציב חודשי (₪)</div>
              </div>

              {/* Current Expenses Section */}
              <div className="p-4 border-b border-white/10">
                <h4 className="text-[#4956D4] font-semibold mb-3">הוצאות שוטפות</h4>
                <div className="space-y-2">
                  {suppliers
                    .filter((s) => s.expense_type === "current_expenses")
                    .map((supplier) => {
                      const budget = supplierBudgets.find((b) => b.supplier_id === supplier.id);
                      return (
                        <div key={supplier.id} className="grid grid-cols-12 gap-4 items-center py-2">
                          <div className="col-span-5 text-white/90">{supplier.name}</div>
                          <div className="col-span-3 text-white/60 text-sm">
                            {supplier.is_fixed_expense ? "הוצאה קבועה" : "הוצאה משתנה"}
                          </div>
                          <div className="col-span-4">
                            <input
                              type="number"
                              value={budget?.budget_amount || ""}
                              onChange={(e) =>
                                updateSupplierBudget(
                                  supplier.id,
                                  e.target.value ? parseFloat(e.target.value) : 0
                                )
                              }
                              className="w-full bg-[#0F1535] border border-[#29318A] rounded-lg px-3 py-2 text-white text-left focus:outline-none focus:border-[#4956D4]"
                              placeholder="0"
                            />
                          </div>
                        </div>
                      );
                    })}
                </div>
                <div className="flex justify-between items-center mt-3 pt-3 border-t border-white/10">
                  <span className="font-semibold">סה״כ הוצאות שוטפות</span>
                  <span className="text-[#17DB4E] font-bold">
                    ₪{totalCurrentExpensesBudget.toLocaleString()}
                  </span>
                </div>
              </div>

              {/* Goods Purchases Section */}
              <div className="p-4">
                <h4 className="text-[#F64E60] font-semibold mb-3">קניות סחורה</h4>
                <div className="space-y-2">
                  {suppliers
                    .filter((s) => s.expense_type === "goods_purchases")
                    .map((supplier) => {
                      const budget = supplierBudgets.find((b) => b.supplier_id === supplier.id);
                      return (
                        <div key={supplier.id} className="grid grid-cols-12 gap-4 items-center py-2">
                          <div className="col-span-5 text-white/90">{supplier.name}</div>
                          <div className="col-span-3 text-white/60 text-sm">
                            {supplier.is_fixed_expense ? "הוצאה קבועה" : "הוצאה משתנה"}
                          </div>
                          <div className="col-span-4">
                            <input
                              type="number"
                              value={budget?.budget_amount || ""}
                              onChange={(e) =>
                                updateSupplierBudget(
                                  supplier.id,
                                  e.target.value ? parseFloat(e.target.value) : 0
                                )
                              }
                              className="w-full bg-[#0F1535] border border-[#29318A] rounded-lg px-3 py-2 text-white text-left focus:outline-none focus:border-[#4956D4]"
                              placeholder="0"
                            />
                          </div>
                        </div>
                      );
                    })}
                </div>
                <div className="flex justify-between items-center mt-3 pt-3 border-t border-white/10">
                  <span className="font-semibold">סה״כ קניות סחורה</span>
                  <span className="text-[#F64E60] font-bold">
                    ₪{totalGoodsBudget.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
