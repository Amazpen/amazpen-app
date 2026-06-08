import { createClient as createServiceClient } from "@supabase/supabase-js";

// Public, customer-facing BRANDED payment page. The admin shares
// app.amazpenbiz.co.il/pay/c/<chargeId> (branded, "inside our system") instead
// of a raw secure.cardcom.solutions URL. This page embeds the actual Cardcom
// hosted payment page in an iframe inside the brand shell.
//
// Styled to match the brand EMAILS (light + purple) — NOT the dark dashboard.
// Responsive: a centered card on desktop, full-screen on mobile (the iframe
// flexes to fill the viewport). No auth: reached by the unguessable chargeId
// UUID, same security level as the Cardcom URL itself.

const CSS = `
.pay-wrap{min-height:100dvh;display:flex;background:#f5f7fa;color:#333;font-family:'Segoe UI',Tahoma,sans-serif;}
.pay-card{width:100%;min-height:100dvh;background:#fff;display:flex;flex-direction:column;}
.pay-head{background:#f3e8ff;color:#8328f8;padding:18px;text-align:center;font-size:22px;font-weight:700;}
.pay-foot{background:#f3e8ff;color:#888;padding:14px;text-align:center;font-size:12px;}
.pay-body{padding:20px 16px;display:flex;flex-direction:column;flex:1;min-height:0;}
.pay-title{margin:0 0 4px;font-size:20px;font-weight:700;color:#333;text-align:center;}
.pay-amount{margin:0 0 14px;font-size:16px;color:#8328f8;font-weight:700;text-align:center;}
.pay-note{margin:12px 0 0;font-size:12px;color:#888;text-align:center;}
.pay-msg{margin:auto;font-size:17px;color:#444;text-align:center;line-height:1.8;}
.pay-iframe{flex:1;width:100%;border:0;background:#fff;min-height:420px;}
`;

function service() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main dir="rtl" className="pay-wrap">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="pay-card">
        <div className="pay-head">המצפן</div>
        <div className="pay-body">{children}</div>
        <div className="pay-foot">צוות המצפן · © המצפן - כל הזכויות שמורות</div>
      </div>
    </main>
  );
}

export default async function Page({
  params,
}: {
  params: Promise<{ chargeId: string }>;
}) {
  const { chargeId } = await params;

  const db = service();
  const { data: charge } = await db
    .from("billing_charges")
    .select("id, amount, status, cardcom_payment_url, customer_id, deleted_at")
    .eq("id", chargeId)
    .maybeSingle();

  // Not found / deleted / no payment URL → invalid link.
  if (!charge || charge.deleted_at || !charge.cardcom_payment_url) {
    return (
      <Shell>
        <p className="pay-msg">קישור התשלום אינו תקין או שפג תוקפו.</p>
      </Shell>
    );
  }

  // Already paid → no iframe.
  if (charge.status === "success") {
    return (
      <Shell>
        <p className="pay-msg">התשלום כבר התקבל. תודה!</p>
      </Shell>
    );
  }

  const amount = Number(charge.amount ?? 0);

  return (
    <Shell>
      <h1 className="pay-title">תשלום מאובטח</h1>
      <p className="pay-amount">לתשלום: ₪{amount.toLocaleString("he-IL")}</p>
      <iframe src={charge.cardcom_payment_url} title="תשלום" className="pay-iframe" />
      <p className="pay-note">התשלום מאובטח באמצעות Cardcom</p>
    </Shell>
  );
}
