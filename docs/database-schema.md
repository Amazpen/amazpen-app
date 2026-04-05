# AmazPen Database Schema - ארכיטקטורת מסד נתונים

## סקירה כללית

מערכת Multi-Tenant לניהול עסקי עם Supabase Auth, RLS, Realtime, Audit Log, Soft Delete.
כל הטבלאות מפורסמות ב-Realtime (59 טבלאות סה"כ).

**קונבנציות:** UUID PK עם `gen_random_uuid()`, `created_at`/`updated_at` TIMESTAMPTZ DEFAULT NOW(), `deleted_at` ל-soft delete. כל טבלה עם `business_id` מוגנת ב-RLS דרך `business_members`.

---

## טבלאות ליבה (Core)

### 1. `profiles` - פרופילי משתמשים
`id` UUID PK→auth.users | `email` TEXT NOT NULL | `full_name` TEXT | `phone` TEXT | `avatar_url` TEXT | timestamps + soft delete

### 2. `businesses` - עסקים
`id` UUID PK | `name` TEXT NOT NULL | `business_type` TEXT NOT NULL | `status` TEXT DEFAULT 'active' | `tax_id` TEXT | `address/city/phone/email/logo_url` TEXT | `currency` TEXT DEFAULT 'ILS' | `fiscal_year_start` INT DEFAULT 1 | timestamps + soft delete

### 3. `business_members` - חברי עסק (RBAC)
`id` UUID PK | `business_id` FK→businesses | `user_id` FK→profiles | `role` TEXT CHECK (owner/manager/employee) | `permissions` JSONB DEFAULT '{}' | `invited_at/joined_at` TIMESTAMPTZ | timestamps + soft delete | UNIQUE(business_id, user_id)

---

## הגדרות עסק (Business Configuration)

### 4. `business_schedule` - לוח זמנים עסקי
`id` UUID PK | `business_id` FK→businesses | `day_of_week` INT 0-6 (0=ראשון) | `day_factor` DECIMAL(3,2) 0-1 | timestamps | UNIQUE(business_id, day_of_week)

### 5. `business_day_exceptions` - חריגים ללוח זמנים
`id` UUID PK | `business_id` FK→businesses | `exception_date` DATE NOT NULL | `day_factor` NUMERIC DEFAULT 0 | `note` TEXT | `created_by` FK→profiles | timestamps

### 6. `business_monthly_settings` - הגדרות חודשיות (מרקאפ, מע"מ)
`id` UUID PK | `business_id` FK→businesses | `month_year` TEXT NOT NULL (YYYY-MM) | `markup_percentage` NUMERIC DEFAULT 1.00 | `vat_percentage` NUMERIC DEFAULT 0.18 | timestamps

### 7. `business_credit_cards` - כרטיסי אשראי עסקיים
`id` UUID PK | `business_id` FK→businesses | `card_name` TEXT NOT NULL | `last_four_digits` TEXT | `card_type` TEXT (visa/mastercard/amex/diners/isracard) | `billing_day` INT 1-31 | `credit_limit` DECIMAL(12,2) | `is_active` BOOLEAN | `notes` TEXT | timestamps + soft delete | UNIQUE(business_id, card_name)

### 8. `income_sources` - מקורות הכנסה (דינמי)
`id` UUID PK | `business_id` FK→businesses | `name` TEXT NOT NULL (קופה, 10ביס וכו') | `display_order` INT | `is_active` BOOLEAN | timestamps + soft delete | UNIQUE(business_id, name)

### 9. `expense_categories` - קטגוריות הוצאות (היררכי)
`id` UUID PK | `business_id` FK→businesses | `parent_id` FK→self (NULL=ראשי) | `name` TEXT NOT NULL | `description` TEXT | `display_order` INT | `is_active` BOOLEAN | timestamps + soft delete | UNIQUE(business_id, name, parent_id)

### 10. `custom_parameters` - פרמטרים מותאמים למילוי יומי
`id` UUID PK | `business_id` FK→businesses | `name` TEXT NOT NULL | `input_type` TEXT DEFAULT 'single' | `display_order` INT | `is_active` BOOLEAN | timestamps + soft delete

### 11. `receipt_types` - סוגי קבלות למילוי יומי
`id` UUID PK | `business_id` FK→businesses | `name` TEXT NOT NULL | `input_type` TEXT DEFAULT 'single' | `display_order` INT | `is_active` BOOLEAN | timestamps + soft delete

### 12. `payment_method_types` - אמצעי תשלום (Enum)
`id` TEXT PK | `name_he` TEXT NOT NULL | `display_order` INT
ערכים: bank_transfer, cash, check, bit, paybox, credit_card, credit_company, standing_order, other

---

## ספקים והוצאות (Suppliers & Expenses)

### 13. `suppliers` - ספקים
```sql
-- פרטי ספק
id UUID PK | business_id FK→businesses | name TEXT NOT NULL
expense_type TEXT NOT NULL (current_expenses/goods_purchases/employee_costs)
expense_category_id FK→expense_categories | parent_category_id UUID
expense_nature TEXT (fixed/variable)
contact_name/phone/email/address/tax_id TEXT
-- תנאי תשלום
payment_terms_days INT DEFAULT 30 | requires_vat BOOLEAN DEFAULT true
vat_type TEXT DEFAULT 'full' | default_credit_card_id FK→business_credit_cards
default_payment_method TEXT | default_discount_percentage NUMERIC DEFAULT 0
-- הוצאה קבועה
is_fixed_expense BOOLEAN DEFAULT false | charge_day INT | monthly_expense_amount NUMERIC
-- התחייבויות קודמות
has_previous_obligations BOOLEAN DEFAULT false
obligation_total_amount/terms/first_charge_date/num_payments/monthly_amount/document_url
-- אחר
waiting_for_coordinator BOOLEAN | request_karteset BOOLEAN
document_url/notes TEXT | is_active BOOLEAN | timestamps + soft delete
```

### 14. `invoices` - חשבוניות/הוצאות
`id` UUID PK | `business_id` FK→businesses | `supplier_id` FK→suppliers | `invoice_number` TEXT | `invoice_date` DATE NOT NULL | `due_date` DATE | `subtotal` DECIMAL(12,2) | `vat_amount` DECIMAL(10,2) | `total_amount` DECIMAL(12,2) | `status` TEXT (pending/partial/paid/cancelled) | `amount_paid` DECIMAL(12,2) | `attachment_url` TEXT | `notes` TEXT | `created_by` FK→profiles | timestamps + soft delete

### 15. `delivery_notes` - תעודות משלוח
`id` UUID PK | `business_id` FK→businesses | `supplier_id` FK→suppliers | `invoice_id` FK→invoices | `delivery_note_number` TEXT | `delivery_date` DATE NOT NULL | `subtotal` NUMERIC | `discount_amount/discount_percentage` NUMERIC DEFAULT 0 | `vat_amount` NUMERIC | `total_amount` NUMERIC | `attachment_url` TEXT | `is_verified` BOOLEAN DEFAULT false | `notes` TEXT | `created_by` FK→profiles | timestamps

### 16. `payments` - תשלומים
`id` UUID PK | `business_id` FK→businesses | `supplier_id` FK→suppliers | `payment_date` DATE NOT NULL | `total_amount` DECIMAL(12,2) | `invoice_id` FK→invoices | `notes` TEXT | `created_by` FK→profiles | timestamps + soft delete

### 17. `payment_splits` - פיצול תשלום
`id` UUID PK | `payment_id` FK→payments (CASCADE) | `payment_method` FK→payment_method_types | `amount` DECIMAL(12,2) | `credit_card_id` FK→business_credit_cards | `check_number/check_date/reference_number` | `installments_count/installment_number` INT DEFAULT 1 | `created_at`

### 18. `supplier_budgets` - תקציב חודשי לספק
`id` UUID PK | `supplier_id` FK→suppliers | `business_id` FK→businesses | `year/month` INT | `budget_amount` NUMERIC DEFAULT 0 | `notes` TEXT | timestamps + soft delete

### 19. `supplier_documents` - מסמכי ספק
`id` UUID PK | `supplier_id` FK→suppliers | `business_id` FK→businesses | `description` TEXT NOT NULL | `document_url` TEXT NOT NULL | `created_at`

### 20. `prior_commitments` - התחייבויות קודמות
`id` UUID PK | `business_id` FK→businesses | `name` TEXT NOT NULL | `monthly_amount` NUMERIC NOT NULL | `total_installments` INT NOT NULL | `start_date/end_date` DATE NOT NULL | `terms` TEXT | `created_by` FK→profiles | timestamps + soft delete

---

## מעקב מחירים (Price Tracking)

### 21. `supplier_items` - קטלוג מוצרי ספק
`id` UUID PK | `business_id` FK→businesses | `supplier_id` FK→suppliers | `item_name` TEXT NOT NULL | `item_aliases` TEXT[] DEFAULT '{}' | `unit` TEXT | `current_price` NUMERIC | `last_price_date` DATE | `is_active` BOOLEAN | `alert_muted` BOOLEAN DEFAULT false | timestamps

### 22. `supplier_item_prices` - היסטוריית מחירים
`id` UUID PK | `supplier_item_id` FK→supplier_items | `price` NUMERIC NOT NULL | `quantity` NUMERIC | `invoice_id` FK→invoices | `ocr_document_id` FK→ocr_documents | `document_date` DATE NOT NULL | `notes` TEXT | `created_at`

### 23. `price_alerts` - התראות שינוי מחיר
`id` UUID PK | `business_id` FK→businesses | `supplier_item_id` FK→supplier_items | `supplier_id` FK→suppliers | `ocr_document_id` FK→ocr_documents | `old_price/new_price` NUMERIC NOT NULL | `change_pct` NUMERIC NOT NULL | `document_date` DATE | `status` TEXT DEFAULT 'unread' | `created_at`

---

## מילוי יומי (Daily Entries)

### 24. `daily_entries` - מילוי יומי
`id` UUID PK | `business_id` FK→businesses | `entry_date` DATE NOT NULL | `total_register` DECIMAL(12,2) | `labor_cost` DECIMAL(12,2) | `labor_hours` DECIMAL(6,2) | `discounts/waste` DECIMAL(10,2) | `day_factor` DECIMAL(3,2) DEFAULT 1 | `notes` TEXT | `created_by` FK→profiles | timestamps + soft delete | UNIQUE(business_id, entry_date)

### 25. `daily_income_breakdown` - פירוט הכנסות יומי
`id` UUID PK | `daily_entry_id` FK→daily_entries (CASCADE) | `income_source_id` FK→income_sources | `amount` DECIMAL(12,2) | timestamps | UNIQUE(daily_entry_id, income_source_id)

### 26. `daily_parameters` - ערכי פרמטרים מותאמים
`id` UUID PK | `daily_entry_id` FK→daily_entries | `parameter_id` FK→custom_parameters | `value` NUMERIC DEFAULT 0 | timestamps

### 27. `daily_receipts` - ערכי קבלות יומי
`id` UUID PK | `daily_entry_id` FK→daily_entries | `receipt_type_id` FK→receipt_types | `amount` NUMERIC DEFAULT 0 | timestamps

### 28. `daily_payment_breakdown` - פירוט אמצעי תשלום יומי
`id` UUID PK | `daily_entry_id` FK→daily_entries | `payment_method_id` UUID NOT NULL | `amount` NUMERIC DEFAULT 0 | timestamps

### 29. `daily_product_usage` - שימוש במוצרים מנוהלים
`id` UUID PK | `daily_entry_id` FK→daily_entries (CASCADE) | `product_id` FK→managed_products | `quantity` DECIMAL(10,3) | `unit_cost_at_time` DECIMAL(10,2) | timestamps | UNIQUE(daily_entry_id, product_id)

### 30. `daily_entry_approvals` - אישורי שדות
`id` UUID PK | `daily_entry_id` FK→daily_entries | `business_id` FK→businesses | `field_name` TEXT NOT NULL | `status` TEXT DEFAULT 'pending' | `source` TEXT DEFAULT 'manual' | `approved_by` FK→profiles | `approved_at` TIMESTAMPTZ | `created_at`

### 31. `managed_products` - מוצרים מנוהלים (Food Cost)
`id` UUID PK | `business_id` FK→businesses | `name` TEXT NOT NULL | `unit` TEXT NOT NULL | `unit_cost` DECIMAL(10,2) | `category` TEXT | `is_active` BOOLEAN | timestamps + soft delete | UNIQUE(business_id, name)

---

## יעדים ותקציבים (Goals & Budgets)

### 32. `goals` - יעדים
`id` UUID PK | `business_id` FK→businesses | `year` INT | `month` INT (NULL=שנתי) | `revenue_target` DECIMAL(14,2) | `labor_cost_target_pct/food_cost_target_pct/operating_cost_target_pct` DECIMAL(5,2) | `profit_target` DECIMAL(14,2) | `profit_margin_target_pct` DECIMAL(5,2) | `notes` TEXT | timestamps + soft delete | UNIQUE(business_id, year, month)

### 33. `income_source_goals` - יעדים לפי מקור הכנסה
`id` UUID PK | `goal_id` FK→goals | `income_source_id` FK→income_sources | `avg_ticket_target` NUMERIC DEFAULT 0 | timestamps

### 34. `monthly_budgets` - תקציב חודשי כללי
`id` UUID PK | `business_id` FK→businesses | `year/month` INT | `revenue_budget/labor_budget/operating_budget/goods_budget` DECIMAL(14,2) | `notes` TEXT | timestamps + soft delete | UNIQUE(business_id, year, month)

### 35. `bonus_plans` - תוכניות בונוס לעובדים
`id` UUID PK | `business_id` FK→businesses | `employee_user_id` FK→profiles | `area_name` TEXT NOT NULL (תחום) | `measurement_type/data_source` TEXT NOT NULL | `is_lower_better` BOOLEAN DEFAULT true | `custom_source_label` TEXT | `tier[1-3]_label/threshold/threshold_max/amount` (3 רמות בונוס) | `tips` TEXT | `push_enabled` BOOLEAN DEFAULT true | `push_hour` SMALLINT DEFAULT 8 | `push_days` SMALLINT[] DEFAULT {0..6} | `is_active` BOOLEAN | `notes` TEXT | timestamps + soft delete

---

## מטריקות וסיכומים (Metrics & Summaries)

### 36. `business_monthly_metrics` - מטריקות חודשיות מחושבות
`id` UUID PK | `business_id` FK→businesses | `year/month` INT NOT NULL
**ימי עבודה:** `actual_work_days/actual_day_factors/expected_work_days` NUMERIC
**הכנסות:** `total_income/income_before_vat/monthly_pace/daily_avg` NUMERIC
**יעדים:** `revenue_target/target_diff_pct/target_diff_amount` NUMERIC
**עלות עבודה:** `labor_cost_amount/pct/target_pct/diff_pct/diff_amount` NUMERIC
**Food Cost:** `food_cost_amount/pct/target_pct/diff_pct/diff_amount` NUMERIC
**הוצאות שוטפות:** `current_expenses_amount/pct/target_pct/diff_pct/diff_amount` NUMERIC
**מוצרים מנוהלים:** `managed_product_[1-3]_name/cost/pct/target_pct/diff_pct` TEXT/NUMERIC
**פירוט הכנסות:** `private_income/orders_count/avg_ticket` | `business_income/orders_count/avg_ticket`
**השוואות:** `prev_month_income/change_pct` | `prev_year_income/change_pct`
**הגדרות:** `vat_pct/markup_pct/manager_salary/manager_daily_cost` NUMERIC
**אחר:** `total_labor_hours/total_discounts` | `profit_actual/pct/target/pct` | `computed_at` TIMESTAMPTZ

### 37. `monthly_summaries` - סיכומים חודשיים (cached)
`id` UUID PK | `business_id` FK→businesses | `year/month` INT NOT NULL
`actual_work_days/total_income/monthly_pace` | `labor_cost_pct/amount` | `food_cost_pct/amount`
`managed_product_[1-3]_pct/cost` | `avg_income_[1-4]` | `sales/labor/food_cost_budget_diff_pct`
`managed_product_[1-3]_budget_diff_pct` | `*_cost_budget_diff_pct` | `avg_income_[1-4]_budget_diff`
`sales/labor_cost/food_cost_yoy_change_pct` | `managed_product_[1-3]_yoy_change_pct` | `avg_income_[1-4]_yoy_change`
`last_calculated_at` | timestamps

---

## תזרים מזומנים (Cashflow)

### 38. `cashflow_settings` - הגדרות תזרים
`id` UUID PK | `business_id` FK→businesses | `opening_balance` NUMERIC DEFAULT 0 | `opening_date` DATE DEFAULT CURRENT_DATE | timestamps

### 39. `cashflow_income_overrides` - דריסות הכנסה בתזרים
`id` UUID PK | `business_id` FK→businesses | `settlement_date` DATE NOT NULL | `payment_method_id` UUID NOT NULL | `original_amount/override_amount` NUMERIC DEFAULT 0 | `note` TEXT | `created_by` FK→profiles | `created_at`

---

## OCR - סריקת מסמכים

### 40. `ocr_documents` - תור מסמכי OCR
`id` UUID PK | `business_id` FK→businesses | `source` TEXT DEFAULT 'upload' (upload/whatsapp/email) | `source_chat_id/source_message_id/source_sender_name/source_sender_phone` TEXT | `image_url` TEXT NOT NULL | `image_storage_path/original_filename/file_type` TEXT | `file_size_bytes` INT | `status` TEXT DEFAULT 'pending' (pending/processing/ready/approved/rejected) | `document_type` TEXT (invoice/receipt/delivery_note) | `document_type_confidence` NUMERIC | `ocr_engine` TEXT | `ocr_processed_at` TIMESTAMPTZ | `ocr_error_message` TEXT | `ocr_retry_count` INT DEFAULT 0 | `reviewed_by` FK→profiles | `reviewed_at` TIMESTAMPTZ | `review_notes/rejection_reason` TEXT | `created_invoice_id` FK→invoices | `created_payment_id` FK→payments | `created_delivery_note_id` FK→delivery_notes | timestamps

### 41. `ocr_extracted_data` - נתונים שחולצו מ-OCR
`id` UUID PK | `document_id` FK→ocr_documents | `raw_text` TEXT | `overall_confidence` NUMERIC | `language_detected` TEXT | `supplier_name/supplier_tax_id` TEXT | `document_number` TEXT | `document_date/due_date` DATE | `subtotal/vat_amount/total_amount` NUMERIC | `discount_amount/discount_percentage` NUMERIC | `currency` TEXT DEFAULT 'ILS' | `confidence_supplier_name/document_number/document_date/amounts` NUMERIC | `matched_supplier_id` FK→suppliers | `supplier_match_confidence` NUMERIC | `payment_method/bank_account` TEXT | `extraction_metadata` JSONB | timestamps

### 42. `ocr_extracted_line_items` - פריטי שורה מ-OCR
`id` UUID PK | `extracted_data_id` FK→ocr_extracted_data | `line_number` INT | `description` TEXT | `quantity/unit_price/total` NUMERIC | `discount_amount` NUMERIC | `confidence` NUMERIC | `created_at`

### 43. `ocr_document_crops` - גזירות מסמך
`id` UUID PK | `document_id` FK→ocr_documents | `crop_image_url` TEXT NOT NULL | `crop_storage_path` TEXT | `crop_region` JSONB ({x,y,width,height}) | `is_active` BOOLEAN | `created_by` FK→profiles | `created_at`

### 44. `ocr_audit_log` - לוג פעולות OCR
`id` UUID PK | `document_id` FK→ocr_documents | `action` TEXT NOT NULL | `performed_by` FK→profiles | `details` JSONB | `created_at`

---

## לקוחות (Customers)

### 45. `customers` - ניהול לקוחות
`id` UUID PK | `business_id` FK→businesses | `contact_name` TEXT NOT NULL | `business_name` TEXT NOT NULL | `company_name/business_type/business_type_other` TEXT | `tax_id` TEXT | `work_start_date` DATE | `setup_fee/payment_terms/payment_method` TEXT | `agreement_url` TEXT | `linked_income_source_id` FK→income_sources | `is_foreign` BOOLEAN DEFAULT false | `labor_type` TEXT | `labor_monthly_salary/labor_hourly_rate` NUMERIC | `retainer_amount` NUMERIC | `retainer_type` TEXT | `retainer_months` INT | `retainer_start_date/retainer_end_date` DATE | `retainer_day_of_month` INT DEFAULT 1 | `retainer_status` TEXT DEFAULT 'active' | `notes` TEXT | `is_active` BOOLEAN | timestamps + soft delete

### 46. `customer_payments` - תשלומי לקוח
`id` UUID PK | `customer_id` FK→customers | `payment_date` DATE NOT NULL | `amount` NUMERIC NOT NULL | `description/payment_method/notes` TEXT | `created_at` | `deleted_at`

### 47. `customer_services` - שירותים ללקוח
`id` UUID PK | `customer_id` FK→customers | `name` TEXT NOT NULL | `amount` NUMERIC NOT NULL | `service_date` DATE NOT NULL | `linked_income_source_id` FK→income_sources | `notes` TEXT | `created_at` | `deleted_at`

### 48. `customer_retainer_entries` - רשומות ריטיינר
`id` UUID PK | `customer_id` FK→customers | `entry_month` DATE NOT NULL | `amount` NUMERIC NOT NULL | `daily_income_breakdown_id` FK→daily_income_breakdown | `created_at`

### 49. `customer_surveys` - סקרי שביעות רצון
`id` UUID PK | `customer_id` FK→customers | `token` TEXT NOT NULL (קישור ייחודי) | `is_completed` BOOLEAN DEFAULT false | `created_at` | `completed_at`

### 50. `customer_survey_responses` - תשובות לסקר
`id` UUID PK | `survey_id` FK→customer_surveys | `question_key` TEXT NOT NULL | `answer_value` TEXT NOT NULL | `created_at`

### 51. `customer_documents` - מסמכי לקוח
`id` UUID PK | `customer_id` FK→customers | `description` TEXT NOT NULL | `document_url` TEXT NOT NULL | `created_at`

---

## AI, התראות ומשימות

### 52. `ai_chat_sessions` - שיחות AI
`id` UUID PK | `user_id` FK→profiles | `business_id` FK→businesses | `title` TEXT | timestamps

### 53. `ai_chat_messages` - הודעות AI
`id` UUID PK | `session_id` FK→ai_chat_sessions | `role` TEXT NOT NULL (user/assistant/tool) | `content` TEXT NOT NULL | `chart_data` JSONB | `created_at`

### 54. `notifications` - התראות
`id` BIGINT PK (serial) | `user_id` FK→profiles | `business_id` FK→businesses | `title` TEXT NOT NULL | `message` TEXT | `type` TEXT DEFAULT 'info' | `is_read` BOOLEAN DEFAULT false | `link` TEXT | timestamps

### 55. `push_subscriptions` - מנויי Push
`id` BIGINT PK | `user_id` FK→profiles | `endpoint` TEXT NOT NULL | `p256dh` TEXT NOT NULL | `auth` TEXT NOT NULL | `created_at`

### 56. `tasks` - משימות עסקיות
`id` UUID PK | `business_id` FK→businesses | `assignee_id` FK→profiles | `title` TEXT NOT NULL | `description` TEXT | `category` TEXT DEFAULT 'כללי' | `status` TEXT DEFAULT 'pending' (pending/in_progress/done) | `priority` TEXT DEFAULT 'medium' (low/medium/high) | `due_date` DATE | `completed_at` TIMESTAMPTZ | `created_by` FK→profiles | timestamps + soft delete

### 57. `data_reminders` - תזכורות מילוי נתונים
`id` UUID PK | `business_id` FK→businesses | `reminder_type` TEXT NOT NULL | `reference_date` DATE NOT NULL | `sent_at` TIMESTAMPTZ | `sent_to` TEXT NOT NULL | `channel` TEXT NOT NULL (push/email/whatsapp)

---

## לוגים (Logging)

### 58. `audit_log` - לוג ביקורת
`id` UUID PK | `user_id` FK→profiles | `business_id` FK→businesses | `action` TEXT NOT NULL (CREATE/UPDATE/DELETE/LOGIN) | `table_name` TEXT | `record_id` UUID | `old_values/new_values` JSONB | `metadata` JSONB | `created_at`

### 59. `client_error_logs` - לוג שגיאות צד לקוח
`id` UUID PK | `user_id` FK→profiles | `business_id` FK→businesses | `action` TEXT NOT NULL | `error_message` TEXT | `error_details` JSONB | `page` TEXT | `created_at`

---

## RLS & Realtime

### Row Level Security
כל הטבלאות מוגנות ב-RLS. הדפוס הבסיסי:
```sql
CREATE POLICY "Users can view business data" ON [table]
  FOR SELECT USING (
    business_id IN (SELECT business_id FROM business_members WHERE user_id = auth.uid() AND deleted_at IS NULL)
  );
```

### Realtime Publication
כל 59 הטבלאות מפורסמות ב-`supabase_realtime` publication.

---

## סיכום מבנה

| # | טבלה | תיאור |
|---|------|-------|
| 1 | `profiles` | פרופילי משתמשים |
| 2 | `businesses` | עסקים |
| 3 | `business_members` | חברות בעסק (RBAC) |
| 4 | `business_schedule` | לוח זמנים (ימי עבודה) |
| 5 | `business_day_exceptions` | חריגים ללוח זמנים |
| 6 | `business_monthly_settings` | הגדרות חודשיות (מרקאפ, מע"מ) |
| 7 | `business_credit_cards` | כרטיסי אשראי עסקיים |
| 8 | `income_sources` | מקורות הכנסה דינמיים |
| 9 | `expense_categories` | קטגוריות הוצאות (היררכי) |
| 10 | `custom_parameters` | פרמטרים מותאמים למילוי יומי |
| 11 | `receipt_types` | סוגי קבלות למילוי יומי |
| 12 | `payment_method_types` | סוגי אמצעי תשלום |
| 13 | `suppliers` | ספקים |
| 14 | `invoices` | חשבוניות/הוצאות |
| 15 | `delivery_notes` | תעודות משלוח |
| 16 | `payments` | תשלומים |
| 17 | `payment_splits` | פיצול תשלום |
| 18 | `supplier_budgets` | תקציב חודשי לספק |
| 19 | `supplier_documents` | מסמכי ספק |
| 20 | `prior_commitments` | התחייבויות קודמות |
| 21 | `supplier_items` | קטלוג מוצרי ספק |
| 22 | `supplier_item_prices` | היסטוריית מחירים |
| 23 | `price_alerts` | התראות שינוי מחיר |
| 24 | `daily_entries` | מילוי יומי |
| 25 | `daily_income_breakdown` | פירוט הכנסות יומי |
| 26 | `daily_parameters` | ערכי פרמטרים מותאמים |
| 27 | `daily_receipts` | ערכי קבלות יומי |
| 28 | `daily_payment_breakdown` | פירוט אמצעי תשלום יומי |
| 29 | `daily_product_usage` | שימוש במוצרים יומי |
| 30 | `daily_entry_approvals` | אישורי שדות יומי |
| 31 | `managed_products` | מוצרים מנוהלים (Food Cost) |
| 32 | `goals` | יעדים |
| 33 | `income_source_goals` | יעדים לפי מקור הכנסה |
| 34 | `monthly_budgets` | תקציב חודשי כללי |
| 35 | `bonus_plans` | תוכניות בונוס לעובדים |
| 36 | `business_monthly_metrics` | מטריקות חודשיות מחושבות |
| 37 | `monthly_summaries` | סיכומים חודשיים (cached) |
| 38 | `cashflow_settings` | הגדרות תזרים מזומנים |
| 39 | `cashflow_income_overrides` | דריסות הכנסה בתזרים |
| 40 | `ocr_documents` | תור מסמכי OCR |
| 41 | `ocr_extracted_data` | נתונים שחולצו מ-OCR |
| 42 | `ocr_extracted_line_items` | פריטי שורה מ-OCR |
| 43 | `ocr_document_crops` | גזירות מסמך OCR |
| 44 | `ocr_audit_log` | לוג פעולות OCR |
| 45 | `customers` | ניהול לקוחות |
| 46 | `customer_payments` | תשלומי לקוח |
| 47 | `customer_services` | שירותים ללקוח |
| 48 | `customer_retainer_entries` | רשומות ריטיינר |
| 49 | `customer_surveys` | סקרי שביעות רצון |
| 50 | `customer_survey_responses` | תשובות לסקר |
| 51 | `customer_documents` | מסמכי לקוח |
| 52 | `ai_chat_sessions` | שיחות AI |
| 53 | `ai_chat_messages` | הודעות AI |
| 54 | `notifications` | התראות |
| 55 | `push_subscriptions` | מנויי Push |
| 56 | `tasks` | משימות עסקיות |
| 57 | `data_reminders` | תזכורות מילוי נתונים |
| 58 | `audit_log` | לוג ביקורת |
| 59 | `client_error_logs` | לוג שגיאות צד לקוח |

---

## ERD (יחסים עיקריים)

```
profiles ──┬── business_members ◄── businesses
           │                           │
           │   ┌────────────────────────┤
           │   ├── business_schedule    ├── business_day_exceptions
           │   ├── business_credit_cards ◄───────────────────┐
           │   ├── business_monthly_settings                 │
           │   ├── income_sources ◄──────────────────┐       │
           │   ├── expense_categories (self-ref)     │       │
           │   ├── custom_parameters                 │       │
           │   ├── receipt_types                     │       │
           │   │                                     │       │
           │   ├── suppliers ────────────────────────┤       │
           │   │     ├── invoices ◄── delivery_notes │       │
           │   │     ├── payments ── payment_splits ─┘───────┘
           │   │     ├── supplier_items ── supplier_item_prices
           │   │     │      └── price_alerts
           │   │     ├── supplier_budgets / supplier_documents
           │   │     └── prior_commitments
           │   │
           │   ├── daily_entries
           │   │     ├── daily_income_breakdown ◄── income_sources
           │   │     ├── daily_product_usage ◄── managed_products
           │   │     ├── daily_parameters ◄── custom_parameters
           │   │     ├── daily_receipts ◄── receipt_types
           │   │     ├── daily_payment_breakdown
           │   │     └── daily_entry_approvals
           │   │
           │   ├── goals ── income_source_goals
           │   ├── monthly_budgets / bonus_plans
           │   ├── business_monthly_metrics / monthly_summaries
           │   ├── cashflow_settings / cashflow_income_overrides
           │   │
           │   ├── ocr_documents
           │   │     ├── ocr_extracted_data ── ocr_extracted_line_items
           │   │     ├── ocr_document_crops
           │   │     └── ocr_audit_log
           │   │
           │   ├── customers
           │   │     ├── customer_payments / customer_services
           │   │     ├── customer_retainer_entries
           │   │     ├── customer_surveys ── customer_survey_responses
           │   │     └── customer_documents
           │   │
           │   ├── tasks / notifications / data_reminders
           │   └── audit_log / client_error_logs
           │
           ├── ai_chat_sessions ── ai_chat_messages
           └── push_subscriptions
```
