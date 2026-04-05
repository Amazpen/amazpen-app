# Security Audit — Quick Scan

**Date:** 2026-04-05 11:31
**Scope:** Entire codebase
**Focus:** Comprehensive (STRIDE + OWASP Top 10)
**Iterations:** 5
**Mode:** Report only (no auto-fix)

## Summary

- **Total Findings:** 12
  - Critical: 2 | High: 6 | Medium: 4 | Low: 0 | Info: 0
- **STRIDE Coverage:** S[✓] T[✓] R[✗] I[✓] D[✓] E[✓] — 5/6
- **OWASP Coverage:** A01[✓] A02[✗] A03[✓] A04[✓] A05[✓] A06[✗] A07[✓] A08[✗] A09[✗] A10[✓] — 6/10
- **Confirmed:** 11 | Likely: 1

## Top 3 Critical/High Findings

1. **[SQL Injection](./findings.md#finding-1)** — Direct SQL interpolation in metrics/refresh endpoint
2. **[Unauthenticated Push](./findings.md#finding-2)** — Anyone can send push notifications to any user
3. **[Open Redirect](./findings.md#finding-3)** — Auth callback redirects to unvalidated URL

## Dependency Audit

3 moderate vulnerabilities in transitive dependencies:
- `ajv` < 6.14.0 — ReDoS with `$data` option
- `bn.js` < 4.12.3 — Infinite loop
- `brace-expansion` < 1.1.13 / 2.0.0-2.0.3 — Memory exhaustion

## Priority Remediation

### Immediate (Critical — fix today)
1. **SQL Injection** in `/api/metrics/refresh` — switch to parameterized queries
2. **Add auth** to `/api/push/send` — require admin authentication

### This Week (High)
3. **Open Redirect** in auth callback — validate `next` param is relative path
4. **SSRF** in upload/transfer-url — block private IPs
5. **File Upload** bucket injection — whitelist allowed buckets
6. **Intake API** business authorization — validate key→business mapping
7. **Admin localStorage bypass** — remove client-side admin caching
8. **Cron secrets** — use timing-safe comparison

### This Month (Medium)
9. **Function() eval** — replace with math parser library
10. **CSP headers** — add Content-Security-Policy
11. **Health endpoint** — remove config exposure
12. **Rate limiting** — move to centralized solution

## Files in This Report

- [Findings](./findings.md) — All 12 findings ranked by severity with code evidence and mitigations
- [Iteration Log](./security-audit-results.tsv) — Raw iteration data

## Coverage Matrix

| OWASP Category | Tested | Findings |
|----------------|--------|----------|
| A01 Broken Access Control | ✓ | 4 |
| A02 Cryptographic Failures | ✗ | - |
| A03 Injection | ✓ | 2 |
| A04 Insecure Design | ✓ | 1 |
| A05 Security Misconfiguration | ✓ | 2 |
| A06 Vulnerable Components | ✗ | - |
| A07 Auth Failures | ✓ | 2 |
| A08 Data Integrity | ✗ | - |
| A09 Logging Failures | ✗ | - |
| A10 SSRF | ✓ | 1 |

| STRIDE Category | Tested | Findings |
|-----------------|--------|----------|
| Spoofing | ✓ | 3 |
| Tampering | ✓ | 4 |
| Repudiation | ✗ | 0 |
| Info Disclosure | ✓ | 2 |
| Denial of Service | ✓ | 1 |
| Elevation of Privilege | ✓ | 3 |
