import type { DriveStep } from "driver.js";

/**
 * שלבי הסיור של דף קליטת המסמכים (OCR).
 * המהות: במקום להקליד חשבוניות ידנית, מצלמים או שולחים את המסמך והמערכת
 * קוראת אותו אוטומטית. הסיור מסביר את הרעיון ואת זרימת העבודה של אישור מסמך.
 * אין שימוש בתו em dash בתוכן.
 */
export const ocrBusinessSteps: DriveStep[] = [
  {
    popover: {
      title: "קליטת מסמכים חכמה (OCR)",
      description:
        "זה אחד הכלים שחוסכים לך הכי הרבה זמן. במקום להקליד כל חשבונית ידנית, פשוט מצלמים אותה או שולחים אותה לוואטסאפ של המערכת, והיא קוראת לבד את הספק, הסכום, התאריך והפריטים. כל מה שנשאר לך הוא להציץ, לוודא שהכל נכון, וללחוץ אישור. נראה לך איך כל החלקים עובדים יחד.",
    },
  },
  {
    element: "#onboarding-ocr-queue",
    popover: {
      title: "תור המסמכים",
      description:
        "כאן מופיעים כל המסמכים שנקלטו, בין אם צילמת אותם, העלית, או נשלחו לוואטסאפ. אפשר לסנן לפי סטטוס: 'ממתינים' הם מסמכים שעוד לא טופלו, 'אושרו' הם כאלה שכבר נקלטו למערכת, ו'ארכיון' הם ישנים. המספר שליד 'ממתינים' מראה כמה מסמכים מחכים לטיפול שלך.",
      side: "left",
      align: "center",
    },
  },
  {
    element: "#onboarding-ocr-upload",
    popover: {
      title: "תצוגת המסמך",
      description:
        "במרכז מוצגת התמונה או ה-PDF של המסמך שנבחר מהתור. אפשר להגדיל, לסובב, לחתוך ולנקות את התמונה כדי שהקריאה תהיה מדויקת יותר. אם המערכת לא קראה משהו נכון, כפתור ה-OCR שבסרגל מריץ קריאה מחדש על התמונה. כך אתה תמיד רואה את המסמך המקורי לצד הנתונים.",
      side: "bottom",
      align: "center",
    },
  },
  {
    element: "#onboarding-ocr-form",
    popover: {
      title: "הנתונים שהמערכת קראה",
      description:
        "זה החלק החכם: כל השדות כאן מולאו אוטומטית ממה שהמערכת קראה במסמך, הספק, מספר החשבונית, התאריכים והסכומים. תפקידך רק לעבור עליהם במהירות ולוודא שהכל נכון. אם משהו חסר או שגוי, פשוט מתקנים אותו כאן לפני הקליטה.",
      side: "right",
      align: "center",
    },
  },
  {
    element: "#onboarding-ocr-approve",
    popover: {
      title: "אישור וקליטה",
      description:
        "אחרי שווידאת שהנתונים נכונים, לחיצה על 'אישור וקליטה' מכניסה את החשבונית למערכת: היא מצטרפת להוצאות, מתעדכנת מול הספק, ונכנסת לכל הדוחות. אם מסמך לא רלוונטי אפשר לדחות או לדלג עליו. כך כל חשבונית נקלטת תוך שניות במקום דקות של הקלדה.",
      side: "top",
      align: "center",
    },
  },
  {
    element: "#onboarding-ocr-scanned",
    popover: {
      title: "הפרדת מסמכים סרוקים",
      description:
        "כאן ניתן להעביר כמות מסמכים שנסרקו והמערכת תדע לסנן אותם בהתאם לכמות הדפים שעלו יחדיו. מתאים למי שסורק מסמכים ומעוניין להפריד אותם.",
      side: "bottom",
      align: "end",
    },
  },
  {
    popover: {
      title: "טיפים לצילום מסמך מנצח",
      description: `
<p style="margin:0 0 12px 0;font-size:13px;line-height:1.6;color:rgba(255,255,255,0.85);">
  איכות הצילום קובעת איכות הקריאה. הסתכל על ההבדל בין שתי הדוגמאות:
</p>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px;">
  <div style="display:flex;flex-direction:column;gap:4px;">
    <div style="position:relative;aspect-ratio:3/4;background:#fafafa;border-radius:6px;border:2px solid #10b981;overflow:hidden;padding:8px 6px;font-family:'Courier New',monospace;direction:ltr;text-align:left;">
      <div style="position:absolute;top:4px;right:4px;width:18px;height:18px;border-radius:50%;background:#10b981;color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;font-family:sans-serif;">✓</div>
      <div style="font-size:6px;color:#111;font-weight:700;text-align:center;border-bottom:1px solid #999;padding-bottom:2px;margin-bottom:3px;">חשבונית מס</div>
      <div style="font-size:5px;color:#333;line-height:1.4;">
        <div>ספק: מאפיית הבית</div>
        <div>ח.פ. 514876321</div>
        <div>תאריך: 15/03/2026</div>
        <div>מספר: 1247</div>
        <div style="margin-top:4px;border-top:1px dashed #aaa;padding-top:3px;">
          <div>לחם פרוס &nbsp;&nbsp; ₪24.00</div>
          <div>חלות &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ₪36.00</div>
          <div>בורקס &nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ₪48.00</div>
        </div>
        <div style="margin-top:4px;border-top:1px solid #333;padding-top:2px;font-weight:700;">סה"כ: ₪108.00</div>
      </div>
    </div>
    <div style="font-size:11px;color:#10b981;text-align:center;font-weight:700;">תקין ✓</div>
  </div>
  <div style="display:flex;flex-direction:column;gap:4px;">
    <div style="position:relative;aspect-ratio:3/4;background:linear-gradient(135deg,#d4d4d4 0%,#9ca3af 100%);border-radius:6px;border:2px solid #ef4444;overflow:hidden;padding:8px 6px;font-family:'Courier New',monospace;direction:ltr;text-align:left;transform:rotate(-4deg) scale(0.92);filter:blur(0.8px);">
      <div style="position:absolute;top:4px;right:4px;width:18px;height:18px;border-radius:50%;background:#ef4444;color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;font-family:sans-serif;transform:rotate(4deg);">✕</div>
      <div style="font-size:6px;color:#444;font-weight:700;text-align:center;border-bottom:1px solid #888;padding-bottom:2px;margin-bottom:3px;opacity:0.6;">חשב__ית ___</div>
      <div style="font-size:5px;color:#555;line-height:1.4;opacity:0.7;">
        <div>ספק: מ___ית הב__</div>
        <div>ח.פ. 5148__321</div>
        <div>תא___: __/03/__26</div>
        <div>מ____: 1__7</div>
        <div style="margin-top:4px;border-top:1px dashed #888;padding-top:3px;">
          <div>לחם פר__ &nbsp; ₪__.00</div>
          <div>חלו_ &nbsp;&nbsp;&nbsp;&nbsp; ₪36.__</div>
        </div>
        <div style="position:absolute;bottom:8px;left:6px;right:6px;height:14px;background:rgba(0,0,0,0.3);border-radius:2px;"></div>
      </div>
    </div>
    <div style="font-size:11px;color:#ef4444;text-align:center;font-weight:700;">לא תקין ✕</div>
  </div>
</div>
<p style="margin:0 0 10px 0;font-size:12.5px;line-height:1.5;color:rgba(255,255,255,0.8);">
  מטושטש, מקופל וחתוך = שדות ייקראו שגוי. ככה תצלם נכון:
</p>
<ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:10px;">
  <li style="display:flex;align-items:flex-start;gap:10px;">
    <span style="flex-shrink:0;width:22px;height:22px;border-radius:50%;background:rgba(255,164,18,0.2);color:#FFA412;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;">✓</span>
    <div style="font-size:12.5px;line-height:1.5;">
      <strong style="color:#fff;">תאורה טובה</strong>
      <div style="color:rgba(255,255,255,0.7);">צלם בחדר מואר, בלי צל של היד על המסמך.</div>
    </div>
  </li>
  <li style="display:flex;align-items:flex-start;gap:10px;">
    <span style="flex-shrink:0;width:22px;height:22px;border-radius:50%;background:rgba(255,164,18,0.2);color:#FFA412;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;">✓</span>
    <div style="font-size:12.5px;line-height:1.5;">
      <strong style="color:#fff;">מסמך ישר ומלא</strong>
      <div style="color:rgba(255,255,255,0.7);">החזק את הטלפון מקביל למסמך, וודא שכל הפינות נראות.</div>
    </div>
  </li>
  <li style="display:flex;align-items:flex-start;gap:10px;">
    <span style="flex-shrink:0;width:22px;height:22px;border-radius:50%;background:rgba(255,164,18,0.2);color:#FFA412;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;">✓</span>
    <div style="font-size:12.5px;line-height:1.5;">
      <strong style="color:#fff;">רקע נקי וכהה</strong>
      <div style="color:rgba(255,255,255,0.7);">הניח את המסמך על משטח כהה ואחיד כדי שהמערכת תזהה את הגבולות.</div>
    </div>
  </li>
  <li style="display:flex;align-items:flex-start;gap:10px;">
    <span style="flex-shrink:0;width:22px;height:22px;border-radius:50%;background:rgba(255,164,18,0.2);color:#FFA412;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;">✓</span>
    <div style="font-size:12.5px;line-height:1.5;">
      <strong style="color:#fff;">חד וממוקד</strong>
      <div style="color:rgba(255,255,255,0.7);">המתן שהמצלמה תתמקד לפני הצילום. תמונה מטושטשת = קריאה שגויה.</div>
    </div>
  </li>
  <li style="display:flex;align-items:flex-start;gap:10px;">
    <span style="flex-shrink:0;width:22px;height:22px;border-radius:50%;background:rgba(239,68,68,0.25);color:#FCA5A5;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;">✕</span>
    <div style="font-size:12.5px;line-height:1.5;">
      <strong style="color:#fff;">להימנע: מסמך מקופל או חתוך</strong>
      <div style="color:rgba(255,255,255,0.7);">פתח את הקיפולים. אם חלק מהמסמך חסר, גם הסכום והתאריך עלולים לחסר.</div>
    </div>
  </li>
</ul>
<p style="margin:14px 0 0 0;padding:10px 12px;background:rgba(255,255,255,0.08);border-radius:8px;font-size:12px;line-height:1.5;color:rgba(255,255,255,0.85);">
  💡 <strong>טיפ:</strong> אפשר לשלוח מסמכים גם דרך הוואטסאפ של המערכת. הקליטה תקרה אוטומטית גם בלי לפתוח את האפליקציה.
</p>
      `.trim(),
    },
  },
];
