-- Summit (סאמיט) export — align with the real import file.
--
-- The spec doc described a 17-column template. An actual working Summit import
-- file turned out to have only 8 columns:
--   סוג תנועה | אסמכתא 1 | מספר הקצאה | ת. אסמכתא | סכום |
--   חשבון לקוח/ספק | פרטים | סכום מע"מ
--
-- Two consequences for the schema:
--
-- 1. "סוג תנועה" is an INTEGER code, not free text. The code is a Summit
--    journal template that fixes both the debit (expense) account and the VAT
--    rule, so it is per-category — not merely "full VAT / partial VAT".
--    Codes observed in the real file:
--      3  כללי (מע"מ ידני, 0/7/18%)   4  יבוא / ללא מע"מ (0%)
--      5  אחזקת רכב (2/3 מע"מ)        6  קניות (18%)
--      7  אינטרנט                     8  ציוד ורכוש קבוע
--      11 הכנסות                      12 נייד (2/3 מע"מ)
--      14 חשמל / מים (1/4 מע"מ)       16 עמלות אשראי
--      17 מחשבים ותוכנה               18 הנהלת חשבונות
--
-- 2. "חשבון לקוח/ספק" is the supplier's account NUMBER in the bookkeeper's
--    chart of accounts (8134, 50010, 20000...). Summit matches on that number,
--    not on the supplier name and not on the ח.פ — so the export needs a new
--    per-supplier field that only the bookkeeper can populate.

alter table public.supplier_transaction_types
  add column if not exists code integer;

alter table public.suppliers
  add column if not exists accounting_account_number text;

-- The original seed shipped two placeholder rows. Nothing was ever assigned to
-- 'מע"מ חלקי' (0 suppliers), and 'מע"מ מלא' means exactly code 6 — so rename it
-- in place, which keeps every suppliers.transaction_type_id FK intact.
update public.supplier_transaction_types
set name = 'קניות', code = 6, display_order = 40
where name = 'מע"מ מלא' and deleted_at is null;

update public.supplier_transaction_types
set deleted_at = now(), is_active = false
where name = 'מע"מ חלקי' and deleted_at is null;

insert into public.supplier_transaction_types (business_id, name, code, display_order, is_active)
select b.id, v.name, v.code, v.ord, true
from public.businesses b
cross join (values
  ('כללי (מע"מ ידני)', 3, 10),
  ('יבוא / ללא מע"מ', 4, 20),
  ('אחזקת רכב (2/3 מע"מ)', 5, 30),
  ('אינטרנט', 7, 50),
  ('ציוד ורכוש קבוע', 8, 60),
  ('הכנסות', 11, 70),
  ('נייד (2/3 מע"מ)', 12, 80),
  ('חשמל / מים (1/4 מע"מ)', 14, 90),
  ('עמלות אשראי', 16, 100),
  ('מחשבים ותוכנה', 17, 110),
  ('הנהלת חשבונות', 18, 120)
) as v(name, code, ord)
where not exists (
  select 1 from public.supplier_transaction_types t
  where t.business_id = b.id and t.name = v.name and t.deleted_at is null
);

-- New businesses get the same list.
create or replace function public.seed_supplier_transaction_types()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.supplier_transaction_types (business_id, name, code, display_order)
  values
    (new.id, 'כללי (מע"מ ידני)', 3, 10),
    (new.id, 'יבוא / ללא מע"מ', 4, 20),
    (new.id, 'אחזקת רכב (2/3 מע"מ)', 5, 30),
    (new.id, 'קניות', 6, 40),
    (new.id, 'אינטרנט', 7, 50),
    (new.id, 'ציוד ורכוש קבוע', 8, 60),
    (new.id, 'הכנסות', 11, 70),
    (new.id, 'נייד (2/3 מע"מ)', 12, 80),
    (new.id, 'חשמל / מים (1/4 מע"מ)', 14, 90),
    (new.id, 'עמלות אשראי', 16, 100),
    (new.id, 'מחשבים ותוכנה', 17, 110),
    (new.id, 'הנהלת חשבונות', 18, 120)
  on conflict do nothing;
  return new;
end;
$function$;
