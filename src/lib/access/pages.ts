/**
 * Per-user page access (admin "ניהול משתמשים" screen).
 *
 * One shared list of the pages an admin can switch off for a regular user.
 * Used by the admin UI (checkbox per page), the dashboard sidebar / top bar
 * (greyed-out item), the client-side redirect guard and the server-side API
 * check for the AI chat.
 *
 * Storage: `user_access_settings.blocked_pages` holds the BLOCKED keys, so a
 * missing row or an empty array means full access (existing users see no
 * change). Admins (`profiles.is_admin`) ignore these settings entirely.
 *
 * Keys are the sidebar `key` values from `src/app/(dashboard)/layout.tsx`.
 * Not listed on purpose: the dashboard `/` (cannot be blocked), logout,
 * admin-only pages (admins see them anyway) and `/agent` (not in use).
 */

export interface AccessPage {
  /** Stable key stored in user_access_settings.blocked_pages. */
  key: string;
  /** Hebrew label shown in the admin screen. */
  label: string;
  /**
   * URL paths this key covers. A path matches exactly or as a prefix
   * followed by "/". Empty for items that are not a page (מרכזת opens a modal).
   */
  paths: string[];
}

export const ACCESS_PAGES: AccessPage[] = [
  { key: "customers", label: "ניהול לקוחות", paths: ["/customers"] },
  { key: "expenses", label: "ניהול הוצאות", paths: ["/expenses"] },
  { key: "suppliers", label: "ניהול ספקים", paths: ["/suppliers"] },
  { key: "payments", label: "ניהול תשלומים", paths: ["/payments"] },
  { key: "cashflow", label: "תזרים מזומנים", paths: ["/cashflow"] },
  { key: "reports", label: "דוח רווח הפסד", paths: ["/reports"] },
  { key: "goals", label: "יעדים", paths: ["/goals"] },
  { key: "surveys", label: "סקרים", paths: ["/surveys"] },
  { key: "bonus-plans", label: "תכניות בונוסים", paths: ["/admin/bonus-plans"] },
  { key: "ocr-business", label: "קליטת מסמכים OCR", paths: ["/ocr-business", "/ocr"] },
  { key: "settings", label: "הגדרות", paths: ["/settings"] },
  { key: "ai", label: "עוזר AI", paths: ["/ai", "/agent"] },
  { key: "markezet", label: "מרכזת", paths: [] },
];

export const ACCESS_PAGE_KEYS: readonly string[] = ACCESS_PAGES.map((p) => p.key);

/** Key of the AI assistant page; also gates the /api/ai/* chat endpoints. */
export const AI_PAGE_KEY = "ai";
/** Key of the top-bar "מרכזת" button (opens the consolidated-invoice modal). */
export const MARKEZET_PAGE_KEY = "markezet";

function pathMatches(pathname: string, path: string): boolean {
  return pathname === path || pathname.startsWith(`${path}/`);
}

/** The access key that covers this pathname, or null when it is not blockable. */
export function pageKeyForPath(pathname: string): string | null {
  for (const page of ACCESS_PAGES) {
    if (page.paths.some((path) => pathMatches(pathname, path))) return page.key;
  }
  return null;
}

/** True when the pathname belongs to a page in the blocked list. */
export function isPathBlocked(pathname: string, blockedPages: readonly string[]): boolean {
  const key = pageKeyForPath(pathname);
  return key !== null && blockedPages.includes(key);
}

/** Keeps only known keys, without duplicates. Unknown / non-string values are dropped. */
export function sanitizeBlockedPages(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const known = new Set(ACCESS_PAGE_KEYS);
  const result: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && known.has(item) && !result.includes(item)) {
      result.push(item);
    }
  }
  return result;
}
