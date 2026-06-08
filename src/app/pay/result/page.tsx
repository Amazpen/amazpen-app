"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, XCircle } from "lucide-react";

// Customer-facing page — styled to match the brand emails (light + purple),
// NOT the dark admin dashboard. Inline styles override the global dark theme.
const FONT = "'Segoe UI', Tahoma, sans-serif";
const PURPLE = "#8328f8";
const LILAC = "#f3e8ff";

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
          maxWidth: "480px",
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

function PayResult() {
  const searchParams = useSearchParams();
  const success = searchParams.get("status") === "success";

  return (
    <Shell>
      <div style={{ padding: "36px 24px", textAlign: "center", lineHeight: 1.8 }}>
        {success ? (
          <>
            <CheckCircle2 size={64} strokeWidth={1.5} style={{ color: "#16a34a", margin: "0 auto" }} />
            <h1 style={{ margin: "18px 0 0", fontSize: "22px", fontWeight: 700, color: "#333" }}>
              התשלום התקבל בהצלחה
            </h1>
            <p style={{ margin: "10px 0 0", fontSize: "15px", color: "#666" }}>
              תודה רבה! קיבלנו את תשלומך.
            </p>
          </>
        ) : (
          <>
            <XCircle size={64} strokeWidth={1.5} style={{ color: "#dc2626", margin: "0 auto" }} />
            <h1 style={{ margin: "18px 0 0", fontSize: "22px", fontWeight: 700, color: "#333" }}>
              התשלום לא הושלם
            </h1>
            <p style={{ margin: "10px 0 0", fontSize: "15px", color: "#666" }}>
              נא לנסות שוב או לפנות אלינו בטלפון{" "}
              <span style={{ color: PURPLE, fontWeight: 700, whiteSpace: "nowrap" }} dir="ltr">
                054-5554106
              </span>
            </p>
          </>
        )}
      </div>
    </Shell>
  );
}

export default function PayResultPage() {
  return (
    <Suspense
      fallback={
        <main
          dir="rtl"
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#f5f7fa",
            color: "#888",
            fontFamily: FONT,
          }}
        >
          טוען...
        </main>
      }
    >
      <PayResult />
    </Suspense>
  );
}
