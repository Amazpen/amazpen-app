import { createClient as createServerClient } from "@/lib/supabase/server";
import { NextRequest } from "next/server";
import { z } from "zod";

const expenseSchema = z.object({
  actionType: z.literal("expense"),
  businessId: z.string().uuid(),
  supplier_id: z.string().uuid(),
  invoice_date: z.string(),
  subtotal: z.number().positive(),
  vat_amount: z.number().nonnegative(),
  total_amount: z.number().positive(),
  invoice_number: z.string().optional(),
  invoice_type: z.string().optional(),
  notes: z.string().optional(),
});

const paymentSchema = z.object({
  actionType: z.literal("payment"),
  businessId: z.string().uuid(),
  supplier_id: z.string().uuid(),
  payment_date: z.string(),
  total_amount: z.number().positive(),
  payment_method: z.enum(["cash", "check", "bank_transfer", "credit_card", "bit", "paybox", "other"]),
  check_number: z.string().optional(),
  reference_number: z.string().optional(),
  notes: z.string().optional(),
});

const dailyEntrySchema = z.object({
  actionType: z.literal("daily_entry"),
  businessId: z.string().uuid(),
  entry_date: z.string(),
  total_register: z.number().nonnegative(),
  labor_cost: z.number().nonnegative().optional(),
  labor_hours: z.number().nonnegative().optional(),
  discounts: z.number().nonnegative().optional(),
  notes: z.string().optional(),
});

function json(data: Record<string, unknown>, status = 200) {
  return Response.json(data, { status });
}

export async function POST(request: NextRequest) {
  // 1. Authenticate
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return json({ error: "לא מחובר" }, 401);
  }

  // 2. Parse body
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "בקשה לא תקינה" }, 400);
  }

  const actionType = body.actionType as string;
  if (!["expense", "payment", "daily_entry"].includes(actionType)) {
    return json({ error: "סוג פעולה לא חוקי" }, 400);
  }

  // 3. Validate
  let validated;
  try {
    if (actionType === "expense") validated = expenseSchema.parse(body);
    else if (actionType === "payment") validated = paymentSchema.parse(body);
    else validated = dailyEntrySchema.parse(body);
  } catch (e) {
    return json({
      error: "נתונים חסרים או לא תקינים",
      details: e instanceof z.ZodError ? e.issues : undefined,
    }, 400);
  }

  const businessId = validated.businessId;

  // 4. Authorize — check business membership
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();

  const isAdmin = profile?.is_admin === true;

  if (!isAdmin) {
    const { data: membership } = await supabase
      .from("business_members")
      .select("id")
      .eq("user_id", user.id)
      .eq("business_id", businessId)
      .is("deleted_at", null)
      .maybeSingle();

    if (!membership) {
      return json({ error: "אין הרשאה לעסק זה" }, 403);
    }
  }

  // 5. Execute
  try {
    if (actionType === "expense") {
      const d = validated as z.infer<typeof expenseSchema>;
      const { data: invoice, error } = await supabase
        .from("invoices")
        .insert({
          business_id: d.businessId,
          supplier_id: d.supplier_id,
          invoice_date: d.invoice_date,
          invoice_number: d.invoice_number || null,
          subtotal: d.subtotal,
          vat_amount: d.vat_amount,
          total_amount: d.total_amount,
          invoice_type: d.invoice_type || "current",
          status: "pending",
          notes: d.notes || null,
          created_by: user.id,
        })
        .select("id")
        .single();

      if (error) throw error;
      return json({ success: true, message: "חשבונית נוצרה בהצלחה", recordId: invoice.id, actionType: "expense" });
    }

    if (actionType === "payment") {
      const d = validated as z.infer<typeof paymentSchema>;
      const { data: payment, error: payErr } = await supabase
        .from("payments")
        .insert({
          business_id: d.businessId,
          supplier_id: d.supplier_id,
          payment_date: d.payment_date,
          total_amount: d.total_amount,
          notes: d.notes || null,
          created_by: user.id,
        })
        .select("id")
        .single();

      if (payErr) throw payErr;

      await supabase.from("payment_splits").insert({
        payment_id: payment.id,
        payment_method: d.payment_method,
        amount: d.total_amount,
        check_number: d.check_number || null,
        reference_number: d.reference_number || null,
      });

      return json({ success: true, message: "תשלום נוצר בהצלחה", recordId: payment.id, actionType: "payment" });
    }

    // daily_entry
    const d = validated as z.infer<typeof dailyEntrySchema>;

    // Check duplicate
    const { data: existing } = await supabase
      .from("daily_entries")
      .select("id")
      .eq("business_id", d.businessId)
      .eq("entry_date", d.entry_date)
      .is("deleted_at", null)
      .maybeSingle();

    if (existing) {
      return json({ error: "כבר קיים רישום יומי לתאריך זה" }, 409);
    }

    const { data: entry, error } = await supabase
      .from("daily_entries")
      .insert({
        business_id: d.businessId,
        entry_date: d.entry_date,
        total_register: d.total_register,
        labor_cost: d.labor_cost || 0,
        labor_hours: d.labor_hours || 0,
        discounts: d.discounts || 0,
        notes: d.notes || null,
        created_by: user.id,
      })
      .select("id")
      .single();

    if (error) throw error;
    return json({ success: true, message: "רישום יומי נוצר בהצלחה", recordId: entry.id, actionType: "daily_entry" });

  } catch (err) {
    console.error("[AI Actions] Error:", err);
    return json({
      error: "שגיאה ביצירת הרשומה",
      details: err instanceof Error ? err.message : undefined,
    }, 500);
  }
}
