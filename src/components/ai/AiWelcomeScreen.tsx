"use client";

import { useRouter } from "next/navigation";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import type { AiSuggestedQuestion } from "@/types/ai";

const userSuggestions: AiSuggestedQuestion[] = [
  { text: "איך החודש שלי? תן סיכום", icon: "summary" },
  { text: "מי הספק הכי יקר שלי?", icon: "expenses" },
  { text: "מה ההכנסות היום?", icon: "revenue" },
  { text: "השווה לי בין החודש לחודש שעבר", icon: "comparison" },
  { text: "מה המצב מול היעדים?", icon: "targets" },
  { text: "כמה אחוז עלות העובדים מההכנסות?", icon: "general" },
];

const adminSuggestions: AiSuggestedQuestion[] = [
  { text: "תן סקירה של כל העסקים", icon: "summary" },
  { text: "איזה עסק הכי רווחי החודש?", icon: "revenue" },
  { text: "השווה עלות עובדים בין העסקים", icon: "comparison" },
  { text: "איפה יש חריגה מהיעדים?", icon: "targets" },
  { text: "מה סך ההוצאות החודש לכל העסקים?", icon: "expenses" },
  { text: "איזה ספקים הכי יקרים ברמת מערכת?", icon: "general" },
];

const iconMap: Record<AiSuggestedQuestion["icon"], React.ReactNode> = {
  revenue: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
    </svg>
  ),
  expenses: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12V7H5a2 2 0 010-4h14v4" /><path d="M3 5v14a2 2 0 002 2h16v-5" /><path d="M18 12a2 2 0 000 4h4v-4z" />
    </svg>
  ),
  comparison: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  ),
  targets: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" />
    </svg>
  ),
  summary: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" />
    </svg>
  ),
  general: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
};

interface AiWelcomeScreenProps {
  isAdmin: boolean;
  onSuggestionClick: (text: string) => void;
}

export function AiWelcomeScreen({ isAdmin, onSuggestionClick }: AiWelcomeScreenProps) {
  const router = useRouter();
  const suggestions = isAdmin ? adminSuggestions : userSuggestions;

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 py-6 sm:py-8 relative overflow-y-auto" dir="rtl">
      {/* Close button */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => router.back()}
        title="סגור"
        className="absolute top-3 left-3 sm:top-4 sm:left-4 w-[32px] h-[32px] sm:w-[36px] sm:h-[36px] rounded-full hover:bg-white/10 flex items-center justify-center transition-colors cursor-pointer"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </Button>

      {/* AI Bot Avatar */}
      <div className="w-[80px] h-[80px] sm:w-[110px] sm:h-[110px] rounded-full overflow-hidden mb-3 sm:mb-5">
        <Image
          src="https://db.amazpenbiz.co.il/storage/v1/object/public/attachments/ai/ai-avatar.png"
          alt="דדי - העוזר החכם"
          width={110}
          height={110}
          className="w-full h-full object-cover"
        />
      </div>

      {/* Title */}
      <h1 className="text-white text-[18px] sm:text-[22px] font-bold mb-1.5 sm:mb-2 text-center">
        שלום! אני דדי, העוזר החכם של המצפן
      </h1>

      {/* Subtitle */}
      <p className="text-white/50 text-[13px] sm:text-[14px] text-center mb-2 max-w-[400px] px-2">
        אפשר לשאול אותי כל שאלה על הנתונים העסקיים שלך ואני אענה עם ניתוחים, טבלאות וגרפים
      </p>

      {/* Admin badge */}
      {isAdmin && (
        <div className="flex items-center gap-1.5 bg-[#FFA412]/15 text-[#FFA412] text-[11px] sm:text-[12px] font-medium px-3 py-1 rounded-full mb-4 sm:mb-6">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          מצב מנהל — גישה לכל העסקים
        </div>
      )}

      {!isAdmin && <div className="mb-4 sm:mb-6" />}

      {/* Suggestion cards */}
      <div id="onboarding-ai-suggestions" className="w-full max-w-[500px] grid grid-cols-1 min-[400px]:grid-cols-2 gap-2 sm:gap-3">
        {suggestions.map((suggestion) => (
          <Button
            key={suggestion.text}
            type="button"
            variant="ghost"
            onClick={() => onSuggestionClick(suggestion.text)}
            className="flex items-center gap-2 sm:gap-3 bg-[#29318A] hover:bg-[#3D44A0] text-white text-[12px] sm:text-[13px] text-right p-2.5 sm:p-3 rounded-[10px] sm:rounded-[12px] transition-colors cursor-pointer active:scale-[0.98]"
          >
            <span className="flex-shrink-0 text-white">
              {iconMap[suggestion.icon]}
            </span>
            <span className="leading-snug">{suggestion.text}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}
