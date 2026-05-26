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
      `.trim(),
    },
  },
  {
    popover: {
      title: "שליחת מסמכים בלי לפתוח את האפליקציה",
      description: `
<p style="margin:0 0 14px 0;font-size:13px;line-height:1.6;color:rgba(255,255,255,0.85);">
  לא חייבים להיכנס לאתר כדי לשלוח חשבונית. שלח אותה ישירות לאחד מהערוצים הבאים והמערכת תקלוט אותה אוטומטית:
</p>
<a href="https://wa.me/972542464081" target="_blank" rel="noopener noreferrer" style="display:flex;align-items:center;gap:12px;padding:12px;background:#25D366;border-radius:10px;text-decoration:none;color:#fff;margin-bottom:10px;">
  <span style="flex-shrink:0;width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,0.2);display:flex;align-items:center;justify-content:center;">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413"/></svg>
  </span>
  <div style="flex:1;min-width:0;">
    <div style="font-size:11px;opacity:0.85;line-height:1.3;">שלח לוואטסאפ של המערכת</div>
    <div style="font-size:15px;font-weight:700;line-height:1.3;direction:ltr;text-align:right;">054-246-4081</div>
  </div>
</a>
<a href="mailto:hello@amazpen.co.il" style="display:flex;align-items:center;gap:12px;padding:12px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:10px;text-decoration:none;color:#fff;margin-bottom:14px;">
  <span style="flex-shrink:0;width:36px;height:36px;border-radius:50%;background:#FFA412;display:flex;align-items:center;justify-content:center;">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
  </span>
  <div style="flex:1;min-width:0;">
    <div style="font-size:11px;opacity:0.85;line-height:1.3;">או שלח במייל</div>
    <div style="font-size:15px;font-weight:700;line-height:1.3;direction:ltr;text-align:right;">hello@amazpen.co.il</div>
  </div>
</a>
<div style="padding:10px 12px;background:rgba(255,164,18,0.15);border:1px solid rgba(255,164,18,0.3);border-radius:8px;font-size:12px;line-height:1.5;color:rgba(255,255,255,0.9);">
  ⚡ <strong>הכי מהיר:</strong> תקבל חשבונית במייל מספק? פשוט תעביר אותה ל-hello@amazpen.co.il והכל ייקלט אוטומטית. בלי לצלם, בלי להעלות.
</div>
      `.trim(),
    },
  },
];
