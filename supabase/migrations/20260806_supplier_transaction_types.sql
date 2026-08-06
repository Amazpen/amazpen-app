-- Summit (סאמיט) bookkeeping export: "סוג תנועה" per supplier.
--
-- Summit's import template opens with a "סוג תנועה" column that has no
-- equivalent in Amazpen. It behaves like the expense-category field on the
-- supplier form: a per-business list the customer maintains themselves, seeded
-- with the two values every business starts from ('מע"מ מלא' / 'מע"מ חלקי').
--
-- The second missing Summit column, "מספר עוסק", already exists as
-- suppliers.tax_id — it was just never surfaced in the supplier form.

create table if not exists public.supplier_transaction_types (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  display_order integer default 0,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz
);

-- Partial unique index (soft-delete aware) so a name can be re-created after
-- being removed — same pattern as expense_categories.
create unique index if not exists supplier_transaction_types_business_name_uniq
  on public.supplier_transaction_types (business_id, name)
  where deleted_at is null;

create index if not exists supplier_transaction_types_business_idx
  on public.supplier_transaction_types (business_id)
  where deleted_at is null;

alter table public.supplier_transaction_types enable row level security;

drop policy if exists supplier_transaction_types_select on public.supplier_transaction_types;
drop policy if exists supplier_transaction_types_insert on public.supplier_transaction_types;
drop policy if exists supplier_transaction_types_update on public.supplier_transaction_types;
drop policy if exists supplier_transaction_types_delete on public.supplier_transaction_types;

create policy supplier_transaction_types_select on public.supplier_transaction_types
  for select using (public.is_business_member(business_id) or public.is_admin());
create policy supplier_transaction_types_insert on public.supplier_transaction_types
  for insert with check (public.is_business_member(business_id) or public.is_admin());
create policy supplier_transaction_types_update on public.supplier_transaction_types
  for update using (public.is_business_member(business_id) or public.is_admin());
create policy supplier_transaction_types_delete on public.supplier_transaction_types
  for delete using (public.is_business_member(business_id) or public.is_admin());

alter table public.suppliers
  add column if not exists transaction_type_id uuid
    references public.supplier_transaction_types(id) on delete set null;

-- Seed the two defaults for every existing business.
insert into public.supplier_transaction_types (business_id, name, display_order)
select b.id, v.name, v.ord
from public.businesses b
cross join (values ('מע"מ מלא', 0), ('מע"מ חלקי', 1)) as v(name, ord)
on conflict do nothing;

-- Every existing supplier starts on 'מע"מ מלא' — per David, everything goes
-- out as full VAT and the bookkeeper adjusts the exceptions afterwards.
update public.suppliers s
set transaction_type_id = t.id
from public.supplier_transaction_types t
where t.business_id = s.business_id
  and t.name = 'מע"מ מלא'
  and t.deleted_at is null
  and s.transaction_type_id is null;

-- New businesses get the same two defaults, so the dropdown is never empty.
create or replace function public.seed_supplier_transaction_types()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.supplier_transaction_types (business_id, name, display_order)
  values (new.id, 'מע"מ מלא', 0), (new.id, 'מע"מ חלקי', 1)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists trg_seed_supplier_transaction_types on public.businesses;
create trigger trg_seed_supplier_transaction_types
after insert on public.businesses
for each row execute function public.seed_supplier_transaction_types();
