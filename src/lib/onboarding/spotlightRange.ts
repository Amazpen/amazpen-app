/**
 * עוזר לסיורי driver.js: מאיר טווח שמשתרע מאלמנט אחד עד אלמנט אחר
 * (למשל כותרת סקשן + כל הכרטיסים שתחתיה), במקום אלמנט יחיד.
 *
 * driver.js תומך ב-`element` כפונקציה שמחזירה Element. כאן אנחנו מחזירים
 * אלמנט-פרוקסי שקוף וממוקם absolute שמכסה בדיוק את הטווח המבוקש, כך
 * שה-spotlight יאיר את כל האזור. הפרוקסי מתעדכן בכל קריאה (driver קורא
 * לפונקציה מחדש בכל מעבר שלב), ולכן הוא מדויק גם אחרי גלילה או שינוי גודל.
 */

const PROXY_ID = "amazpen-tour-spotlight-proxy";

function getProxyEl(): HTMLElement {
  let el = document.getElementById(PROXY_ID);
  if (!el) {
    el = document.createElement("div");
    el.id = PROXY_ID;
    el.style.position = "absolute";
    el.style.pointerEvents = "none";
    el.style.zIndex = "-1";
    document.body.appendChild(el);
  }
  return el;
}

interface SpotlightRangeOptions {
  /**
   * אם true, הטווח נעצר ב-top של אלמנט ה-`to` (לא כולל אותו),
   * שימושי כשה-`to` הוא האלמנט שמגיע אחרי הסקשן (למשל הגרפים).
   */
  untilTopOfTo?: boolean;
}

/**
 * מחזיר פונקציה שמתאימה ל-`element` של DriveStep.
 * @param fromSelector תחילת הטווח (למשל כותרת הסקשן)
 * @param toSelector סוף הטווח (אם לא קיים, נופלים חזרה ל-from בלבד)
 * @param options אפשרויות, ראה SpotlightRangeOptions
 */
export function spotlightRange(
  fromSelector: string,
  toSelector?: string,
  options: SpotlightRangeOptions = {}
): () => Element {
  return () => {
    const from = document.querySelector(fromSelector);
    const fallback = from ?? document.body;
    if (!from) return fallback;

    const fromRect = from.getBoundingClientRect();
    const to = toSelector ? document.querySelector(toSelector) : null;
    const toRect = to ? to.getBoundingClientRect() : fromRect;

    const scrollY = window.scrollY;
    const scrollX = window.scrollX;

    // כשה-`to` הוא האלמנט שאחרי הסקשן, נעצור ב-top שלו (לא כולל אותו)
    const toBottomEdge = options.untilTopOfTo ? toRect.top : toRect.bottom;

    const top = Math.min(fromRect.top, toRect.top) + scrollY;
    const bottom = Math.max(fromRect.bottom, toBottomEdge) + scrollY;
    const left = Math.min(fromRect.left, toRect.left) + scrollX;
    const right = Math.max(fromRect.right, toRect.right) + scrollX;

    const proxy = getProxyEl();
    proxy.style.top = `${top}px`;
    proxy.style.left = `${left}px`;
    proxy.style.width = `${right - left}px`;
    proxy.style.height = `${bottom - top}px`;
    return proxy;
  };
}

/** מסיר את אלמנט הפרוקסי (לקריאה ב-onDestroyed של הסיור). */
export function removeSpotlightProxy() {
  document.getElementById(PROXY_ID)?.remove();
}
