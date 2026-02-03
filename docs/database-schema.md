# AmazPen Database Schema - ארכיטקטורת מסד נתונים

## סקירה כללית

מערכת Multi-Tenant לניהול עסקי עם:
- Supabase Auth לאימות
- Row Level Security (RLS) לאבטחה
- Realtime לעדכונים בזמן אמת
- Audit Log מלא
- Soft Delete

---

## טבלאות

### 1. `profiles` - פרופילי משתמשים
```sql
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  phone TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ -- Soft delete
);
```

### 2. `businesses` - עסקים
```sql
CREATE TABLE businesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  business_type TEXT NOT NULL, -- עירייה, מסעדה, אחר
  status TEXT DEFAULT 'active', -- active, inactive, suspended
  tax_id TEXT, -- מספר עוסק/ח.פ
  address TEXT,
  city TEXT,
  phone TEXT,
  email TEXT,
  logo_url TEXT,

  -- הגדרות
  currency TEXT DEFAULT 'ILS',
  fiscal_year_start INTEGER DEFAULT 1, -- חודש תחילת שנת כספים

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
```

### 3. `business_members` - חברי עסק (RBAC)
```sql
CREATE TABLE business_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'employee')),

  -- הרשאות מותאמות אישית
  permissions JSONB DEFAULT '{}',

  invited_at TIMESTAMPTZ DEFAULT NOW(),
  joined_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,

  UNIQUE(business_id, user_id)
);
```

### 4. `business_schedule` - לוח זמנים עסקי
```sql
CREATE TABLE business_schedule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=ראשון
  day_factor DECIMAL(3,2) NOT NULL CHECK (day_factor BETWEEN 0 AND 1), -- 0, 0.5, 1

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(business_id, day_of_week)
);
```

### 5. `income_sources` - מקורות הכנסה (דינמי לעסק)
```sql
CREATE TABLE income_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL, -- שם הערוץ: קופה, 10ביס, וולט, וכו'
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,

  UNIQUE(business_id, name)
);
```

### 6. `expense_categories` - קטגוריות הוצאות (דינמי והיררכי)
```sql
CREATE TABLE expense_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,

  -- היררכיה
  parent_id UUID REFERENCES expense_categories(id) ON DELETE SET NULL, -- קטגוריית אב (NULL = קטגוריה ראשית)

  name TEXT NOT NULL,
  description TEXT,
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,

  UNIQUE(business_id, name, parent_id) -- שם ייחודי תחת אותה קטגוריית אב
);

-- אינדקס לשליפת היררכיה
CREATE INDEX idx_expense_categories_business ON expense_categories(business_id);
CREATE INDEX idx_expense_categories_parent ON expense_categories(parent_id);

-- פונקציה לשליפת כל הקטגוריות בהיררכיה (recursive)
CREATE OR REPLACE FUNCTION get_category_tree(p_business_id UUID)
RETURNS TABLE (
  id UUID,
  name TEXT,
  parent_id UUID,
  parent_name TEXT,
  depth INTEGER,
  path TEXT
) AS $$
WITH RECURSIVE category_tree AS (
  -- Base case: קטגוריות ראשיות
  SELECT
    ec.id,
    ec.name,
    ec.parent_id,
    NULL::TEXT as parent_name,
    0 as depth,
    ec.name as path
  FROM expense_categories ec
  WHERE ec.business_id = p_business_id
    AND ec.parent_id IS NULL
    AND ec.deleted_at IS NULL

  UNION ALL

  -- Recursive case: קטגוריות משנה
  SELECT
    ec.id,
    ec.name,
    ec.parent_id,
    ct.name as parent_name,
    ct.depth + 1,
    ct.path || ' > ' || ec.name
  FROM expense_categories ec
  JOIN category_tree ct ON ec.parent_id = ct.id
  WHERE ec.deleted_at IS NULL
)
SELECT * FROM category_tree
ORDER BY path;
$$ LANGUAGE SQL;

-- דוגמת מבנה היררכי:
-- קטגוריה ראשית: "תחזוקה"
--   └── תת-קטגוריה: "מיזוג אוויר"
--   └── תת-קטגוריה: "חשמל"
--   └── תת-קטגוריה: "אינסטלציה"
-- קטגוריה ראשית: "משרדי"
--   └── תת-קטגוריה: "ציוד משרדי"
--   └── תת-קטגוריה: "שירותי הדפסה"
```

### 7. `business_credit_cards` - כרטיסי אשראי עסקיים
```sql
CREATE TABLE business_credit_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,

  -- פרטי הכרטיס
  card_name TEXT NOT NULL, -- שם לזיהוי: "ויזה 1234", "מסטרקארד עסקי"
  last_four_digits TEXT, -- 4 ספרות אחרונות
  card_type TEXT, -- visa, mastercard, amex, diners, isracard

  -- מועד חיוב
  billing_day INTEGER CHECK (billing_day BETWEEN 1 AND 31), -- יום החיוב בחודש

  -- הגדרות
  credit_limit DECIMAL(12,2), -- מסגרת אשראי
  is_active BOOLEAN DEFAULT true,

  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,

  UNIQUE(business_id, card_name)
);

CREATE INDEX idx_credit_cards_business ON business_credit_cards(business_id);
```

### 8. `suppliers` - ספקים
```sql
CREATE TABLE suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,

  -- סיווג (היררכי)
  expense_type TEXT NOT NULL CHECK (expense_type IN ('current_expenses', 'goods_purchases')),
    -- current_expenses = הוצאות שוטפות
    -- goods_purchases = קניות סחורה
  expense_category_id UUID REFERENCES expense_categories(id), -- קטגוריית הוצאה (דינמית והיררכית)
  expense_nature TEXT CHECK (expense_nature IN ('fixed', 'variable')),
    -- fixed = הוצאה קבועה
    -- variable = הוצאה משתנה

  -- פרטי ספק
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  tax_id TEXT, -- ח.פ/עוסק

  -- תנאי תשלום
  payment_terms_days INTEGER DEFAULT 30, -- שוטף + 30
  requires_vat BOOLEAN DEFAULT true,

  -- כרטיס אשראי ברירת מחדל לספק זה (אופציונלי)
  default_credit_card_id UUID REFERENCES business_credit_cards(id),

  notes TEXT,
  is_active BOOLEAN DEFAULT true,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
```

### 8. `managed_products` - מוצרים מנוהלים (Food Cost)
```sql
CREATE TABLE managed_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  unit TEXT NOT NULL, -- ק"ג, יחידה, ליטר, וכו'
  unit_cost DECIMAL(10,2) NOT NULL,

  -- קטגוריה
  category TEXT, -- בשר, ירקות, חלב, וכו'

  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,

  UNIQUE(business_id, name)
);
```

### 9. `daily_entries` - מילוי יומי
```sql
CREATE TABLE daily_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  entry_date DATE NOT NULL,

  -- הכנסות
  total_register DECIMAL(12,2) DEFAULT 0, -- סה"כ קופה

  -- עלות עבודה
  labor_cost DECIMAL(12,2) DEFAULT 0,
  labor_hours DECIMAL(6,2) DEFAULT 0,

  -- הנחות/אבדן
  discounts DECIMAL(10,2) DEFAULT 0, -- הנחות
  waste DECIMAL(10,2) DEFAULT 0, -- פחת/אבדן

  -- גורם יום (מועתק מ-business_schedule או נקבע ידנית)
  day_factor DECIMAL(3,2) DEFAULT 1,

  notes TEXT,

  -- מטא
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,

  UNIQUE(business_id, entry_date)
);
```

### 10. `daily_income_breakdown` - פירוט הכנסות יומי
```sql
CREATE TABLE daily_income_breakdown (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_entry_id UUID NOT NULL REFERENCES daily_entries(id) ON DELETE CASCADE,
  income_source_id UUID NOT NULL REFERENCES income_sources(id),
  amount DECIMAL(12,2) NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(daily_entry_id, income_source_id)
);
```

### 11. `daily_product_usage` - שימוש במוצרים מנוהלים (יומי)
```sql
CREATE TABLE daily_product_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_entry_id UUID NOT NULL REFERENCES daily_entries(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES managed_products(id),
  quantity DECIMAL(10,3) NOT NULL, -- כמות שנצרכה
  unit_cost_at_time DECIMAL(10,2) NOT NULL, -- מחיר יחידה בזמן הרישום

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(daily_entry_id, product_id)
);
```

### 12. `invoices` - חשבוניות/הוצאות
```sql
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES suppliers(id),

  -- פרטי חשבונית
  invoice_number TEXT,
  invoice_date DATE NOT NULL,
  due_date DATE, -- תאריך לתשלום

  -- סכומים
  subtotal DECIMAL(12,2) NOT NULL, -- לפני מע"מ
  vat_amount DECIMAL(10,2) DEFAULT 0,
  total_amount DECIMAL(12,2) NOT NULL, -- כולל מע"מ

  -- סטטוס
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'partial', 'paid', 'cancelled')),
  amount_paid DECIMAL(12,2) DEFAULT 0,

  -- קבצים
  attachment_url TEXT, -- קישור לסריקת החשבונית

  notes TEXT,

  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
```

### 13. `payments` - תשלומים
```sql
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES suppliers(id),

  -- תאריך
  payment_date DATE NOT NULL, -- תאריך קבלה/תשלום

  -- סכום כולל
  total_amount DECIMAL(12,2) NOT NULL,

  -- קישור לחשבונית (אופציונלי)
  invoice_id UUID REFERENCES invoices(id),

  notes TEXT,

  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
```

### 14. `payment_methods` - אמצעי תשלום (Enum)
```sql
CREATE TABLE payment_method_types (
  id TEXT PRIMARY KEY,
  name_he TEXT NOT NULL,
  display_order INTEGER DEFAULT 0
);

INSERT INTO payment_method_types (id, name_he, display_order) VALUES
  ('bank_transfer', 'העברה בנקאית', 1),
  ('cash', 'מזומן', 2),
  ('check', 'צ׳ק', 3),
  ('bit', 'ביט', 4),
  ('paybox', 'פייבוקס', 5),
  ('credit_card', 'כרטיס אשראי', 6),
  ('credit_company', 'חברות הקפה', 7),
  ('standing_order', 'הוראת קבע', 8),
  ('other', 'אחר', 9);
```

### 15. `payment_splits` - פיצול תשלום לאמצעי תשלום
```sql
CREATE TABLE payment_splits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  payment_method TEXT NOT NULL REFERENCES payment_method_types(id),
  amount DECIMAL(12,2) NOT NULL,

  -- כרטיס אשראי (אם אמצעי תשלום = credit_card)
  credit_card_id UUID REFERENCES business_credit_cards(id),

  -- פרטים נוספים לפי סוג
  check_number TEXT, -- מספר צ'ק
  check_date DATE, -- תאריך פירעון צ'ק
  reference_number TEXT, -- אסמכתא

  -- תשלומים/תשלום בתשלומים
  installments_count INTEGER DEFAULT 1, -- מספר תשלומים
  installment_number INTEGER DEFAULT 1, -- תשלום מספר X מתוך Y

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- אינדקס לשליפת תשלומים לפי כרטיס
CREATE INDEX idx_payment_splits_credit_card ON payment_splits(credit_card_id);
```

### 16. `goals` - יעדים
```sql
CREATE TABLE goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,

  -- תקופה
  year INTEGER NOT NULL,
  month INTEGER, -- NULL = יעד שנתי

  -- יעדי הכנסות
  revenue_target DECIMAL(14,2),

  -- יעדי עלויות (באחוזים מההכנסות)
  labor_cost_target_pct DECIMAL(5,2), -- יעד עלות עבודה %
  food_cost_target_pct DECIMAL(5,2), -- יעד Food Cost %
  operating_cost_target_pct DECIMAL(5,2), -- יעד הוצאות תפעול %

  -- יעדים נוספים
  profit_target DECIMAL(14,2),
  profit_margin_target_pct DECIMAL(5,2),

  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,

  UNIQUE(business_id, year, month)
);
```

### 17. `monthly_budgets` - תקציב חודשי
```sql
CREATE TABLE monthly_budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),

  -- תקציבים
  revenue_budget DECIMAL(14,2),
  labor_budget DECIMAL(14,2),
  operating_budget DECIMAL(14,2),
  goods_budget DECIMAL(14,2), -- קניות סחורה

  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,

  UNIQUE(business_id, year, month)
);
```

### 18. `audit_log` - לוג ביקורת
```sql
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- מי
  user_id UUID REFERENCES profiles(id),
  business_id UUID REFERENCES businesses(id),

  -- מה
  action TEXT NOT NULL, -- CREATE, UPDATE, DELETE, LOGIN, etc.
  table_name TEXT,
  record_id UUID,

  -- פרטים
  old_values JSONB,
  new_values JSONB,
  metadata JSONB, -- מידע נוסף (IP, User-Agent, וכו')

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- אינדקס לחיפוש מהיר
CREATE INDEX idx_audit_log_user ON audit_log(user_id);
CREATE INDEX idx_audit_log_business ON audit_log(business_id);
CREATE INDEX idx_audit_log_table ON audit_log(table_name);
CREATE INDEX idx_audit_log_created ON audit_log(created_at DESC);
```

---

## Views - תצוגות לחישובים

### V1. `daily_summary` - סיכום יומי מחושב
```sql
CREATE VIEW daily_summary AS
SELECT
  de.id,
  de.business_id,
  de.entry_date,
  de.total_register,
  de.labor_cost,
  de.labor_hours,
  de.discounts,
  de.waste,
  de.day_factor,

  -- סה"כ הכנסות מפירוט
  COALESCE(SUM(dib.amount), 0) AS total_income_breakdown,

  -- Food Cost מחושב
  COALESCE(SUM(dpu.quantity * dpu.unit_cost_at_time), 0) AS food_cost,

  -- אחוזים
  CASE WHEN de.total_register > 0
    THEN (de.labor_cost / de.total_register * 100)::DECIMAL(5,2)
    ELSE 0
  END AS labor_cost_pct,

  CASE WHEN de.total_register > 0
    THEN (COALESCE(SUM(dpu.quantity * dpu.unit_cost_at_time), 0) / de.total_register * 100)::DECIMAL(5,2)
    ELSE 0
  END AS food_cost_pct

FROM daily_entries de
LEFT JOIN daily_income_breakdown dib ON de.id = dib.daily_entry_id
LEFT JOIN daily_product_usage dpu ON de.id = dpu.daily_entry_id
WHERE de.deleted_at IS NULL
GROUP BY de.id;
```

### V2. `monthly_pl_summary` - דוח רווח והפסד חודשי
```sql
CREATE VIEW monthly_pl_summary AS
WITH monthly_income AS (
  SELECT
    business_id,
    DATE_TRUNC('month', entry_date) AS month,
    SUM(total_register) AS total_revenue,
    SUM(labor_cost) AS total_labor_cost,
    SUM(day_factor) AS working_days, -- סה"כ ימי עבודה בפועל
    COUNT(*) AS calendar_days
  FROM daily_entries
  WHERE deleted_at IS NULL
  GROUP BY business_id, DATE_TRUNC('month', entry_date)
),
monthly_expenses AS (
  SELECT
    i.business_id,
    DATE_TRUNC('month', i.invoice_date) AS month,
    s.expense_type,
    SUM(i.total_amount) AS total_expenses
  FROM invoices i
  JOIN suppliers s ON i.supplier_id = s.id
  WHERE i.deleted_at IS NULL
  GROUP BY i.business_id, DATE_TRUNC('month', i.invoice_date), s.expense_type
),
monthly_food_cost AS (
  SELECT
    de.business_id,
    DATE_TRUNC('month', de.entry_date) AS month,
    SUM(dpu.quantity * dpu.unit_cost_at_time) AS food_cost
  FROM daily_entries de
  JOIN daily_product_usage dpu ON de.id = dpu.daily_entry_id
  WHERE de.deleted_at IS NULL
  GROUP BY de.business_id, DATE_TRUNC('month', de.entry_date)
)
SELECT
  mi.business_id,
  mi.month,
  mi.total_revenue,
  mi.total_labor_cost,
  mi.working_days,
  mi.calendar_days,

  -- נרמול להכנסה ליום עבודה
  CASE WHEN mi.working_days > 0
    THEN (mi.total_revenue / mi.working_days)::DECIMAL(12,2)
    ELSE 0
  END AS revenue_per_working_day,

  -- הוצאות
  COALESCE(me_current.total_expenses, 0) AS current_expenses, -- הוצאות שוטפות
  COALESCE(me_goods.total_expenses, 0) AS goods_purchases, -- קניות סחורה
  COALESCE(mfc.food_cost, 0) AS food_cost,

  -- אחוזים
  CASE WHEN mi.total_revenue > 0
    THEN (mi.total_labor_cost / mi.total_revenue * 100)::DECIMAL(5,2)
    ELSE 0
  END AS labor_cost_pct,

  CASE WHEN mi.total_revenue > 0
    THEN (COALESCE(mfc.food_cost, 0) / mi.total_revenue * 100)::DECIMAL(5,2)
    ELSE 0
  END AS food_cost_pct,

  -- רווח גולמי
  (mi.total_revenue - mi.total_labor_cost - COALESCE(mfc.food_cost, 0) -
   COALESCE(me_current.total_expenses, 0) - COALESCE(me_goods.total_expenses, 0))::DECIMAL(14,2) AS gross_profit

FROM monthly_income mi
LEFT JOIN monthly_expenses me_current
  ON mi.business_id = me_current.business_id
  AND mi.month = me_current.month
  AND me_current.expense_type = 'current_expenses'
LEFT JOIN monthly_expenses me_goods
  ON mi.business_id = me_goods.business_id
  AND mi.month = me_goods.month
  AND me_goods.expense_type = 'goods_purchases'
LEFT JOIN monthly_food_cost mfc
  ON mi.business_id = mfc.business_id
  AND mi.month = mfc.month;
```

---

## Row Level Security (RLS)

### הפעלה
```sql
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_members ENABLE ROW LEVEL SECURITY;
-- ... לכל הטבלאות
```

### פוליסות בסיסיות
```sql
-- Profiles - משתמש רואה רק את עצמו
CREATE POLICY "Users can view own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

-- Business Members - משתמש רואה רק עסקים שהוא חבר בהם
CREATE POLICY "Users can view their business memberships" ON business_members
  FOR SELECT USING (user_id = auth.uid());

-- Businesses - משתמש רואה רק עסקים שהוא חבר בהם
CREATE POLICY "Users can view businesses they belong to" ON businesses
  FOR SELECT USING (
    id IN (SELECT business_id FROM business_members WHERE user_id = auth.uid() AND deleted_at IS NULL)
  );

-- כל שאר הטבלאות - דרך business_id
CREATE POLICY "Users can view business data" ON daily_entries
  FOR SELECT USING (
    business_id IN (SELECT business_id FROM business_members WHERE user_id = auth.uid() AND deleted_at IS NULL)
  );

-- הרשאות עריכה לפי role
CREATE POLICY "Owners and managers can insert" ON daily_entries
  FOR INSERT WITH CHECK (
    business_id IN (
      SELECT business_id FROM business_members
      WHERE user_id = auth.uid()
      AND role IN ('owner', 'manager')
      AND deleted_at IS NULL
    )
  );
```

---

## Realtime

### הפעלה
```sql
-- הוספת טבלאות ל-publication
ALTER PUBLICATION supabase_realtime ADD TABLE daily_entries;
ALTER PUBLICATION supabase_realtime ADD TABLE payments;
ALTER PUBLICATION supabase_realtime ADD TABLE invoices;
ALTER PUBLICATION supabase_realtime ADD TABLE business_members;
```

---

## אינדקסים

```sql
-- מילוי יומי
CREATE INDEX idx_daily_entries_business_date ON daily_entries(business_id, entry_date DESC);

-- חשבוניות
CREATE INDEX idx_invoices_business ON invoices(business_id);
CREATE INDEX idx_invoices_supplier ON invoices(supplier_id);
CREATE INDEX idx_invoices_status ON invoices(status) WHERE deleted_at IS NULL;

-- תשלומים
CREATE INDEX idx_payments_business ON payments(business_id);
CREATE INDEX idx_payments_supplier ON payments(supplier_id);
CREATE INDEX idx_payments_date ON payments(payment_date DESC);

-- ספקים
CREATE INDEX idx_suppliers_business ON suppliers(business_id);
CREATE INDEX idx_suppliers_type ON suppliers(expense_type);
```

---

## Triggers

### עדכון updated_at
```sql
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- החלה על כל הטבלאות
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
-- ... לכל טבלה עם updated_at
```

### Audit Log Trigger
```sql
CREATE OR REPLACE FUNCTION audit_log_trigger()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_log (user_id, business_id, action, table_name, record_id, new_values)
    VALUES (auth.uid(), NEW.business_id, 'CREATE', TG_TABLE_NAME, NEW.id, to_jsonb(NEW));
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_log (user_id, business_id, action, table_name, record_id, old_values, new_values)
    VALUES (auth.uid(), COALESCE(NEW.business_id, OLD.business_id), 'UPDATE', TG_TABLE_NAME, OLD.id, to_jsonb(OLD), to_jsonb(NEW));
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO audit_log (user_id, business_id, action, table_name, record_id, old_values)
    VALUES (auth.uid(), OLD.business_id, 'DELETE', TG_TABLE_NAME, OLD.id, to_jsonb(OLD));
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

## סיכום מבנה

| טבלה | תיאור |
|------|-------|
| `profiles` | פרופילי משתמשים |
| `businesses` | עסקים |
| `business_members` | חברות בעסק (RBAC) |
| `business_schedule` | לוח זמנים (ימי עבודה) |
| `business_credit_cards` | כרטיסי אשראי עסקיים |
| `income_sources` | מקורות הכנסה דינמיים |
| `expense_categories` | קטגוריות הוצאות (היררכי + דינמי) |
| `suppliers` | ספקים |
| `managed_products` | מוצרים מנוהלים (Food Cost) |
| `daily_entries` | מילוי יומי |
| `daily_income_breakdown` | פירוט הכנסות יומי |
| `daily_product_usage` | שימוש במוצרים יומי |
| `invoices` | חשבוניות/הוצאות |
| `payments` | תשלומים |
| `payment_method_types` | סוגי אמצעי תשלום |
| `payment_splits` | פיצול תשלום (כולל כרטיס אשראי) |
| `goals` | יעדים |
| `monthly_budgets` | תקציב חודשי |
| `audit_log` | לוג ביקורת |

---

## ERD (יחסים)

```
profiles ─────┬──────────────────────────────────────┐
              │                                      │
              ▼                                      │
        business_members ◄──── businesses           │
              │                     │               │
              │                     ├── business_schedule
              │                     ├── business_credit_cards ◄────────┐
              │                     │                                  │
              │                     ├── income_sources                 │
              │                     │                                  │
              │                     ├── expense_categories (היררכי)    │
              │                     │       │ (parent_id → self)       │
              │                     │       ▼                          │
              │                     ├── suppliers ─────────────────────┤
              │                     │       │ (expense_category_id)    │
              │                     │       │ (default_credit_card_id) │
              │                     │       │                          │
              │                     │       ├── invoices               │
              │                     │       └── payments               │
              │                     │               │                  │
              │                     │               ▼                  │
              │                     │         payment_splits ──────────┘
              │                     │               │ (credit_card_id)
              │                     │               ▼
              │                     │         payment_method_types
              │                     │
              │                     ├── managed_products
              │                     │
              │                     ├── daily_entries
              │                     │       ├── daily_income_breakdown ◄── income_sources
              │                     │       └── daily_product_usage ◄── managed_products
              │                     │
              │                     ├── goals
              │                     └── monthly_budgets
              │
              └──────────────────── audit_log
```

## דוגמת היררכיית קטגוריות

```
עסק: "מסעדת השף"
│
├── קטגוריה ראשית: "תחזוקה"
│   ├── תת-קטגוריה: "מיזוג אוויר"
│   ├── תת-קטגוריה: "חשמל"
│   └── תת-קטגוריה: "אינסטלציה"
│
├── קטגוריה ראשית: "מזון"
│   ├── תת-קטגוריה: "בשר"
│   ├── תת-קטגוריה: "ירקות"
│   └── תת-קטגוריה: "מוצרי חלב"
│
├── קטגוריה ראשית: "משרדי"
│   ├── תת-קטגוריה: "ציוד משרדי"
│   └── תת-קטגוריה: "שירותי הדפסה"
│
└── קטגוריה ראשית: "הוצאות קבועות"
    ├── תת-קטגוריה: "שכירות"
    ├── תת-קטגוריה: "ביטוחים"
    └── תת-קטגוריה: "הנהלת חשבונות"
```

## דוגמת כרטיסי אשראי עסקיים

```
עסק: "מסעדת השף"
│
├── כרטיס אשראי: "ויזה 1234" (חיוב: 10 לחודש)
├── כרטיס אשראי: "מסטרקארד 5678" (חיוב: 15 לחודש)
└── כרטיס אשראי: "אמריקן אקספרס 9012" (חיוב: 1 לחודש)

תשלום לספק "יבואן הבשר":
├── 70% בכרטיס "ויזה 1234" - 3 תשלומים
└── 30% בהעברה בנקאית
```
