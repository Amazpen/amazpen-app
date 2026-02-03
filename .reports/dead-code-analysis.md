# Dead Code Analysis Report

**Generated:** 2026-02-04
**Project:** amazpen-app
**Build Status:** Passing

---

## Cleanup Completed

The following items were safely deleted with build verification after each step:

| Item | Type | Status |
|------|------|--------|
| `src/components/ui/avatar.tsx` | Unused component | DELETED |
| `src/components/ui/card.tsx` | Unused component | DELETED |
| `src/components/ocr/index.ts` | Unused barrel export | DELETED |
| `getStatusColor()` in ocr.ts | Unused function | DELETED |
| `getSourceLabel()` in ocr.ts | Unused function | DELETED |
| `@radix-ui/react-avatar` | Unused dependency | REMOVED |

**Build verification:** Passed after all changes

---

## Summary

| Category | Count | Action |
|----------|-------|--------|
| ~~Unused UI Components~~ | ~~2~~ | CLEANED |
| Unused Type Definitions | 7 | CAUTION |
| ~~Unused Helper Functions~~ | ~~2~~ | CLEANED |
| ~~Unused Barrel Export~~ | ~~1~~ | CLEANED |
| Mock Data | 1 | CAUTION (used in development) |
| Backup Directory | 1 | SAFE to delete |

---

## SAFE TO DELETE

### ~~1. Unused UI Components~~ - CLEANED

~~`src/components/ui/avatar.tsx`~~ - **DELETED**
~~`src/components/ui/card.tsx`~~ - **DELETED**

### ~~2. Unused Helper Functions~~ - CLEANED

~~`getStatusColor()` in ocr.ts~~ - **DELETED**
~~`getSourceLabel()` in ocr.ts~~ - **DELETED**

### ~~3. Unused Barrel Export~~ - CLEANED

~~`src/components/ocr/index.ts`~~ - **DELETED**

### 4. Backup Directory

#### `_backup/`
- **Severity:** SAFE
- **Reason:** Development backup folder, not part of application code
- **Contents:**
  - `flow.json` (n8n workflow backup)
  - `תמונות אפליקציה/` (app screenshots folder)
- **Action:** Consider moving to a separate location or adding to .gitignore

---

## CAUTION - Review Before Deleting

### 1. Unused Type Definitions (in `src/types/index.ts`)

These types are defined but not imported anywhere. They may be:
- Planned for future use
- Required for database schema documentation
- Used by external tools/scripts

| Type | Used |
|------|------|
| `BusinessSchedule` | No |
| `UserBusiness` | No (variable names with similar names exist) |
| `NavItem` | No |
| `DailyIncomeBreakdown` | No |
| `DailyReceipt` | No |
| `DailyParameter` | No |
| `DailyProductUsage` | No |

**Recommendation:** Keep for now - these likely map to database tables and provide type safety for future features.

### 2. Unused OCR Type

#### `OCRLineItem` (in `src/types/ocr.ts`)
- **Severity:** CAUTION
- **Reason:** Referenced only in `OCRExtractedData.line_items` type definition, but `line_items` is never actually used in the codebase
- **Recommendation:** Keep if OCR line item parsing is planned

### 3. Mock Data

#### `MOCK_DOCUMENTS` (in `src/types/ocr.ts`)
- **Severity:** CAUTION
- **Reason:** Used in `src/app/(dashboard)/ocr/page.tsx` for development
- **Recommendation:** Keep for development, consider removing before production

---

## DANGER - Do Not Delete

### Config Files
- `next.config.ts` - Essential
- `tsconfig.json` - Essential
- `tailwind.config.ts` - Essential
- `postcss.config.mjs` - Essential

### Entry Points
- `src/app/layout.tsx` - Root layout
- `src/app/(dashboard)/layout.tsx` - Dashboard layout
- `src/app/(auth)/layout.tsx` - Auth layout

### API Routes
- `src/app/api/admin/create-user/route.ts`
- `src/app/api/admin/update-user-password/route.ts`
- `src/app/api/health/route.ts`
- `src/app/api/upload/route.ts`

---

## Dependency Analysis

### ~~Unused npm Dependencies~~ - CLEANED

~~`@radix-ui/react-avatar`~~ - **REMOVED** from package.json

All remaining dependencies are actively used in the codebase.

---

## Recommended Cleanup Actions

### ~~Phase 1 - Safe Deletions (No Risk)~~ - COMPLETED
1. ~~Delete `src/components/ui/avatar.tsx`~~ - Done
2. ~~Delete `src/components/ui/card.tsx`~~ - Done
3. ~~Delete `src/components/ocr/index.ts`~~ - Done
4. ~~Remove `getStatusColor` and `getSourceLabel` from `src/types/ocr.ts`~~ - Done
5. ~~Remove `@radix-ui/react-avatar` from package.json~~ - Done

### Phase 2 - After Verification (Manual Review Required)
1. Review if `_backup/` should be in .gitignore or deleted
2. Review unused types in `src/types/index.ts` with team

### Phase 3 - Before Production
1. Consider removing `MOCK_DOCUMENTS` from `src/types/ocr.ts`
2. Remove or replace mock data usage in `src/app/(dashboard)/ocr/page.tsx`

---

## Verification Commands

```bash
# Build verification
npm run build

# Lint check
npm run lint

# Type check
npx tsc --noEmit
```

---

## Notes

- Build passes with current code
- No circular dependencies detected
- All imports resolve correctly
- UI components are from shadcn/ui and can be regenerated if needed
