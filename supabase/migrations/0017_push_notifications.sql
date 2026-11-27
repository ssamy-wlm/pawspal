-- 0017 (phase 9): push notifications (Expo push service) and the phase 9 settings.
--   * tables push_tokens, notification_prefs and notification_outbox: RLS on, no policy, no grant to the app. The app reaches
--     them ONLY through the four RPCs below (register_push_token, unregister_push_token, my_notification_prefs,
--     set_notification_prefs). The send-notifications edge function (service role) reads the outbox.
--   * what is queued: a new message, a booking request, changed terms, a confirmed or cancelled booking, a membership
--     renewal reminder, and a verification or payment decision. Always GENERIC: title "PawsPal", one of five fixed sentences
--     (English or Arabic), data {type, id} with an opaque id. Never a name, a date, a price or message text.
--   * nothing is queued or sent until the founder sets app_settings.push_enabled = 'true' (default 'false').
--   * settings added here for phase 9: push_enabled, deletion_grace_days (default 30), shared_history_months (default 24).
--     Their validation is in admin_set_setting below. The two legal numbers are placeholders from the privacy policy
--     ([30] days, [24] months): the founder and the lawyer confirm them.

insert into public.app_settings (key, value) values
  ('push_enabled', 'false'), ('deletion_grace_days', '30'), ('shared_history_months', '24')
on conflict (key) do nothing;

-- The payment screen gets only the payment settings. The phase 9 switches (push, retention) are not for the app.
create or replace function public.get_payment_settings()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when auth.uid() is null then '{}'::jsonb
    else coalesce((select jsonb_object_agg(key, value) from public.app_settings
                    where key not in ('push_enabled', 'deletion_grace_days', 'shared_history_months')), '{}'::jsonb) end
$$;

create or replace function public.admin_set_setting(p_key text, p_value text)
returns void language plpgsql security definer set search_path = public as $$
declare v_value text := btrim(coalesce(p_value, '')); v_old text;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  if p_key in ('registration_fee_egp', 'renewal_fee_egp') then
    if v_value !~ '^[0-9]{1,6}$' or v_value::integer < 1 or v_value::integer > 100000 then raise exception 'invalid value'; end if;
  elsif p_key = 'membership_months' then
    if v_value !~ '^[0-9]{1,2}$' or v_value::integer < 1 or v_value::integer > 60 then raise exception 'invalid value'; end if;
  elsif p_key = 'reminder_days' then
    if v_value !~ '^[0-9]{1,2}$' or v_value::integer < 1 or v_value::integer > 60 then raise exception 'invalid value'; end if;
  elsif p_key = 'deletion_grace_days' then
    if v_value !~ '^[0-9]{1,3}$' or v_value::integer < 1 or v_value::integer > 365 then raise exception 'invalid value'; end if;
  elsif p_key = 'shared_history_months' then
    if v_value !~ '^[0-9]{1,3}$' or v_value::integer < 1 or v_value::integer > 120 then raise exception 'invalid value'; end if;
  elsif p_key = 'push_enabled' then
    if v_value not in ('true', 'false') then raise exception 'invalid value'; end if;
  elsif p_key in ('instapay_link', 'instapay_qr_url') then
    if v_value <> '' and v_value !~ '^https://[^[:space:]]{3,255}$' then raise exception 'invalid value'; end if;
  elsif p_key in ('bank_name', 'bank_account_name', 'bank_account_number', 'bank_iban', 'payment_note') then
    if length(v_value) > 500 then raise exception 'invalid value'; end if;
  else
    raise exception 'unknown setting';
  end if;
  select value into v_old from public.app_settings where key = p_key;
  update public.app_settings set value = v_value, updated_at = now() where key = p_key;
  insert into public.audit_log (admin_id, action, target_user, details)
  values (auth.uid(), 'setting_changed', null, jsonb_build_object('key', p_key, 'old', v_old, 'new', v_value));
end $$;

create or replace function private.push_enabled()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select value = 'true' from public.app_settings where key = 'push_enabled'), false)
$$;
revoke execute on function private.push_enabled() from public, anon, authenticated;

-- ---------------------------------------------------------------- tables (no policy, no grant: functions only)
create table public.push_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  token        text not null unique check (token ~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,128}\]$'),
  platform     text not null check (platform in ('ios', 'android')),
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index on public.push_tokens (user_id, last_seen_at desc);
alter table public.push_tokens enable row level security;
revoke all on public.push_tokens from anon, authenticated;

create table public.notification_prefs (
  user_id      uuid primary key references public.profiles (id) on delete cascade,
  messages     boolean not null default true,
  bookings     boolean not null default true,
  membership   boolean not null default true,
  verification boolean not null default true,
  updated_at   timestamptz not null default now()
);
alter table public.notification_prefs enable row level security;
revoke all on public.notification_prefs from anon, authenticated;

create table public.notification_outbox (
  id              bigint generated always as identity primary key,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  pref            text not null check (pref in ('messages', 'bookings', 'membership', 'verification')),
  title           text not null,
  body            text not null,
  data            jsonb not null,                       -- {type, id}: an opaque booking or conversation id, or null
  status          text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped', 'expired')),
  attempts        smallint not null default 0,
  next_attempt_at timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  sent_at         timestamptz
);
create index on public.notification_outbox (next_attempt_at) where status = 'pending';
create index on public.notification_outbox (user_id, status);
alter table public.notification_outbox enable row level security;
revoke all on public.notification_outbox from anon, authenticated;

-- ---------------------------------------------------------------- the fixed sentences
create or replace function private.push_body(p_key text, p_locale text)
returns text language sql immutable set search_path = '' as $$
  select case p_key
    when 'message'    then case when p_locale = 'ar' then 'لديك رسالة جديدة'           else 'You have a new message' end
    when 'booking'    then case when p_locale = 'ar' then 'هناك جديد بخصوص حجزك'      else 'There is news about your booking' end
    when 'membership' then case when p_locale = 'ar' then 'عضويتك ستتجدد قريبا'        else 'Your membership renews soon' end
    when 'account'    then case when p_locale = 'ar' then 'لدينا أخبار عن حسابك'       else 'We have news about your account' end
  end
$$;
revoke execute on function private.push_body(text, text) from public, anon, authenticated;

-- Queues one generic notification. It never raises (a notification must never break a message or a booking).
-- p_need_active: true = the person must be active and paid (messages, bookings, reminders); false = any account that is not
-- suspended or removed (a verification or payment decision reaches people who are not active yet).
create or replace function private.enqueue_notification(p_user uuid, p_pref text, p_type text, p_ref uuid, p_body_key text, p_need_active boolean default true)
returns void language plpgsql security definer set search_path = public, private as $$
declare p public.profiles; pr public.notification_prefs; v_ok boolean;
begin
  if not private.push_enabled() then return; end if;
  select * into p from public.profiles where id = p_user;
  if p.id is null or p.status in ('suspended', 'removed') then return; end if;
  if p_need_active and not public.is_active(p_user) then return; end if;
  select * into pr from public.notification_prefs where user_id = p_user;
  v_ok := case p_pref
    when 'messages'     then coalesce(pr.messages, true)
    when 'bookings'     then coalesce(pr.bookings, true)
    when 'membership'   then coalesce(pr.membership, true)
    when 'verification' then coalesce(pr.verification, true)
    else false end;
  if not v_ok then return; end if;
  if not exists (select 1 from public.push_tokens where user_id = p_user) then return; end if;
  -- One waiting notification per thing: ten messages in a row make one buzz.
  if exists (select 1 from public.notification_outbox o
              where o.user_id = p_user and o.status = 'pending' and o.data ->> 'type' = p_type and (o.data ->> 'id') is not distinct from p_ref::text) then
    return;
  end if;
  if (select count(*) from public.notification_outbox where user_id = p_user and status = 'pending') >= 20 then return; end if;
  insert into public.notification_outbox (user_id, pref, title, body, data)
  values (p_user, p_pref, 'PawsPal', private.push_body(p_body_key, p.locale), jsonb_build_object('type', p_type, 'id', p_ref));
exception when others then
  raise warning 'notification not queued (%)', sqlstate;          -- the code only, never data
end $$;
revoke execute on function private.enqueue_notification(uuid, text, text, uuid, text, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------- events
create or replace function private.notify_new_message()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare v_other uuid;
begin
  select case when c.user_a = new.sender_id then c.user_b else c.user_a end into v_other
    from public.conversations c where c.id = new.conversation_id;
  if v_other is not null and not public.is_blocked_between(new.sender_id, v_other) then
    perform private.enqueue_notification(v_other, 'messages', 'message', new.conversation_id, 'message');
  end if;
  return new;
end $$;
revoke execute on function private.notify_new_message() from public, anon, authenticated;
create trigger notify_after_message after insert on public.messages
  for each row execute function private.notify_new_message();

-- A booking request, changed terms, a confirmed or a cancelled booking: the OTHER person hears about it.
create or replace function private.notify_booking_change()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare v_actor uuid := auth.uid(); r uuid;
begin
  if tg_op = 'INSERT'
     or new.terms_version is distinct from old.terms_version
     or (new.status is distinct from old.status and new.status in ('confirmed', 'cancelled')) then
    foreach r in array array[new.owner_id, new.sitter_id] loop
      if r is distinct from v_actor then
        perform private.enqueue_notification(r, 'bookings', 'booking', new.id, 'booking');
      end if;
    end loop;
  end if;
  return new;
end $$;
revoke execute on function private.notify_booking_change() from public, anon, authenticated;
create trigger notify_after_booking after insert or update on public.bookings
  for each row execute function private.notify_booking_change();

-- The founder decided a verification: the person hears "we have news about your account".
create or replace function private.notify_verification_decision()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  if old.status = 'pending' and new.status in ('approved', 'rejected') then
    perform private.enqueue_notification(new.user_id, 'verification', 'account', null, 'account', false);
  end if;
  return new;
end $$;
revoke execute on function private.notify_verification_decision() from public, anon, authenticated;
create trigger notify_after_verification_decision after update of status on public.verification_requests
  for each row execute function private.notify_verification_decision();

-- Same for a membership payment decision (the preference is "membership").
create or replace function private.notify_payment_decision()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  if old.status = 'pending' and new.status in ('confirmed', 'rejected') and new.user_id is not null then
    perform private.enqueue_notification(new.user_id, 'membership', 'account', null, 'account', false);
  end if;
  return new;
end $$;
revoke execute on function private.notify_payment_decision() from public, anon, authenticated;
create trigger notify_after_payment_decision after update of status on public.payment_claims
  for each row execute function private.notify_payment_decision();

-- Membership due soon: the daily reminder job already lists who is due (list_due_reminders) and calls mark_reminded after the
-- email went out. The push notification rides on the same call, so the same people are reminded once per renewal date.
create or replace function public.mark_reminded(p_user uuid, p_paid_until date)
returns void language plpgsql security definer set search_path = public, private as $$
begin
  update public.memberships set reminded_for = p_paid_until where user_id = p_user and paid_until = p_paid_until;
  if found then
    perform private.enqueue_notification(p_user, 'membership', 'membership', null, 'membership');
  end if;
end $$;
revoke execute on function public.mark_reminded(uuid, date) from public, anon, authenticated;
grant execute on function public.mark_reminded(uuid, date) to service_role;

-- ---------------------------------------------------------------- RPCs for the app
create or replace function public.register_push_token(p_token text, p_platform text)
returns void language plpgsql security definer set search_path = public as $$
declare v_status public.account_status;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select status into v_status from public.profiles where id = auth.uid();
  if v_status is null or v_status not in ('pending_verification', 'pending_review', 'active') then raise exception 'not allowed'; end if;
  if p_platform is null or p_platform not in ('ios', 'android') then raise exception 'invalid platform'; end if;
  if p_token is null or p_token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,128}\]$' then raise exception 'invalid token'; end if;
  perform pg_advisory_xact_lock(hashtext('push:' || auth.uid()::text));
  -- A token belongs to one device. If the device signs in as someone else, it moves to that person.
  insert into public.push_tokens (user_id, token, platform) values (auth.uid(), p_token, p_platform)
  on conflict (token) do update set user_id = auth.uid(), platform = excluded.platform, last_seen_at = now();
  -- At most five devices per person: the ones not seen for longest go first.
  delete from public.push_tokens where id in (
    select id from public.push_tokens where user_id = auth.uid() order by last_seen_at desc, created_at desc offset 5);
end $$;

create or replace function public.unregister_push_token(p_token text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from public.push_tokens where token = p_token and user_id = auth.uid();
end $$;

create or replace function public.my_notification_prefs()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare pr public.notification_prefs;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into pr from public.notification_prefs where user_id = auth.uid();
  return jsonb_build_object('messages', coalesce(pr.messages, true), 'bookings', coalesce(pr.bookings, true),
                            'membership', coalesce(pr.membership, true), 'verification', coalesce(pr.verification, true));
end $$;

-- Partial update: only the keys you send change. Unknown keys and values that are not true or false are refused.
create or replace function public.set_notification_prefs(p_prefs jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare k text; v jsonb; v_status public.account_status;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select status into v_status from public.profiles where id = auth.uid();
  if v_status is null or v_status = 'removed' then raise exception 'not allowed'; end if;
  if p_prefs is null or jsonb_typeof(p_prefs) <> 'object' then raise exception 'invalid preferences'; end if;
  for k, v in select * from jsonb_each(p_prefs) loop
    if k not in ('messages', 'bookings', 'membership', 'verification') or jsonb_typeof(v) <> 'boolean' then
      raise exception 'invalid preferences';
    end if;
  end loop;
  insert into public.notification_prefs (user_id) values (auth.uid()) on conflict (user_id) do nothing;
  update public.notification_prefs set
    messages     = coalesce((p_prefs ->> 'messages')::boolean, messages),
    bookings     = coalesce((p_prefs ->> 'bookings')::boolean, bookings),
    membership   = coalesce((p_prefs ->> 'membership')::boolean, membership),
    verification = coalesce((p_prefs ->> 'verification')::boolean, verification),
    updated_at   = now()
   where user_id = auth.uid();
  return public.my_notification_prefs();
end $$;

revoke execute on function public.register_push_token(text, text), public.unregister_push_token(text),
  public.my_notification_prefs(), public.set_notification_prefs(jsonb) from public, anon;
grant execute on function public.register_push_token(text, text), public.unregister_push_token(text),
  public.my_notification_prefs(), public.set_notification_prefs(jsonb) to authenticated;

-- ---------------------------------------------------------------- service role: the send-notifications function
create or replace function public.push_is_enabled()
returns boolean language sql stable security definer set search_path = public, private as $$
  select private.push_enabled()
$$;

-- Takes up to 100 waiting notifications, with the device tokens of each person. A row that is taken is not offered again for
-- 2, 4, 8, 16 minutes (so a crash or a failed send is retried later), and after 4 tries it is marked failed. Nothing is
-- returned while the switch is off.
create or replace function public.claim_notifications(p_limit integer default 100)
returns table (id bigint, title text, body text, data jsonb, tokens text[])
language plpgsql security definer set search_path = public, private as $$
declare v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 100);
begin
  if not private.push_enabled() then return; end if;
  update public.notification_outbox set status = 'expired' where status = 'pending' and created_at < now() - interval '1 day';
  update public.notification_outbox set status = 'failed' where status = 'pending' and attempts >= 4;
  delete from public.notification_outbox where status in ('sent', 'failed', 'skipped', 'expired') and created_at < now() - interval '7 days';
  delete from public.push_tokens where last_seen_at < now() - interval '180 days';
  return query
    with picked as (
      select o.id from public.notification_outbox o
       where o.status = 'pending' and o.next_attempt_at <= now()
       order by o.id limit v_limit for update skip locked),
    upd as (
      update public.notification_outbox o
         set attempts = o.attempts + 1, next_attempt_at = now() + interval '2 minutes' * power(2, o.attempts)
        from picked where o.id = picked.id
      returning o.id, o.user_id, o.title, o.body, o.data)
    select u.id, u.title, u.body, u.data,
           coalesce((select array_agg(t.token order by t.last_seen_at desc) from public.push_tokens t where t.user_id = u.user_id), '{}'::text[])
      from upd u order by u.id;
end $$;

create or replace function public.finish_notifications(p_ids bigint[])
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.notification_outbox set status = 'sent', sent_at = now() where id = any (coalesce(p_ids, '{}')) and status = 'pending';
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.remove_push_tokens(p_tokens text[])
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from public.push_tokens where token = any (coalesce(p_tokens, '{}'));
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.push_is_enabled(), public.claim_notifications(integer), public.finish_notifications(bigint[]),
  public.remove_push_tokens(text[]) from public, anon, authenticated;
grant execute on function public.push_is_enabled(), public.claim_notifications(integer), public.finish_notifications(bigint[]),
  public.remove_push_tokens(text[]) to service_role;
