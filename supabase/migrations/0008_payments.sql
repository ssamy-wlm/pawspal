-- 0008 (phase 6): the booking fee, payments and refunds.
--   * the fee amount lives in a server setting (app_settings), changed in the Supabase dashboard
--   * every payment is a row made by the server; the app never sends an amount
--   * a payment confirms a booking only through complete_fee_payment, called by the signed webhook function
--   * refunds follow Terms of Service section 6 and are recorded as "due" for the refund job

-- ---------------------------------------------------------------- settings (server config)
create table public.app_settings (
  key        text primary key,
  value      text not null,
  note       text,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
revoke insert, update, delete on public.app_settings from anon, authenticated;
create policy "anyone signed in reads settings" on public.app_settings for select to authenticated using (true);   -- nothing secret belongs here

create or replace function public.check_app_setting()
returns trigger language plpgsql as $$
begin
  if new.key in ('booking_fee_egp', 'refund_processing_charge_egp') then
    if new.value !~ '^[0-9]{1,5}$' then raise exception '% must be a whole number of pounds', new.key; end if;
  end if;
  if new.key = 'booking_fee_egp' and (new.value::int < 1 or new.value::int > 10000) then raise exception 'the booking fee must be between 1 and 10000 EGP'; end if;
  if new.key = 'refund_processing_charge_egp' and new.value::int > coalesce((select value::int from public.app_settings where key = 'booking_fee_egp'), 10000) then
    raise exception 'the refund charge cannot be more than the booking fee';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger check_app_setting_before_write before insert or update on public.app_settings
  for each row execute function public.check_app_setting();

insert into public.app_settings (key, value, note) values
  ('booking_fee_egp', '75', 'The booking fee in Egyptian pounds, charged when a booking is confirmed. Change the value here (Table Editor) to change the fee.'),
  ('refund_processing_charge_egp', '0', 'The charge kept when an owner cancels more than 48 hours before the start (Terms of Service section 6, [X] EGP). 0 until the lawyer confirms the number.');

create or replace function public.booking_fee_cents()
returns integer language sql stable security definer set search_path = public as $$
  select (value::int) * 100 from public.app_settings where key = 'booking_fee_egp'
$$;
create or replace function public.refund_charge_cents()
returns integer language sql stable security definer set search_path = public as $$
  select coalesce((select (value::int) * 100 from public.app_settings where key = 'refund_processing_charge_egp'), 0)
$$;
revoke execute on function public.booking_fee_cents() from public, anon;
grant execute on function public.booking_fee_cents() to authenticated, service_role;
revoke execute on function public.refund_charge_cents() from public, anon, authenticated;
grant execute on function public.refund_charge_cents() to service_role;

-- ---------------------------------------------------------------- payments
create table public.booking_payments (
  id                 uuid primary key default gen_random_uuid(),     -- also the reference we give the payment provider
  booking_id         uuid not null references public.bookings (id),  -- the booking, or the first leg of a swap
  payer_id           uuid not null references public.profiles (id),
  amount_cents       integer not null check (amount_cents > 0),
  refund_charge_cents integer not null default 0,
  currency           text not null default 'EGP' check (currency = 'EGP'),
  terms_version      integer not null,
  provider           text not null,
  provider_ref       text,                                            -- the provider's id for the checkout
  provider_txn_id    text,                                            -- the provider's id for the transaction, once paid
  status             text not null default 'created' check (status in ('created', 'paid', 'failed', 'refund_due', 'refunded')),
  refund_cents       integer not null default 0 check (refund_cents >= 0),
  refund_reason      text,
  refund_attempts    integer not null default 0,
  created_at         timestamptz not null default now(),
  paid_at            timestamptz,
  refunded_at        timestamptz
);
create index on public.booking_payments (booking_id);
create unique index booking_payments_one_paid on public.booking_payments (booking_id) where status in ('paid', 'refund_due', 'refunded');
create unique index booking_payments_txn on public.booking_payments (provider, provider_txn_id) where provider_txn_id is not null;
alter table public.booking_payments enable row level security;
revoke all on public.booking_payments from anon, authenticated;
-- The two people in the booking may see where payment stands. Provider references and refund bookkeeping stay private.
grant select (id, booking_id, payer_id, amount_cents, currency, status, refund_cents, created_at, paid_at) on public.booking_payments to authenticated;
create policy "participants read payment status" on public.booking_payments for select to authenticated using (
  exists (select 1 from public.bookings b where b.id = booking_id and auth.uid() in (b.owner_id, b.sitter_id)));

-- Who opened the booking (the person who sent the request). For a swap both legs carry the one who asked.
alter table public.bookings add column opened_by uuid;
update public.bookings set opened_by = owner_id where opened_by is null;
create or replace function public.set_booking_opener()
returns trigger language plpgsql as $$
begin
  new.opened_by := coalesce(auth.uid(), new.owner_id);     -- the caller inside request_booking and request_swap
  return new;
end $$;
create trigger set_booking_opener_before_insert before insert on public.bookings
  for each row execute function public.set_booking_opener();

-- The person who pays: whoever sent the request (the owner who asked for a stay; for a swap, the one who proposed it).
create or replace function public.fee_payer(p_booking uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(l.opened_by, l.owner_id) from public.booking_legs(p_booking) l order by l.created_at, l.id limit 1
$$;
revoke execute on function public.fee_payer(uuid) from public, anon, authenticated;

-- Starts a payment. Service role only (the create-fee-payment function). The amount comes from the server setting, never
-- from the app. Returns the payment id (the reference for the provider) and the amount.
create or replace function public.begin_fee_payment(p_booking uuid, p_user uuid, p_provider text)
returns table (payment_id uuid, amount_cents integer)
language plpgsql security definer set search_path = public as $$
declare b public.bookings; v_other uuid; v_id uuid; v_cents integer;
begin
  perform public.lock_booking_legs(p_booking);
  select * into b from public.bookings where id = p_booking;
  if b.id is null or p_user not in (b.owner_id, b.sitter_id) then raise exception 'booking not found'; end if;
  if p_user <> public.fee_payer(p_booking) then raise exception 'the other person pays the booking fee'; end if;
  if b.status <> 'terms_agreed' or b.fee_status <> 'unpaid' then raise exception 'booking not payable'; end if;
  v_other := case when p_user = b.owner_id then b.sitter_id else b.owner_id end;
  if not public.is_active(p_user) or not public.is_active(v_other) or public.is_blocked_between(p_user, v_other) then raise exception 'not allowed'; end if;
  if exists (select 1 from public.booking_legs(p_booking) l where not public.pet_is_free(l.pet_id, l.starts_on, l.ends_on, array[l.id])) then
    raise exception 'that pet is already booked for these dates';
  end if;
  if (select count(*) from public.booking_payments where booking_id = p_booking and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'too many payment attempts';
  end if;
  v_cents := public.booking_fee_cents();
  insert into public.booking_payments (booking_id, payer_id, amount_cents, refund_charge_cents, terms_version, provider)
  values (p_booking, p_user, v_cents, public.refund_charge_cents(), b.terms_version, p_provider)
  returning id into v_id;
  return query select v_id, v_cents;
end $$;
revoke execute on function public.begin_fee_payment(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.begin_fee_payment(uuid, uuid, text) to service_role;

create or replace function public.set_payment_ref(p_payment uuid, p_ref text)
returns void language sql security definer set search_path = public as $$
  update public.booking_payments set provider_ref = p_ref where id = p_payment and status = 'created';
$$;
revoke execute on function public.set_payment_ref(uuid, text) from public, anon, authenticated;
grant execute on function public.set_payment_ref(uuid, text) to service_role;

-- The provider says a payment succeeded (the webhook function has checked its signature). The amount and currency must be
-- exactly what we asked for. Repeats are harmless. If the booking can no longer be confirmed (the terms changed, it was
-- cancelled, the pet got booked elsewhere), the money is marked for refund in full.
create or replace function public.complete_fee_payment(p_payment uuid, p_txn_id text, p_amount_cents integer, p_currency text, p_provider_ref text)
returns text language plpgsql security definer set search_path = public as $$
declare pay public.booking_payments; b public.bookings;
begin
  select * into pay from public.booking_payments where id = p_payment for update;
  if pay.id is null then raise exception 'unknown payment'; end if;
  if pay.status in ('paid', 'refund_due', 'refunded') then return 'already_done'; end if;
  -- The provider's signature does not cover our own reference, so the payment must also be the one the provider made the order for.
  if pay.provider_ref is null or pay.provider_ref <> p_provider_ref then
    insert into public.security_events (user_id, kind, details) values (pay.payer_id, 'payment_mismatch', jsonb_build_object('payment', p_payment, 'why', 'reference'));
    return 'reference_mismatch';
  end if;
  if p_amount_cents <> pay.amount_cents or p_currency <> pay.currency then
    insert into public.security_events (user_id, kind, details) values (pay.payer_id, 'payment_mismatch', jsonb_build_object('payment', p_payment));
    return 'amount_mismatch';        -- nothing changes; the event is kept because we return instead of raising
  end if;
  update public.booking_payments set provider_txn_id = p_txn_id where id = p_payment;
  perform public.lock_booking_legs(pay.booking_id);
  select * into b from public.bookings where id = pay.booking_id;
  if b.status <> 'terms_agreed' or b.fee_status <> 'unpaid' or b.terms_version <> pay.terms_version then
    update public.booking_payments set status = 'refund_due', refund_cents = pay.amount_cents, refund_reason = 'booking_changed_before_payment', paid_at = now() where id = p_payment;
    return 'refund_due';
  end if;
  begin
    perform public.confirm_booking_payment(pay.booking_id);
  exception when others then
    update public.booking_payments set status = 'refund_due', refund_cents = pay.amount_cents, refund_reason = 'booking_could_not_be_confirmed', paid_at = now() where id = p_payment;
    return 'refund_due';
  end;
  update public.booking_payments set status = 'paid', paid_at = now() where id = p_payment;
  return 'paid';
end $$;
revoke execute on function public.complete_fee_payment(uuid, text, integer, text, text) from public, anon, authenticated;
grant execute on function public.complete_fee_payment(uuid, text, integer, text, text) to service_role;

create or replace function public.fail_fee_payment(p_payment uuid)
returns void language sql security definer set search_path = public as $$
  update public.booking_payments set status = 'failed' where id = p_payment and status = 'created';
$$;
revoke execute on function public.fail_fee_payment(uuid) from public, anon, authenticated;
grant execute on function public.fail_fee_payment(uuid) to service_role;

-- ---------------------------------------------------------------- refunds (Terms of Service section 6)
--   the other person cancels                    -> the payer gets everything back
--   the payer cancels more than 48 h before     -> everything back minus the processing charge (a setting, 0 for now)
--   the payer cancels within 48 h of the start  -> nothing back
-- (No-shows and removals are decided by a person, in the admin app.)
create or replace function public.refund_for(p_payment uuid, p_canceller uuid)
returns table (refund_cents integer, reason text)
language plpgsql stable security definer set search_path = public as $$
declare pay public.booking_payments; v_start timestamptz;
begin
  select * into pay from public.booking_payments where id = p_payment;
  if pay.id is null then return query select 0, 'no_payment'::text; return; end if;
  select min(l.starts_on)::timestamp at time zone 'Africa/Cairo' into v_start from public.booking_legs(pay.booking_id) l;
  if p_canceller <> pay.payer_id then return query select pay.amount_cents, 'cancelled_by_other_person'::text; return; end if;
  if v_start - now() > interval '48 hours' then return query select greatest(pay.amount_cents - pay.refund_charge_cents, 0), 'cancelled_early'::text; return; end if;
  return query select 0, 'cancelled_late'::text;
end $$;
revoke execute on function public.refund_for(uuid, uuid) from public, anon, authenticated;

-- What would I get back if I cancelled this confirmed booking now? (For the cancel screen.)
create or replace function public.refund_preview(p_booking uuid)
returns table (refund_cents integer, amount_cents integer, is_payer boolean)
language plpgsql stable security definer set search_path = public as $$
declare pay public.booking_payments; r record;
begin
  if not exists (select 1 from public.bookings b where b.id = p_booking and auth.uid() in (b.owner_id, b.sitter_id)) then raise exception 'not found'; end if;
  select * into pay from public.booking_payments where booking_id in (select id from public.booking_legs(p_booking)) and status = 'paid';
  if pay.id is null then return query select 0, 0, false; return; end if;
  select * into r from public.refund_for(pay.id, auth.uid());
  return query select r.refund_cents, pay.amount_cents, auth.uid() = pay.payer_id;
end $$;
revoke execute on function public.refund_preview(uuid) from public, anon;
grant execute on function public.refund_preview(uuid) to authenticated;

create or replace function public.cancel_booking(p_booking uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_pets uuid[]; pay public.booking_payments; r record;
begin
  perform public.lock_booking_legs(p_booking);
  select array_agg(pet_id) into v_pets from public.booking_legs(p_booking);
  select * into pay from public.booking_payments where booking_id in (select id from public.booking_legs(p_booking)) and status = 'paid' for update;
  if pay.id is not null then select * into r from public.refund_for(pay.id, auth.uid()); end if;   -- worked out before anything changes
  update public.bookings set status = 'cancelled', cancelled_by = auth.uid()
   where id in (select id from public.booking_legs(p_booking)) and auth.uid() in (owner_id, sitter_id)
     and status in ('requested', 'terms_agreed', 'confirmed');
  if not found then raise exception 'booking cannot be cancelled'; end if;
  update public.pets p set locked = false
   where p.id = any (v_pets)
     and not exists (select 1 from public.bookings x where x.pet_id = p.id and x.status in ('confirmed', 'in_progress'));
  if pay.id is not null then
    update public.booking_payments
       set refund_cents = r.refund_cents, refund_reason = r.reason, status = case when r.refund_cents > 0 then 'refund_due' else 'paid' end
     where id = pay.id;
  end if;
  insert into public.security_events (user_id, kind, details)
  values (auth.uid(), 'booking_cancelled', jsonb_build_object('booking', p_booking, 'reason', left(p_reason, 300)));
end $$;
revoke execute on function public.cancel_booking(uuid, text) from public, anon;
grant execute on function public.cancel_booking(uuid, text) to authenticated;

-- For the refund job (service role only).
create or replace function public.list_refunds_due()
returns table (payment_id uuid, provider text, provider_txn_id text, refund_cents integer)
language sql stable security definer set search_path = public as $$
  select id, provider, provider_txn_id, refund_cents from public.booking_payments
   where status = 'refund_due' and provider_txn_id is not null and refund_attempts < 5 order by paid_at limit 50
$$;
revoke execute on function public.list_refunds_due() from public, anon, authenticated;
grant execute on function public.list_refunds_due() to service_role;

create or replace function public.mark_refund_result(p_payment uuid, p_ok boolean)
returns void language sql security definer set search_path = public as $$
  update public.booking_payments
     set status = case when p_ok then 'refunded' else status end,
         refunded_at = case when p_ok then now() else refunded_at end,
         refund_attempts = refund_attempts + 1
   where id = p_payment and status = 'refund_due';
$$;
revoke execute on function public.mark_refund_result(uuid, boolean) from public, anon, authenticated;
grant execute on function public.mark_refund_result(uuid, boolean) to service_role;

-- The exact pin and the pet's care details: functions from phase 0, now closed to anyone signed out.
revoke execute on function public.get_booking_location(uuid) from public, anon;
grant execute on function public.get_booking_location(uuid) to authenticated;
