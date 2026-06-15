"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { useDashboard } from "../layout";
import { AiChatContainer } from "@/components/ai/AiChatContainer";

/**
 * דדי - דף הסוכן (בנייה מחדש).
 *
 * הדף מחובר לעסק יחיד בלבד: הוא נפתח רק כשנבחר בדיוק עסק אחד בבורר העסקים
 * שבהדר. אם נבחרו 0 עסקים, או יותר מעסק אחד, הצ'אט לא נפתח ומוצג גייט שמנחה
 * את המשתמש לבחור עסק יחיד. אין בורר עסקים פנימי בדף (גם לא לאדמין).
 */
export default function AgentPage() {
  const { isAdmin, selectedBusinesses, userAvatarUrl } = useDashboard();

  // הדף קשור לעסק יחיד: תקף רק כשנבחר בדיוק עסק אחד.
  const isSingleBusiness = selectedBusinesses.length === 1;
  const businessId = isSingleBusiness ? selectedBusinesses[0] : undefined;

  // נמנע מ-hydration mismatch: בוחרים מה להציג רק אחרי mount בצד הלקוח,
  // כי selectedBusinesses נטען מ-localStorage ב-useEffect.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return null;

  // גייט: הדף לא נפתח בלי עסק יחיד נבחר.
  if (!isSingleBusiness) {
    const noneSelected = selectedBusinesses.length === 0;
    return (
      <div
        dir="rtl"
        className="flex flex-col items-center justify-center h-[calc(100vh-70px)] sm:h-[calc(100vh-66px)] h-[calc(100dvh-70px)] sm:h-[calc(100dvh-66px)] bg-[#0F1535] px-6 text-center"
      >
        <div className="w-[72px] h-[72px] sm:w-[88px] sm:h-[88px] rounded-full overflow-hidden mb-4 bg-[#1a1f4e] opacity-90">
          <Image
            src="https://db.amazpenbiz.co.il/storage/v1/object/public/attachments/ai/ai-avatar.png"
            alt="דדי"
            width={88}
            height={88}
            className="w-full h-full object-cover"
            unoptimized
            priority
          />
        </div>
        <h1 className="text-white text-[18px] sm:text-[22px] font-bold mb-2">
          {noneSelected ? "בחרו עסק כדי להתחיל" : "דדי עובד מול עסק אחד בכל פעם"}
        </h1>
        <p className="text-white/50 text-[13px] sm:text-[14px] max-w-[420px]">
          {noneSelected
            ? "כדי לעבוד עם דדי, בחרו עסק יחיד בבורר העסקים שבראש המסך."
            : "בחרתם כמה עסקים. כדי להמשיך, השאירו עסק יחיד מסומן בבורר העסקים שבראש המסך."}
        </p>
      </div>
    );
  }

  // עסק יחיד נבחר - פותחים את הצ'אט מול אותו עסק בלבד (ללא בורר עסקים פנימי).
  return (
    <AiChatContainer
      isAdmin={isAdmin}
      businessId={businessId}
      userAvatarUrl={userAvatarUrl}
      chatApiPath="/api/agent/chat"
      singleBusiness
    />
  );
}
