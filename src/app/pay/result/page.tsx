"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, XCircle } from "lucide-react";

function PayResult() {
  const searchParams = useSearchParams();
  const status = searchParams.get("status");
  const success = status === "success";

  return (
    <main
      dir="rtl"
      className="min-h-screen flex items-center justify-center bg-[#0B1133] px-4"
    >
      <div className="w-full max-w-md bg-[#0F1535] border border-white/10 rounded-2xl p-8 text-center shadow-2xl">
        {success ? (
          <>
            <CheckCircle2
              size={64}
              className="mx-auto text-[#17DB4E]"
              strokeWidth={1.5}
            />
            <h1 className="mt-5 text-[22px] font-bold text-white">
              התשלום התקבל בהצלחה
            </h1>
            <p className="mt-2 text-[15px] text-white/70">תודה רבה</p>
          </>
        ) : (
          <>
            <XCircle
              size={64}
              className="mx-auto text-[#F64E60]"
              strokeWidth={1.5}
            />
            <h1 className="mt-5 text-[22px] font-bold text-white">
              התשלום לא הושלם
            </h1>
            <p className="mt-2 text-[15px] text-white/70">
              נא לנסות שוב או לפנות אלינו
            </p>
          </>
        )}
      </div>
    </main>
  );
}

export default function PayResultPage() {
  return (
    <Suspense
      fallback={
        <main
          dir="rtl"
          className="min-h-screen flex items-center justify-center bg-[#0B1133] text-white"
        >
          טוען...
        </main>
      }
    >
      <PayResult />
    </Suspense>
  );
}
