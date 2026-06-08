import { createClient as createServiceClient } from "@supabase/supabase-js";

// Public, customer-facing BRANDED payment page. The admin shares
// app.amazpenbiz.co.il/pay/c/<chargeId> (branded, "inside our system") instead
// of a raw secure.cardcom.solutions URL. This page embeds the actual Cardcom
// hosted payment page in an iframe inside the brand shell.
//
// Styled to match the brand EMAILS (light + purple) — NOT the dark dashboard.
// Inline styles override the global dark theme. No auth: it is reached by the
// unguessable chargeId UUID, same security level as the Cardcom URL itself.

const FONT = "'Segoe UI', Tahoma, sans-serif";
const PURPLE = "#8328f8";
const LILAC = "#f3e8ff";

function service() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main
      dir="rtl"
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f5f7fa",
        color: "#333",
        fontFamily: FONT,
        padding: "20px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "560px",
          background: "#fff",
          borderRadius: "16px",
          boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            background: LILAC,
            color: PURPLE,
            padding: "22px",
            textAlign: "center",
            fontSize: "22px",
            fontWeight: 700,
          }}
        >
          המצפן
        </div>
        {children}
        {/* Footer */}
        <div
          style={{
            background: LILAC,
            color: "#888",
            padding: "16px",
            textAlign: "center",
            fontSize: "12px",
          }}
        >
          צוות המצפן · © המצפן - כל הזכויות שמורות
        </div>
      </div>
    </main>
  );
}

function Message({ text }: { text: string }) {
  return (
    <div style={{ padding: "40px 24px", textAlign: "center", lineHeight: 1.8 }}>
      <p style={{ margin: 0, fontSize: "17px", color: "#444" }}>{text}</p>
    </div>
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
        <Message text="קישור התשלום אינו תקין או שפג תוקפו." />
      </Shell>
    );
  }

  // Already paid → no iframe.
  if (charge.status === "success") {
    return (
      <Shell>
        <Message text="התשלום כבר התקבל. תודה!" />
      </Shell>
    );
  }

  const amount = Number(charge.amount ?? 0);

  return (
    <Shell>
      <div style={{ padding: "28px 24px" }}>
        <h1
          style={{
            margin: "0 0 6px",
            fontSize: "20px",
            fontWeight: 700,
            color: "#333",
            textAlign: "center",
          }}
        >
          תשלום מאובטח
        </h1>
        <p
          style={{
            margin: "0 0 18px",
            fontSize: "16px",
            color: PURPLE,
            fontWeight: 700,
            textAlign: "center",
          }}
        >
          לתשלום: ₪{amount.toLocaleString("he-IL")}
        </p>
        <iframe
          src={charge.cardcom_payment_url}
          title="תשלום"
          style={{
            width: "100%",
            height: "640px",
            border: 0,
            borderRadius: 12,
            background: "#fff",
          }}
        />
        <p
          style={{
            margin: "14px 0 0",
            fontSize: "12px",
            color: "#888",
            textAlign: "center",
          }}
        >
          התשלום מאובטח באמצעות Cardcom
        </p>
      </div>
    </Shell>
  );
}
