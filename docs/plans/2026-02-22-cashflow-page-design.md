# Cash Flow Forecast Page - Design Document

**Date:** 2026-02-22
**Replaces:** Existing `/cashflow` page

## Overview

A daily cash flow forecast table showing when money **actually enters and leaves the bank account**, not when it was recorded. Based on income settlement rules per source and payment split due dates for expenses.

## Key Decisions

- **Replaces** existing `/cashflow` page (not a new route)
- **Income sources** extended with settlement rules (fields added to existing `income_sources` table)
- **Date range** is user-selectable (flexible)
- **Opening balance** entered manually per business
- **Expenses** pulled from existing `payment_splits` by `due_date`

## Page Structure

### Header

- **Opening bank balance** field — manual input with date (stored in `cashflow_settings`)
- **Date range picker** — user selects start/end dates
- **Business selector** — from DashboardContext

### Main Table (Daily View)

| תאריך | הכנסות | הוצאות | הפרש יומי | צפי תזרים |
|--------|---------|---------|------------|-----------|
| 21/02/2026 | 100 | 200 | -100 | 9,900 |

- **הכנסות** = daily_income_breakdown amounts mapped through settlement rules per income_source
- **הוצאות** = payment_splits.amount by due_date
- **הפרש יומי** = income - expenses
- **צפי תזרים** = previous day's forecast + daily difference (cumulative from opening balance)

### Drill-Down (Notes/Details)

Three-level expandable hierarchy:
1. **Month name** (click to expand) →
2. **Date** (click to expand) →
3. **Individual income/expense item**: name + amount + image (if attachment exists)

## Income Settlement Rules

New fields added to `income_sources` table:

| Field | Type | Description |
|-------|------|-------------|
| `settlement_type` | enum | `daily`, `weekly`, `monthly`, `bimonthly`, `same_day`, `custom` |
| `settlement_delay_days` | int | For cash/bank transfer: days after recording (0=same day, 1=next day) |
| `settlement_day_of_week` | int | For weekly (e.g., Wolt): which day of week (0=Sun..6=Sat) |
| `settlement_day_of_month` | int | For monthly: which day of month |
| `bimonthly_first_cutoff` | int | For bimonthly (credit): first period cutoff day (e.g., 14) |
| `bimonthly_first_settlement` | int | First settlement day (e.g., 2) |
| `bimonthly_second_settlement` | int | Second settlement day (e.g., 8) |
| `fee_percentage` | decimal | Processing fee % deducted from income |
| `coupon_settlement_date` | int | For coupons: fixed day of month when coupons are deposited |
| `coupon_range_start` | int | Coupon collection period start day |
| `coupon_range_end` | int | Coupon collection period end day |

### Settlement Logic Examples

- **Cash**: Recorded on day X → enters bank on day X + `settlement_delay_days` (default: 1)
- **Credit card (bimonthly)**: Income recorded 1st-14th → deposited on 2nd of next month. Income recorded 15th-end → deposited on 8th of next month. Minus `fee_percentage`.
- **Wolt (weekly)**: Accumulated weekly, deposited on `settlement_day_of_week`. Minus `fee_percentage`.
- **Bank transfer (same_day/daily)**: Enters on same day or next day per `settlement_delay_days`.
- **Coupons (custom)**: All coupons recorded between `coupon_range_start` and `coupon_range_end` → deposited on `coupon_settlement_date`.

## Income Override System

Users can manually edit any auto-calculated income amount (e.g., credit card amount reduced due to promotions).

**Table: `cashflow_income_overrides`**

| Field | Type | Description |
|-------|------|-------------|
| `id` | uuid | PK |
| `business_id` | uuid | FK to businesses |
| `date` | date | The settlement date |
| `income_source_id` | uuid | FK to income_sources |
| `original_amount` | decimal | Auto-calculated amount |
| `override_amount` | decimal | User-entered actual amount |
| `note` | text | Optional explanation |
| `created_by` | uuid | FK to auth.users |
| `created_at` | timestamptz | |

## Expenses

Pulled directly from `payment_splits` by `due_date` — no changes to existing mechanism.

Each expense row shows:
- Supplier name (from payment → supplier)
- Amount
- Payment method
- Attachment image (from linked invoice, if exists)

## Database Changes

### 1. Extend `income_sources` table

Add columns:
- `settlement_type` (text, default 'daily')
- `settlement_delay_days` (int, default 1)
- `settlement_day_of_week` (int, nullable)
- `settlement_day_of_month` (int, nullable)
- `bimonthly_first_cutoff` (int, nullable)
- `bimonthly_first_settlement` (int, nullable)
- `bimonthly_second_settlement` (int, nullable)
- `fee_percentage` (decimal, default 0)
- `coupon_settlement_date` (int, nullable)
- `coupon_range_start` (int, nullable)
- `coupon_range_end` (int, nullable)

### 2. New table: `cashflow_settings`

| Field | Type |
|-------|------|
| `id` | uuid PK |
| `business_id` | uuid FK UNIQUE |
| `opening_balance` | decimal |
| `opening_date` | date |
| `created_at` | timestamptz |
| `updated_at` | timestamptz |

### 3. New table: `cashflow_income_overrides`

(See schema above)

## Settings UI

Income source settlement configuration will be added to the existing income sources settings page (where users already manage their income sources). Each income source gets a "settlement rules" section with the relevant fields based on `settlement_type`.

## UI Reference

The table design follows the profit & loss report style (expandable rows, Hebrew RTL, dark theme, same card/table components).
