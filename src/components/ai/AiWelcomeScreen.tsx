"use client";

import { useRouter } from "next/navigation";
import type { AiSuggestedQuestion } from "@/types/ai";

const suggestions: AiSuggestedQuestion[] = [
  { text: "מה סך ההכנסות החודש?", icon: "revenue" },
  { text: "הראה לי פילוח הוצאות", icon: "expenses" },
  { text: "השווה בין החודש לחודש שעבר", icon: "comparison" },
  { text: "מה המצב מול היעדים?", icon: "targets" },
  { text: "תן לי סיכום כללי של העסק", icon: "summary" },
  { text: "מה עלות העובדים באחוזים?", icon: "general" },
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

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-8 relative" dir="rtl">
      {/* Close button */}
      <button
        type="button"
        onClick={() => router.back()}
        title="סגור"
        className="absolute top-4 left-4 w-[36px] h-[36px] rounded-full hover:bg-white/10 flex items-center justify-center transition-colors cursor-pointer"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      {/* AI Bot Icon */}
      <div className="w-[72px] h-[72px] rounded-full bg-[#6366f1]/20 flex items-center justify-center mb-5">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" className="text-white">
          <rect x="3" y="11" width="18" height="10" rx="3" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="9" cy="16" r="1.5" fill="currentColor" />
          <circle cx="15" cy="16" r="1.5" fill="currentColor" />
          <path d="M12 2v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="12" cy="2" r="1" fill="currentColor" />
          <path d="M1 15h2M21 15h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>

      {/* Title */}
      <h1 className="text-white text-[22px] font-bold mb-2 text-center">
        שלום! אני העוזר החכם של המצפן
      </h1>

      {/* Subtitle */}
      <p className="text-white/50 text-[14px] text-center mb-2 max-w-[400px]">
        אפשר לשאול אותי כל שאלה על הנתונים העסקיים שלך ואני אענה עם ניתוחים, טבלאות וגרפים
      </p>

      {/* Admin badge */}
      {isAdmin && (
        <div className="flex items-center gap-1.5 bg-[#FFA412]/15 text-[#FFA412] text-[12px] font-medium px-3 py-1 rounded-full mb-6">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          מצב מנהל — גישה לכל העסקים
        </div>
      )}

      {!isAdmin && <div className="mb-6" />}

      {/* Suggestion cards */}
      <div id="onboarding-ai-suggestions" className="w-full max-w-[500px] grid grid-cols-2 gap-3">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion.text}
            type="button"
            onClick={() => onSuggestionClick(suggestion.text)}
            className="flex items-center gap-3 bg-[#29318A] hover:bg-[#3D44A0] text-white text-[13px] text-right p-3 rounded-[12px] transition-colors cursor-pointer active:scale-[0.98]"
          >
            <span className="flex-shrink-0 text-white">
              {iconMap[suggestion.icon]}
            </span>
            <span className="leading-snug">{suggestion.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
