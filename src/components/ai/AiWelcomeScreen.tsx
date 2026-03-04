"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import type { AiSuggestedQuestion } from "@/types/ai";

/** 5×5 circular matrix skeleton for the large avatar — fills the whole circle */
function AvatarMatrixSkeleton() {
  const gridSize = 5;
  const total = gridSize * gridSize;
  // Which cells are inside a circle (skip corners for round shape)
  const isInCircle = (row: number, col: number) => {
    const cx = (gridSize - 1) / 2;
    const cy = (gridSize - 1) / 2;
    const dist = Math.sqrt((row - cx) ** 2 + (col - cy) ** 2);
    return dist <= 2.3;
  };
  // Spiral delay from center outward
  const getDelay = (row: number, col: number) => {
    const cx = (gridSize - 1) / 2;
    const dist = Math.abs(row - cx) + Math.abs(col - cx);
    return dist * 0.12;
  };
  // Alternating colors for a dynamic feel
  const colors = ["bg-indigo-400", "bg-cyan-400", "bg-violet-400", "bg-blue-400", "bg-purple-400"];
  const getColor = (row: number, col: number) => colors[(row * gridSize + col) % colors.length];

  return (
    <div
      className="inline-grid w-full h-full"
      style={{
        gridTemplateColumns: `repeat(${gridSize}, 1fr)`,
        gap: "3px",
        padding: "12%",
      }}
    >
      {Array.from({ length: total }, (_, i) => {
        const row = Math.floor(i / gridSize);
        const col = i % gridSize;
        if (!isInCircle(row, col)) {
          return <div key={i} />;
        }
        return (
          <div
            key={i}
            className={getColor(row, col)}
            style={{
              borderRadius: "50%",
              aspectRatio: "1",
              width: "100%",
              animation: `mmBreathe 1.4s ease-in-out infinite`,
              animationDelay: `${getDelay(row, col)}s`,
            }}
          />
        );
      })}
    </div>
  );
}

const ALL_USER_SUGGESTIONS: AiSuggestedQuestion[] = [
  // סקירה כללית
  { text: "תן לי סקירה מקיפה על העסק שלי", icon: "summary" },
  { text: "מה צפי הרווח שלי החודש?", icon: "general" },
  { text: "איך הביצועים שלי בהשוואה לחודש קודם?", icon: "comparison" },
  { text: "מה הסיכום הכספי של החודש עד עכשיו?", icon: "summary" },
  { text: "האם אני בדרך הנכונה להגיע ליעד החודש?", icon: "targets" },
  { text: "מה הממוצע יומי של ההכנסות שלי החודש?", icon: "revenue" },
  // הוצאות
  { text: "איפה העסק שלי מפסיד כסף?", icon: "expenses" },
  { text: "מי ההוצאות הכי כבדות שלי?", icon: "expenses" },
  { text: "מה צפוי לרדת לי השבוע מהבנק?", icon: "comparison" },
  { text: "אילו הוצאות חרגו מהיעד החודש?", icon: "expenses" },
  { text: "מה עלות המכר שלי ביחס להכנסות?", icon: "expenses" },
  { text: "כמה שילמתי לספקים החודש?", icon: "expenses" },
  { text: "אילו ספקים יש לי תשלומים אליהם השבוע הקרוב?", icon: "comparison" },
  { text: "מה ההוצאות השוטפות הקבועות שלי?", icon: "expenses" },
  { text: "האם יש הוצאה שעלתה בצורה חריגה לאחרונה?", icon: "expenses" },
  // עובדים ושכר
  { text: "מה עלות העובדים ביחס להכנסות?", icon: "targets" },
  { text: "באילו ימים עלות העובדים הכי גבוהה?", icon: "comparison" },
  { text: "האם יש חריגה בשעות העבודה החודש?", icon: "targets" },
  // הכנסות ומכירות
  { text: "מה שלושת הדברים שהכי משפיעים על הרווח שלי כרגע?", icon: "targets" },
  { text: "מה ממוצע ההזמנה שלי לפי מקור?", icon: "revenue" },
  { text: "איזה יום בשבוע מכניס הכי הרבה?", icon: "revenue" },
  { text: "מה ההכנסות שלי לפי ערוץ מכירה?", icon: "revenue" },
  { text: "האם יש ירידה בהכנסות בימים מסוימים?", icon: "comparison" },
  { text: "כמה הזמנות קיבלתי החודש?", icon: "summary" },
  // ספקים
  { text: "אילו ספקים העלו מחיר לאחרונה?", icon: "expenses" },
  { text: "מה הספקים שאני הכי תלוי בהם?", icon: "general" },
  { text: "האם כדאי להשוות מחירים אצל ספקים מתחרים?", icon: "general" },
  // יעדים
  { text: "מה היעדים שלי החודש ואיפה אני עומד?", icon: "targets" },
  { text: "מה הפער בין היעד להכנסות בפועל?", icon: "targets" },
  { text: "מה צריך לקרות כדי שאגיע ליעד החודש?", icon: "targets" },
  // טיפים ועצות
  { text: "תן לי 3 פעולות שאני יכול לעשות היום כדי לשפר את הרווח", icon: "general" },
  { text: "מה הדבר הכי חשוב שצריך לשפר בעסק שלי?", icon: "general" },
  { text: "איך אני יכול לחסוך עוד כסף החודש?", icon: "general" },
  { text: "מה הסיכון הכספי הגדול ביותר שלי כרגע?", icon: "targets" },
];

const ALL_ADMIN_SUGGESTIONS: AiSuggestedQuestion[] = [
  // סקירה כללית
  { text: "תן סקירה של כל העסקים", icon: "summary" },
  { text: "איזה עסק הכי רווחי החודש?", icon: "revenue" },
  { text: "מה סך ההכנסות של כל העסקים החודש?", icon: "revenue" },
  { text: "מה סך ההוצאות החודש לכל העסקים?", icon: "expenses" },
  { text: "מה הרווח הכולל של כל העסקים החודש?", icon: "summary" },
  { text: "איך הביצועים הכוללים בהשוואה לחודש קודם?", icon: "comparison" },
  // יעדים וחריגות
  { text: "איפה יש חריגה מהיעדים?", icon: "targets" },
  { text: "אילו עסקים לא עומדים ביעדים החודש?", icon: "targets" },
  { text: "אילו עסקים חרגו בהוצאות?", icon: "expenses" },
  { text: "מה הפערים הגדולים ביותר בין יעד לבפועל?", icon: "targets" },
  // ניתוח עסקים
  { text: "איזה עסק משפר את עצמו הכי הרבה?", icon: "comparison" },
  { text: "איזה עסק נמצא במגמת ירידה?", icon: "comparison" },
  { text: "מה ההבדל בין העסקים מבחינת עלות מכר?", icon: "expenses" },
  { text: "מה עלות העובדים לפי עסק ביחס להכנסות?", icon: "targets" },
  // הוצאות ותשלומים
  { text: "אילו תשלומים לספקים צפויים השבוע?", icon: "comparison" },
  { text: "מה ההוצאות הגדולות ביותר על פני כל העסקים?", icon: "expenses" },
  { text: "אילו ספקים מקבלים הכי הרבה כסף ממכלול העסקים?", icon: "expenses" },
  // כלים ומידע
  { text: "מה זה סטטוס בירור בהוצאות?", icon: "general" },
  { text: "איך בנויה התוכנית העסקית החודשית?", icon: "comparison" },
  { text: "איך עובד מנגנון היעדים במערכת?", icon: "general" },
  { text: "מה המשמעות של עלות מכר במערכת?", icon: "general" },
  // פעולות מומלצות
  { text: "אילו עסקים דורשים תשומת לב דחופה?", icon: "targets" },
  { text: "תן לי 3 המלצות לשיפור הביצועים הכוללים", icon: "general" },
  { text: "אילו עסקים מציגים סיכון כלכלי?", icon: "targets" },
];

function pickRandom<T>(arr: T[], count: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}


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
  adminViewAsOwner?: boolean;
  onToggleAdminView?: () => void;
  onSuggestionClick: (text: string) => void;
}

export function AiWelcomeScreen({ isAdmin, adminViewAsOwner, onToggleAdminView, onSuggestionClick }: AiWelcomeScreenProps) {
  const router = useRouter();
  const [suggestions] = useState<AiSuggestedQuestion[]>(() =>
    pickRandom(isAdmin ? ALL_ADMIN_SUGGESTIONS : ALL_USER_SUGGESTIONS, 6)
  );
  const [showImage, setShowImage] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const minTimeRef = useRef(false);
  const hapticIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hapticStepRef = useRef(0);

  // Matrix-synced haptic: pulsing vibration that mirrors the skeleton animation
  useEffect(() => {
    if (showImage) return; // stop when image appears

    const canVibrate = typeof navigator !== "undefined" && "vibrate" in navigator;
    if (!canVibrate) return;

    // Pulse pattern synced to mmBreathe 1.4s cycle with spiral delay
    // Each tick = one "ring" of the matrix expanding outward
    hapticStepRef.current = 0;
    hapticIntervalRef.current = setInterval(() => {
      const step = hapticStepRef.current % 8;
      // Build up: center → edges, then pause, then repeat
      // Steps 0-4: expanding rings (intensity grows), 5-7: breathing pause
      if (step <= 4) {
        const intensity = 5 + step * 4; // 5, 9, 13, 17, 21
        navigator.vibrate(intensity);
      }
      // steps 5-7: silence (breathing pause)
      hapticStepRef.current++;
    }, 180);

    return () => {
      if (hapticIntervalRef.current) {
        clearInterval(hapticIntervalRef.current);
        hapticIntervalRef.current = null;
      }
    };
  }, [showImage]);

  useEffect(() => {
    const timer = setTimeout(() => {
      minTimeRef.current = true;
      if (imageLoaded) {
        setShowImage(true);
        const canVibrate = typeof navigator !== "undefined" && "vibrate" in navigator;
        if (canVibrate) navigator.vibrate([20, 40, 50]);
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, [imageLoaded]);

  const handleImageLoad = useCallback(() => {
    setImageLoaded(true);
    if (minTimeRef.current) {
      setShowImage(true);
      // Completion vibration when avatar appears
      const canVibrate = typeof navigator !== "undefined" && "vibrate" in navigator;
      if (canVibrate) navigator.vibrate([20, 40, 50]);
    }
  }, []);

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 py-6 sm:py-8 relative overflow-y-auto" dir="rtl">
      {/* Close button */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => router.back()}
        title="סגור"
        className="absolute top-3 right-3 sm:top-4 sm:right-4 w-[32px] h-[32px] sm:w-[36px] sm:h-[36px] rounded-full hover:bg-white/10 flex items-center justify-center transition-colors cursor-pointer"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </Button>

      {/* AI Bot Avatar with matrix skeleton */}
      <div className="w-[80px] h-[80px] sm:w-[110px] sm:h-[110px] rounded-full overflow-hidden mb-3 sm:mb-5 relative">
        {!showImage && (
          <div className="absolute inset-0 bg-[#1a1f4e] rounded-full">
            <AvatarMatrixSkeleton />
          </div>
        )}
        <Image
          src="https://db.amazpenbiz.co.il/storage/v1/object/public/attachments/ai/ai-avatar.png"
          alt="דדי - העוזר החכם"
          width={110}
          height={110}
          className={`w-full h-full object-cover transition-opacity duration-500 ${showImage ? "opacity-100" : "opacity-0"}`}
          unoptimized
          priority
          loading="eager"
          onLoad={handleImageLoad}
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

      {/* Admin badge + toggle */}
      {(isAdmin || onToggleAdminView) && (
        <div className="flex flex-col items-center gap-2 mb-4 sm:mb-6">
          <div className="flex items-center gap-1.5 bg-[#FFA412]/15 text-[#FFA412] text-[11px] sm:text-[12px] font-medium px-3 py-1 rounded-full">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            {adminViewAsOwner ? "מצב בעל עסק — תשובות לפי העסק הנבחר" : "מצב מנהל — גישה לכל העסקים"}
          </div>
          {onToggleAdminView && (
            <button
              type="button"
              onClick={onToggleAdminView}
              className="flex items-center gap-1.5 text-white/50 hover:text-white/80 text-[11px] transition-colors"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 2l4 4-4 4" /><path d="M3 11V9a4 4 0 014-4h14" />
                <path d="M7 22l-4-4 4-4" /><path d="M21 13v2a4 4 0 01-4 4H3" />
              </svg>
              {adminViewAsOwner ? "עבור למצב מנהל" : "עבור למצב בעל עסק"}
            </button>
          )}
        </div>
      )}

      {!isAdmin && !onToggleAdminView && <div className="mb-4 sm:mb-6" />}

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
