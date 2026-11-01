-- 0013: architecture v3 (docs/ARCHITECTURE.md), the "direct" model.
--   * two account types only (owner, sitter = Host); swaps are gone
--   * email + password sign-up; phone, OTP and SMS are gone
--   * verification by hand: selfie + ID photo, the founder approves or rejects, the ID photo is deleted right after
--   * membership: registration then renewal, paid outside the app, confirmed by hand; a lapsed account is not "active"
--   * no booking fee, no Paymob, no refunds; both people accept the terms and the booking is confirmed
--   * map of availability, payment settings, reminders
--
-- destructive-approved
-- The founder asked in chat to remove the booking fee, Paymob, swaps, phone sign-up and the "both" role entirely. The live
-- database holds no people, bookings or payments yet (one admin account only), so no user data is lost.

-- ================================================================ 1. money to PawsPal is gone from bookings
drop function if exists public.confirm_booking_payment cascade;
drop function if exists public.request_swap cascade;
drop function if exists public.refund_preview cascade;
drop function if exists public.refund_for cascade;
drop function if exists public.list_refunds_due cascade;
drop function if exists public.mark_refund_result cascade;
drop function if exists public.complete_fee_payment cascade;
drop function if exists public.fail_fee_payment cascade;
drop function if exists public.begin_fee_payment cascade;
drop function if exists public.set_payment_ref cascade;
drop function if exists public.fee_payer cascade;
drop function if exists public.set_booking_opener cascade;
drop function if exists public.booking_fee_cents cascade;
drop function if exists public.refund_charge_cents cascade;
drop function if exists public.check_app_setting cascade;
drop table if exists public.booking_payments cascade;
drop table if exists public.app_settings cascade;
drop function if exists public.cancel_booking(uuid, text);
drop function if exists public.propose_terms(uuid, date, date, public.stay_location, public.cost_type, integer, boolean);
drop function if exists public.accept_terms(uuid, integer);
drop function if exists public.request_booking(uuid, uuid, date, date, public.stay_location, public.cost_type, integer, boolean);
drop function if exists public.booking_legs cascade;
drop function if exists public.lock_booking_legs cascade;
drop function if exists public.has_paid_booking cascade;

alter table public.bookings drop column if exists fee_status;
alter table public.bookings drop column if exists opened_by;
alter table public.bookings drop column if exists swap_group;
drop type if exists public.fee_status;

-- ================================================================ 2. no swaps
alter table public.bookings alter column cost_type drop default;
alter type public.cost_type rename to cost_type_old;
create type public.cost_type as enum ('paid', 'volunteer');
alter table public.bookings alter column cost_type type public.cost_type using (case cost_type::text when 'volunteer' then 'volunteer' else 'paid' end)::public.cost_type;
alter table public.bookings alter column cost_type set default 'paid';
drop type public.cost_type_old;

update public.availability set offers = array_remove(offers, 'swap');
alter table public.availability drop constraint if exists availability_offers_check;
alter table public.availability add constraint availability_offers_check
  check (offers <@ array['volunteer', 'paid', 'food_provided', 'stay_at_my_place']);

-- ================================================================ 3. two roles: owner and sitter (Host)
drop view if exists public.profile_cards;
drop trigger if exists lock_role_after_submit_before_update on public.profiles;
alter table public.profiles alter column role drop default;
alter type public.user_role rename to user_role_old;
create type public.user_role as enum ('owner', 'sitter');
alter table public.profiles alter column role type public.user_role using (case role::text when 'sitter' then 'sitter' else 'owner' end)::public.user_role;
alter table public.profiles alter column role set default 'owner';
drop type public.user_role_old;
create trigger lock_role_after_submit_before_update before update of role on public.profiles
  for each row execute function public.lock_role_after_submit();

create or replace function public.check_availability_post()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id = new.user_id and role = 'sitter') then
    raise exception 'only hosts can post availability';
  end if;
  perform pg_advisory_xact_lock(hashtext('post:' || new.user_id::text));      -- parallel posts cannot both slip under the limit
  if tg_op = 'INSERT' and (select count(*) from public.availability where user_id = new.user_id and ends_on >= current_date) >= 10 then
    raise exception 'too many open posts';
  end if;
  return new;
end $$;

create or replace function public.check_travel_post()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id = new.user_id and role = 'owner') then
    raise exception 'only pet owners can post travel dates';
  end if;
  perform pg_advisory_xact_lock(hashtext('post:' || new.user_id::text));
  if tg_op = 'UPDATE' and new.starts_on < current_date and new.starts_on is distinct from old.starts_on then
    raise exception 'dates cannot be moved into the past';
  end if;
  if tg_op = 'INSERT' and (select count(*) from public.travel_posts where user_id = new.user_id and ends_on >= current_date) >= 5 then
    raise exception 'too many open posts';
  end if;
  new.note := public.mask_contact_text(new.note);      -- public text: no phone numbers or links
  return new;
end $$;

-- ================================================================ 4. phone, OTP and SMS are gone
drop trigger if exists on_auth_phone_confirmed on auth.users;
drop function if exists public.handle_phone_confirmed cascade;
drop function if exists public.otp_check_and_log cascade;
drop function if exists public.otp_record_result cascade;
drop function if exists public.is_phone_banned cascade;
drop function if exists public.record_verification cascade;
drop function if exists public.set_verification cascade;
drop function if exists public.my_signup_state cascade;
drop function if exists public.submit_profile cascade;
drop table if exists private.otp_events cascade;

alter table public.banned_identifiers drop constraint if exists banned_identifiers_kind_check;
delete from public.banned_identifiers where kind = 'phone';
alter table public.banned_identifiers add constraint banned_identifiers_kind_check check (kind in ('email', 'device', 'id_document'));
alter table public.profiles drop column if exists phone_verified;

create or replace function private.email_hash(p_email text)
returns text language sql immutable set search_path = extensions, pg_catalog as $$
  select encode(digest(lower(btrim(coalesce(p_email, ''))), 'sha256'), 'hex')
$$;
create or replace function private.device_hash(p_device text)
returns text language sql immutable set search_path = extensions, pg_catalog as $$
  select encode(digest(btrim(coalesce(p_device, '')), 'sha256'), 'hex')
$$;

-- What a ban is made of: the email and the device (hashed). Used by removal and reinstatement.
create or replace function private.identity_hashes(p_user uuid)
returns table (kind text, hash text) language sql stable security definer set search_path = public, private, extensions, auth as $$
  select 'email', private.email_hash(u.email) from auth.users u where u.id = p_user and u.email is not null
  union
  select f.kind, f.hash from private.identity_fingerprints f where f.user_id = p_user;
$$;
revoke execute on function private.identity_hashes(uuid) from public, anon, authenticated;

drop function if exists private.is_test_number cascade;
drop function if exists private.is_egypt_mobile cascade;
drop function if exists private.phone_hash cascade;
drop function if exists private.phone_digits cascade;
drop table if exists private.local_switches cascade;

-- ================================================================ 5. membership, settings
create table public.app_settings (
  key        text primary key,
  value      text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
revoke insert, update, delete on public.app_settings from anon, authenticated;
create policy "signed-in people read the settings" on public.app_settings for select to authenticated using (true);
insert into public.app_settings (key, value) values
  ('registration_fee_egp', '75'), ('renewal_fee_egp', '25'), ('membership_months', '6'), ('reminder_days', '7'),
  ('instapay_link', ''), ('instapay_qr_url', ''), ('bank_name', ''), ('bank_account_name', ''),
  ('bank_account_number', ''), ('bank_iban', ''), ('payment_note', '');

create or replace function private.setting_int(p_key text, p_default integer)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(value, '')::integer from public.app_settings where key = p_key), p_default)
$$;
revoke execute on function private.setting_int(text, integer) from public, anon, authenticated;

create table public.memberships (
  user_id      uuid primary key references public.profiles (id) on delete cascade,
  paid_until   date,                                   -- null until the registration payment is confirmed
  reminded_for date,                                   -- the paid_until date a reminder email was already sent for
  created_at   timestamptz not null default now()
);
alter table public.memberships enable row level security;
revoke insert, update, delete on public.memberships from anon, authenticated;
create policy "read own membership or admin" on public.memberships for select to authenticated using (user_id = auth.uid() or public.is_admin());
create index on public.memberships (paid_until);

-- Everyone who already has a profile gets a membership row (nobody has paid yet).
insert into public.memberships (user_id) select id from public.profiles on conflict do nothing;

-- An account is usable only when it is approved AND its membership is paid up. Every rule that asks "is this person active"
-- (search, messages, requests, bookings, profile cards) therefore stops working by itself when a membership lapses.
create or replace function public.is_active(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p join public.memberships m on m.user_id = p.id
                  where p.id = p_user and p.status = 'active' and m.paid_until is not null and m.paid_until >= current_date);
$$;

create or replace view public.profile_cards as
  select p.id, p.first_name, p.role, p.bio, p.area, p.approx_lat, p.approx_lng,
         p.face_photo_path, p.home_photo_path, p.card_illustration, p.card_background,
         p.rating_avg, p.stays_count, p.created_at, p.home_tags
  from public.profiles p
  where p.status = 'active'
    and public.is_active(p.id)                       -- a paused host is not shown to anyone
    and auth.uid() is not null
    and public.is_active(auth.uid())                 -- only active people see other people
    and not public.is_blocked_between(auth.uid(), p.id);
revoke all on public.profile_cards from anon;
grant select on public.profile_cards to authenticated;

-- ================================================================ 6. verification by hand
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('ids', 'ids', false, 8388608, array['image/jpeg', 'image/png']),
  ('payments', 'payments', false, 8388608, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;
-- ID photos and payment screenshots: only an admin (with the authenticator code) can read or delete them. Nobody else can,
-- not even the person who uploaded them. They are written by process-upload (service role) only.
create policy "admins read id and payment files" on storage.objects
  for select to authenticated using (bucket_id in ('ids', 'payments') and public.is_admin());
create policy "admins delete id and payment files" on storage.objects
  for delete to authenticated using (bucket_id in ('ids', 'payments') and public.is_admin());

create table public.verification_requests (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  face_path    text not null,
  id_path      text,                                   -- cleared the moment the founder decides; the file is deleted too
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  note         text check (char_length(note) <= 1000),
  submitted_at timestamptz not null default now(),
  decided_at   timestamptz,
  decided_by   uuid
);
create unique index verification_one_pending on public.verification_requests (user_id) where status = 'pending';
create index on public.verification_requests (user_id, submitted_at desc);
alter table public.verification_requests enable row level security;
revoke insert, update, delete on public.verification_requests from anon, authenticated;
create policy "read own verification or admin" on public.verification_requests for select to authenticated using (user_id = auth.uid() or public.is_admin());

create table public.payment_claims (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  kind            text not null check (kind in ('registration', 'renewal')),
  amount_egp      integer not null check (amount_egp > 0),
  reference       text check (char_length(reference) <= 80),
  screenshot_path text,                                -- cleared the moment the founder decides; the file is deleted too
  status          text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
  note            text check (char_length(note) <= 1000),
  created_at      timestamptz not null default now(),
  decided_at      timestamptz,
  decided_by      uuid,
  check (reference is not null or screenshot_path is not null or status <> 'pending')
);
create unique index payment_one_pending on public.payment_claims (user_id) where status = 'pending';
create index on public.payment_claims (user_id, created_at desc);
alter table public.payment_claims enable row level security;
revoke insert, update, delete on public.payment_claims from anon, authenticated;
create policy "read own claims or admin" on public.payment_claims for select to authenticated using (user_id = auth.uid() or public.is_admin());

-- ================================================================ 7. sign-up (email), terms accepted at sign-up
-- Refusals carry a short code in the server log only (never an address): E1 bad email, E2 no role and no invite, E3 bad role,
-- E4 the Terms version is not the current one, E5 banned email, E6 banned device.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, private, extensions as $$
declare
  v_email  text := lower(btrim(coalesce(new.email, '')));
  v_role   text := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'role', '')), '');
  v_terms  text := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'terms_version', '')), '');
  v_device text := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'device_id', '')), '');
  v_privacy text;
begin
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'sign-up not allowed [E1]'; end if;
  if exists (select 1 from public.banned_identifiers where kind = 'email' and hash = private.email_hash(v_email)) then
    raise exception 'sign-up not allowed [E5]';
  end if;
  if v_device is not null and exists (select 1 from public.banned_identifiers where kind = 'device' and hash = private.device_hash(v_device)) then
    raise exception 'sign-up not allowed [E6]';
  end if;
  if v_role is null then
    -- Accounts made in the Supabase dashboard (the admins) carry no role: they must have been invited first.
    if not exists (select 1 from private.admin_invites where email = v_email) then raise exception 'sign-up not allowed [E2]'; end if;
    update private.admin_invites set user_id = new.id where email = v_email and user_id is null;
    insert into public.profiles (id) values (new.id);
    insert into public.memberships (user_id) values (new.id);
    return new;
  end if;
  if v_role not in ('owner', 'sitter') then raise exception 'sign-up not allowed [E3]'; end if;
  -- The sign-up screen shows the disclaimer and the Terms; the version it sends is the proof the person agreed to those words.
  if v_terms is null or not exists (select 1 from public.legal_documents where doc = 'terms' and current_version = v_terms) then
    raise exception 'sign-up not allowed [E4]';
  end if;
  insert into public.profiles (id, role) values (new.id, v_role::public.user_role);
  insert into public.memberships (user_id) values (new.id);
  insert into public.legal_acceptances (user_id, doc, version) values (new.id, 'terms', v_terms);
  select current_version into v_privacy from public.legal_documents where doc = 'privacy';
  insert into public.legal_acceptances (user_id, doc, version) values (new.id, 'privacy', v_privacy);
  if v_device is not null then
    insert into private.identity_fingerprints (kind, hash, user_id) values ('device', private.device_hash(v_device), new.id) on conflict do nothing;
  end if;
  return new;
end $$;

-- A new admin: the email was invited, and its owner proved it by confirming the sign-up email. (No phone any more.)
create or replace function private.grant_admin(p_email text)
returns text language plpgsql security definer set search_path = public, private, auth as $$
declare v_id uuid; v_confirmed timestamptz;
begin
  select id, email_confirmed_at into v_id, v_confirmed from auth.users where lower(email) = lower(btrim(p_email));
  if v_id is null then return 'no_user'; end if;
  if not exists (select 1 from private.admin_invites where email = lower(btrim(p_email))) then return 'no_invite'; end if;
  if v_confirmed is null then return 'not_confirmed'; end if;
  insert into public.admins (user_id) values (v_id) on conflict do nothing;
  insert into public.audit_log (admin_id, action, target_user, details)
  values ('00000000-0000-0000-0000-000000000000', 'admin_granted', v_id, '{}');
  return 'granted';
end $$;
revoke execute on function private.grant_admin(text) from public, anon, authenticated;

-- ================================================================ 8. where is this person? (replaces my_signup_state)
create or replace function public.my_account_state()
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare
  p public.profiles; m public.memberships; v public.verification_requests; c public.payment_claims;
  v_pet boolean; v_loc boolean; v_legal boolean; v_missing text[] := '{}';
  v_reg integer := private.setting_int('registration_fee_egp', 75);
  v_ren integer := private.setting_int('renewal_fee_egp', 25);
  v_remind integer := private.setting_int('reminder_days', 7);
  v_state text; v_kind text; v_amount integer; v_days integer; v_vstatus text; v_cstatus text;
begin
  select * into p from public.profiles where id = auth.uid();
  if p.id is null then raise exception 'not signed in'; end if;
  select * into m from public.memberships where user_id = p.id;
  select * into v from public.verification_requests where user_id = p.id order by submitted_at desc limit 1;
  select * into c from public.payment_claims where user_id = p.id order by created_at desc limit 1;
  v_pet   := exists (select 1 from public.pets where owner_id = p.id);
  v_loc   := exists (select 1 from private.locations where user_id = p.id);
  v_legal := not exists (
    select 1 from public.legal_documents d
     where not exists (select 1 from public.legal_acceptances a where a.user_id = p.id and a.doc = d.doc and a.version = d.current_version));
  v_vstatus := coalesce(v.status, 'none');
  if v_vstatus in ('none', 'rejected') then v_missing := array_append(v_missing, 'verification'); end if;
  if p.first_name is null then v_missing := array_append(v_missing, 'name'); end if;
  if p.role = 'owner' and not v_pet then v_missing := array_append(v_missing, 'pet'); end if;
  if p.role = 'sitter' and p.home_photo_path is null then v_missing := array_append(v_missing, 'home'); end if;
  if not v_loc then v_missing := array_append(v_missing, 'location'); end if;
  if not v_legal then v_missing := array_append(v_missing, 'legal'); end if;

  if m.paid_until is null then v_state := 'unpaid'; v_kind := 'registration'; v_amount := v_reg;
  elsif m.paid_until < current_date then v_state := 'paused'; v_kind := 'renewal'; v_amount := v_ren; v_days := m.paid_until - current_date;
  elsif m.paid_until - current_date <= v_remind then v_state := 'due_soon'; v_kind := 'renewal'; v_amount := v_ren; v_days := m.paid_until - current_date;
  else v_state := 'active'; v_kind := 'renewal'; v_amount := v_ren; v_days := m.paid_until - current_date;
  end if;
  v_cstatus := case when c.id is null or c.status = 'confirmed' then 'none' else c.status end;

  return jsonb_build_object(
    'status', p.status, 'role', p.role, 'first_name', p.first_name,
    'missing', to_jsonb(v_missing),
    'has_pet', v_pet, 'has_home_photo', p.home_photo_path is not null, 'has_location', v_loc, 'legal_accepted', v_legal,
    'verification', jsonb_build_object('status', v_vstatus, 'note', case when v_vstatus = 'rejected' then v.note end),
    'membership', jsonb_build_object('state', v_state, 'kind', v_kind, 'paid_until', m.paid_until, 'days_left', v_days,
                                     'amount_egp', v_amount, 'claim_status', v_cstatus,
                                     'claim_note', case when v_cstatus = 'rejected' then c.note end));
end $$;

create or replace function public.submit_profile()
returns public.account_status language plpgsql security definer set search_path = public, private as $$
declare v_state jsonb; v_status public.account_status;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  v_state := public.my_account_state();
  v_status := (v_state ->> 'status')::public.account_status;
  if v_status = 'pending_review' then return v_status; end if;          -- already submitted
  if v_status <> 'pending_verification' then raise exception 'profile cannot be submitted'; end if;
  if jsonb_array_length(v_state -> 'missing') > 0 then
    raise exception 'profile incomplete' using detail = (v_state -> 'missing')::text;
  end if;
  update public.profiles set status = 'pending_review', updated_at = now() where id = auth.uid();
  insert into public.security_events (user_id, kind) values (auth.uid(), 'profile_submitted');
  return 'pending_review';
end $$;

-- The two photos come from process-upload: clean copies in the person's own folder, in faces and ids.
create or replace function public.submit_verification(p_face_path text, p_id_path text)
returns uuid language plpgsql security definer set search_path = public, storage as $$
declare v_id uuid; v_status public.account_status;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select status into v_status from public.profiles where id = auth.uid();
  if v_status is distinct from 'pending_verification' then raise exception 'not allowed'; end if;
  if p_face_path is null or p_face_path !~ ('^' || auth.uid()::text || '/[A-Za-z0-9._-]{1,100}$')
     or p_id_path is null or p_id_path !~ ('^' || auth.uid()::text || '/[A-Za-z0-9._-]{1,100}$') then
    raise exception 'invalid photo';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'faces' and o.name = p_face_path)
     or not exists (select 1 from storage.objects o where o.bucket_id = 'ids' and o.name = p_id_path) then
    raise exception 'invalid photo';
  end if;
  perform pg_advisory_xact_lock(hashtext('verification:' || auth.uid()::text));
  if (select count(*) from public.verification_requests where user_id = auth.uid() and submitted_at > now() - interval '1 day') >= 5 then
    raise exception 'too many tries';
  end if;
  update public.verification_requests set face_path = p_face_path, id_path = p_id_path, submitted_at = now()
   where user_id = auth.uid() and status = 'pending' returning id into v_id;     -- retaking the photos replaces the pending request
  if v_id is null then
    insert into public.verification_requests (user_id, face_path, id_path) values (auth.uid(), p_face_path, p_id_path) returning id into v_id;
  end if;
  update public.profiles set face_photo_path = p_face_path, updated_at = now() where id = auth.uid();
  return v_id;
end $$;

create or replace function public.get_payment_settings()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when auth.uid() is null then '{}'::jsonb else coalesce((select jsonb_object_agg(key, value) from public.app_settings), '{}'::jsonb) end
$$;

create or replace function public.submit_payment_claim(p_reference text, p_screenshot_path text)
returns uuid language plpgsql security definer set search_path = public, private, storage as $$
declare v_status public.account_status; m public.memberships; v_kind text; v_amount integer; v_id uuid; v_ref text := nullif(btrim(coalesce(p_reference, '')), '');
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select status into v_status from public.profiles where id = auth.uid();
  if v_status is null or v_status in ('suspended', 'removed') then raise exception 'not allowed'; end if;
  if v_ref is null and p_screenshot_path is null then raise exception 'a reference or a screenshot is required'; end if;
  if v_ref is not null and length(v_ref) > 80 then raise exception 'reference too long'; end if;
  if p_screenshot_path is not null and (p_screenshot_path !~ ('^' || auth.uid()::text || '/[A-Za-z0-9._-]{1,100}$')
     or not exists (select 1 from storage.objects o where o.bucket_id = 'payments' and o.name = p_screenshot_path)) then
    raise exception 'invalid screenshot';
  end if;
  select * into m from public.memberships where user_id = auth.uid();
  if m.paid_until is null then v_kind := 'registration'; v_amount := private.setting_int('registration_fee_egp', 75);
  elsif m.paid_until - current_date <= private.setting_int('reminder_days', 7) then v_kind := 'renewal'; v_amount := private.setting_int('renewal_fee_egp', 25);
  else raise exception 'not due yet'; end if;
  perform pg_advisory_xact_lock(hashtext('claim:' || auth.uid()::text));
  if exists (select 1 from public.payment_claims where user_id = auth.uid() and status = 'pending') then raise exception 'a payment is already waiting'; end if;
  if (select count(*) from public.payment_claims where user_id = auth.uid() and created_at > now() - interval '1 day') >= 5 then raise exception 'too many tries'; end if;
  insert into public.payment_claims (user_id, kind, amount_egp, reference, screenshot_path)
  values (auth.uid(), v_kind, v_amount, v_ref, p_screenshot_path) returning id into v_id;
  return v_id;
end $$;

-- ================================================================ 9. the founder decides (all audited, admin + authenticator code)
create or replace function public.admin_decide_verification(p_user uuid, p_approve boolean, p_adult boolean, p_note text)
returns text language plpgsql security definer set search_path = public as $$
declare r public.verification_requests; v_path text; v_status public.account_status;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  if length(coalesce(p_note, '')) > 1000 then raise exception 'too long'; end if;
  select * into r from public.verification_requests where user_id = p_user and status = 'pending' for update;
  if r.id is null then raise exception 'no pending request'; end if;
  select status into v_status from public.profiles where id = p_user for update;
  v_path := r.id_path;
  if p_approve then
    if p_adult is not true then raise exception 'confirm that the person is an adult'; end if;
    if v_status <> 'pending_review' then raise exception 'the profile is not waiting for review'; end if;
    update public.profiles set face_verified = true, id_verified = true, is_adult = true, updated_at = now() where id = p_user;
    perform public.admin_take_action(p_user, 'approval', null, null, false, '[]', null);        -- the account becomes active
    update public.verification_requests set status = 'approved', id_path = null, note = nullif(btrim(p_note), ''), decided_at = now(), decided_by = auth.uid() where id = r.id;
    insert into public.audit_log (admin_id, action, target_user, details) values (auth.uid(), 'verification_approved', p_user, '{}');
  else
    if btrim(coalesce(p_note, '')) = '' then raise exception 'a reason is required'; end if;
    if v_status = 'pending_review' then update public.profiles set status = 'pending_verification', updated_at = now() where id = p_user; end if;
    update public.verification_requests set status = 'rejected', id_path = null, note = btrim(p_note), decided_at = now(), decided_by = auth.uid() where id = r.id;
    insert into public.audit_log (admin_id, action, target_user, details) values (auth.uid(), 'verification_rejected', p_user, '{}');
  end if;
  return coalesce(v_path, '');                         -- the admin site deletes this file at once; the nightly clean-up is the safety net
end $$;

create or replace function public.admin_confirm_payment(p_claim uuid, p_confirm boolean, p_note text)
returns text language plpgsql security definer set search_path = public, private as $$
declare c public.payment_claims; v_path text; v_months integer := private.setting_int('membership_months', 6);
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  if length(coalesce(p_note, '')) > 1000 then raise exception 'too long'; end if;
  select * into c from public.payment_claims where id = p_claim and status = 'pending' for update;
  if c.id is null then raise exception 'no pending payment'; end if;
  v_path := c.screenshot_path;
  if p_confirm then
    insert into public.memberships (user_id, paid_until) values (c.user_id, (current_date + make_interval(months => v_months))::date)
    on conflict (user_id) do update
      set paid_until = (greatest(current_date, coalesce(public.memberships.paid_until, current_date)) + make_interval(months => v_months))::date,
          reminded_for = null;
    update public.payment_claims set status = 'confirmed', screenshot_path = null, note = nullif(btrim(p_note), ''), decided_at = now(), decided_by = auth.uid() where id = c.id;
    insert into public.audit_log (admin_id, action, target_user, details)
    values (auth.uid(), 'payment_confirmed', c.user_id, jsonb_build_object('kind', c.kind, 'amount_egp', c.amount_egp));
  else
    if btrim(coalesce(p_note, '')) = '' then raise exception 'a reason is required'; end if;
    update public.payment_claims set status = 'rejected', screenshot_path = null, note = btrim(p_note), decided_at = now(), decided_by = auth.uid() where id = c.id;
    insert into public.audit_log (admin_id, action, target_user, details)
    values (auth.uid(), 'payment_rejected', c.user_id, jsonb_build_object('kind', c.kind, 'amount_egp', c.amount_egp));
  end if;
  return coalesce(v_path, '');
end $$;

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
  elsif p_key in ('instapay_link', 'instapay_qr_url') then
    if v_value <> '' and v_value !~ '^https://[^[:space:]]{3,480}$' then raise exception 'invalid value'; end if;
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

create or replace function public.admin_overview()
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  return jsonb_build_object(
    'active_users',      (select count(*) from public.profiles p where public.is_active(p.id)),
    'new_this_week',     (select count(*) from public.profiles where created_at > now() - interval '7 days'
                            and not exists (select 1 from public.admins a where a.user_id = profiles.id)),
    'open_reports',      (select count(*) from public.reports where status in ('new', 'in_review')),
    'high_priority',     (select count(*) from public.reports where status in ('new', 'in_review') and priority = 'high'),
    'suspended',         (select count(*) from public.profiles where status = 'suspended'),
    'pending_approvals', (select count(*) from public.profiles p where p.status = 'pending_review'
                            and exists (select 1 from public.verification_requests v where v.user_id = p.id and v.status = 'pending')),
    'pending_verifications', (select count(*) from public.profiles p where p.status = 'pending_review'
                            and exists (select 1 from public.verification_requests v where v.user_id = p.id and v.status = 'pending')),
    'pending_payments',  (select count(*) from public.payment_claims where status = 'pending'),
    'expiring_soon',     (select count(*) from public.memberships m join public.profiles p on p.id = m.user_id
                           where p.status = 'active' and m.paid_until >= current_date
                             and m.paid_until <= current_date + private.setting_int('reminder_days', 7)),
    'paused',            (select count(*) from public.memberships m join public.profiles p on p.id = m.user_id
                           where p.status = 'active' and m.paid_until < current_date),
    'open_appeals',      (select count(*) from public.appeals where status in ('new', 'in_review')),
    'actions_this_month',(select count(*) from public.enforcement_actions where created_at >= date_trunc('month', now()))
  );
end $$;

revoke execute on function public.my_account_state(), public.submit_profile(), public.submit_verification(text, text),
  public.get_payment_settings(), public.submit_payment_claim(text, text), public.admin_decide_verification(uuid, boolean, boolean, text),
  public.admin_confirm_payment(uuid, boolean, text), public.admin_set_setting(text, text), public.admin_overview() from public, anon;
grant execute on function public.my_account_state(), public.submit_profile(), public.submit_verification(text, text),
  public.get_payment_settings(), public.submit_payment_claim(text, text), public.admin_decide_verification(uuid, boolean, boolean, text),
  public.admin_confirm_payment(uuid, boolean, text), public.admin_set_setting(text, text), public.admin_overview() to authenticated;

-- ================================================================ 10. reminders (service role: the membership-reminders function)
create or replace function public.list_due_reminders()
returns table (user_id uuid, email text, first_name text, locale text, paid_until date)
language sql stable security definer set search_path = public, private, auth as $$
  select m.user_id, u.email::text, p.first_name, p.locale, m.paid_until
    from public.memberships m
    join public.profiles p on p.id = m.user_id
    join auth.users u on u.id = m.user_id
   where p.status = 'active' and m.paid_until is not null and m.paid_until >= current_date
     and m.paid_until <= current_date + private.setting_int('reminder_days', 7)
     and m.reminded_for is distinct from m.paid_until and u.email is not null
$$;
create or replace function public.mark_reminded(p_user uuid, p_paid_until date)
returns void language sql security definer set search_path = public as $$
  update public.memberships set reminded_for = p_paid_until where user_id = p_user and paid_until = p_paid_until
$$;
revoke execute on function public.list_due_reminders(), public.mark_reminded(uuid, date) from public, anon, authenticated;
grant execute on function public.list_due_reminders(), public.mark_reminded(uuid, date) to service_role;

-- ================================================================ 11. bookings: both accept, the booking is confirmed
create or replace function public.has_confirmed_booking(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.bookings
    where status in ('confirmed', 'in_progress', 'completed')
      and ((owner_id = a and sitter_id = b) or (owner_id = b and sitter_id = a))
  );
$$;

create or replace function public.mask_contact_info()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_other uuid;
  v_body  text;
begin
  new.masked := false;  -- only this trigger may set it
  select case when c.user_a = new.sender_id then c.user_b else c.user_a end
    into v_other from public.conversations c where c.id = new.conversation_id;
  if public.has_confirmed_booking(new.sender_id, v_other) then return new; end if;     -- details unlock when a booking is confirmed
  v_body := public.mask_contact_text(new.body);
  if v_body <> new.body then
    new.body := v_body;
    new.masked := true;
    insert into public.security_events (user_id, kind, details)
    values (new.sender_id, 'contact_info_masked', jsonb_build_object('conversation', new.conversation_id));
  end if;
  return new;
end $$;

create or replace function public.request_booking(
  p_sitter uuid, p_pet uuid, p_starts date, p_ends date,
  p_location public.stay_location, p_cost public.cost_type, p_price integer, p_food boolean
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not public.is_active(auth.uid()) or not public.is_active(p_sitter) then
    raise exception 'both accounts must be active';
  end if;
  if p_sitter = auth.uid() or public.is_blocked_between(auth.uid(), p_sitter) then raise exception 'not allowed'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'owner')
     or not exists (select 1 from public.profiles where id = p_sitter and role = 'sitter') then
    raise exception 'the roles do not fit a booking';
  end if;
  if not exists (select 1 from public.pets where id = p_pet and owner_id = auth.uid()) then
    raise exception 'not your pet';
  end if;
  if p_starts < current_date or p_ends < p_starts or p_ends - p_starts > 60 then
    raise exception 'invalid dates';
  end if;
  if p_cost = 'paid' and (p_price is null or p_price < 0 or p_price > 100000) then raise exception 'invalid price'; end if;
  perform pg_advisory_xact_lock(hashtext('booking:' || auth.uid()::text));
  if not public.pet_is_free(p_pet, p_starts, p_ends) then raise exception 'that pet is already booked for these dates'; end if;
  if (select count(*) from public.bookings where (owner_id = auth.uid() or sitter_id = auth.uid()) and status = 'requested') >= 10 then
    raise exception 'too many open requests';
  end if;
  if exists (select 1 from public.bookings where owner_id = auth.uid() and sitter_id = p_sitter and pet_id = p_pet
              and status = 'requested' and daterange(starts_on, ends_on, '[]') && daterange(p_starts, p_ends, '[]')) then
    raise exception 'there is already a request for these dates';
  end if;
  insert into public.bookings (owner_id, sitter_id, pet_id, starts_on, ends_on, stay_location, cost_type, price_per_night, food_provided)
  values (auth.uid(), p_sitter, p_pet, p_starts, p_ends, p_location, p_cost,
          case when p_cost = 'paid' then p_price else null end, coalesce(p_food, false))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.propose_terms(
  p_booking uuid, p_starts date, p_ends date, p_location public.stay_location,
  p_cost public.cost_type, p_price integer, p_food boolean
) returns void language plpgsql security definer set search_path = public as $$
declare b public.bookings; v_other uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into b from public.bookings where id = p_booking for update;
  if b.id is null or auth.uid() not in (b.owner_id, b.sitter_id) or b.status <> 'requested' then raise exception 'booking cannot be changed'; end if;
  v_other := case when auth.uid() = b.owner_id then b.sitter_id else b.owner_id end;
  if not public.is_active(auth.uid()) or not public.is_active(v_other) or public.is_blocked_between(auth.uid(), v_other) then
    raise exception 'not allowed';
  end if;
  if p_starts < current_date or p_ends < p_starts or p_ends - p_starts > 60 then raise exception 'invalid dates'; end if;
  if p_cost = 'paid' and (p_price is null or p_price < 0 or p_price > 100000) then raise exception 'invalid price'; end if;
  if not public.pet_is_free(b.pet_id, p_starts, p_ends, array[b.id]) then raise exception 'that pet is already booked for these dates'; end if;
  update public.bookings
     set starts_on = p_starts, ends_on = p_ends, stay_location = p_location,
         price_per_night = case when p_cost = 'paid' then p_price else null end,
         cost_type = p_cost, food_provided = coalesce(p_food, false),
         owner_accepted_at = null, sitter_accepted_at = null, status = 'requested', terms_version = terms_version + 1
   where id = p_booking;
end $$;

-- Both people accept the terms as they stood when they looked at them: the booking is confirmed, the pet is locked, and
-- contact details and the exact address unlock. No fee, no payment step.
create or replace function public.accept_terms(p_booking uuid, p_version integer)
returns public.booking_status language plpgsql security definer set search_path = public as $$
declare b public.bookings; v_other uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into b from public.bookings where id = p_booking for update;
  if b.id is null or auth.uid() not in (b.owner_id, b.sitter_id) then raise exception 'not found'; end if;
  if b.status <> 'requested' then raise exception 'booking is not open'; end if;
  v_other := case when auth.uid() = b.owner_id then b.sitter_id else b.owner_id end;
  if not public.is_active(auth.uid()) or not public.is_active(v_other) or public.is_blocked_between(auth.uid(), v_other) then
    raise exception 'not allowed';
  end if;
  if b.terms_version <> p_version then raise exception 'the terms changed'; end if;
  if auth.uid() = b.owner_id then
    update public.bookings set owner_accepted_at = coalesce(owner_accepted_at, now()) where id = p_booking returning * into b;
  else
    update public.bookings set sitter_accepted_at = coalesce(sitter_accepted_at, now()) where id = p_booking returning * into b;
  end if;
  if b.owner_accepted_at is not null and b.sitter_accepted_at is not null then
    if not public.pet_is_free(b.pet_id, b.starts_on, b.ends_on, array[b.id]) then raise exception 'that pet is already booked for these dates'; end if;
    update public.bookings set status = 'confirmed', confirmed_at = now() where id = p_booking returning * into b;
    update public.pets set locked = true where id = b.pet_id;
  end if;
  return b.status;
end $$;

create or replace function public.cancel_booking(p_booking uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare b public.bookings;
begin
  select * into b from public.bookings where id = p_booking for update;
  update public.bookings set status = 'cancelled', cancelled_by = auth.uid()
   where id = p_booking and auth.uid() in (owner_id, sitter_id) and status in ('requested', 'confirmed');
  if not found then raise exception 'booking cannot be cancelled'; end if;
  update public.pets p set locked = false
   where p.id = b.pet_id
     and not exists (select 1 from public.bookings x where x.pet_id = p.id and x.status in ('confirmed', 'in_progress'));
  insert into public.security_events (user_id, kind, details)
  values (auth.uid(), 'booking_cancelled', jsonb_build_object('booking', p_booking, 'reason', left(p_reason, 300)));
end $$;

create or replace function public.get_booking_location(p_booking uuid)
returns table (lat double precision, lng double precision, address text)
language plpgsql stable security definer set search_path = public, private as $$
declare b public.bookings; v_host uuid;
begin
  select * into b from public.bookings where id = p_booking;
  if b.id is null or auth.uid() not in (b.owner_id, b.sitter_id) then raise exception 'not found'; end if;
  if b.status not in ('confirmed', 'in_progress') then
    raise exception 'location is released after the booking is confirmed';
  end if;
  v_host := case when b.stay_location = 'sitter_home' then b.sitter_id else b.owner_id end;
  if not (select share_exact_pin from public.profiles where id = v_host) then
    raise exception 'the host chose not to share an exact pin';
  end if;
  return query select l.lat, l.lng, l.address from private.locations l where l.user_id = v_host;
end $$;

revoke execute on function public.request_booking(uuid, uuid, date, date, public.stay_location, public.cost_type, integer, boolean),
  public.propose_terms(uuid, date, date, public.stay_location, public.cost_type, integer, boolean),
  public.accept_terms(uuid, integer), public.cancel_booking(uuid, text), public.get_booking_location(uuid) from public, anon;
grant execute on function public.request_booking(uuid, uuid, date, date, public.stay_location, public.cost_type, integer, boolean),
  public.propose_terms(uuid, date, date, public.stay_location, public.cost_type, integer, boolean),
  public.accept_terms(uuid, integer), public.cancel_booking(uuid, text), public.get_booking_location(uuid) to authenticated;

-- ================================================================ 12. map of availability (approximate areas only)
create or replace function public.map_availability(p_pet_type public.pet_type default null, p_limit integer default 200)
returns table (
  availability_id uuid, user_id uuid, first_name text, area text, approx_lat double precision, approx_lng double precision,
  price_per_night integer, offers text[], starts_on date, ends_on date, pets_accepted public.pet_type[]
)
language sql stable set search_path = public as $$
  select a.id, a.user_id, c.first_name, c.area, c.approx_lat, c.approx_lng, a.price_per_night, a.offers, a.starts_on, a.ends_on, a.pets_accepted
    from public.availability a
    join public.profile_cards c on c.id = a.user_id          -- active, paid up, not blocked, public columns only
   where a.user_id <> auth.uid() and a.ends_on >= current_date
     and c.approx_lat is not null and c.approx_lng is not null
     and (p_pet_type is null or p_pet_type = any (a.pets_accepted))
   order by a.starts_on
   limit least(greatest(coalesce(p_limit, 200), 1), 300);
$$;
revoke execute on function public.map_availability(public.pet_type, integer) from public, anon;
grant execute on function public.map_availability(public.pet_type, integer) to authenticated;

-- ================================================================ 13. clean-up list: ID photos and screenshots nobody needs
create or replace function public.list_unused_uploads(p_older_than interval default interval '1 day')
returns table (bucket_id text, name text)
language sql stable security definer set search_path = public, storage as $$
  select o.bucket_id, o.name from storage.objects o
   where o.bucket_id = 'incoming' and o.created_at < now() - interval '1 hour'
  union all
  select o.bucket_id, o.name from storage.objects o
   where o.bucket_id = 'pets' and o.created_at < now() - p_older_than
     and not exists (select 1 from public.pets p where o.name = any (p.photo_paths))
  union all
  select o.bucket_id, o.name from storage.objects o
   where o.bucket_id = 'homes' and o.created_at < now() - p_older_than
     and not exists (select 1 from public.profiles p where p.home_photo_path = o.name)
  union all
  select o.bucket_id, o.name from storage.objects o
   where o.bucket_id = 'faces' and o.created_at < now() - p_older_than * 7      -- a selfie waits for the founder's review, so it gets a week
     and not exists (select 1 from public.profiles p where p.face_photo_path = o.name)
     and not exists (select 1 from public.verification_requests v where v.face_path = o.name)
  union all
  select o.bucket_id, o.name from storage.objects o
   where o.bucket_id = 'handovers' and o.created_at < now() - p_older_than
     and not exists (select 1 from public.handover_photos h where h.photo_path = o.name)
  union all
  select o.bucket_id, o.name from storage.objects o                              -- an ID photo lives only while its request is pending
   where o.bucket_id = 'ids' and o.created_at < now() - interval '1 hour'
     and not exists (select 1 from public.verification_requests v where v.id_path = o.name and v.status = 'pending')
  union all
  select o.bucket_id, o.name from storage.objects o                              -- so does a payment screenshot
   where o.bucket_id = 'payments' and o.created_at < now() - interval '1 hour'
     and not exists (select 1 from public.payment_claims c where c.screenshot_path = o.name and c.status = 'pending')
$$;
revoke execute on function public.list_unused_uploads(interval) from public, anon, authenticated;
grant execute on function public.list_unused_uploads(interval) to service_role;

-- ================================================================ 14. legal documents: new versions (docs/legal/*.md say the same)
update public.legal_documents set current_version = '2.0.0-draft', updated_at = now() where doc in ('privacy', 'terms');
