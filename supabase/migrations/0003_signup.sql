-- PawsPal Dahab: phase 2 (sign-up and verification).
-- The server enforces every rule here; the app only shows what it allows. See docs/security.md.

-- ---------------------------------------------------------------- phone helpers (never exposed to the API)
create or replace function private.phone_digits(p text)
returns text language sql immutable as $$ select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') $$;

-- Egyptian mobile numbers only: +20 then 10, 11, 12 or 15, then 8 digits.
create or replace function private.is_egypt_mobile(p text)
returns boolean language sql immutable as $$ select private.phone_digits(p) ~ '^20(10|11|12|15)[0-9]{8}$' $$;

-- The one-way hash used for banned numbers and rate limits. Digits only, so "+2010..." and "2010..." match.
create or replace function private.phone_hash(p text)
returns text language sql immutable set search_path = extensions, private, pg_catalog as $$
  select encode(digest(private.phone_digits(p), 'sha256'), 'hex')
$$;

-- New auth user -> profile row. Phone only, Egypt only, and banned numbers cannot come back.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, private, extensions as $$
begin
  if new.phone is null or not private.is_egypt_mobile(new.phone) then
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

-- ---------------------------------------------------------------- only active people see other people
-- Before: any signed-in user, even one still waiting for review, could browse. Now the caller must be active too.
create or replace view public.profile_cards as
  select p.id, p.first_name, p.role, p.bio, p.area, p.approx_lat, p.approx_lng,
         p.face_photo_path, p.home_photo_path, p.card_illustration, p.card_background,
         p.rating_avg, p.stays_count, p.created_at
  from public.profiles p
  where p.status = 'active'
    and auth.uid() is not null
    and public.is_active(auth.uid())
    and not public.is_blocked_between(auth.uid(), p.id);

drop policy "read active listings" on public.availability;
create policy "read active listings" on public.availability
  for select to authenticated using (
    user_id = auth.uid()
    or (public.is_active(auth.uid()) and public.is_active(user_id) and not public.is_blocked_between(auth.uid(), user_id))
  );

drop policy "read pets of active users" on public.pets;
create policy "read pets of active users" on public.pets
  for select to authenticated using (
    owner_id = auth.uid() or public.is_admin()
    or (public.is_active(auth.uid()) and public.is_active(owner_id) and not public.is_blocked_between(auth.uid(), owner_id))
  );

drop policy "read reviews of active people" on public.reviews;
create policy "read reviews of active people" on public.reviews
  for select to authenticated using (
    public.is_admin() or auth.uid() in (author_id, subject_id)
    or (public.is_active(auth.uid()) and public.is_active(subject_id) and not public.is_blocked_between(auth.uid(), subject_id))
  );

create or replace function public.can_view_media_of(p_folder text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid;
begin
  begin
    v_owner := p_folder::uuid;
  exception when others then
    return false;
  end;
  return v_owner = auth.uid() or public.is_admin()
      or (public.is_active(auth.uid()) and public.is_active(v_owner) and not public.is_blocked_between(auth.uid(), v_owner));
end $$;

-- ---------------------------------------------------------------- uploads: raw files go to "incoming" only
-- The app uploads a raw photo to incoming/<its own id>/. The process-upload function (service role) strips the GPS
-- and other metadata, then writes the clean copy to the real bucket. The app can no longer write the real buckets.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('incoming', 'incoming', false, 8388608, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;
update storage.buckets set file_size_limit = 8388608, allowed_mime_types = array['image/jpeg', 'image/png']
 where id in ('faces', 'pets', 'homes', 'handovers');

drop policy "upload to own folder" on storage.objects;
create policy "upload raw photo to own incoming folder" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'incoming' and (storage.foldername(name))[1] = auth.uid()::text
  );
-- Nobody reads incoming/ through the API: only the service role does.

-- Pet photos must be real, processed files in the owner's own folder.
create or replace function public.validate_pet_photos()
returns trigger language plpgsql security definer set search_path = public, storage as $$
declare p text;
begin
  foreach p in array new.photo_paths loop
    if split_part(p, '/', 1) <> new.owner_id::text
       or not exists (select 1 from storage.objects o where o.bucket_id = 'pets' and o.name = p) then
      raise exception 'invalid photo';
    end if;
  end loop;
  if tg_op = 'INSERT' and (select count(*) from public.pets where owner_id = new.owner_id) >= 10 then
    raise exception 'too many pets';
  end if;
  return new;
end $$;
create trigger validate_pet_photos_before_write before insert or update of photo_paths on public.pets
  for each row execute function public.validate_pet_photos();

-- ---------------------------------------------------------------- sign-in code limits (private)
create table private.otp_events (
  id          bigint generated always as identity primary key,
  kind        text not null check (kind in ('request', 'send', 'verify_ok', 'verify_fail')),
  phone_hash  text not null,
  device_hash text,
  created_at  timestamptz not null default now()
);
create index on private.otp_events (phone_hash, created_at);
create index on private.otp_events (device_hash, created_at);
alter table private.otp_events enable row level security;   -- no policies: only security-definer functions touch it

-- The sign-in code rules (docs/security.md): 3 codes per number per hour, 10 requests per device per day, and after
-- 2 wrong codes a CAPTCHA (or a 10 minute wait). Where each is counted:
--   'send'    : logged by the send-sms hook, at the moment a code is really sent. Counts per number. Nobody can skip it,
--               because every code goes through the hook, whether it came from the app or not.
--   'request' : logged by request-otp, per device (the hook cannot see the device).
--   'check'   : nothing is logged.
-- Returns {allowed, reason, retry_after_seconds, captcha_required}.
create or replace function public.otp_check_and_log(p_phone_hash text, p_device_hash text, p_captcha_ok boolean default false, p_mode text default 'check')
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  v_fails int; v_last_fail timestamptz;
  v_sends int; v_oldest_send timestamptz;
  v_requests int; v_oldest_request timestamptz;
begin
  if p_mode not in ('check', 'request', 'send') then raise exception 'bad mode'; end if;
  perform pg_advisory_xact_lock(hashtext(p_phone_hash));    -- one decision per number at a time
  delete from private.otp_events where created_at < now() - interval '2 days';

  -- Wrong codes since the last correct one, in the last 15 minutes.
  select count(*), max(created_at) into v_fails, v_last_fail
    from private.otp_events e
   where e.phone_hash = p_phone_hash and e.kind = 'verify_fail' and e.created_at > now() - interval '15 minutes'
     and e.created_at > coalesce((select max(created_at) from private.otp_events
                                   where phone_hash = p_phone_hash and kind = 'verify_ok'), 'epoch');
  if v_fails >= 2 and not p_captcha_ok then
    insert into public.security_events (kind, details) values ('otp_blocked', jsonb_build_object('reason', 'captcha_required'));
    return jsonb_build_object('allowed', false, 'reason', 'captcha_required', 'captcha_required', true,
      'retry_after_seconds', greatest(1, ceil(extract(epoch from (v_last_fail + interval '10 minutes' - now())))::int));
  end if;

  select count(*), min(created_at) into v_sends, v_oldest_send
    from private.otp_events where phone_hash = p_phone_hash and kind = 'send' and created_at > now() - interval '1 hour';
  if v_sends >= 3 then
    insert into public.security_events (kind, details) values ('otp_blocked', jsonb_build_object('reason', 'phone_limit'));
    return jsonb_build_object('allowed', false, 'reason', 'phone_limit', 'captcha_required', false,
      'retry_after_seconds', greatest(1, ceil(extract(epoch from (v_oldest_send + interval '1 hour' - now())))::int));
  end if;

  if p_device_hash is not null then
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

-- Called by verify-otp with the outcome of a code check.
create or replace function public.otp_record_result(p_phone_hash text, p_device_hash text, p_ok boolean)
returns void language plpgsql security definer set search_path = public, private as $$
begin
  insert into private.otp_events (kind, phone_hash, device_hash)
  values (case when p_ok then 'verify_ok' else 'verify_fail' end, p_phone_hash, p_device_hash);
end $$;

-- Has this number been banned? (request-otp asks before spending an SMS.)
create or replace function public.is_phone_banned(p_phone text)
returns boolean language sql stable security definer set search_path = public, private, extensions as $$
  select exists (
    select 1 from public.banned_identifiers
    where kind = 'phone' and hash in (private.phone_hash(p_phone), encode(digest('+' || private.phone_digits(p_phone), 'sha256'), 'hex'))
  )
$$;

-- ---------------------------------------------------------------- identity checks (private)
create table private.identity_fingerprints (
  kind       text not null check (kind in ('id_document', 'device')),
  hash       text not null,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (kind, hash, user_id)
);
-- One identity document, one account.
create unique index identity_one_account_per_document on private.identity_fingerprints (hash) where kind = 'id_document';
alter table private.identity_fingerprints enable row level security;

-- Called by verify-identity (service role) with the provider's result. Stores no image and no ID number: only
-- one-way hashes. Returns 'ok', or why the person is refused ('banned_id', 'duplicate_id', 'banned_device').
-- A refusal is a normal result, not an error, so the security event that records it is kept.
create or replace function public.record_verification(
  p_user uuid, p_face boolean, p_id boolean, p_adult boolean, p_face_path text, p_id_hash text, p_device_hash text
) returns text language plpgsql security definer set search_path = public, private as $$
begin
  if p_face_path is not null and split_part(p_face_path, '/', 1) <> p_user::text then
    raise exception 'invalid photo';
  end if;
  if p_id_hash is not null then
    if exists (select 1 from public.banned_identifiers where kind = 'id_document' and hash = p_id_hash) then
      insert into public.security_events (user_id, kind) values (p_user, 'banned_id_blocked');
      return 'banned_id';
    end if;
    if exists (select 1 from private.identity_fingerprints where kind = 'id_document' and hash = p_id_hash and user_id <> p_user) then
      insert into public.security_events (user_id, kind) values (p_user, 'duplicate_id_blocked');
      return 'duplicate_id';
    end if;
  end if;
  if p_device_hash is not null
     and exists (select 1 from public.banned_identifiers where kind = 'device' and hash = p_device_hash) then
    insert into public.security_events (user_id, kind) values (p_user, 'banned_device_blocked');
    return 'banned_device';
  end if;
  if p_id_hash is not null then
    insert into private.identity_fingerprints (kind, hash, user_id) values ('id_document', p_id_hash, p_user) on conflict do nothing;
  end if;
  if p_device_hash is not null then
    insert into private.identity_fingerprints (kind, hash, user_id) values ('device', p_device_hash, p_user) on conflict do nothing;
  end if;
  update public.profiles
     set face_verified   = coalesce(p_face, face_verified),
         id_verified     = coalesce(p_id, id_verified),
         is_adult        = coalesce(p_adult, is_adult),
         face_photo_path = coalesce(p_face_path, face_photo_path),
         updated_at      = now()
   where id = p_user;
  return 'ok';
end $$;
revoke execute on function public.record_verification(uuid, boolean, boolean, boolean, text, text, text) from public, anon, authenticated;
grant execute on function public.record_verification(uuid, boolean, boolean, boolean, text, text, text) to service_role;

-- Verification no longer moves the profile on its own: the user must finish every step and submit (submit_profile).
create or replace function public.set_verification(p_user uuid, p_face boolean, p_id boolean, p_adult boolean, p_face_path text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.profiles
     set face_verified   = coalesce(p_face, face_verified),
         id_verified     = coalesce(p_id, id_verified),
         is_adult        = coalesce(p_adult, is_adult),
         face_photo_path = coalesce(p_face_path, face_photo_path),
         updated_at      = now()
   where id = p_user;
end $$;

-- The home photo: only the process-upload function (service role) may set it, from a processed file.
create or replace function public.attach_home_photo(p_user uuid, p_path text)
returns void language plpgsql security definer set search_path = public, storage as $$
begin
  if split_part(p_path, '/', 1) <> p_user::text
     or not exists (select 1 from storage.objects o where o.bucket_id = 'homes' and o.name = p_path) then
    raise exception 'invalid photo';
  end if;
  update public.profiles set home_photo_path = p_path, updated_at = now() where id = p_user;
end $$;
revoke execute on function public.attach_home_photo(uuid, text) from public, anon, authenticated;
grant execute on function public.attach_home_photo(uuid, text) to service_role;

-- ---------------------------------------------------------------- legal documents: the current versions
create table public.legal_documents (
  doc             text primary key check (doc in ('privacy', 'terms', 'guidelines')),
  current_version text not null,
  updated_at      timestamptz not null default now()
);
alter table public.legal_documents enable row level security;
revoke insert, update, delete on public.legal_documents from anon, authenticated;
create policy "anyone signed in reads the current versions" on public.legal_documents
  for select to authenticated using (true);
-- Keep these in step with the version line of docs/legal/*.md (scripts/check-legal-versions.py checks it).
insert into public.legal_documents (doc, current_version) values
  ('privacy', '1.0.0-draft'), ('terms', '1.0.0-draft'), ('guidelines', '1.0.0-draft');

-- An acceptance must be for the version that is current now.
create or replace function public.check_legal_acceptance()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.legal_documents where doc = new.doc and current_version = new.version) then
    raise exception 'that version is not current';
  end if;
  return new;
end $$;
create trigger check_legal_acceptance_before_insert before insert on public.legal_acceptances
  for each row execute function public.check_legal_acceptance();

-- ---------------------------------------------------------------- where is this person in sign-up?
create or replace function public.my_signup_state()
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare
  p public.profiles;
  v_pet boolean; v_loc boolean; v_legal boolean; v_missing text[] := '{}';
begin
  select * into p from public.profiles where id = auth.uid();
  if p.id is null then raise exception 'not signed in'; end if;
  v_pet   := exists (select 1 from public.pets where owner_id = p.id);
  v_loc   := exists (select 1 from private.locations where user_id = p.id);
  v_legal := not exists (
    select 1 from public.legal_documents d
     where not exists (select 1 from public.legal_acceptances a where a.user_id = p.id and a.doc = d.doc and a.version = d.current_version));
  if not p.phone_verified then v_missing := array_append(v_missing, 'phone'); end if;
  if not p.face_verified then v_missing := array_append(v_missing, 'face'); end if;
  if not p.id_verified then v_missing := array_append(v_missing, 'id'); end if;
  if not p.is_adult then v_missing := array_append(v_missing, 'adult'); end if;
  if p.first_name is null then v_missing := array_append(v_missing, 'name'); end if;
  if p.role in ('owner', 'both') and not v_pet then v_missing := array_append(v_missing, 'pet'); end if;
  if p.role in ('sitter', 'both') and p.home_photo_path is null then v_missing := array_append(v_missing, 'home'); end if;
  if not v_loc then v_missing := array_append(v_missing, 'location'); end if;
  if not v_legal then v_missing := array_append(v_missing, 'legal'); end if;
  return jsonb_build_object(
    'status', p.status, 'role', p.role, 'first_name', p.first_name,
    'phone_verified', p.phone_verified, 'face_verified', p.face_verified, 'id_verified', p.id_verified, 'is_adult', p.is_adult,
    'has_pet', v_pet, 'has_home_photo', p.home_photo_path is not null, 'has_location', v_loc, 'legal_accepted', v_legal,
    'missing', to_jsonb(v_missing));
end $$;
revoke execute on function public.my_signup_state() from public, anon;
grant execute on function public.my_signup_state() to authenticated;

-- Step 6 of sign-up. Only a complete profile goes to a person for review; the server checks every requirement.
create or replace function public.submit_profile()
returns public.account_status language plpgsql security definer set search_path = public, private as $$
declare v_state jsonb; v_status public.account_status;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  v_state := public.my_signup_state();
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
revoke execute on function public.submit_profile() from public, anon;
grant execute on function public.submit_profile() to authenticated;

-- ---------------------------------------------------------------- the role is fixed once the profile is submitted
-- The pet and home-photo checks depend on the role, so a person cannot change it after passing them.
create or replace function public.lock_role_after_submit()
returns trigger language plpgsql as $$
begin
  if new.role is distinct from old.role and old.status <> 'pending_verification' and current_user in ('authenticated', 'anon') then
    raise exception 'role cannot be changed after the profile is submitted';
  end if;
  return new;
end $$;
create trigger lock_role_after_submit_before_update before update of role on public.profiles
  for each row execute function public.lock_role_after_submit();

-- ---------------------------------------------------------------- service-only functions stay service-only
revoke execute on function public.otp_check_and_log(text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.otp_check_and_log(text, text, boolean, text) to service_role;
revoke execute on function public.otp_record_result(text, text, boolean) from public, anon, authenticated;
grant execute on function public.otp_record_result(text, text, boolean) to service_role;
revoke execute on function public.is_phone_banned(text) from public, anon, authenticated;
grant execute on function public.is_phone_banned(text) to service_role;
