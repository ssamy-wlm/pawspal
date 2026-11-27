-- 0014: admin sign-in is now "password, then passkey" (WebAuthn: Face ID, fingerprint, Windows Hello).
-- It replaces the authenticator-app code (aal2) of migration 0010.
--
-- Why our own table and not Supabase's: registering a passkey with Supabase needs only a normal session, so a stolen
-- password could enrol a rogue passkey, and the database could not tell which credential made a session. Here:
--   * a passkey is registered only by an admin who is already verified (or who holds a one-time setup code from the founder,
--     or a recovery session), always through the edge function `admin-passkey`, which checks the WebAuthn proof;
--   * the edge function records "this Supabase session (JWT claim session_id) passed a passkey" in
--     private.admin_passkey_sessions; public.is_admin() is true only for such a session, so the database enforces it;
--   * nothing in schema private is reachable from the app; the helpers the edge function needs are service-role only;
--   * break-glass for the founder (SQL editor only): private.new_admin_setup_code, private.reset_admin_passkeys, private.list_admins.
-- Nothing here stores a code, a challenge or credential data in a log. Codes are kept only as sha256 hashes.

-- ---------------------------------------------------------------- tables (all in private: RLS on, no policies, no grants)
create table private.admin_passkeys (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  credential_id text not null unique,                          -- base64url, as the browser reports it
  public_key    text not null,                                 -- base64url COSE key
  counter       bigint not null default 0 check (counter >= 0),
  transports    text[],
  device_type   text,                                          -- 'singleDevice' | 'multiDevice'
  backed_up     boolean,
  name          text not null check (char_length(name) between 1 and 40),
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);
create index admin_passkeys_user_idx on private.admin_passkeys (user_id);

-- One live challenge per (user, session, purpose): asking again replaces it; it is consumed by delete ... returning.
create table private.admin_passkey_challenges (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  session_id uuid not null,
  purpose    text not null check (purpose in ('register', 'login')),
  challenge  text not null,
  expires_at timestamptz not null default now() + interval '5 minutes',
  unique (user_id, session_id, purpose)
);

-- "This Supabase session passed a passkey (or a recovery code)". Passkey sessions last 8 hours, recovery sessions 30 minutes.
create table private.admin_passkey_sessions (
  session_id uuid primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  passkey_id uuid references private.admin_passkeys (id) on delete cascade,   -- removing a passkey ends the sessions it opened
  via        text not null check (via in ('passkey', 'recovery')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index admin_passkey_sessions_user_idx on private.admin_passkey_sessions (user_id);

-- The founder makes one with private.new_admin_setup_code(email). One at a time per admin; valid 15 minutes; used once.
create table private.admin_setup_codes (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  code_hash  text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at    timestamptz
);

create table private.admin_recovery_codes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  code_hash  text not null,
  used_at    timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, code_hash)
);
create index admin_recovery_codes_user_idx on private.admin_recovery_codes (user_id);

alter table private.admin_passkeys           enable row level security;
alter table private.admin_passkey_challenges enable row level security;
alter table private.admin_passkey_sessions   enable row level security;
alter table private.admin_setup_codes        enable row level security;
alter table private.admin_recovery_codes     enable row level security;
revoke all on private.admin_passkeys, private.admin_passkey_challenges, private.admin_passkey_sessions,
              private.admin_setup_codes, private.admin_recovery_codes from public, anon, authenticated;

create index if not exists security_events_user_kind_idx on public.security_events (user_id, kind, created_at desc);

-- ---------------------------------------------------------------- the rule the whole admin site rests on
-- Admin = a row in admins AND the current Supabase session (claim session_id) has a live passkey-session row for the same user.
-- A missing or malformed claim is simply "not admin"; this function never raises.
create or replace function public.is_admin()
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_sid uuid; v_uid uuid := auth.uid();
begin
  if v_uid is null then return false; end if;
  begin
    v_sid := (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'session_id')::uuid;
  exception when others then
    return false;
  end;
  if v_sid is null then return false; end if;
  return exists (select 1 from public.admins a where a.user_id = v_uid)
     and exists (select 1 from private.admin_passkey_sessions s
                  where s.session_id = v_sid and s.user_id = v_uid and s.expires_at > now());
end $$;

-- What the dashboard needs after the password step: 'not_admin', 'needs_setup' (an admin with no passkey yet: needs a setup
-- code from the founder), 'needs_passkey' (has a passkey, this session has not used it) or 'admin'. Reveals nothing about others.
create or replace function public.admin_status()
returns text language sql stable security definer set search_path = public as $$
  select case
    when not exists (select 1 from public.admins where user_id = auth.uid()) then 'not_admin'
    when public.is_admin() then 'admin'
    when exists (select 1 from private.admin_passkeys where user_id = auth.uid()) then 'needs_passkey'
    else 'needs_setup' end;
$$;
revoke execute on function public.admin_status() from public, anon;
grant execute on function public.admin_status() to authenticated;

-- ---------------------------------------------------------------- internal helpers (private; nobody calls them directly)
-- Random code from an alphabet without 0 O 1 I (32 characters, so a byte masked to 5 bits is uniform): 5 bits per character.
create or replace function private.random_code(p_len integer)
returns text language plpgsql volatile set search_path = extensions, pg_catalog as $$
declare alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; out text := ''; bytes bytea := gen_random_bytes(p_len);
begin
  for i in 0 .. p_len - 1 loop
    out := out || substr(alphabet, (get_byte(bytes, i) & 31) + 1, 1);
  end loop;
  return out;
end $$;

create or replace function private.code_hash(p_code text)
returns text language sql immutable set search_path = extensions, pg_catalog as $$
  select encode(digest(upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')), 'sha256'), 'hex')
$$;

create or replace function private.pk_failures(p_user uuid, p_kinds text[], p_minutes integer default 60)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::integer from public.security_events
   where user_id = p_user and kind = any (p_kinds) and created_at > now() - make_interval(mins => p_minutes)
$$;

-- Security event + audit row. The details are filtered to a few harmless keys, so no code or credential can end up here.
create or replace function private.pk_event(p_user uuid, p_kind text, p_details jsonb default '{}')
returns void language plpgsql security definer set search_path = public as $$
declare v_clean jsonb;
begin
  select coalesce(jsonb_object_agg(key, case when jsonb_typeof(value) = 'string' then to_jsonb(left(value #>> '{}', 80)) else value end), '{}')
    into v_clean
    from jsonb_each(case when jsonb_typeof(p_details) = 'object' then p_details else '{}'::jsonb end)
   where key in ('name', 'via', 'reason', 'device_type', 'backed_up', 'count') and jsonb_typeof(value) in ('string', 'number', 'boolean');
  insert into public.security_events (user_id, kind, details)
  values ((select id from public.profiles where id = p_user), p_kind, v_clean);
  insert into public.audit_log (admin_id, action, target_user, details)
  values (p_user, p_kind, p_user, v_clean);
end $$;

-- Removes what has expired. Called now and then by the helpers below and nightly by pg_cron where that exists.
create or replace function private.pk_prune()
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from private.admin_passkey_challenges where expires_at < now();
  delete from private.admin_passkey_sessions where expires_at < now();
  delete from private.admin_setup_codes where expires_at < now() - interval '1 day' or used_at < now() - interval '1 day';
end $$;

revoke execute on function private.random_code(integer), private.code_hash(text), private.pk_failures(uuid, text[], integer),
  private.pk_event(uuid, text, jsonb), private.pk_prune() from public, anon, authenticated;

-- ---------------------------------------------------------------- service-only helpers (the edge function `admin-passkey` calls these)
-- They take the user id explicitly: the edge function takes it (and the session id) from the verified JWT, never from the body.

create or replace function public.pk_state(p_user uuid, p_session uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s private.admin_passkey_sessions;
begin
  if p_session is not null then
    select * into s from private.admin_passkey_sessions where session_id = p_session and user_id = p_user and expires_at > now();
  end if;
  return jsonb_build_object(
    'is_admin_row', exists (select 1 from public.admins where user_id = p_user),
    'passkeys', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'name', k.name, 'created_at', k.created_at,
                                                               'last_used_at', k.last_used_at, 'device_type', k.device_type,
                                                               'backed_up', k.backed_up) order by k.created_at)
                            from private.admin_passkeys k where k.user_id = p_user), '[]'::jsonb),
    'verified', s.session_id is not null,
    'via', s.via,
    'recovery_codes_left', (select count(*)::integer from private.admin_recovery_codes where user_id = p_user and used_at is null),
    'failures_hour', private.pk_failures(p_user, array['admin_login_failed', 'admin_recovery_failed']),
    'recovery_locked', private.pk_failures(p_user, array['admin_recovery_failed']) >= 5);
end $$;

-- A challenge for this user, session and purpose. Replaces an older one for the same triple. Valid 5 minutes.
create or replace function public.pk_new_challenge(p_user uuid, p_session uuid, p_purpose text, p_challenge text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_session is null or p_purpose not in ('register', 'login') or coalesce(length(p_challenge), 0) not between 16 and 512 then
    raise exception 'invalid';
  end if;
  perform private.pk_prune();
  delete from private.admin_passkey_challenges where user_id = p_user and session_id = p_session and purpose = p_purpose;
  insert into private.admin_passkey_challenges (user_id, session_id, purpose, challenge)
  values (p_user, p_session, p_purpose, p_challenge) returning id into v_id;
  return v_id;
end $$;

-- Single use: the row is deleted as it is read. Returns the challenge, or null (none, used, expired, other user/session/purpose).
create or replace function public.pk_take_challenge(p_user uuid, p_session uuid, p_purpose text)
returns text language plpgsql security definer set search_path = public as $$
declare v_challenge text; v_expires timestamptz;
begin
  delete from private.admin_passkey_challenges
   where user_id = p_user and session_id = p_session and purpose = p_purpose
  returning challenge, expires_at into v_challenge, v_expires;
  if v_challenge is null or v_expires <= now() then return null; end if;
  return v_challenge;
end $$;

-- Setup code: checked without using it up ('ok' | 'bad' | 'locked'). Ten wrong tries per hour lock the user out of codes.
create or replace function public.pk_check_setup_code(p_user uuid, p_code text)
returns text language plpgsql security definer set search_path = public as $$
begin
  if private.pk_failures(p_user, array['admin_setup_code_failed']) >= 10 then return 'locked'; end if;
  if exists (select 1 from private.admin_setup_codes
              where user_id = p_user and code_hash = private.code_hash(p_code) and used_at is null and expires_at > now()) then
    return 'ok';
  end if;
  insert into public.security_events (user_id, kind) values ((select id from public.profiles where id = p_user), 'admin_setup_code_failed');
  return 'bad';
end $$;

-- Setup code: uses it up. True once; false when wrong, used, expired, someone else's, or locked.
create or replace function public.pk_take_setup_code(p_user uuid, p_code text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if private.pk_failures(p_user, array['admin_setup_code_failed']) >= 10 then return false; end if;
  update private.admin_setup_codes set used_at = now()
   where user_id = p_user and code_hash = private.code_hash(p_code) and used_at is null and expires_at > now();
  get diagnostics v_n = row_count;
  if v_n = 1 then return true; end if;
  insert into public.security_events (user_id, kind) values ((select id from public.profiles where id = p_user), 'admin_setup_code_failed');
  return false;
end $$;

-- Stores a verified credential. Gate: the caller already checked (verified session or setup code). When p_setup_code is
-- given it is used up in the same transaction, so a failed save never burns it and a saved one is never left reusable.
-- Returns {status: 'ok'|'limit'|'duplicate'|'invalid'|'bad_setup_code'|'not_allowed', id}.
create or replace function public.pk_add_credential(
  p_user uuid, p_credential_id text, p_public_key text, p_counter bigint, p_transports text[],
  p_device_type text, p_backed_up boolean, p_name text, p_setup_code text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_name text := btrim(coalesce(p_name, '')); v_id uuid;
begin
  perform 1 from public.admins where user_id = p_user for update;       -- serialises concurrent adds for this admin
  if not found then return jsonb_build_object('status', 'not_allowed'); end if;
  if char_length(v_name) not between 1 and 40 or coalesce(p_credential_id, '') = '' or coalesce(p_public_key, '') = ''
     or coalesce(p_counter, -1) < 0 then
    return jsonb_build_object('status', 'invalid');
  end if;
  if (select count(*) from private.admin_passkeys where user_id = p_user) >= 10 then return jsonb_build_object('status', 'limit'); end if;
  if exists (select 1 from private.admin_passkeys where credential_id = p_credential_id) then return jsonb_build_object('status', 'duplicate'); end if;
  if p_setup_code is not null and not public.pk_take_setup_code(p_user, p_setup_code) then
    return jsonb_build_object('status', 'bad_setup_code');
  end if;
  insert into private.admin_passkeys (user_id, credential_id, public_key, counter, transports, device_type, backed_up, name)
  values (p_user, p_credential_id, p_public_key, p_counter, p_transports, p_device_type, p_backed_up, v_name)
  returning id into v_id;
  return jsonb_build_object('status', 'ok', 'id', v_id);
end $$;

-- For allowCredentials / excludeCredentials: [{id: credential_id, transports: [...]}]
create or replace function public.pk_credentials(p_user uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', credential_id, 'transports', coalesce(to_jsonb(transports), '[]'::jsonb)) order by created_at), '[]'::jsonb)
    from private.admin_passkeys where user_id = p_user
$$;

-- One credential of THIS user, by the id the browser reported. Null when it is not theirs.
create or replace function public.pk_credential(p_user uuid, p_credential_id text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', id, 'credential_id', credential_id, 'public_key', public_key, 'counter', counter,
                            'transports', coalesce(to_jsonb(transports), '[]'::jsonb))
    from private.admin_passkeys where user_id = p_user and credential_id = p_credential_id
$$;

-- Clone detection: the counter must grow when either side is non-zero. Synced passkeys often report 0 every time: 0 -> 0 is fine.
create or replace function public.pk_use_counter(p_id uuid, p_new bigint)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_old bigint;
begin
  select counter into v_old from private.admin_passkeys where id = p_id for update;
  if v_old is null or p_new is null or p_new < 0 then return false; end if;
  if (p_new <> 0 or v_old <> 0) and p_new <= v_old then return false; end if;
  update private.admin_passkeys set counter = p_new, last_used_at = now() where id = p_id;
  return true;
end $$;

-- Marks the Supabase session as verified. Returns when it ends, or null when refused. A recovery session never replaces a
-- live passkey session. Lengths are capped: 8 hours for a passkey, 30 minutes for a recovery code.
create or replace function public.pk_start_session(p_user uuid, p_session uuid, p_passkey_id uuid, p_via text, p_minutes integer)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare v_mins integer; v_expires timestamptz;
begin
  if p_session is null or p_via not in ('passkey', 'recovery') then return null; end if;
  if not exists (select 1 from public.admins where user_id = p_user) then return null; end if;
  if p_via = 'passkey' and not exists (select 1 from private.admin_passkeys where id = p_passkey_id and user_id = p_user) then return null; end if;
  v_mins := least(greatest(coalesce(p_minutes, 1), 1), case when p_via = 'recovery' then 30 else 480 end);
  perform private.pk_prune();
  insert into private.admin_passkey_sessions (session_id, user_id, passkey_id, via, expires_at)
  values (p_session, p_user, case when p_via = 'passkey' then p_passkey_id end, p_via, now() + make_interval(mins => v_mins))
  on conflict (session_id) do update
     set passkey_id = excluded.passkey_id, via = excluded.via, created_at = now(), expires_at = excluded.expires_at
   where private.admin_passkey_sessions.user_id = excluded.user_id
     and not (private.admin_passkey_sessions.via = 'passkey' and private.admin_passkey_sessions.expires_at > now() and excluded.via = 'recovery')
  returning expires_at into v_expires;
  if v_expires is null then
    select expires_at into v_expires from private.admin_passkey_sessions where session_id = p_session and user_id = p_user and expires_at > now();
  end if;
  return v_expires;
end $$;

create or replace function public.pk_end_session(p_session uuid)
returns void language sql security definer set search_path = public as $$
  delete from private.admin_passkey_sessions where session_id = p_session
$$;

-- Ten recovery codes (hashes of the normalised codes, made by the edge function) replace every older code.
create or replace function public.pk_replace_recovery_codes(p_user uuid, p_hashes text[])
returns integer language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.admins where user_id = p_user) then raise exception 'not allowed'; end if;
  if coalesce(array_length(p_hashes, 1), 0) <> 10 or exists (select 1 from unnest(p_hashes) h where h !~ '^[0-9a-f]{64}$')
     or (select count(distinct h) from unnest(p_hashes) h) <> 10 then
    raise exception 'invalid';
  end if;
  delete from private.admin_recovery_codes where user_id = p_user;
  insert into private.admin_recovery_codes (user_id, code_hash) select p_user, h from unnest(p_hashes) h;
  return 10;
end $$;

-- 'ok' (used up) | 'bad' | 'locked'. Five wrong codes in an hour lock this for an hour, even for the right code.
create or replace function public.pk_use_recovery_code(p_user uuid, p_hash text)
returns text language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if private.pk_failures(p_user, array['admin_recovery_failed']) >= 5 then return 'locked'; end if;
  update private.admin_recovery_codes set used_at = now()
   where user_id = p_user and code_hash = p_hash and used_at is null;
  get diagnostics v_n = row_count;
  if v_n = 1 then return 'ok'; end if;
  insert into public.security_events (user_id, kind) values ((select id from public.profiles where id = p_user), 'admin_recovery_failed');
  return 'bad';
end $$;

create or replace function public.pk_rename(p_user uuid, p_id uuid, p_name text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_name text := btrim(coalesce(p_name, '')); v_n integer;
begin
  if char_length(v_name) not between 1 and 40 then return false; end if;
  update private.admin_passkeys set name = v_name where id = p_id and user_id = p_user;
  get diagnostics v_n = row_count;
  return v_n = 1;
end $$;

-- 'ok' | 'last' (the only passkey cannot be removed) | 'not_found'. Sessions opened with that passkey end with it.
create or replace function public.pk_remove(p_user uuid, p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
begin
  perform 1 from public.admins where user_id = p_user for update;       -- two removals at once cannot both pass the count
  if not exists (select 1 from private.admin_passkeys where id = p_id and user_id = p_user) then return 'not_found'; end if;
  if (select count(*) from private.admin_passkeys where user_id = p_user) <= 1 then return 'last'; end if;
  delete from private.admin_passkeys where id = p_id and user_id = p_user;
  return 'ok';
end $$;

-- Audit trail for the passkey flow. Kinds are fixed; the details keep only a few harmless keys (never a code or a credential).
create or replace function public.pk_note(p_user uuid, p_kind text, p_details jsonb default '{}')
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_kind not in ('setup', 'passkey_added', 'passkey_removed', 'passkey_renamed', 'passkey_login', 'recovery_used',
                    'recovery_generated', 'login_failed') then
    raise exception 'invalid';
  end if;
  perform private.pk_event(p_user, 'admin_' || p_kind, p_details);
end $$;

revoke execute on function
  public.pk_state(uuid, uuid), public.pk_new_challenge(uuid, uuid, text, text), public.pk_take_challenge(uuid, uuid, text),
  public.pk_check_setup_code(uuid, text), public.pk_take_setup_code(uuid, text),
  public.pk_add_credential(uuid, text, text, bigint, text[], text, boolean, text, text),
  public.pk_credentials(uuid), public.pk_credential(uuid, text), public.pk_use_counter(uuid, bigint),
  public.pk_start_session(uuid, uuid, uuid, text, integer), public.pk_end_session(uuid),
  public.pk_replace_recovery_codes(uuid, text[]), public.pk_use_recovery_code(uuid, text),
  public.pk_rename(uuid, uuid, text), public.pk_remove(uuid, uuid), public.pk_note(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function
  public.pk_state(uuid, uuid), public.pk_new_challenge(uuid, uuid, text, text), public.pk_take_challenge(uuid, uuid, text),
  public.pk_check_setup_code(uuid, text), public.pk_take_setup_code(uuid, text),
  public.pk_add_credential(uuid, text, text, bigint, text[], text, boolean, text, text),
  public.pk_credentials(uuid), public.pk_credential(uuid, text), public.pk_use_counter(uuid, bigint),
  public.pk_start_session(uuid, uuid, uuid, text, integer), public.pk_end_session(uuid),
  public.pk_replace_recovery_codes(uuid, text[]), public.pk_use_recovery_code(uuid, text),
  public.pk_rename(uuid, uuid, text), public.pk_remove(uuid, uuid), public.pk_note(uuid, text, jsonb)
  to service_role;

-- ---------------------------------------------------------------- founder break-glass (SQL editor only; no role but the owner)
-- A setup code for an admin who has no passkey yet (first sign-in, or every device and recovery code lost). Shown once.
create or replace function private.new_admin_setup_code(p_email text)
returns text language plpgsql security definer set search_path = public, private, auth as $$
declare v_id uuid; v_code text := private.random_code(12);
begin
  select u.id into v_id from auth.users u join public.admins a on a.user_id = u.id where lower(u.email) = lower(btrim(p_email));
  if v_id is null then raise exception 'that email is not an admin'; end if;
  insert into private.admin_setup_codes (user_id, code_hash, expires_at)
  values (v_id, private.code_hash(v_code), now() + interval '15 minutes')
  on conflict (user_id) do update set code_hash = excluded.code_hash, created_at = now(), expires_at = excluded.expires_at, used_at = null;
  insert into public.audit_log (admin_id, action, target_user, details)
  values ('00000000-0000-0000-0000-000000000000', 'admin_setup_code_issued', v_id, '{}');
  return v_code;
end $$;

-- Both devices and every recovery code are lost: forget this admin's passkeys, sessions and recovery codes.
-- They then sign in with the password and a new setup code (private.new_admin_setup_code).
create or replace function private.reset_admin_passkeys(p_email text)
returns text language plpgsql security definer set search_path = public, private, auth as $$
declare v_id uuid; v_n integer;
begin
  select u.id into v_id from auth.users u join public.admins a on a.user_id = u.id where lower(u.email) = lower(btrim(p_email));
  if v_id is null then raise exception 'that email is not an admin'; end if;
  delete from private.admin_passkeys where user_id = v_id;                 -- also ends the sessions opened with them
  get diagnostics v_n = row_count;
  delete from private.admin_passkey_sessions where user_id = v_id;
  delete from private.admin_recovery_codes where user_id = v_id;
  delete from private.admin_setup_codes where user_id = v_id;
  delete from private.admin_passkey_challenges where user_id = v_id;
  insert into public.audit_log (admin_id, action, target_user, details)
  values ('00000000-0000-0000-0000-000000000000', 'admin_passkeys_reset', v_id, jsonb_build_object('passkeys_removed', v_n));
  return 'reset: ' || v_n || ' passkey(s) removed; now run select private.new_admin_setup_code(''' || lower(btrim(p_email)) || ''')';
end $$;

-- Who is an admin, and how many passkeys each has. Read-only.
create or replace function private.list_admins()
returns table (email text, passkeys integer, setup_code_open boolean)
language sql stable security definer set search_path = public, private, auth as $$
  select u.email::text,
         (select count(*)::integer from private.admin_passkeys k where k.user_id = a.user_id),
         exists (select 1 from private.admin_setup_codes c where c.user_id = a.user_id and c.used_at is null and c.expires_at > now())
    from public.admins a join auth.users u on u.id = a.user_id
   order by u.email
$$;
revoke execute on function private.new_admin_setup_code(text), private.reset_admin_passkeys(text), private.list_admins()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------- nightly tidy-up, where pg_cron exists
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('prune-admin-passkeys', '17 3 * * *', 'select private.pk_prune()');
  end if;
exception when others then
  raise notice 'pg_cron job not scheduled: %', sqlerrm;
end $$;
