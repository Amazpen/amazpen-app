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

// Returns the existing close row + its generated lines (for the edit form).
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const business_id = searchParams.get("business_id");
    const year = Number(searchParams.get("year"));
    const month = Number(searchParams.get("month"));

    if (!business_id || !year || !month) {
      return NextResponse.json({ error: "business_id, year, month are required" }, { status: 400 });
    }

    const userId = await assertMember(business_id);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: closeRow } = await supabase
      .from("labor_month_close")
      .select("id, status, notes, estimate_total, actual_total")
      .eq("business_id", business_id)
      .eq("period_year", year)
      .eq("period_month", month)
      .maybeSingle();

    if (!closeRow) return NextResponse.json({ close: null, lines: [] });

    const { data: invoices } = await supabase
      .from("invoices")
      .select("supplier_id, total_amount, supplier:suppliers(name, system_kind)")
      .eq("labor_close_id", closeRow.id);

    const lines = (invoices || []).map((inv) => {
      const supplier = inv.supplier as unknown as { name: string | null; system_kind: string | null } | null;
      return {
        supplier_id: (inv as unknown as { supplier_id: string }).supplier_id,
        amount: Number((inv as unknown as { total_amount: number }).total_amount),
        name: supplier?.name || "",
        is_salary: supplier?.system_kind === "labor_salary",
      };
    });

    return NextResponse.json({ close: closeRow, lines });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}

// Updates the free-text notes on an existing close row.
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

    const { business_id, year, month, notes } = body as {
      business_id: string; year: number; month: number; notes: string;
    };
    if (!business_id || !year || !month) {
      return NextResponse.json({ error: "business_id, year, month are required" }, { status: 400 });
    }

    const userId = await assertMember(business_id);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { error: updErr } = await supabase
      .from("labor_month_close")
      .update({ notes: notes ?? null, updated_at: new Date().toISOString() })
      .eq("business_id", business_id)
      .eq("period_year", year)
      .eq("period_month", month);

    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
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

    // 0. If a close already exists (editing a closed month), remove its old
    // invoices first so we don't create duplicates. Block when any is paid.
    const { data: existingClose } = await supabase
      .from("labor_month_close")
      .select("id")
      .eq("business_id", business_id)
      .eq("period_year", year)
      .eq("period_month", month)
      .maybeSingle();

    if (existingClose) {
      const { data: oldInvoices } = await supabase
        .from("invoices")
        .select("id")
        .eq("labor_close_id", existingClose.id);
      const oldIds = (oldInvoices || []).map((i) => i.id);
      if (oldIds.length > 0) {
        const { data: links } = await supabase
          .from("payment_invoice_links")
          .select("invoice_id")
          .in("invoice_id", oldIds)
          .limit(1);
        if (links && links.length > 0) {
          return NextResponse.json(
            { error: "יש תשלום מקושר לאחת מחשבוניות הסגירה. בטל קודם את התשלום ואז ערוך." },
            { status: 409 }
          );
        }
        const { error: delErr } = await supabase.from("invoices").delete().in("id", oldIds);
        if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
      }
    }

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

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const business_id = searchParams.get("business_id");
    const year = Number(searchParams.get("year"));
    const month = Number(searchParams.get("month"));

    if (!business_id || !year || !month) {
      return NextResponse.json({ error: "business_id, year, month are required" }, { status: 400 });
    }

    const userId = await assertMember(business_id);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: closeRow } = await supabase
      .from("labor_month_close")
      .select("id")
      .eq("business_id", business_id)
      .eq("period_year", year)
      .eq("period_month", month)
      .eq("status", "closed")
      .maybeSingle();

    if (!closeRow) return NextResponse.json({ error: "No closed month found" }, { status: 404 });

    // Invoices generated by this close.
    const { data: closeInvoices } = await supabase
      .from("invoices")
      .select("id")
      .eq("labor_close_id", closeRow.id);

    const invoiceIds = (closeInvoices || []).map((i) => i.id);

    // Block reopen if any generated invoice already has a linked payment.
    if (invoiceIds.length > 0) {
      const { data: links } = await supabase
        .from("payment_invoice_links")
        .select("invoice_id")
        .in("invoice_id", invoiceIds)
        .limit(1);
      if (links && links.length > 0) {
        return NextResponse.json(
          { error: "יש תשלום מקושר לאחת מחשבוניות הסגירה. בטל קודם את התשלום ואז פתח מחדש." },
          { status: 409 }
        );
      }
    }

    if (invoiceIds.length > 0) {
      const { error: delErr } = await supabase.from("invoices").delete().in("id", invoiceIds);
      if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
    }

    const { error: updErr } = await supabase
      .from("labor_month_close")
      .update({ status: "reopened", reopened_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", closeRow.id);

    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, deleted: invoiceIds.length });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
