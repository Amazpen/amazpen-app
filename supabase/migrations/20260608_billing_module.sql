-- billing_customers: standalone customers billed by admins (not tied to businesses/users)
create table if not exists public.billing_customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text,
  tax_id text,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- billing_subscriptions: one monthly subscription per customer
create table if not exists public.billing_subscriptions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.billing_customers(id) on delete cascade,
  monthly_amount numeric not null check (monthly_amount > 0), -- NET (pre-VAT)
  vat_percent numeric not null default 18,
  currency text not null default 'ILS',
  status text not null default 'pending'
    check (status in ('pending','active','paused','cancelled','failed')),
  cardcom_token text,
  card_last_four text,
  card_expiry text,
  next_charge_date date,
  day_of_month int check (day_of_month between 1 and 31),
  failed_attempts int not null default 0,
  started_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- billing_charges: log of every charge attempt
create table if not exists public.billing_charges (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid references public.billing_subscriptions(id) on delete set null,
  customer_id uuid references public.billing_customers(id) on delete set null,
  amount numeric not null, -- GROSS charged (net + vat)
  vat_percent numeric,
  net_amount numeric,
  vat_amount numeric,
  status text not null default 'pending'
    check (status in ('pending','success','failed')),
  type text not null check (type in ('initial','recurring','manual','one_time')),
  cardcom_low_profile_id text,
  cardcom_transaction_id text,
  cardcom_response jsonb,
  error_message text,
  charged_at timestamptz,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_billing_sub_customer on public.billing_subscriptions(customer_id);
create index if not exists idx_billing_sub_due on public.billing_subscriptions(status, next_charge_date);
create index if not exists idx_billing_charges_sub on public.billing_charges(subscription_id);
create index if not exists idx_billing_charges_customer on public.billing_charges(customer_id);

-- updated_at trigger helper (reuse existing if present)
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists trg_billing_customers_updated on public.billing_customers;
create trigger trg_billing_customers_updated before update on public.billing_customers
  for each row execute function public.set_updated_at();

drop trigger if exists trg_billing_subscriptions_updated on public.billing_subscriptions;
create trigger trg_billing_subscriptions_updated before update on public.billing_subscriptions
  for each row execute function public.set_updated_at();

-- RLS: admin-only, separate policy per operation (never FOR ALL)
alter table public.billing_customers enable row level security;
alter table public.billing_subscriptions enable row level security;
alter table public.billing_charges enable row level security;

create policy billing_customers_select on public.billing_customers for select using (public.is_admin());
create policy billing_customers_insert on public.billing_customers for insert with check (public.is_admin());
create policy billing_customers_update on public.billing_customers for update using (public.is_admin()) with check (public.is_admin());
create policy billing_customers_delete on public.billing_customers for delete using (public.is_admin());

create policy billing_subscriptions_select on public.billing_subscriptions for select using (public.is_admin());
create policy billing_subscriptions_insert on public.billing_subscriptions for insert with check (public.is_admin());
create policy billing_subscriptions_update on public.billing_subscriptions for update using (public.is_admin()) with check (public.is_admin());
create policy billing_subscriptions_delete on public.billing_subscriptions for delete using (public.is_admin());

create policy billing_charges_select on public.billing_charges for select using (public.is_admin());
create policy billing_charges_insert on public.billing_charges for insert with check (public.is_admin());
create policy billing_charges_update on public.billing_charges for update using (public.is_admin()) with check (public.is_admin());
create policy billing_charges_delete on public.billing_charges for delete using (public.is_admin());
