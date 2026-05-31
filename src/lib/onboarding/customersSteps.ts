import type { DriveStep } from "driver.js";

/**
 * שלבי הסיור של דף ניהול הלקוחות (עסקי נותני שירות).
 *
 * חלק מהמסך חי בתוך חלונות נפתחים (Sheet/Dialog של Radix) שלא ניתן לנווט
 * אליהם בבטחה תוך כדי סיור, לכן את התוכן שלהם מסבירים בעזרת דמו ויזואלי
 * מוטמע בתוך כרטיס הסיור עצמו (אותו דפוס כמו בסיור ההוצאות).
 * כל שלב שמצביע על אלמנט אמיתי משתמש ב-id="onboarding-customers-*" שקיים בדף.
 * אין שימוש בתו em dash בתוכן.
 */

/** דמו ויזואלי של טופס הקמת לקוח חדש, מוצג בתוך כרטיס הסיור. */
const ADD_CUSTOMER_DEMO = `
<div style="margin-top:12px;border:1px solid rgba(255,255,255,0.14);border-radius:10px;padding:12px;background:rgba(0,0,0,0.12);">
  <div style="font-size:11px;color:rgba(255,255,255,0.55);margin-bottom:10px;font-weight:600;">דוגמה לטופס הקמת לקוח</div>

  <div style="margin-bottom:8px;">
    <div style="font-size:11px;color:rgba(255,255,255,0.7);margin-bottom:3px;">שם לקוח / נותן שירות</div>
    <div style="border:1px solid #727BA0;border-radius:6px;padding:5px 8px;font-size:12px;color:#fff;background:rgba(0,0,0,0.2);">סטודיו ראם</div>
  </div>

  <div style="margin-bottom:8px;">
    <div style="font-size:11px;color:rgba(255,255,255,0.7);margin-bottom:3px;">שם העסק</div>
    <div style="border:1px solid #727BA0;border-radius:6px;padding:5px 8px;font-size:12px;color:#fff;background:rgba(0,0,0,0.2);">ראם עיצובים בע"מ</div>
  </div>

  <div style="border:1px solid rgba(124,58,237,0.4);border-radius:8px;padding:10px;background:rgba(107,33,168,0.12);margin-bottom:8px;">
    <div style="font-size:12px;font-weight:700;color:#C4B5FD;margin-bottom:8px;">תנאי התשלום</div>
    <div style="display:flex;gap:8px;margin-bottom:8px;">
      <div style="flex:1;">
        <div style="font-size:11px;color:rgba(255,255,255,0.7);margin-bottom:3px;">סכום לפני מע"מ</div>
        <div style="border:1px solid #727BA0;border-radius:6px;padding:5px 8px;font-size:12px;color:#fff;background:rgba(0,0,0,0.2);">₪ 3,000</div>
      </div>
      <div style="flex:1;">
        <div style="font-size:11px;color:rgba(255,255,255,0.7);margin-bottom:3px;">כולל מע"מ</div>
        <div style="border:1px solid #727BA0;border-radius:6px;padding:5px 8px;font-size:12px;color:#C4B5FD;background:rgba(0,0,0,0.2);">₪ 3,510</div>
      </div>
    </div>
    <div style="display:flex;gap:8px;">
      <div style="flex:1;">
        <div style="font-size:11px;color:rgba(255,255,255,0.7);margin-bottom:3px;">סוג תשלום</div>
        <div style="border:1px solid #727BA0;border-radius:6px;padding:5px 8px;font-size:12px;color:#fff;background:rgba(0,0,0,0.2);">ריטיינר חודשי</div>
      </div>
      <div style="flex:1;">
        <div style="font-size:11px;color:rgba(255,255,255,0.7);margin-bottom:3px;">יום חיוב בחודש</div>
        <div style="border:1px solid #727BA0;border-radius:6px;padding:5px 8px;font-size:12px;color:#fff;background:rgba(0,0,0,0.2);">1 לחודש</div>
      </div>
    </div>
  </div>

  <div style="display:flex;align-items:center;gap:6px;font-size:12px;color:rgba(255,255,255,0.85);margin-bottom:6px;">
    <span style="display:inline-flex;width:15px;height:15px;border-radius:4px;background:#0BB783;color:#fff;align-items:center;justify-content:center;font-size:11px;font-weight:700;">✓</span>
    התשלום הראשון כבר שולם (העברה בנקאית)
  </div>
  <div style="font-size:12px;color:rgba(255,255,255,0.7);">תשלומים נוספים: דמי הקמה ₪1,500</div>
</div>`;

const ADD_CUSTOMER_DESCRIPTION = `<div>בלחיצה כאן נפתח טופס להקמת לקוח חדש. מזינים את שם הלקוח ושם העסק, ומגדירים את תנאי התשלום: סכום הריטיינר (לפני מע"מ), סוג התשלום (ריטיינר חודשי, חד פעמי, או מתמשך למספר חודשים), יום החיוב בחודש ותאריך תחילת הריטיינר. כל לקוח שמוקם מצטרף מיד לסיכום ההכנסות החודשי ולמעקב הגבייה.</div>
<div style="margin-top:10px;border:1px solid rgba(255,255,255,0.25);border-radius:8px;padding:9px 11px;background:rgba(11,183,131,0.12);">
  <div style="font-size:12px;font-weight:700;color:#7ee0bd;margin-bottom:3px;">קליטת תשלומים כבר בהקמה</div>
  <div style="font-size:12px;line-height:1.55;color:rgba(255,255,255,0.85);">אפשר לסמן ש"התשלום הראשון כבר שולם" ולבחור אמצעי תשלום, וגם להוסיף תשלומים חד-פעמיים נוספים כמו דמי הקמה. כך הגבייה מתעדכנת כבר ברגע הקמת הלקוח, בלי להזין תשלום בנפרד.</div>
</div>
<div style="margin-top:10px;">תחת "לעדכון פרטים נוספים" אפשר להוסיף טלפון ומייל ליצירת קשר, ע.מ/ח.פ, מקור הגעה, הסכם עבודה מצורף, סימון לקוח חו"ל (ללא מע"מ), ולקשר את הריטיינר למקור הכנסה קיים בדשבורד.</div>
<div style="margin-top:10px;">כך נראה הטופס בפועל:</div>${ADD_CUSTOMER_DEMO}`;

/** דמו ויזואלי של טבלת הגבייה החודשית בכרטיס הלקוח. */
const BILLING_DEMO = `
<div style="margin-top:12px;border:1px solid rgba(255,255,255,0.14);border-radius:10px;padding:12px;background:rgba(0,0,0,0.12);">
  <div style="display:flex;gap:6px;margin-bottom:10px;">
    <div style="flex:1;text-align:center;border:1px solid rgba(255,255,255,0.12);border-radius:6px;padding:6px 4px;">
      <div style="font-size:10px;color:rgba(255,255,255,0.6);">סה"כ צריך לשלם</div>
      <div style="font-size:13px;font-weight:700;color:#fff;">₪ 10,530</div>
    </div>
    <div style="flex:1;text-align:center;border:1px solid rgba(255,255,255,0.12);border-radius:6px;padding:6px 4px;">
      <div style="font-size:10px;color:rgba(255,255,255,0.6);">סה"כ שולם</div>
      <div style="font-size:13px;font-weight:700;color:#0BB783;">₪ 7,020</div>
    </div>
    <div style="flex:1;text-align:center;border:1px solid rgba(255,255,255,0.12);border-radius:6px;padding:6px 4px;">
      <div style="font-size:10px;color:rgba(255,255,255,0.6);">פתוח לתשלום</div>
      <div style="font-size:13px;font-weight:700;color:#F64E60;">₪ 3,510</div>
    </div>
  </div>
  <div style="display:flex;font-size:10px;color:rgba(255,255,255,0.5);padding:0 4px 4px;border-bottom:1px solid rgba(255,255,255,0.1);">
    <span style="flex:1.2;">חודש</span><span style="flex:1;text-align:center;">לחיוב</span><span style="flex:1;text-align:center;">שולם</span><span style="flex:1;text-align:center;">סטטוס</span>
  </div>
  <div style="display:flex;align-items:center;font-size:11px;color:#fff;padding:6px 4px;">
    <span style="flex:1.2;">מרץ 2026</span><span style="flex:1;text-align:center;">₪3,510</span><span style="flex:1;text-align:center;color:#0BB783;">₪3,510</span><span style="flex:1;text-align:center;"><span style="background:rgba(11,183,131,0.2);color:#0BB783;border-radius:9px;padding:1px 7px;font-size:10px;font-weight:700;">שולם</span></span>
  </div>
  <div style="display:flex;align-items:center;font-size:11px;color:#fff;padding:6px 4px;">
    <span style="flex:1.2;">אפריל 2026</span><span style="flex:1;text-align:center;">₪3,510</span><span style="flex:1;text-align:center;color:#0BB783;">₪3,510</span><span style="flex:1;text-align:center;"><span style="background:rgba(11,183,131,0.2);color:#0BB783;border-radius:9px;padding:1px 7px;font-size:10px;font-weight:700;">שולם</span></span>
  </div>
  <div style="display:flex;align-items:center;font-size:11px;color:#fff;padding:6px 4px;">
    <span style="flex:1.2;">מאי 2026</span><span style="flex:1;text-align:center;">₪3,510</span><span style="flex:1;text-align:center;color:rgba(255,255,255,0.4);">—</span><span style="flex:1;text-align:center;"><span style="background:rgba(246,78,96,0.2);color:#F64E60;border-radius:9px;padding:1px 7px;font-size:10px;font-weight:700;">פתוח</span></span>
  </div>
</div>`;

const DETAIL_BILLING_DESCRIPTION = `<div>לחיצה על כרטיס לקוח פותחת את כרטיס הלקוח המלא, מרכז הניהול של אותו לקוח. בראש הכרטיס מוצגים פרטי הלקוח ופרטי הריטיינר, ולצדם כפתורי ניהול הריטיינר: <b>השהיית</b> ריטיינר באופן זמני, <b>חידוש</b> ריטיינר מושהה, או <b>עצירת ריטיינר מתאריך</b> מסוים (שגם קובע את תאריך הסיום).</div>
<div style="margin-top:10px;">החלק החשוב ביותר הוא <b>מעקב הגבייה החודשי</b>: טבלה שמראה חודש-אחר-חודש כמה הלקוח אמור לשלם, כמה שולם בפועל וכמה עדיין פתוח, עם סטטוס צבעוני (שולם / חלקי / פתוח / עודף). כך רואים מיד אם לקוח בפיגור.</div>
<div style="margin-top:10px;">בתחתית הכרטיס מנהלים את <b>ההכנסות והתשלומים</b>: רשימת התשלומים לפי חודש, סך הכל לכל התקופה, וכפתור "הוספת תשלום" שמתמלא אוטומטית בסכום ובאמצעי התשלום של הלקוח ומציג את פירוק המע"מ.</div>
<div style="margin-top:10px;">כך נראה מעקב הגבייה:</div>${BILLING_DEMO}`;

const DETAIL_MORE_DESCRIPTION = `<div>כרטיס הלקוח מרכז עוד כלים לניהול מלא של הקשר עם הלקוח:</div>
<ul style="margin:10px 0 0;padding-inline-start:18px;font-size:13px;line-height:1.7;color:rgba(255,255,255,0.88);">
  <li><b>מוצרים ושירותים</b> - הוספת חיובים חד-פעמיים מעבר לריטיינר (למשל "עיצוב לוגו"), עם סכום, תאריך והערות.</li>
  <li><b>מסמכים</b> - העלאת מסמכים הקשורים ללקוח (חוזים, אישורים) וצפייה בהם, בנוסף להסכם העבודה שצורף בהקמה.</li>
  <li><b>סקר לקוח יוצא</b> - כשריטיינר מסתיים אפשר לשלוח ללקוח קישור לסקר עזיבה ולראות את התשובות (דירוג, סיבות עזיבה, NPS והערות).</li>
  <li><b>משתמשים פעילים</b> - אם הלקוח מחובר לעסק במערכת, מוצגים חברי הצוות והתפקידים שלהם.</li>
</ul>
<div style="margin-top:10px;border:1px solid rgba(255,255,255,0.25);border-radius:8px;padding:9px 11px;background:rgba(107,33,168,0.18);">
  <div style="font-size:12px;line-height:1.55;color:rgba(255,255,255,0.85);">מחיקת לקוח אפשרית רק כשעדיין לא נרשמו לו תשלומים, כדי לא לאבד היסטוריית הכנסות. לעדכון פרטים יש להשתמש בכפתור העריכה שבראש הכרטיס.</div>
</div>`;

export const customersSteps: DriveStep[] = [
  {
    popover: {
      title: "ניהול הלקוחות שלך",
      description:
        "במסך הזה מרכזים את כל הלקוחות של העסק במקום אחד: מי משלם ריטיינר חודשי, מי בהקמה, כמה כל לקוח חייב וכמה הכנסה קבועה נכנסת בכל חודש. ניהול מסודר של הלקוחות מאפשר לראות במבט אחד את בריאות ההכנסות של העסק ולזהות לקוחות שדורשים תשומת לב. הסיור הקצר הזה יעבור על כל חלק במסך, כולל מה שמסתתר בתוך טופס ההקמה וכרטיס הלקוח.",
    },
  },
  {
    element: "#onboarding-customers-summary",
    popover: {
      title: "תמונת מצב פיננסית",
      description:
        "בראש המסך מוצגים שלושה מדדי מפתח: 'הכנסה חודשית מריטיינרים' (סכום כל הריטיינרים הפעילים יחד), 'חייבים לי' (סך החובות הפתוחים של כל הלקוחות, באדום) ו'לקוחות פעילים' (כמה לקוחות פעילים יש כרגע). המדדים האלה נותנים לך מיד את התמונה הגדולה: כמה הכנסה קבועה צפויה, כמה כסף ממתין לגבייה וכמה לקוחות פעילים מולך.",
      side: "bottom",
      align: "center",
    },
  },
  {
    element: "#onboarding-customers-add",
    popover: {
      title: "הקמת לקוח חדש",
      description: ADD_CUSTOMER_DESCRIPTION,
      side: "bottom",
      align: "start",
    },
  },
  {
    element: "#onboarding-customers-search",
    popover: {
      title: "חיפוש וספירת לקוחות",
      description:
        "כאן מוצג מספר הלקוחות הכולל, ולחיצה על אייקון הזכוכית פותחת שדה חיפוש מהיר לאיתור לקוח לפי שם, שם עסק או ח.פ. כשיש הרבה לקוחות זו הדרך המהירה ביותר להגיע ללקוח מסוים. אגב, את הסיור הזה אפשר להפעיל שוב בכל רגע דרך כפתור העזרה הכתום (?) שמופיע כאן.",
      side: "bottom",
      align: "start",
    },
  },
  {
    element: "#onboarding-customers-grid",
    popover: {
      title: "כרטיסי הלקוחות",
      description:
        "כל לקוח מוצג ככרטיס עם שמו וסכום הריטיינר. תווית הסטטוס מציינת אם הריטיינר פעיל, מושהה או הסתיים; תווית 'חייב' באדום מציגה חוב פתוח; 'טרם הוקם' מסמנת לקוח שעדיין לא הוגדרו לו תנאי תשלום; ו'לא פעיל' מסמנת לקוח שאינו פעיל (הכרטיס שלו מעומעם). לחיצה על כרטיס פותחת את כרטיס הלקוח המלא, שעליו נעבור בשני השלבים הבאים.",
      side: "top",
      align: "center",
    },
  },
  {
    popover: {
      title: "כרטיס הלקוח: ריטיינר וגבייה",
      description: DETAIL_BILLING_DESCRIPTION,
    },
  },
  {
    popover: {
      title: "כרטיס הלקוח: שירותים, מסמכים וסקר",
      description: DETAIL_MORE_DESCRIPTION,
    },
  },
];
