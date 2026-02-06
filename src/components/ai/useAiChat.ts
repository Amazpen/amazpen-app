"use client";

import { useState, useCallback, useRef } from "react";
import type { AiMessage, AiChartData } from "@/types/ai";

interface MockResponse {
  content: string;
  chartData?: AiChartData;
}

const mockResponses: Record<string, MockResponse> = {
  revenue: {
    content: `## סיכום הכנסות החודש

סה"כ הכנסות: **₪185,400**

| מקור | סכום | שינוי מחודש קודם |
|------|------|------------------|
| לקוחות פרטיים | ₪120,300 | +5.2% |
| לקוחות עסקיים | ₪65,100 | -2.1% |

ההכנסות מלקוחות פרטיים ממשיכות במגמת עלייה חיובית, בעוד ההכנסות מלקוחות עסקיים ירדו קלות ב-2.1%.

> **המלצה:** כדאי לבחון את הסיבות לירידה בלקוחות העסקיים ולשקול קמפיין ממוקד.`,
    chartData: {
      type: "bar",
      title: "הכנסות לפי חודש (₪)",
      xAxisKey: "month",
      data: [
        { month: "ינואר", private: 98000, business: 52000 },
        { month: "פברואר", private: 105000, business: 58000 },
        { month: "מרץ", private: 112000, business: 61000 },
        { month: "אפריל", private: 120300, business: 65100 },
      ],
      dataKeys: [
        { key: "private", label: "פרטיים", color: "#6366f1" },
        { key: "business", label: "עסקיים", color: "#22c55e" },
      ],
    },
  },
  expenses: {
    content: `## פילוח הוצאות החודש

סה"כ הוצאות: **₪142,800**

| קטגוריה | סכום | אחוז |
|----------|------|------|
| שכר עובדים | ₪78,500 | 55% |
| שכירות ותשתיות | ₪28,200 | 20% |
| שיווק ופרסום | ₪18,600 | 13% |
| ספקים וחומרי גלם | ₪12,100 | 8% |
| אחר | ₪5,400 | 4% |

ההוצאה הגדולה ביותר היא **שכר עובדים** (55%), שהיא סבירה לסוג העסק.`,
    chartData: {
      type: "bar",
      title: "הוצאות לפי קטגוריה (₪)",
      xAxisKey: "category",
      data: [
        { category: "שכר", amount: 78500 },
        { category: "שכירות", amount: 28200 },
        { category: "שיווק", amount: 18600 },
        { category: "ספקים", amount: 12100 },
        { category: "אחר", amount: 5400 },
      ],
      dataKeys: [
        { key: "amount", label: "סכום", color: "#f59e0b" },
      ],
    },
  },
  comparison: {
    content: `## השוואה: החודש מול חודש קודם

| מדד | חודש נוכחי | חודש קודם | שינוי |
|-----|-----------|-----------|-------|
| הכנסות | ₪185,400 | ₪176,200 | **+5.2%** |
| הוצאות | ₪142,800 | ₪138,500 | +3.1% |
| רווח גולמי | ₪42,600 | ₪37,700 | **+13%** |
| מספר לקוחות | 234 | 218 | +7.3% |

המגמה חיובית! הרווח הגולמי עלה ב-**13%** לעומת החודש הקודם, וזאת בזכות גידול בהכנסות שעולה על קצב עליית ההוצאות.`,
    chartData: {
      type: "bar",
      title: "השוואת ביצועים (₪)",
      xAxisKey: "metric",
      data: [
        { metric: "הכנסות", current: 185400, previous: 176200 },
        { metric: "הוצאות", current: 142800, previous: 138500 },
        { metric: "רווח", current: 42600, previous: 37700 },
      ],
      dataKeys: [
        { key: "current", label: "חודש נוכחי", color: "#6366f1" },
        { key: "previous", label: "חודש קודם", color: "#94a3b8" },
      ],
    },
  },
  targets: {
    content: `## מצב מול יעדים

### יעד הכנסות חודשי: ₪200,000
- **ביצוע:** ₪185,400 (92.7%)
- **חסר:** ₪14,600

### יעד לקוחות חדשים: 30
- **ביצוע:** 26 (86.7%)
- **חסר:** 4 לקוחות

### יעד שביעות רצון: 4.5/5
- **ביצוע:** 4.3/5 (95.6%)

> **סיכום:** העסק קרוב מאוד להשגת היעדים. עם מאמץ ממוקד בשבועיים הקרובים, ניתן לעמוד ביעד ההכנסות.`,
  },
  summary: {
    content: `## סיכום כללי של העסק

### מצב פיננסי
העסק נמצא במצב פיננסי **יציב וחיובי**. ההכנסות במגמת עלייה רציפה בארבעת החודשים האחרונים, עם גידול ממוצע של כ-4% לחודש.

### נקודות חוזק
- **גידול בהכנסות** — מגמה חיובית של +5.2% החודש
- **בסיס לקוחות מתרחב** — 234 לקוחות פעילים, עלייה של 7.3%
- **רווחיות משתפרת** — רווח גולמי עלה ב-13%

### נקודות לשיפור
- ירידה קלה בהכנסות מלקוחות עסקיים (-2.1%)
- הוצאות שיווק עלו ב-8% ללא גידול מקביל בלידים
- יעד ההכנסות החודשי טרם הושג (92.7%)

### המלצות
1. בחינת אסטרטגיית המחירים ללקוחות עסקיים
2. אופטימיזציה של ערוצי השיווק
3. מיקוד במכירות בשבועיים האחרונים של החודש`,
  },
  default: {
    content: `אשמח לעזור לך עם מידע על העסק! הנה כמה דברים שאני יכול לעשות:

- **הכנסות** — סיכום ופילוח הכנסות
- **הוצאות** — ניתוח הוצאות לפי קטגוריה
- **השוואה** — השוואה בין תקופות
- **יעדים** — מעקב אחר התקדמות מול יעדים
- **סיכום** — סיכום כללי של מצב העסק

נסה לשאול שאלה כמו: *"מה סך ההכנסות החודש?"* או *"הראה לי פילוח הוצאות"*`,
  },
};

function getKeywordMatch(input: string): string {
  const lower = input.toLowerCase();
  if (/הכנס[הות]/.test(lower) || /revenue/.test(lower)) return "revenue";
  if (/הוצא[הות]/.test(lower) || /expense/.test(lower) || /פילוח/.test(lower)) return "expenses";
  if (/השוו[אה]|השווא|השוואה|לעומת|מול חודש/.test(lower) || /compar/.test(lower)) return "comparison";
  if (/יעד|יעדים|מטר[הות]|target/.test(lower)) return "targets";
  if (/סיכום|כללי|overview|summary|מצב העסק/.test(lower)) return "summary";
  return "default";
}

export function useAiChat() {
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sendMessage = useCallback((content: string) => {
    const userMessage: AiMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    const delay = 800 + Math.random() * 1200;
    timeoutRef.current = setTimeout(() => {
      const key = getKeywordMatch(content);
      const mock = mockResponses[key] || mockResponses.default;

      const assistantMessage: AiMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: mock.content,
        timestamp: new Date(),
        chartData: mock.chartData,
      };

      setMessages((prev) => [...prev, assistantMessage]);
      setIsLoading(false);
    }, delay);
  }, []);

  const clearChat = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setMessages([]);
    setIsLoading(false);
  }, []);

  return { messages, isLoading, sendMessage, clearChat };
}
