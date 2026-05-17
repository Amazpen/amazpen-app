"use client";

import { useState, useEffect } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";

interface QuickAddSupplierModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  businessId: string;
  /**
   * If the OCR identified a supplier name on the document, prefill it so the
   * admin doesn't have to retype it. Same for the tax id when available.
   */
  initialName?: string;
  initialTaxId?: string;
  /**
   * Fires after a successful insert with the new supplier's id, so the
   * caller can refresh its supplier list and auto-select the new row.
   */
  onCreated: (supplierId: string) => void;
}

type ExpenseType = "current" | "goods" | "employees";
type VatRequired = "yes" | "no" | "partial";
type PaymentMethod = "" | "credit" | "bank_transfer" | "cash" | "check" | "direct_debit";

type ParentCategory = { id: string; name: string; business_id: string };
// Child categories live in the SAME expense_categories table as parents — the
// parent/child link is the `parent_id` column on each row, not a separate
// `parent_categories` table. (The old code mistakenly hit a non-existent
// table + wrong column, so both dropdowns came back empty.)
type Category = { id: string; name: string; business_id: string; parent_id: string | null };
type CreditCard = { id: string; card_name: string };

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "", label: "ללא ברירת מחדל" },
  { value: "credit", label: "אשראי" },
  { value: "bank_transfer", label: "העברה בנקאית" },
  { value: "cash", label: "מזומן" },
  { value: "check", label: "צ׳ק" },
  { value: "direct_debit", label: "הוראת קבע" },
];

const EXPENSE_TO_DB: Record<ExpenseType, string> = {
  current: "current_expenses",
  goods: "goods_purchases",
  employees: "employee_costs",
};

const VAT_TO_DB: Record<VatRequired, string> = {
  yes: "full",
  no: "none",
  partial: "partial",
};

/**
 * Quick add-supplier sheet for the OCR queue. Mirrors the field set of the
 * full editor on /suppliers (name, expense type, parent + child category,
 * payment terms, vat, fixed expense + charge day + monthly amount,
 * default payment method + credit card, request-karteset, contact info,
 * notes) so admins don't have to leave the OCR flow and then go fix the
 * supplier later. Skips the rare "previous obligations" branch — if that's
 * needed the user opens /suppliers.
 */
export default function QuickAddSupplierModal({
  open,
  onOpenChange,
  businessId,
  initialName,
  initialTaxId,
  onCreated,
}: QuickAddSupplierModalProps) {
  // Core
  const [name, setName] = useState("");
  const [taxId, setTaxId] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [requestKarteset, setRequestKarteset] = useState(false);
  const [waitingForCoordinator, setWaitingForCoordinator] = useState(false);
  const [isFixedExpense, setIsFixedExpense] = useState(false);
  const [expenseType, setExpenseType] = useState<ExpenseType>("goods");
  const [vatRequired, setVatRequired] = useState<VatRequired>("yes");

  // Categories
  const [parentCategoryId, setParentCategoryId] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [parentCategories, setParentCategories] = useState<ParentCategory[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);

  // Terms / fixed expense
  const [paymentTermsDays, setPaymentTermsDays] = useState<string>("30");
  const [chargeDay, setChargeDay] = useState<string>("");
  const [monthlyExpenseAmount, setMonthlyExpenseAmount] = useState<string>("");

  // Default payment
  const [defaultPaymentMethod, setDefaultPaymentMethod] = useState<PaymentMethod>("");
  const [defaultCreditCardId, setDefaultCreditCardId] = useState<string>("");
  const [creditCards, setCreditCards] = useState<CreditCard[]>([]);

  // Discount + notes
  const [defaultDiscountPct, setDefaultDiscountPct] = useState<string>("");
  const [notes, setNotes] = useState("");

  // UI
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refresh prefilled fields whenever the modal opens with new OCR data —
  // otherwise stale values from a previous open stick around when the
  // admin clicks "+" on a different document.
  useEffect(() => {
    if (!open) return;
    setName(initialName?.trim() || "");
    setTaxId(initialTaxId?.trim() || "");
    setEmail("");
    setPhone("");
    setRequestKarteset(false);
    setWaitingForCoordinator(false);
    setIsFixedExpense(false);
    setExpenseType("goods");
    setVatRequired("yes");
    setParentCategoryId("");
    setCategoryId("");
    setPaymentTermsDays("30");
    setChargeDay("");
    setMonthlyExpenseAmount("");
    setDefaultPaymentMethod("");
    setDefaultCreditCardId("");
    setDefaultDiscountPct("");
    setNotes("");
    setError(null);
  }, [open, initialName, initialTaxId]);

  // Fetch categories + credit cards once we have a business.
  // Parents and children both live in expense_categories — rows with
  // parent_id IS NULL are parent categories, everything else is a child.
  // (Matches /suppliers exactly so the dropdowns show the same lists.)
  useEffect(() => {
    if (!open || !businessId) return;
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const [catRes, ccRes] = await Promise.all([
        supabase
          .from("expense_categories")
          .select("id, name, business_id, parent_id")
          .eq("business_id", businessId)
          .is("deleted_at", null)
          .eq("is_active", true)
          .order("display_order", { ascending: true, nullsFirst: false })
          .order("name", { ascending: true }),
        supabase.from("business_credit_cards").select("id, card_name").eq("business_id", businessId).eq("is_active", true).order("card_name"),
      ]);
      if (cancelled) return;
      const allCats = (catRes.data as Category[]) || [];
      const parents = allCats.filter(c => !c.parent_id).map(c => ({ id: c.id, name: c.name, business_id: c.business_id }));
      const children = allCats.filter(c => c.parent_id);
      setParentCategories(parents);
      // If the business has flat categories (no parents/children split), still
      // show them in the "category" dropdown — that's how /suppliers handles it.
      setCategories(children.length > 0 ? children : allCats);
      setCreditCards((ccRes.data as CreditCard[]) || []);
    })();
    return () => { cancelled = true; };
  }, [open, businessId]);

  // Filter child categories to the selected parent (matching /suppliers behavior)
  const filteredCategories = parentCategoryId
    ? categories.filter(c => c.parent_id === parentCategoryId)
    : categories;

  const handleSave = async () => {
    setError(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("נא למלא שם ספק");
      return;
    }
    if (!businessId) {
      setError("לא נבחר עסק — בחרו עסק מהתפריט בראש הדף לפני הוספת ספק");
      return;
    }
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("כתובת מייל לא תקינה");
      return;
    }
    setIsSaving(true);
    try {
      const supabase = createClient();

      // Duplicate guard — case/trim insensitive match in the same business.
      const { data: existingMatches } = await supabase
        .from("suppliers")
        .select("id, name")
        .eq("business_id", businessId)
        .is("deleted_at", null)
        .ilike("name", trimmedName);
      if (existingMatches && existingMatches.length > 0) {
        const proceed = window.confirm(`ספק בשם "${trimmedName}" כבר קיים בעסק זה. ליצור ספק נוסף באותו שם?`);
        if (!proceed) {
          setIsSaving(false);
          return;
        }
      }

      // Auto-assign parent category if user didn't pick one (mirror /suppliers)
      let resolvedParentCategory: string | null = parentCategoryId || null;
      if (!resolvedParentCategory && parentCategories.length > 0) {
        if (expenseType === "goods") {
          resolvedParentCategory = parentCategories.find(p => p.name === "עלות מכר")?.id || null;
        } else if (expenseType === "employees") {
          resolvedParentCategory = parentCategories.find(p => p.name === "עלויות עובדים" || p.name === "עלות עובדים")?.id || null;
        }
      }

      const discountPctNum = parseFloat(defaultDiscountPct);

      const insertRow: Record<string, unknown> = {
        business_id: businessId,
        name: trimmedName,
        expense_type: EXPENSE_TO_DB[expenseType],
        expense_category_id: categoryId || null,
        parent_category_id: resolvedParentCategory,
        payment_terms_days: paymentTermsDays ? parseInt(paymentTermsDays, 10) : 30,
        vat_type: VAT_TO_DB[vatRequired],
        requires_vat: vatRequired !== "no",
        is_fixed_expense: isFixedExpense,
        charge_day: chargeDay ? parseInt(chargeDay, 10) : null,
        monthly_expense_amount: monthlyExpenseAmount ? parseFloat(monthlyExpenseAmount) : null,
        default_payment_method: defaultPaymentMethod || null,
        default_credit_card_id: defaultPaymentMethod === "credit" && defaultCreditCardId ? defaultCreditCardId : null,
        default_discount_percentage: !Number.isNaN(discountPctNum) && discountPctNum > 0 ? discountPctNum : 0,
        waiting_for_coordinator: waitingForCoordinator,
        request_karteset: requestKarteset,
        notes: notes.trim() || null,
        is_active: true,
      };
      if (taxId.trim()) insertRow.tax_id = taxId.trim();
      if (phone.trim()) insertRow.phone = phone.trim();
      if (email.trim()) insertRow.email = email.trim();

      const { data, error: insertError } = await supabase
        .from("suppliers")
        .insert(insertRow)
        .select("id")
        .single();

      if (insertError) {
        console.error("[QuickAddSupplier] insert failed:", insertError);
        setError(`שגיאה בהוספת ספק: ${insertError.message}`);
        setIsSaving(false);
        return;
      }
      if (!data?.id) {
        setError("הוספה הצליחה אבל לא הוחזר מזהה — נסו לרענן");
        setIsSaving(false);
        return;
      }
      onCreated(data.id);
      onOpenChange(false);
    } catch (err) {
      console.error("[QuickAddSupplier] unexpected error:", err);
      const msg = err instanceof Error ? err.message : "שגיאה לא ידועה";
      setError(msg);
    } finally {
      setIsSaving(false);
    }
  };

  // Reusable row check for the toggle-style checkboxes
  const Check = ({ checked }: { checked: boolean }) => (
    <svg width="20" height="20" viewBox="0 0 32 32" fill="none" className="text-[#979797]">
      {checked ? (
        <>
          <rect x="4" y="4" width="24" height="24" rx="2" stroke="currentColor" strokeWidth="2" fill="currentColor"/>
          <path d="M10 16L14 20L22 12" stroke="#0F1535" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </>
      ) : (
        <rect x="4" y="4" width="24" height="24" rx="2" stroke="currentColor" strokeWidth="2"/>
      )}
    </svg>
  );

  // Reusable radio
  const Radio = ({ active }: { active: boolean }) => (
    <svg width="16" height="16" viewBox="0 0 32 32" fill="none" className={active ? "text-white" : "text-[#979797]"}>
      {active ? (
        <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="2" fill="currentColor"/>
      ) : (
        <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="2"/>
      )}
    </svg>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="bg-[#0F1535] border-t border-white/10 max-h-[92vh] overflow-y-auto"
      >
        <SheetHeader className="text-right">
          <SheetTitle className="text-white text-[18px] font-bold">הוספת ספק חדש</SheetTitle>
        </SheetHeader>

        <div dir="rtl" className="flex flex-col gap-[10px] px-[5px] mt-[12px]">
          {/* Name */}
          <div className="flex flex-col gap-[5px]">
            <label className="text-[15px] font-medium text-white text-right">שם הספק</label>
            <div className="border border-[#4C526B] rounded-[10px] h-[50px]">
              <Input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="לדוגמה: מאפיית אבי"
                className="w-full h-full bg-transparent text-white text-[14px] text-center rounded-[10px] border-none outline-none px-[10px]"
              />
            </div>
          </div>

          {/* Tax ID */}
          <div className="flex flex-col gap-[5px]">
            <label className="text-[15px] font-medium text-white text-right">ח.פ / עוסק מורשה</label>
            <div className="border border-[#4C526B] rounded-[10px] h-[50px]">
              <Input
                type="text"
                dir="ltr"
                value={taxId}
                onChange={(e) => setTaxId(e.target.value)}
                placeholder="9 ספרות"
                className="w-full h-full bg-transparent text-white text-[14px] text-center rounded-[10px] border-none outline-none px-[10px]"
              />
            </div>
          </div>

          {/* Email */}
          <div className="flex flex-col gap-[5px]">
            <label className="text-[15px] font-medium text-white text-right">כתובת מייל</label>
            <div className="border border-[#4C526B] rounded-[10px] h-[50px]">
              <Input
                type="email"
                dir="ltr"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="example@email.com"
                className="w-full h-full bg-transparent text-white text-[14px] text-center rounded-[10px] border-none outline-none px-[10px]"
              />
            </div>
          </div>

          {/* Karteset toggle (only when email present) */}
          {email.trim() && (
            <div className="flex items-center justify-between px-[5px]">
              <label className="text-[14px] font-medium text-white">שלח בקשת כרטסת כל 2 לחודש</label>
              <button
                type="button"
                onClick={() => setRequestKarteset(!requestKarteset)}
                className={`w-[44px] h-[24px] rounded-full transition-colors duration-200 flex items-center ${requestKarteset ? "bg-[#0BB783]" : "bg-[#4C526B]"}`}
              >
                <div className={`w-[20px] h-[20px] bg-white rounded-full transition-transform duration-200 mx-[2px] ${requestKarteset ? "mr-auto" : "ml-auto"}`} />
              </button>
            </div>
          )}

          {/* Phone */}
          <div className="flex flex-col gap-[5px]">
            <label className="text-[15px] font-medium text-white text-right">טלפון</label>
            <div className="border border-[#4C526B] rounded-[10px] h-[50px]">
              <Input
                type="tel"
                dir="ltr"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="050-0000000"
                className="w-full h-full bg-transparent text-white text-[14px] text-center rounded-[10px] border-none outline-none px-[10px]"
              />
            </div>
          </div>

          {/* Toggles row — waiting for coordinator + fixed expense */}
          <div className="flex flex-col gap-[10px] items-start" dir="rtl">
            <Button type="button" onClick={() => setWaitingForCoordinator(!waitingForCoordinator)} className="flex items-center gap-[3px]">
              <Check checked={waitingForCoordinator} />
              <span className="text-[15px] font-semibold text-[#979797]">ממתין למרכזת</span>
            </Button>
            <Button type="button" onClick={() => setIsFixedExpense(!isFixedExpense)} className="flex items-center gap-[3px]">
              <Check checked={isFixedExpense} />
              <span className="text-[15px] font-semibold text-[#979797]">הוצאה קבועה</span>
            </Button>
          </div>

          {/* Expense type — radios */}
          <div className="flex flex-col gap-[5px]">
            <label className="text-[15px] font-medium text-white text-right">סוג הוצאה</label>
            <div className="flex items-center justify-start gap-[20px]" dir="rtl">
              <Button type="button" onClick={() => setExpenseType("current")} className="flex items-center gap-[3px]">
                <Radio active={expenseType === "current"} />
                <span className={`text-[15px] font-semibold ${expenseType === "current" ? "text-white" : "text-[#979797]"}`}>הוצאות שוטפות</span>
              </Button>
              <Button type="button" onClick={() => setExpenseType("goods")} className="flex items-center gap-[3px]">
                <Radio active={expenseType === "goods"} />
                <span className={`text-[15px] font-semibold ${expenseType === "goods" ? "text-white" : "text-[#979797]"}`}>קניות סחורה</span>
              </Button>
              <Button type="button" onClick={() => setExpenseType("employees")} className="flex items-center gap-[3px]">
                <Radio active={expenseType === "employees"} />
                <span className={`text-[15px] font-semibold ${expenseType === "employees" ? "text-white" : "text-[#979797]"}`}>עלות עובדים</span>
              </Button>
            </div>
          </div>

          {/* Parent category */}
          <div className="flex flex-col gap-[5px]">
            <label className="text-[15px] font-medium text-white text-right">קטגוריית אב</label>
            <Select value={parentCategoryId || "__none__"} onValueChange={(v) => { setParentCategoryId(v === "__none__" ? "" : v); setCategoryId(""); }}>
              <SelectTrigger className="w-full bg-transparent border border-[#4C526B] rounded-[10px] h-[50px] px-[12px] text-[14px] text-white text-right">
                <SelectValue placeholder="בחר קטגוריית אב" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">בחר קטגוריית אב</SelectItem>
                {parentCategories.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Category — children are scoped to the selected parent so the
              user can't accidentally tag a "עלות מכר" supplier with a
              "הוצאות שוטפות" subcategory (matches /suppliers form). */}
          <div className="flex flex-col gap-[5px]">
            <label className="text-[15px] font-medium text-white text-right">קטגוריה</label>
            <Select value={categoryId || "__none__"} onValueChange={(v) => setCategoryId(v === "__none__" ? "" : v)}>
              <SelectTrigger className="w-full bg-transparent border border-[#4C526B] rounded-[10px] h-[50px] px-[12px] text-[14px] text-white text-right">
                <SelectValue placeholder={parentCategoryId ? "בחר קטגוריה" : "יש לבחור קטגוריית אב תחילה"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{parentCategoryId ? "בחר קטגוריה" : "יש לבחור קטגוריית אב תחילה"}</SelectItem>
                {filteredCategories.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Payment terms */}
          <div className="flex flex-col gap-[5px]">
            <label className="text-[15px] font-medium text-white text-right">תנאי תשלום (שוטף +)</label>
            <div className="border border-[#4C526B] rounded-[10px] h-[50px]">
              <Input
                type="tel"
                value={paymentTermsDays}
                onChange={(e) => setPaymentTermsDays(e.target.value)}
                placeholder="30"
                className="w-full h-full bg-transparent text-white text-[14px] text-center rounded-[10px] border-none outline-none px-[10px]"
              />
            </div>
          </div>

          {/* Fixed-expense extras */}
          {isFixedExpense && (
            <div className="flex flex-col gap-[10px] p-[10px] bg-[#29318A]/20 rounded-[10px] border border-[#4C526B]">
              <p className="text-[14px] font-bold text-white text-right">פרטי הוצאה קבועה</p>
              <div className="flex flex-col gap-[5px]">
                <label className="text-[14px] font-medium text-white/80 text-right">יום חיוב חודשי</label>
                <div className="border border-[#4C526B] rounded-[10px] h-[45px]">
                  <Input
                    type="tel"
                    value={chargeDay}
                    onChange={(e) => setChargeDay(e.target.value)}
                    placeholder="1-31"
                    className="w-full h-full bg-transparent text-white text-[14px] text-center rounded-[10px] border-none outline-none px-[10px] placeholder:text-white/30"
                  />
                </div>
              </div>
              <div className="flex flex-col gap-[5px]">
                <label className="text-[14px] font-medium text-white/80 text-right">סכום חודשי משוער</label>
                <div className="border border-[#4C526B] rounded-[10px] h-[45px]">
                  <Input
                    type="tel"
                    value={monthlyExpenseAmount}
                    onChange={(e) => setMonthlyExpenseAmount(e.target.value)}
                    placeholder="₪"
                    className="w-full h-full bg-transparent text-white text-[14px] text-center rounded-[10px] border-none outline-none px-[10px] placeholder:text-white/30"
                  />
                </div>
              </div>
            </div>
          )}

          {/* VAT — radios with all 3 options */}
          <div className="flex flex-col gap-[3px]">
            <label className="text-[15px] font-medium text-white text-right">נדרש מע&quot;מ</label>
            <div className="flex items-center justify-start gap-[20px]" dir="rtl">
              <Button type="button" onClick={() => setVatRequired("yes")} className="flex items-center gap-[3px]">
                <Radio active={vatRequired === "yes"} />
                <span className={`text-[15px] font-semibold ${vatRequired === "yes" ? "text-white" : "text-[#979797]"}`}>כן</span>
              </Button>
              <Button type="button" onClick={() => setVatRequired("no")} className="flex items-center gap-[3px]">
                <Radio active={vatRequired === "no"} />
                <span className={`text-[15px] font-semibold ${vatRequired === "no" ? "text-white" : "text-[#979797]"}`}>לא</span>
              </Button>
              <Button type="button" onClick={() => setVatRequired("partial")} className="flex items-center gap-[3px]">
                <Radio active={vatRequired === "partial"} />
                <span className={`text-[15px] font-semibold ${vatRequired === "partial" ? "text-white" : "text-[#979797]"}`}>חלקי</span>
              </Button>
            </div>
          </div>

          {/* Default payment method */}
          <div className="flex flex-col gap-[5px]">
            <label className="text-[15px] font-medium text-white text-right">אמצעי תשלום ברירת מחדל</label>
            <Select value={defaultPaymentMethod || "__none__"} onValueChange={(v) => setDefaultPaymentMethod((v === "__none__" ? "" : v) as PaymentMethod)}>
              <SelectTrigger className="w-full bg-transparent border border-[#4C526B] rounded-[10px] h-[50px] px-[12px] text-[14px] text-white text-right">
                <SelectValue placeholder="בחר אמצעי תשלום" />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((m) => (
                  <SelectItem key={m.value || "__none__"} value={m.value || "__none__"}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Credit card picker — only when payment method is credit */}
          {defaultPaymentMethod === "credit" && creditCards.length > 0 && (
            <div className="flex flex-col gap-[5px]">
              <label className="text-[15px] font-medium text-white text-right">כרטיס אשראי</label>
              <Select value={defaultCreditCardId || "__none__"} onValueChange={(v) => setDefaultCreditCardId(v === "__none__" ? "" : v)}>
                <SelectTrigger className="w-full bg-transparent border border-[#4C526B] rounded-[10px] h-[50px] px-[12px] text-[14px] text-white text-right">
                  <SelectValue placeholder="בחר כרטיס" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">ללא ברירת מחדל</SelectItem>
                  {creditCards.map((cc) => (
                    <SelectItem key={cc.id} value={cc.id}>{cc.card_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Default discount */}
          <div className="flex flex-col gap-[5px]">
            <label className="text-[15px] font-medium text-white text-right">אחוז הנחה ברירת מחדל</label>
            <div className="border border-[#4C526B] rounded-[10px] h-[50px] flex items-center">
              <span className="text-white/50 text-[14px] pr-[10px]">%</span>
              <Input
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={defaultDiscountPct}
                onChange={(e) => setDefaultDiscountPct(e.target.value)}
                placeholder="0"
                className="w-full h-full bg-transparent text-white text-[14px] text-center rounded-[10px] border-none outline-none px-[10px] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
          </div>

          {/* Notes */}
          <div className="flex flex-col gap-[5px]">
            <label className="text-[15px] font-medium text-white text-right">הערות</label>
            <div className="border border-[#4C526B] rounded-[10px] min-h-[80px] px-[10px] py-[8px]">
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="(אופציונלי)"
                className="w-full h-full min-h-[64px] bg-transparent text-white text-[14px] text-right rounded-[10px] border-none outline-none resize-none placeholder:text-white/30"
              />
            </div>
          </div>

          {error && (
            <div className="bg-[#F64E60]/10 border border-[#F64E60]/40 text-[#F64E60] text-[12px] rounded-[8px] px-[12px] py-[8px] text-right">
              {error}
            </div>
          )}

          <div className="flex gap-[10px] mt-[8px] mb-[8px]">
            <Button
              type="button"
              onClick={handleSave}
              disabled={isSaving || !name.trim()}
              className="flex-1 h-[50px] bg-[#29318A] hover:bg-[#3D44A0] text-white text-[16px] font-semibold rounded-[10px] disabled:opacity-50"
            >
              {isSaving ? "שומר…" : "שמור ספק"}
            </Button>
            <Button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
              className="flex-1 h-[50px] bg-transparent border border-[#4C526B] text-white text-[16px] rounded-[10px] hover:bg-white/10"
            >
              ביטול
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
