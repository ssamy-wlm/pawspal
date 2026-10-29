-- 0004: hardening after the phase 2 reviews.
--   1. Test phone numbers can never become accounts on a database that has not switched them on.
--   2. One person cannot lock another person out of their own number.
--   3. One open appeal per enforcement action.

-- ---------------------------------------------------------------- 1. test numbers
-- Test numbers (like +20 100 000 0001) are given a fixed code by Supabase Auth settings. If one of those settings ever
-- reached the live project, anyone could sign in as that number. So the database itself refuses to create an account for
-- a number of that shape unless a developer's own local database has switched it on (a row in private.local_switches,
-- added by scripts/local-supabase.sh). The live database never has that row, and nothing in the app or in
-- supabase/config.toml can add it.
create table private.local_switches (name text primary key);
alter table private.local_switches enable row level security;   -- no policies: only the database owner touches it
create or replace function private.is_test_number(p_phone text)
returns boolean language sql immutable as $$
  select private.phone_digits(p_phone) ~ '^20(10|11|12|15)0{6}[0-9]{2}$'
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, private, extensions as $$
begin
  if new.phone is null or not private.is_egypt_mobile(new.phone) then
    raise exception 'sign-up not allowed';
  end if;
  if private.is_test_number(new.phone)
     and not exists (select 1 from private.local_switches where name = 'allow_test_numbers') then
    raise exception 'sign-up not allowed';
  end if;
  if exists (
    select 1 from public.banned_identifiers
    where kind = 'phone' and hash in (
      encode(digest(new.phone, 'sha256'), 'hex'),                                   -- as stored in auth.users
      private.phone_hash(new.phone),                                                -- digits only
      encode(digest('+' || private.phone_digits(new.phone), 'sha256'), 'hex'))      -- E.164 with a plus
  ) then
    raise exception 'sign-up not allowed';
  end if;
  insert into public.profiles (id, phone_verified) values (new.id, new.phone_confirmed_at is not null);
  return new;
end $$;

-- ---------------------------------------------------------------- 2. no lock-out of someone else's number
-- Before, two wrong codes (from anywhere) blocked even asking for a new code, so a stranger could keep a person out.
-- Now:
--   * asking for a code is never blocked by wrong guesses;
--   * two wrong codes from THIS device for this number need a CAPTCHA (or a 10 minute wait), other devices are unaffected;
--   * ten wrong codes from all devices since the last code was sent make that code unusable: the person simply asks
--     for a new one, which starts the count again.
create or replace function public.otp_check_and_log(p_phone_hash text, p_device_hash text, p_captcha_ok boolean default false, p_mode text default 'check')
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  v_dev_fails int; v_last_fail timestamptz; v_num_fails int;
  v_last_ok timestamptz; v_last_send timestamptz;
  v_sends int; v_oldest_send timestamptz;
  v_requests int; v_oldest_request timestamptz;
begin
  if p_mode not in ('check', 'request', 'send') then raise exception 'bad mode'; end if;
  perform pg_advisory_xact_lock(hashtext(p_phone_hash));    -- one decision per number at a time
  delete from private.otp_events where created_at < now() - interval '2 days';

  if p_mode = 'check' then
    select max(created_at) into v_last_ok   from private.otp_events where phone_hash = p_phone_hash and kind = 'verify_ok';
    select max(created_at) into v_last_send from private.otp_events where phone_hash = p_phone_hash and kind = 'send';

    -- Wrong codes since the last correct one: ten from anywhere since the last code was sent use that code up.
    select count(*) into v_num_fails from private.otp_events
     where phone_hash = p_phone_hash and kind = 'verify_fail'
       and created_at > greatest(coalesce(v_last_ok, 'epoch'), coalesce(v_last_send, 'epoch'));
    if v_num_fails >= 10 then
      insert into public.security_events (kind, details) values ('otp_blocked', jsonb_build_object('reason', 'request_new_code'));
      return jsonb_build_object('allowed', false, 'reason', 'request_new_code', 'captcha_required', false, 'retry_after_seconds', 0);
    end if;

    -- Two wrong codes from this device in the last 15 minutes need a CAPTCHA.
    select count(*), max(created_at) into v_dev_fails, v_last_fail
      from private.otp_events
     where phone_hash = p_phone_hash and device_hash is not distinct from p_device_hash and kind = 'verify_fail'
       and created_at > now() - interval '15 minutes' and created_at > coalesce(v_last_ok, 'epoch');
    if v_dev_fails >= 2 and not p_captcha_ok then
      insert into public.security_events (kind, details) values ('otp_blocked', jsonb_build_object('reason', 'captcha_required'));
      return jsonb_build_object('allowed', false, 'reason', 'captcha_required', 'captcha_required', true,
        'retry_after_seconds', greatest(1, ceil(extract(epoch from (v_last_fail + interval '10 minutes' - now())))::int));
    end if;
  end if;

  select count(*), min(created_at) into v_sends, v_oldest_send
    from private.otp_events where phone_hash = p_phone_hash and kind = 'send' and created_at > now() - interval '1 hour';
  if v_sends >= 3 and p_mode <> 'check' then
    insert into public.security_events (kind, details) values ('otp_blocked', jsonb_build_object('reason', 'phone_limit'));
    return jsonb_build_object('allowed', false, 'reason', 'phone_limit', 'captcha_required', false,
      'retry_after_seconds', greatest(1, ceil(extract(epoch from (v_oldest_send + interval '1 hour' - now())))::int));
  end if;

  if p_device_hash is not null and p_mode = 'request' then
    select count(*), min(created_at) into v_requests, v_oldest_request
      from private.otp_events where device_hash = p_device_hash and kind = 'request' and created_at > now() - interval '1 day';
    if v_requests >= 10 then
      insert into public.security_events (kind, details) values ('otp_blocked', jsonb_build_object('reason', 'device_limit'));
      return jsonb_build_object('allowed', false, 'reason', 'device_limit', 'captcha_required', false,
        'retry_after_seconds', greatest(1, ceil(extract(epoch from (v_oldest_request + interval '1 day' - now())))::int));
    end if;
  end if;

  if p_mode = 'send' then
    insert into private.otp_events (kind, phone_hash) values ('send', p_phone_hash);
  elsif p_mode = 'request' and p_device_hash is not null then
    insert into private.otp_events (kind, phone_hash, device_hash) values ('request', p_phone_hash, p_device_hash);
  end if;
  return jsonb_build_object('allowed', true, 'reason', null, 'captcha_required', false, 'retry_after_seconds', 0);
end $$;
revoke execute on function public.otp_check_and_log(text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.otp_check_and_log(text, text, boolean, text) to service_role;

-- ---------------------------------------------------------------- 3. appeals
-- One open appeal per action: a person cannot flood the review queue.
create unique index appeals_one_open_per_action on public.appeals (action_id) where status in ('new', 'in_review');
