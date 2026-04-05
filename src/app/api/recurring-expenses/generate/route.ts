import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Map supplier expense_type to invoice invoice_type
function mapExpenseType(expenseType: string): string {
  switch (expenseType) {
    case "current_expenses": return "current";
    case "goods_purchases": return "goods";
    case "employee_costs": return "employees";
    default: return "current";
  }
}

// Calculate VAT amount based on supplier vat_type
function calculateVat(subtotal: number, vatType: string): number {
  switch (vatType) {
    case "full": return subtotal * 0.18;
    case "none": return 0;
    default: return 0;
  }
}

export async function POST(request: NextRequest) {
  try {
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body", created: 0 }, { status: 400 });
    }
    const { business_id, year, month } = body;

    if (!business_id || !year || !month) {
      return NextResponse.json(
        { error: "business_id, year, and month are required" },
        { status: 400 }
      );
    }

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("recurring-expenses: Missing env vars", { supabaseUrl: !!supabaseUrl, supabaseServiceKey: !!supabaseServiceKey });
      return NextResponse.json({ error: "Missing Supabase configuration", created: 0 }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check if business is active
    const { data: businessData, error: bizError } = await supabase
      .from("businesses")
      .select("status")
      .eq("id", business_id)
      .maybeSingle();

    if (bizError) {
      console.error("recurring-expenses: bizError", bizError.message, { business_id });
      return NextResponse.json({ error: bizError.message, created: 0 }, { status: 500 });
    }

    if (!businessData || businessData.status !== "active") {
      return NextResponse.json({ message: "Business is inactive or not found", created: 0 });
    }

    // 1. Get all active fixed-expense suppliers for this business (excluding previous obligations)
    const { data: fixedSuppliers, error: suppliersError } = await supabase
      .from("suppliers")
      .select("id, name, monthly_expense_amount, charge_day, vat_type, expense_type")
      .eq("business_id", business_id)
      .eq("is_fixed_expense", true)
      .eq("is_active", true)
      .eq("has_previous_obligations", false)
      .is("deleted_at", null);

    if (suppliersError) {
      console.error("recurring-expenses: suppliersError", suppliersError.message, { business_id });
      return NextResponse.json({ message: "Error fetching suppliers", created: 0 });
    }

    // 2. Check budget overrides FIRST (before filtering by amount)
    const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const monthEnd = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

    const allSupplierIds = (fixedSuppliers || []).map((s) => s.id);

    const { data: budgets } = allSupplierIds.length > 0
      ? await supabase
          .from("supplier_budgets")
          .select("supplier_id, budget_amount")
          .eq("business_id", business_id)
          .eq("year", year)
          .eq("month", month)
          .in("supplier_id", allSupplierIds)
      : { data: [] };

    const budgetMap = new Map(
      (budgets || []).map((b) => [b.supplier_id, b.budget_amount])
    );

    // Filter suppliers that have either monthly_expense_amount OR a budget for this month
    const suppliersWithAmount = (fixedSuppliers || []).filter((s) => {
      const hasMonthly = s.monthly_expense_amount && parseFloat(s.monthly_expense_amount) > 0;
      const hasBudget = budgetMap.has(s.id) && budgetMap.get(s.id) > 0;
      return hasMonthly || hasBudget;
    });

    if (suppliersWithAmount.length === 0) {
      return NextResponse.json({ message: "No fixed expense suppliers with amounts found", created: 0 });
    }

    // Check which suppliers already have invoices for this month
    const { data: existingInvoices } = await supabase
      .from("invoices")
      .select("supplier_id")
      .eq("business_id", business_id)
      .is("deleted_at", null)
      .gte("invoice_date", monthStart)
      .lte("invoice_date", monthEnd)
      .in(
        "supplier_id",
        suppliersWithAmount.map((s) => s.id)
      );

    const existingSupplierIds = new Set(
      (existingInvoices || []).map((inv) => inv.supplier_id)
    );

    // 3. Create invoices for suppliers that don't have one yet
    const invoicesToCreate = suppliersWithAmount
      .filter((s) => !existingSupplierIds.has(s.id))
      .map((s) => {
        // Use budget amount if exists, otherwise use supplier default
        const budgetAmount = budgetMap.get(s.id);
        const subtotal = budgetAmount && budgetAmount > 0 ? budgetAmount : parseFloat(s.monthly_expense_amount);
        const vatAmount = calculateVat(subtotal, s.vat_type || "none");
        const totalAmount = subtotal + vatAmount;
        const chargeDay = s.charge_day || 1;
        // Ensure charge day doesn't exceed days in month
        const adjustedDay = Math.min(chargeDay, lastDay);
        const invoiceDate = `${year}-${String(month).padStart(2, "0")}-${String(adjustedDay).padStart(2, "0")}`;

        return {
          business_id,
          supplier_id: s.id,
          invoice_date: invoiceDate,
          reference_date: invoiceDate,
          subtotal,
          vat_amount: vatAmount,
          total_amount: totalAmount,
          status: "pending",
          invoice_type: mapExpenseType(s.expense_type),
          notes: "הוצאה קבועה - נוצרה אוטומטית",
        };
      });

    if (invoicesToCreate.length === 0) {
      return NextResponse.json({
        message: "All fixed expense invoices already exist for this month",
        created: 0,
      });
    }

    const { data: createdInvoices, error: insertError } = await supabase
      .from("invoices")
      .insert(invoicesToCreate)
      .select("id, supplier_id");

    if (insertError) {
      console.error("recurring-expenses: insertError", insertError.message, { business_id, invoicesToCreate: invoicesToCreate.length });
      return NextResponse.json({ message: insertError.message, created: 0 });
    }

    return NextResponse.json({
      message: `Created ${createdInvoices?.length || 0} recurring expense invoices`,
      created: createdInvoices?.length || 0,
      invoices: createdInvoices,
    });
  } catch (error) {
    console.error("recurring-expenses: unexpected error", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Internal server error", created: 0 },
      { status: 200 }
    );
  }
}
