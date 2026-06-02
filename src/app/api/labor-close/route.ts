import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

interface CloseLine {
  supplier_id: string;
  amount: number;
  due_date?: string | null;
}

// Verify the logged-in user is a member (or admin) of the business.
async function assertMember(business_id: string): Promise<string | null> {
  const ssr = await createServerClient();
  const { data: { user } } = await ssr.auth.getUser();
  if (!user) return null;
  const { data: profile } = await ssr
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  const isAdmin = profile?.is_admin === true;
  const { data: membership } = await ssr
    .from("business_members")
    .select("business_id")
    .eq("business_id", business_id)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!membership && !isAdmin) return null;
  return user.id;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

    const { business_id, year, month, lines, estimate_total } = body as {
      business_id: string; year: number; month: number;
      lines: CloseLine[]; estimate_total?: number;
    };

    if (!business_id || !year || !month || !Array.isArray(lines)) {
      return NextResponse.json({ error: "business_id, year, month, lines are required" }, { status: 400 });
    }

    const userId = await assertMember(business_id);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "Missing Supabase configuration" }, { status: 500 });
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const validLines = lines.filter((l) => l.supplier_id && Number(l.amount) > 0);
    if (validLines.length === 0) {
      return NextResponse.json({ error: "No lines with a positive amount" }, { status: 400 });
    }

    const actualTotal = validLines.reduce((s, l) => s + Number(l.amount), 0);

    // 1. Upsert the close record (re-close after reopen reuses the row).
    const { data: closeRow, error: closeErr } = await supabase
      .from("labor_month_close")
      .upsert(
        {
          business_id, period_year: year, period_month: month,
          status: "closed", estimate_total: estimate_total ?? null,
          actual_total: actualTotal, closed_at: new Date().toISOString(),
          closed_by: userId, reopened_at: null, updated_at: new Date().toISOString(),
        },
        { onConflict: "business_id,period_year,period_month" }
      )
      .select("id")
      .single();

    if (closeErr || !closeRow) {
      return NextResponse.json({ error: closeErr?.message || "Failed to create close record" }, { status: 500 });
    }

    // 2. Build the invoices (no VAT on employee costs).
    const lastDay = new Date(year, month, 0).getDate();
    const invoiceDate = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    const monthLabel = `${String(month).padStart(2, "0")}/${year}`;

    const invoicesToCreate = validLines.map((l) => ({
      business_id,
      supplier_id: l.supplier_id,
      invoice_date: invoiceDate,
      reference_date: invoiceDate,
      due_date: l.due_date || invoiceDate,
      subtotal: Number(l.amount),
      vat_amount: 0,
      total_amount: Number(l.amount),
      status: "pending",
      invoice_type: "employees",
      labor_close_id: closeRow.id,
      notes: `סגירת חודש עלות עובדים ${monthLabel}`,
    }));

    const { data: created, error: insErr } = await supabase
      .from("invoices")
      .insert(invoicesToCreate)
      .select("id");

    if (insErr) {
      // Compensate: remove the close row so the month stays open.
      await supabase.from("labor_month_close").delete().eq("id", closeRow.id);
      return NextResponse.json({ error: insErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, close_id: closeRow.id, created: created?.length || 0 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
