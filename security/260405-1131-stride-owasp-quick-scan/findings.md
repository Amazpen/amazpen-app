# ממצאי אבטחה — המצפן (Amazpen)

## ממצאים קריטיים

### Finding 1: SQL Injection — metrics/refresh {#finding-1}
- **OWASP:** A03 Injection
- **STRIDE:** Tampering
- **Location:** `src/app/api/metrics/refresh/route.ts:47-52`
- **Confidence:** Confirmed
- **Description:** Direct SQL string interpolation with unescaped `bizId` parameter via `execReadOnlyQuery()`. Multiple occurrences across lines 47-52, 66-76, 188-200, 242-249, 264-269, 301-316.
- **Attack Scenario:**
  1. Attacker sends crafted `businessId` in request body
  2. Value interpolated directly into SQL: `` `WHERE business_id = '${bizId}'` ``
  3. Attacker extracts data from other businesses via UNION-based injection
- **Code Evidence:**
  ```typescript
  `SELECT ... WHERE business_id = '${bizId}' ...`
  ```
- **Mitigation:**
  ```typescript
  // Use parameterized queries via Supabase SDK
  const { data } = await supabase
    .from('business_monthly_metrics')
    .select('*')
    .eq('business_id', bizId);
  ```

---

### Finding 2: Unauthenticated Push Notification Endpoint {#finding-2}
- **OWASP:** A07 Auth Failures
- **STRIDE:** Spoofing
- **Location:** `src/app/api/push/send/route.ts`
- **Confidence:** Confirmed
- **Description:** No authentication on push notification endpoint. Anyone can send notifications to any user by providing their userId. `userIds` parameter accepted directly in request body with no validation.
- **Attack Scenario:**
  1. Attacker discovers `/api/push/send` endpoint
  2. Sends POST with arbitrary `userIds` and custom `title`/`message`
  3. All targeted users receive fake push notifications (phishing)
- **Mitigation:**
  ```typescript
  // Add auth check at top of handler
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // Also verify user is admin
  ```

---

## ממצאים חמורים (High)

### Finding 3: Open Redirect in Auth Callback {#finding-3}
- **OWASP:** A01 Broken Access Control
- **STRIDE:** Spoofing
- **Location:** `src/app/auth/callback/route.ts:13`
- **Confidence:** Confirmed
- **Description:** Auth callback accepts user-controlled `next` parameter and redirects without validation. Allows redirect to arbitrary URLs via protocol-relative paths.
- **Attack Scenario:**
  1. Attacker crafts link: `/auth/callback?next=//evil.com`
  2. User completes OAuth login
  3. Redirected to `https://evil.com` (phishing page)
- **Mitigation:**
  ```typescript
  const next = searchParams.get("next") ?? "/";
  // Validate: must be relative path, no protocol
  const safePath = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  return NextResponse.redirect(`${origin}${safePath}`);
  ```

---

### Finding 4: SSRF via URL Transfer {#finding-4}
- **OWASP:** A10 SSRF
- **STRIDE:** Tampering
- **Location:** `src/app/api/upload/transfer-url/route.ts:55-79`
- **Confidence:** Confirmed
- **Description:** Server fetches user-provided URL without validating against private IP ranges. Protocol-relative URL conversion (`//`) enables SSRF. Can access internal services, cloud metadata endpoints (169.254.169.254).
- **Attack Scenario:**
  1. Attacker sends `{ url: "//169.254.169.254/latest/meta-data/" }`
  2. Server converts to `https:169.254.169.254/...` and fetches
  3. Cloud metadata (including IAM credentials) returned to attacker
- **Mitigation:**
  ```typescript
  const parsed = new URL(url);
  const blocklist = ['127.0.0.1', 'localhost', '169.254.169.254', '10.', '192.168.', '172.16.'];
  if (blocklist.some(b => parsed.hostname.startsWith(b))) {
    return NextResponse.json({ error: 'Blocked URL' }, { status: 400 });
  }
  ```

---

### Finding 5: Unsafe File Upload — Bucket/Path Injection {#finding-5}
- **OWASP:** A01 Broken Access Control
- **STRIDE:** Elevation of Privilege
- **Location:** `src/app/api/upload/route.ts:27`
- **Confidence:** Confirmed
- **Description:** `bucket` and `path` parameters from user input without validation. User can upload to any Supabase Storage bucket or use path traversal (`../../sensitive/file`).
- **Mitigation:**
  ```typescript
  const ALLOWED_BUCKETS = ['assets', 'documents', 'avatars'];
  const bucket = formData.get("bucket") as string || "assets";
  if (!ALLOWED_BUCKETS.includes(bucket)) {
    return NextResponse.json({ error: 'Invalid bucket' }, { status: 400 });
  }
  ```

---

### Finding 6: Missing Business Authorization on Intake Endpoints {#finding-6}
- **OWASP:** A01 Broken Access Control
- **STRIDE:** Elevation of Privilege
- **Location:** `src/app/api/intake/daily-entry/route.ts:25-28`
- **Confidence:** Confirmed
- **Description:** API key validates existence but does NOT verify which business the key belongs to. Any valid API key can create entries for ANY `business_id` in request body.
- **Mitigation:** Embed business_id in the API key or validate key-to-business mapping.

---

### Finding 7: Client-Side Admin Bypass via localStorage {#finding-7}
- **OWASP:** A01 Broken Access Control
- **STRIDE:** Elevation of Privilege
- **Location:** `src/app/(dashboard)/layout.tsx:270`
- **Confidence:** Confirmed
- **Description:** `isAdmin` status cached in localStorage. Attacker can set `localStorage.isAdmin='true'` to reveal admin UI menu items before server validates. Server-side API checks prevent actual unauthorized actions.
- **Impact:** Information disclosure (admin route paths exposed), UX bypass.
- **Mitigation:** Remove localStorage caching of admin status; fetch only from server.

---

### Finding 8: Weak Cron Secret Comparison {#finding-8}
- **OWASP:** A07 Auth Failures
- **STRIDE:** Spoofing
- **Location:** `src/app/api/reminders/check-missing/route.ts:15-16`
- **Confidence:** Confirmed
- **Description:** Cron endpoints use non-timing-constant string comparison for secret validation. Also accept secret via query parameter (URL exposure in logs). Vulnerable to timing attacks.
- **Mitigation:** Use `crypto.timingSafeEqual()` for comparison; remove query param fallback.

---

## ממצאים בינוניים (Medium)

### Finding 9: Unsafe Function() Expression Evaluation {#finding-9}
- **OWASP:** A03 Injection
- **STRIDE:** Tampering
- **Location:** `src/app/api/ai/chat/route.ts:92-100`, `src/components/ocr/OCRForm.tsx`
- **Confidence:** Likely
- **Description:** Math calculator uses `new Function()` with regex blacklist. Blacklist can be bypassed via unicode/hex escapes (`\u0046unction`).
- **Mitigation:** Replace with math expression parser library (mathjs, expr-eval).

---

### Finding 10: Missing CSP Headers {#finding-10}
- **OWASP:** A05 Security Misconfiguration
- **STRIDE:** Tampering
- **Location:** `next.config.ts`
- **Confidence:** Confirmed
- **Description:** No Content-Security-Policy headers configured. Increases XSS blast radius.
- **Mitigation:** Add CSP headers in next.config.ts headers() function.

---

### Finding 11: Health Endpoint Leaks Configuration {#finding-11}
- **OWASP:** A05 Security Misconfiguration
- **STRIDE:** Information Disclosure
- **Location:** `src/app/api/health/route.ts:8-12`
- **Confidence:** Confirmed
- **Description:** Public `/api/health` returns booleans indicating which API keys are configured (GOOGLE_VISION, OPENAI, SUPABASE). Helps attackers profile the system.
- **Mitigation:** Return only `{ status: "ok" }` on public health endpoint.

---

### Finding 12: In-Memory Rate Limiting {#finding-12}
- **OWASP:** A04 Insecure Design
- **STRIDE:** Denial of Service
- **Location:** `src/app/api/ai/chat/route.ts:9-24`
- **Confidence:** Confirmed
- **Description:** Rate limiting uses in-memory Map, lost on server restart. In multi-instance deployments, each instance has independent limits.
- **Mitigation:** Use centralized rate limiting (Redis, Upstash, or Supabase-based).
