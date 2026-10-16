-- Phase 3 foundation, part 2: the commercial data model. Plans, prices, subscriptions, credit wallets with a
-- ledger, AI usage records, payments and webhook events, and invoice details.
--
-- Nothing here is switched on: there are no plans, prices or packages (none are decided), and the AI and
-- payment functions refuse to run while their flag in commercial_settings is off. The browser may read its
-- own rows; every write below happens in trusted server code (the service role) through these functions.
-- Provider-independent: tables carry an opaque provider name and reference, never a provider's API shape.

-- ---------------------------------------------------------------- catalogue (empty until decided)
create table public.plans (
  code text primary key check (code ~ '^[a-z0-9][a-z0-9_-]{1,39}$'),
  name_he text not null,
  name_en text not null,
  description_he text,
  description_en text,
  is_public boolean not null default false,
  sort_order integer not null default 0,
  -- What the plan grants. Cloud space in bytes; credits renewed each billing period (they do not accumulate).
  storage_quota_bytes bigint not null default 1073741824 check (storage_quota_bytes >= 0),
  monthly_credits bigint not null default 0 check (monthly_credits >= 0),
  created_at timestamptz not null default now()
);

create table public.credit_packs (
  code text primary key check (code ~ '^[a-z0-9][a-z0-9_-]{1,39}$'),
  name_he text not null,
  name_en text not null,
  credits bigint not null check (credits > 0),
  is_public boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.prices (
  id uuid primary key default gen_random_uuid(),
  product_kind text not null check (product_kind in ('plan', 'credit_pack')),
  product_code text not null,
  billing_interval text check (billing_interval in ('month', 'year')),
  currency char(3) not null check (currency = upper(currency)),
  amount_minor bigint not null check (amount_minor >= 0),
  active boolean not null default false,
  provider_price_ref text,
  created_at timestamptz not null default now(),
  check ((product_kind = 'plan') = (billing_interval is not null))
);
create index prices_product_idx on public.prices (product_kind, product_code);

-- ---------------------------------------------------------------- subscriptions
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  plan_code text not null references public.plans (code),
  status text not null check (status in ('trialing', 'active', 'past_due', 'canceled', 'ended')),
  billing_interval text not null check (billing_interval in ('month', 'year')),
  provider text not null,
  provider_customer_ref text,
  provider_subscription_ref text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_subscription_ref)
);
create index subscriptions_user_idx on public.subscriptions (user_id, created_at desc);

alter table public.entitlements
  add column plan_code text references public.plans (code),
  add column subscription_id uuid references public.subscriptions (id) on delete set null;

-- ---------------------------------------------------------------- credits
-- Two balances that are never mixed up: purchased credits do not expire; monthly credits come with a
-- subscription period and are replaced (not added to) at renewal.
create table public.credit_wallets (
  user_id uuid primary key references auth.users (id) on delete cascade,
  purchased_balance bigint not null default 0 check (purchased_balance >= 0),
  monthly_balance bigint not null default 0 check (monthly_balance >= 0),
  monthly_expires_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.credit_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  bucket text not null check (bucket in ('purchased', 'monthly')),
  delta bigint not null check (delta <> 0),
  reason text not null check (reason in ('purchase', 'monthly_grant', 'monthly_expiry', 'ai_hold', 'ai_release', 'refund', 'admin_grant', 'adjustment')),
  ai_usage_id uuid,
  payment_id uuid,
  -- Makes every credit operation safe to retry: the same key is applied once.
  idempotency_key text not null unique,
  note text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index credit_ledger_user_idx on public.credit_ledger (user_id, created_at desc);

-- ---------------------------------------------------------------- AI usage
-- BetterCalc's own provider cost and what the user was charged are kept apart, as the HANDOFF requires.
create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('space_detection', 'openings_detection', 'multi_plan', 'revision_detection')),
  status text not null default 'held' check (status in ('held', 'completed', 'failed', 'cancelled')),
  pages integer not null check (pages > 0),
  credits_held bigint not null default 0 check (credits_held >= 0),
  held_monthly bigint not null default 0 check (held_monthly >= 0),
  held_purchased bigint not null default 0 check (held_purchased >= 0),
  credits_charged bigint not null default 0 check (credits_charged >= 0),
  provider_cost_micro_usd bigint check (provider_cost_micro_usd is null or provider_cost_micro_usd >= 0),
  provider_request_ref text,
  error_code text,
  context_label text check (context_label is null or char_length(context_label) <= 200),
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index ai_usage_user_idx on public.ai_usage (user_id, created_at desc);

-- ---------------------------------------------------------------- payments, invoices, webhooks
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  -- Kept (without the user link) if the account is deleted, because tax records may have to outlive it.
  user_id uuid references auth.users (id) on delete set null,
  subscription_id uuid references public.subscriptions (id) on delete set null,
  kind text not null check (kind in ('subscription', 'credit_pack')),
  provider text not null,
  provider_payment_ref text not null,
  status text not null check (status in ('pending', 'paid', 'failed', 'refunded')),
  amount_minor bigint not null check (amount_minor >= 0),
  currency char(3) not null,
  description text,
  period_start timestamptz,
  period_end timestamptz,
  invoice_number text,
  invoice_url text,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  unique (provider, provider_payment_ref)
);
create index payments_user_idx on public.payments (user_id, created_at desc);

create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_ref text not null,
  event_type text not null,
  payload jsonb not null,
  status text not null default 'received' check (status in ('received', 'processed', 'failed', 'ignored')),
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, event_ref)
);

create table public.billing_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  invoice_name text check (invoice_name is null or char_length(invoice_name) <= 200),
  tax_id text check (tax_id is null or char_length(tax_id) <= 40),
  address_line text check (address_line is null or char_length(address_line) <= 200),
  city text check (city is null or char_length(city) <= 100),
  postal_code text check (postal_code is null or char_length(postal_code) <= 20),
  country text not null default 'IL' check (country ~ '^[A-Z]{2}$'),
  updated_at timestamptz not null default now()
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor uuid,
  action text not null,
  target_user uuid,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- RLS and grants (start from nothing)
alter table public.plans enable row level security;
alter table public.credit_packs enable row level security;
alter table public.prices enable row level security;
alter table public.subscriptions enable row level security;
alter table public.credit_wallets enable row level security;
alter table public.credit_ledger enable row level security;
alter table public.ai_usage enable row level security;
alter table public.payments enable row level security;
alter table public.payment_events enable row level security;
alter table public.billing_profiles enable row level security;
alter table public.audit_log enable row level security;

revoke all on table public.plans, public.credit_packs, public.prices, public.subscriptions, public.credit_wallets,
  public.credit_ledger, public.ai_usage, public.payments, public.payment_events, public.billing_profiles, public.audit_log
  from anon, authenticated;

grant select on public.plans, public.credit_packs, public.prices to anon, authenticated;
create policy "plans: public ones" on public.plans for select to anon, authenticated using (is_public);
create policy "credit_packs: public ones" on public.credit_packs for select to anon, authenticated using (is_public);
create policy "prices: active public products" on public.prices for select to anon, authenticated
  using (active and (
    (product_kind = 'plan' and exists (select 1 from public.plans p where p.code = product_code and p.is_public))
    or (product_kind = 'credit_pack' and exists (select 1 from public.credit_packs c where c.code = product_code and c.is_public))));

grant select on public.subscriptions, public.credit_wallets, public.credit_ledger, public.ai_usage, public.payments to authenticated;
create policy "subscriptions: read own" on public.subscriptions for select to authenticated using (user_id = (select auth.uid()));
create policy "credit_wallets: read own" on public.credit_wallets for select to authenticated using (user_id = (select auth.uid()));
create policy "credit_ledger: read own" on public.credit_ledger for select to authenticated using (user_id = (select auth.uid()));
create policy "ai_usage: read own" on public.ai_usage for select to authenticated using (user_id = (select auth.uid()));
create policy "payments: read own" on public.payments for select to authenticated using (user_id = (select auth.uid()));

-- Invoice details are the one thing here the user writes themselves.
grant select, insert on public.billing_profiles to authenticated;
grant update (invoice_name, tax_id, address_line, city, postal_code, country) on public.billing_profiles to authenticated;
create policy "billing_profiles: read own" on public.billing_profiles for select to authenticated using (user_id = (select auth.uid()));
create policy "billing_profiles: create own" on public.billing_profiles for insert to authenticated with check (user_id = (select auth.uid()));
create policy "billing_profiles: update own" on public.billing_profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create trigger subscriptions_set_updated_at before update on public.subscriptions for each row execute function public.set_updated_at();
create trigger credit_wallets_set_updated_at before update on public.credit_wallets for each row execute function public.set_updated_at();
create trigger billing_profiles_set_updated_at before update on public.billing_profiles for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- every user has a wallet
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, public.clean_display_name(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')))
  on conflict (id) do nothing;
  insert into public.credit_wallets (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;

insert into public.credit_wallets (user_id) select id from auth.users on conflict (user_id) do nothing;

-- ---------------------------------------------------------------- credit operations (server only)
-- The one place balances change. Idempotent per key; never lets a balance go below zero.
create function public.credit_apply(p_user uuid, p_bucket text, p_delta bigint, p_reason text, p_key text,
  p_note text default null, p_actor uuid default null, p_ai_usage uuid default null, p_payment uuid default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare w public.credit_wallets;
begin
  if exists (select 1 from public.credit_ledger l where l.idempotency_key = p_key) then return false; end if;
  select * into w from public.credit_wallets where user_id = p_user for update;
  if not found then raise exception 'wallet_missing' using errcode = 'P0001'; end if;
  if p_bucket = 'purchased' then
    if w.purchased_balance + p_delta < 0 then raise exception 'insufficient_credits' using errcode = 'P0001'; end if;
    update public.credit_wallets set purchased_balance = purchased_balance + p_delta where user_id = p_user;
  elsif p_bucket = 'monthly' then
    if w.monthly_balance + p_delta < 0 then raise exception 'insufficient_credits' using errcode = 'P0001'; end if;
    update public.credit_wallets set monthly_balance = monthly_balance + p_delta where user_id = p_user;
  else
    raise exception 'invalid_bucket' using errcode = 'P0001';
  end if;
  insert into public.credit_ledger (user_id, bucket, delta, reason, ai_usage_id, payment_id, idempotency_key, note, created_by)
  values (p_user, p_bucket, p_delta, p_reason, p_ai_usage, p_payment, p_key, p_note, p_actor);
  return true;
end $$;

-- A new subscription period: whatever is left of the previous monthly credits expires, and the plan's credits
-- replace it. They never accumulate.
create function public.credit_grant_monthly(p_user uuid, p_amount bigint, p_period_end timestamptz, p_key text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare w public.credit_wallets;
begin
  if p_amount < 0 then raise exception 'invalid_amount' using errcode = 'P0001'; end if;
  if exists (select 1 from public.credit_ledger l where l.idempotency_key = p_key || ':grant') then return false; end if;
  select * into w from public.credit_wallets where user_id = p_user for update;
  if not found then raise exception 'wallet_missing' using errcode = 'P0001'; end if;
  if w.monthly_balance > 0 then
    perform public.credit_apply(p_user, 'monthly', -w.monthly_balance, 'monthly_expiry', p_key || ':expiry');
  end if;
  update public.credit_wallets set monthly_expires_at = p_period_end where user_id = p_user;
  if p_amount > 0 then
    perform public.credit_apply(p_user, 'monthly', p_amount, 'monthly_grant', p_key || ':grant');
  end if;
  return true;
end $$;

-- Purchased credits from a confirmed payment. Refuses while credit purchases are switched off.
create function public.credit_purchase(p_user uuid, p_credits bigint, p_payment uuid, p_key text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not public.commercial_flag('credit_purchases_enabled') then raise exception 'purchases_disabled' using errcode = 'P0001'; end if;
  if p_credits <= 0 then raise exception 'invalid_amount' using errcode = 'P0001'; end if;
  return public.credit_apply(p_user, 'purchased', p_credits, 'purchase', p_key, null, null, null, p_payment);
end $$;

-- Manual grant by an operator, with an audit entry. Works while purchases are off (support, refunds, goodwill).
create function public.credit_admin_grant(p_user uuid, p_bucket text, p_amount bigint, p_note text, p_actor uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_amount = 0 then raise exception 'invalid_amount' using errcode = 'P0001'; end if;
  perform public.credit_apply(p_user, p_bucket, p_amount, 'admin_grant', 'admin:' || gen_random_uuid()::text, p_note, p_actor);
  insert into public.audit_log (actor, action, target_user, details)
  values (p_actor, 'credit_admin_grant', p_user, jsonb_build_object('bucket', p_bucket, 'amount', p_amount, 'note', p_note));
end $$;

-- ---------------------------------------------------------------- AI usage (server only, off by default)
create function public.ai_reserve(p_user uuid, p_kind text, p_pages integer, p_credits bigint, p_key text, p_label text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  existing uuid;
  w public.credit_wallets;
  spend_order jsonb;
  usage_id uuid := gen_random_uuid();
  remaining bigint := p_credits;
  take bigint;
  bucket_name text;
  held_m bigint := 0;
  held_p bigint := 0;
begin
  if not public.commercial_flag('ai_enabled') then raise exception 'ai_disabled' using errcode = 'P0001'; end if;
  select a.id into existing from public.ai_usage a where a.idempotency_key = p_key;
  if existing is not null then return existing; end if;
  if p_credits < 0 or p_pages <= 0 then raise exception 'invalid_amount' using errcode = 'P0001'; end if;
  select value into spend_order from public.commercial_settings where key = 'credit_spend_order';
  if spend_order is null or jsonb_typeof(spend_order) <> 'array' or jsonb_array_length(spend_order) <> 2 then
    raise exception 'spend_order_not_configured' using errcode = 'P0001';
  end if;
  select * into w from public.credit_wallets where user_id = p_user for update;
  if not found then raise exception 'wallet_missing' using errcode = 'P0001'; end if;
  if w.monthly_expires_at is not null and w.monthly_expires_at <= now() then w.monthly_balance := 0; end if;
  if w.monthly_balance + w.purchased_balance < p_credits then raise exception 'insufficient_credits' using errcode = 'P0001'; end if;
  insert into public.ai_usage (id, user_id, kind, pages, credits_held, credits_charged, idempotency_key, context_label)
  values (usage_id, p_user, p_kind, p_pages, p_credits, 0, p_key, left(p_label, 200));
  for bucket_name in select jsonb_array_elements_text(spend_order) loop
    exit when remaining = 0;
    take := least(remaining, case bucket_name when 'monthly' then w.monthly_balance else w.purchased_balance end);
    if take > 0 then
      perform public.credit_apply(p_user, bucket_name, -take, 'ai_hold', 'hold:' || usage_id::text || ':' || bucket_name, null, null, usage_id);
      if bucket_name = 'monthly' then held_m := take; else held_p := take; end if;
      remaining := remaining - take;
    end if;
  end loop;
  update public.ai_usage set held_monthly = held_m, held_purchased = held_p where id = usage_id;
  return usage_id;
end $$;

-- Ends a usage record: the user is charged `p_charged` credits (at most what was held); the rest of the hold is
-- returned. A failed call that consumed tokens is charged, one that did not is released in full (p_charged = 0).
create function public.ai_finish(p_usage uuid, p_status text, p_charged bigint, p_cost_micro_usd bigint,
  p_request_ref text default null, p_error text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  u public.ai_usage;
  w public.credit_wallets;
  spend_order jsonb;
  first_bucket text;
  held_first bigint;
  held_second bigint;
  charged_first bigint;
  back_first bigint;
  back_second bigint;
  back_m bigint;
  back_p bigint;
begin
  if p_status not in ('completed', 'failed', 'cancelled') then raise exception 'invalid_status' using errcode = 'P0001'; end if;
  select * into u from public.ai_usage where id = p_usage for update;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  if u.status <> 'held' then return; end if; -- already settled: safe to repeat
  if p_charged < 0 or p_charged > u.credits_held then raise exception 'invalid_amount' using errcode = 'P0001'; end if;
  -- The charge is taken from the buckets in the configured spending order; what was not charged goes back to the
  -- bucket it came from.
  select value into spend_order from public.commercial_settings where key = 'credit_spend_order';
  first_bucket := coalesce(spend_order ->> 0, 'monthly');
  held_first := case first_bucket when 'monthly' then u.held_monthly else u.held_purchased end;
  held_second := u.credits_held - held_first;
  charged_first := least(p_charged, held_first);
  back_first := held_first - charged_first;
  back_second := held_second - (p_charged - charged_first);
  back_m := case first_bucket when 'monthly' then back_first else back_second end;
  back_p := case first_bucket when 'monthly' then back_second else back_first end;
  if back_p > 0 then
    perform public.credit_apply(u.user_id, 'purchased', back_p, 'ai_release', 'release:' || u.id::text || ':purchased', null, null, u.id);
  end if;
  if back_m > 0 then
    select * into w from public.credit_wallets where user_id = u.user_id;
    -- Monthly credits that expired while the call ran are not given back.
    if w.monthly_expires_at is null or w.monthly_expires_at > now() then
      perform public.credit_apply(u.user_id, 'monthly', back_m, 'ai_release', 'release:' || u.id::text || ':monthly', null, null, u.id);
    end if;
  end if;
  update public.ai_usage
     set status = p_status, credits_charged = p_charged, provider_cost_micro_usd = p_cost_micro_usd,
         provider_request_ref = p_request_ref, error_code = left(p_error, 100), completed_at = now()
   where id = u.id;
end $$;

-- ---------------------------------------------------------------- subscriptions and entitlement (server only)
-- Keeps cloud access in step with the subscription: active/trialing grant it; past_due keeps it through the
-- 7-day grace period; a canceled subscription lasts to the end of the paid period; after that it is read-only.
create function public.sync_entitlement(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  s public.subscriptions;
  pl public.plans;
  new_status text;
  ended timestamptz;
begin
  select * into s from public.subscriptions where user_id = p_user order by created_at desc limit 1;
  if not found then return; end if;
  select * into pl from public.plans where code = s.plan_code;
  if s.status in ('active', 'trialing') then
    new_status := 'active';
  elsif s.status = 'past_due' then
    if now() < coalesce(s.current_period_end, now()) + interval '7 days' then new_status := 'grace';
    else new_status := 'ended'; ended := coalesce(s.current_period_end, now()) + interval '7 days'; end if;
  elsif s.status = 'canceled' and s.current_period_end is not null and s.current_period_end > now() then
    new_status := 'active';
  else
    new_status := 'ended'; ended := coalesce(s.current_period_end, s.canceled_at, now());
  end if;
  insert into public.entitlements (user_id, status, source, storage_quota_bytes, ended_at, plan_code, subscription_id)
  values (p_user, new_status, 'billing', pl.storage_quota_bytes, ended, s.plan_code, s.id)
  on conflict (user_id) do update
    set status = excluded.status, source = 'billing', storage_quota_bytes = excluded.storage_quota_bytes,
        ended_at = excluded.ended_at, plan_code = excluded.plan_code, subscription_id = excluded.subscription_id;
end $$;

create function public.record_payment_event(p_provider text, p_event_ref text, p_type text, p_payload jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare inserted integer;
begin
  insert into public.payment_events (provider, event_ref, event_type, payload)
  values (p_provider, p_event_ref, p_type, p_payload) on conflict (provider, event_ref) do nothing;
  get diagnostics inserted = row_count;
  return inserted = 1;
end $$;

-- Applies a provider's subscription state, whichever provider it is. Refuses while payments are off.
create function public.apply_subscription_state(p_user uuid, p_plan text, p_status text, p_interval text, p_provider text,
  p_customer_ref text, p_subscription_ref text, p_period_start timestamptz, p_period_end timestamptz, p_cancel_at_period_end boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  prior public.subscriptions;
  pl public.plans;
  sub_id uuid;
begin
  if not public.commercial_flag('payments_enabled') then raise exception 'payments_disabled' using errcode = 'P0001'; end if;
  select * into pl from public.plans where code = p_plan;
  if not found then raise exception 'unknown_plan' using errcode = 'P0001'; end if;
  select * into prior from public.subscriptions where provider = p_provider and provider_subscription_ref = p_subscription_ref;
  insert into public.subscriptions (user_id, plan_code, status, billing_interval, provider, provider_customer_ref, provider_subscription_ref,
    current_period_start, current_period_end, cancel_at_period_end, canceled_at)
  values (p_user, p_plan, p_status, p_interval, p_provider, p_customer_ref, p_subscription_ref, p_period_start, p_period_end,
    p_cancel_at_period_end, case when p_status in ('canceled', 'ended') then now() end)
  on conflict (provider, provider_subscription_ref) do update
    set plan_code = excluded.plan_code, status = excluded.status, billing_interval = excluded.billing_interval,
        current_period_start = excluded.current_period_start, current_period_end = excluded.current_period_end,
        cancel_at_period_end = excluded.cancel_at_period_end,
        canceled_at = coalesce(public.subscriptions.canceled_at, excluded.canceled_at)
  returning id into sub_id;
  perform public.sync_entitlement(p_user);
  -- A new period of an active subscription renews the monthly credits (once per period).
  if p_status in ('active', 'trialing') and p_period_start is not null
     and (prior.id is null or prior.current_period_start is distinct from p_period_start) then
    perform public.credit_grant_monthly(p_user, pl.monthly_credits, p_period_end, 'sub:' || sub_id::text || ':' || extract(epoch from p_period_start)::bigint::text);
  end if;
  return sub_id;
end $$;

-- ---------------------------------------------------------------- read helpers for the account screens
create function public.account_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  w public.credit_wallets;
  s public.subscriptions;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into w from public.credit_wallets where user_id = uid;
  select * into s from public.subscriptions where user_id = uid order by created_at desc limit 1;
  return jsonb_build_object(
    'purchased_credits', coalesce(w.purchased_balance, 0),
    'monthly_credits', case when w.monthly_expires_at is not null and w.monthly_expires_at <= now() then 0 else coalesce(w.monthly_balance, 0) end,
    'monthly_expires_at', w.monthly_expires_at,
    'subscription', case when s.id is null then null else jsonb_build_object(
      'plan_code', s.plan_code, 'status', s.status, 'billing_interval', s.billing_interval,
      'current_period_end', s.current_period_end, 'cancel_at_period_end', s.cancel_at_period_end) end
  );
end $$;

-- ---------------------------------------------------------------- function privileges
revoke execute on function
  public.credit_apply(uuid, text, bigint, text, text, text, uuid, uuid, uuid), public.credit_grant_monthly(uuid, bigint, timestamptz, text),
  public.credit_purchase(uuid, bigint, uuid, text), public.credit_admin_grant(uuid, text, bigint, text, uuid),
  public.ai_reserve(uuid, text, integer, bigint, text, text), public.ai_finish(uuid, text, bigint, bigint, text, text),
  public.sync_entitlement(uuid), public.record_payment_event(text, text, text, jsonb),
  public.apply_subscription_state(uuid, text, text, text, text, text, text, timestamptz, timestamptz, boolean),
  public.account_overview()
  from public, anon, authenticated;
grant execute on function
  public.credit_apply(uuid, text, bigint, text, text, text, uuid, uuid, uuid), public.credit_grant_monthly(uuid, bigint, timestamptz, text),
  public.credit_purchase(uuid, bigint, uuid, text), public.credit_admin_grant(uuid, text, bigint, text, uuid),
  public.ai_reserve(uuid, text, integer, bigint, text, text), public.ai_finish(uuid, text, bigint, bigint, text, text),
  public.sync_entitlement(uuid), public.record_payment_event(text, text, text, jsonb),
  public.apply_subscription_state(uuid, text, text, text, text, text, text, timestamptz, timestamptz, boolean)
  to service_role;
grant execute on function public.account_overview() to authenticated;
