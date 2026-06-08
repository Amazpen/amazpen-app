"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CreditCard } from "lucide-react";
import { useDashboard } from "../../layout";
import { useToast } from "@/components/ui/toast";
import { AddBillingCustomerModal } from "@/components/dashboard/billing/AddBillingCustomerModal";
import { OneTimeChargeModal } from "@/components/dashboard/billing/OneTimeChargeModal";
import { ChargeHistoryModal } from "@/components/dashboard/billing/ChargeHistoryModal";
import type {
  BillingCustomerWithSubscription,
  SubscriptionStatus,
} from "@/types/billing";

// Same grid template for header and every row so columns align proportionally.
// RTL: first column in JSX = rightmost on screen.
// שם · טלפון · סכום חודשי · סטטוס · תאריך חיוב הבא · 4 ספרות · פעולות
const GRID_COLS = "grid-cols-[1.4fr_1fr_1fr_0.9fr_1.1fr_0.9fr_1.6fr]";

const STATUS_META: Record<SubscriptionStatus, { label: string; color: string }> = {
  pending: { label: "ממתין", color: "#9CA3AF" },
  active: { label: "פעיל", color: "#17DB4E" },
  paused: { label: "מושהה", color: "#FFA412" },
  failed: { label: "נכשל", color: "#F64E60" },
  cancelled: { label: "בוטל", color: "#6B7280" },
};

function StatusBadge({ status }: { status: SubscriptionStatus }) {
  const meta = STATUS_META[status];
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full"
      style={{ background: `${meta.color}1a`, color: meta.color }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: meta.color }} />
      {meta.label}
    </span>
  );
}

function formatNextCharge(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

export default function AdminBillingPageWrapper() {
  return (
    <Suspense fallback={<div className="text-white p-[20px] text-center">טוען...</div>}>
      <AdminBillingPage />
    </Suspense>
  );
}

function AdminBillingPage() {
  const { isAdmin } = useDashboard();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();

  const [customers, setCustomers] = useState<BillingCustomerWithSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [historyCustomer, setHistoryCustomer] = useState<{ id: string; name: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [oneTimeCustomer, setOneTimeCustomer] = useState<{ id: string; name: string; phone: string | null } | null>(null);

  // Redirect non-admins.
  useEffect(() => {
    if (!isAdmin) router.replace("/");
  }, [isAdmin, router]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/billing/customers");
      const data = await res.json();
      setCustomers((data.customers || []) as BillingCustomerWithSubscription[]);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Handle Cardcom redirect landing (?charge=<id>&status=success|failed).
  useEffect(() => {
    const charge = searchParams.get("charge");
    const status = searchParams.get("status");
    if (!charge || !status) return;
    if (status === "success") {
      showToast("החיוב בוצע בהצלחה", "success");
    } else {
      showToast("החיוב נכשל", "error");
    }
    router.replace("/admin/billing");
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const runAction = async (subId: string, action: string, confirmMsg?: string) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusyId(subId);
    try {
      const res = await fetch(`/api/billing/subscriptions/${subId}/${action}`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        showToast(data.error || "הפעולה נכשלה", "error");
      } else if (action === "charge-now") {
        showToast("החיוב בוצע בהצלחה", "success");
      }
    } catch {
      showToast("שגיאת רשת", "error");
    } finally {
      setBusyId(null);
      load();
    }
  };

  if (!isAdmin) return null;

  return (
    <div className="p-4 lg:p-6 max-w-5xl mx-auto">
      {/* Header — admin standard */}
      <div className="flex flex-col items-center gap-[10px] mb-6">
        <div className="w-[60px] h-[60px] rounded-full bg-[#4A56D4] flex items-center justify-center">
          <CreditCard className="w-[30px] h-[30px] text-white" />
        </div>
        <h1 className="text-[24px] font-bold text-white">סליקה</h1>
        <p className="text-[14px] text-white/50 text-center">ניהול לקוחות, מנויים וחיובים חוזרים</p>
      </div>

      {/* Top action */}
      <div className="flex justify-start mb-4">
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="bg-[#29318A] hover:bg-[#333da3] text-white text-[14px] font-semibold rounded-xl px-4 py-2.5 transition-colors"
        >
          + לקוח חדש
        </button>
      </div>

      {loading ? (
        <div className="space-y-2 animate-pulse">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="bg-[#111056]/40 border border-white/5 rounded-[7px] h-14" />
          ))}
        </div>
      ) : customers.length === 0 ? (
        <p className="text-white/40 text-center py-12">אין לקוחות עדיין</p>
      ) : (
        <div className="w-full flex flex-col">
          {/* Header */}
          <div
            className={`grid ${GRID_COLS} bg-[#29318A] rounded-t-[7px] p-[10px_5px] pe-[13px] items-center`}
          >
            <span className="text-[13px] font-medium text-center">שם</span>
            <span className="text-[13px] font-medium text-center">טלפון</span>
            <span className="text-[13px] font-medium text-center">סכום חודשי (נטו) (₪)</span>
            <span className="text-[13px] font-medium text-center">סטטוס</span>
            <span className="text-[13px] font-medium text-center">תאריך חיוב הבא</span>
            <span className="text-[13px] font-medium text-center">4 ספרות אחרונות</span>
            <span className="text-[13px] font-medium text-center">פעולות</span>
          </div>

          {/* Rows */}
          <div className="max-h-[450px] overflow-y-auto flex flex-col gap-[5px]">
            {customers.map((customer) => {
              const sub = customer.subscription;
              const isBusy = sub ? busyId === sub.id : false;
              const hasToken = !!sub?.cardcom_token;
              const canCharge =
                !!sub && (sub.status === "active" || sub.status === "paused") && hasToken;
              return (
                <div
                  key={customer.id}
                  className={`grid ${GRID_COLS} w-full p-[5px_5px] hover:bg-[#29318A]/30 transition-colors rounded-[7px] items-center`}
                >
                  <span className="text-[13px] text-center truncate px-1">{customer.name}</span>
                  <span className="text-[12px] ltr-num text-center text-white/80">
                    {customer.phone || "—"}
                  </span>
                  <span className="text-[13px] ltr-num text-center font-medium">
                    {sub ? `₪${sub.monthly_amount.toLocaleString("he-IL")}` : "—"}
                  </span>
                  <span className="text-center">
                    {sub ? <StatusBadge status={sub.status} /> : <span className="text-white/40">—</span>}
                  </span>
                  <span className="text-[12px] ltr-num text-center text-white/80">
                    {sub ? formatNextCharge(sub.next_charge_date) : "—"}
                  </span>
                  <span className="text-[12px] ltr-num text-center text-white/80">
                    {sub?.card_last_four || "—"}
                  </span>
                  <span className="flex flex-wrap items-center justify-center gap-1">
                    <button
                      type="button"
                      onClick={() => setOneTimeCustomer({ id: customer.id, name: customer.name, phone: customer.phone })}
                      className="text-[11px] px-2 py-1 rounded-md bg-[#5b8cff]/15 text-[#5b8cff] hover:bg-[#5b8cff]/25 transition-colors"
                    >
                      חיוב חד-פעמי
                    </button>
                    {sub && (
                      <>
                        <button
                          type="button"
                          disabled={!canCharge || isBusy}
                          onClick={() => runAction(sub.id, "charge-now")}
                          className="text-[11px] px-2 py-1 rounded-md bg-[#17DB4E]/15 text-[#17DB4E] hover:bg-[#17DB4E]/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                          חייב עכשיו
                        </button>
                        {sub.status === "active" ? (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => runAction(sub.id, "pause")}
                            className="text-[11px] px-2 py-1 rounded-md bg-[#FFA412]/15 text-[#FFA412] hover:bg-[#FFA412]/25 disabled:opacity-40 transition-colors"
                          >
                            השהה
                          </button>
                        ) : sub.status === "paused" ? (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => runAction(sub.id, "resume")}
                            className="text-[11px] px-2 py-1 rounded-md bg-[#5b8cff]/15 text-[#5b8cff] hover:bg-[#5b8cff]/25 disabled:opacity-40 transition-colors"
                          >
                            חדש
                          </button>
                        ) : null}
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() =>
                            runAction(sub.id, "cancel", "לבטל את המנוי של " + customer.name + "?")
                          }
                          className="text-[11px] px-2 py-1 rounded-md bg-[#F64E60]/15 text-[#F64E60] hover:bg-[#F64E60]/25 disabled:opacity-40 transition-colors"
                        >
                          בטל
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => setHistoryCustomer({ id: customer.id, name: customer.name })}
                      className="text-[11px] px-2 py-1 rounded-md bg-white/5 text-white/70 hover:bg-white/10 transition-colors"
                    >
                      היסטוריה
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <AddBillingCustomerModal
        open={addOpen}
        onOpenChange={setAddOpen}
        onDone={load}
      />

      {oneTimeCustomer && (
        <OneTimeChargeModal
          customerId={oneTimeCustomer.id}
          customerName={oneTimeCustomer.name}
          customerPhone={oneTimeCustomer.phone}
          open={!!oneTimeCustomer}
          onOpenChange={(o) => {
            if (!o) setOneTimeCustomer(null);
          }}
          onDone={load}
        />
      )}

      {historyCustomer && (
        <ChargeHistoryModal
          customerId={historyCustomer.id}
          customerName={historyCustomer.name}
          open={!!historyCustomer}
          onOpenChange={(o) => {
            if (!o) setHistoryCustomer(null);
          }}
        />
      )}
    </div>
  );
}
