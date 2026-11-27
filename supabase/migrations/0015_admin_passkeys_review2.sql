-- 0015: second review of the admin passkeys (0014 is already on main, so these are changes on top of it).
--   * lock-outs: passkey failures count per Supabase session only (5 an hour); only wrong recovery and setup codes also count per
--     user, at 100 an hour. So someone with only the password cannot lock other sessions out by spamming login.
--   * pk_note re-checks the lock under the advisory lock and writes nothing once locked; failed-login rows in security_events and
--     audit_log are pruned after 30 days.
--   * is_admin() has no exception block any more: every claim is validated with pg_input_is_valid (PostgreSQL 16 or newer; the
--     project runs 17) and a garbage claim, sub, scalar or array simply gives false.
--   * break-glass: private.list_admin_sessions(email) and private.open_admin_session(email, short_id, minutes) replace the
--     "newest session" version: the founder names the session by the first 8 characters of its id (shown on the admin site),
--     it must match exactly one session, and its IP address and browser go to the audit log.
-- Everything stays revoked from every role.

create or replace function public.is_admin()
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_claims text := nullif(current_setting('request.jwt.claims', true), ''); v_c jsonb; v_sub text; v_sid text;
begin
  -- No exception block (no subtransaction): every value is validated first, so garbage is simply "not admin".
  if v_claims is null or not pg_input_is_valid(v_claims, 'jsonb') then return false; end if;
  v_c := v_claims::jsonb;
  v_sub := coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), v_c ->> 'sub');
  v_sid := v_c ->> 'session_id';
  if v_sub is null or v_sid is null or not pg_input_is_valid(v_sub, 'uuid') or not pg_input_is_valid(v_sid, 'uuid') then return false; end if;
  return exists (select 1 from public.admins a where a.user_id = v_sub::uuid)
     and exists (select 1 from private.admin_passkey_sessions s
                  where s.session_id = v_sid::uuid and s.user_id = v_sub::uuid and s.expires_at > now())
     and exists (select 1 from auth.sessions x where x.id = v_sid::uuid and x.user_id = v_sub::uuid);
end $$;


-- Locked out? One session: 5 failures of any kind in an hour. One user (all sessions): 100 wrong recovery or setup codes. Passkey
-- failures ('login_failed') never count per user, so someone with only the password cannot lock out the other sessions by spamming
-- login. A session that is already verified is held back only by its own failures.
create or replace function private.pk_locked(p_user uuid, p_session uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_verified boolean := false;
begin
  if p_session is not null then
    if (select count(*) from private.admin_passkey_events
         where user_id = p_user and session_id = p_session and created_at > now() - interval '1 hour') >= 5 then return true; end if;
    v_verified := exists (select 1 from private.admin_passkey_sessions where session_id = p_session and user_id = p_user and expires_at > now());
  end if;
  if v_verified then return false; end if;
  return (select count(*) from private.admin_passkey_events
           where user_id = p_user and kind in ('recovery_failed', 'setup_code_failed') and created_at > now() - interval '1 hour') >= 100;
end $$;


-- Removes what has expired. Called now and then by the helpers and nightly by pg_cron where that exists.
create or replace function private.pk_prune()
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from private.admin_passkey_challenges where expires_at < now();
  delete from private.admin_passkey_sessions where expires_at < now();
  delete from private.admin_setup_codes where expires_at < now() - interval '1 day' or used_at < now() - interval '1 day';
  delete from private.admin_passkey_events where created_at < now() - interval '1 day';
  delete from public.security_events where kind = 'admin_login_failed' and created_at < now() - interval '30 days';
  delete from public.audit_log where action = 'admin_login_failed' and created_at < now() - interval '30 days';
end $$;


-- Audit trail for the passkey flow. Kinds are fixed; the details keep only a few harmless keys (never a code or a credential).
-- 'login_failed' also counts against the lock-out (per session when p_session is given, and per user).
create or replace function public.pk_note(p_user uuid, p_kind text, p_details jsonb default '{}', p_session uuid default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_kind not in ('setup', 'passkey_added', 'passkey_removed', 'passkey_renamed', 'passkey_login', 'recovery_used',
                    'recovery_generated', 'login_failed') then
    raise exception 'invalid';
  end if;
  if p_kind = 'login_failed' then
    perform private.pk_lock(p_user);
    if private.pk_locked(p_user, p_session) then return; end if;     -- already locked: no more rows for an attacker to pile up
    insert into private.admin_passkey_events (user_id, session_id, kind) values (p_user, p_session, 'login_failed');
  end if;
  perform private.pk_event(p_user, 'admin_' || p_kind, p_details);
end $$;


-- The sessions of an admin in the last 24 hours, to pick the right one for open_admin_session. short_id is the first 8 characters
-- of the id: the admin site shows it on the "Use your passkey" screen, so the founder can match it. Read-only.
create or replace function private.list_admin_sessions(p_email text)
returns table (id uuid, short_id text, created_at timestamptz, ip text, user_agent text)
language sql stable security definer set search_path = public, private, auth as $$
  select s.id, left(s.id::text, 8), s.created_at, host(s.ip), s.user_agent
    from auth.sessions s
    join auth.users u on u.id = s.user_id
    join public.admins a on a.user_id = u.id
   where lower(u.email) = lower(btrim(p_email)) and s.created_at > now() - interval '24 hours'
   order by s.created_at desc
$$;

-- The admin edge function is down, not deployed or missing its secrets. Procedure: sign in on the admin site with email and
-- password (that makes a Supabase session and the site shows its 8-character code), run list_admin_sessions(email) to see that
-- code with its IP address and browser, then open_admin_session(email, code). The session with that code becomes a verified
-- recovery session for 1 to 30 minutes (the usual recovery banner); then reload the site. It refuses when the code matches no
-- session or more than one, so an attacker's newer session cannot be picked by mistake. IP address and browser are written to
-- the audit log and returned. Audited.
create or replace function private.open_admin_session(p_email text, p_short_id text, p_minutes integer default 30)
returns text language plpgsql security definer set search_path = public, private, auth as $$
declare v_id uuid; v_short text := lower(btrim(coalesce(p_short_id, ''))); v_sids uuid[]; v_ip text; v_ua text;
        v_mins integer := least(greatest(coalesce(p_minutes, 30), 1), 30);
begin
  select u.id into v_id from auth.users u join public.admins a on a.user_id = u.id where lower(u.email) = lower(btrim(p_email));
  if v_id is null then raise exception 'that email is not an admin'; end if;
  if v_short !~ '^[0-9a-f]{8}$' then raise exception 'give the first 8 characters of the session id (private.list_admin_sessions)'; end if;
  select array_agg(s.id) into v_sids from auth.sessions s
   where s.user_id = v_id and s.created_at > now() - interval '24 hours' and left(s.id::text, 8) = v_short;
  if coalesce(array_length(v_sids, 1), 0) = 0 then raise exception 'no session of that admin matches %: sign in on the admin site first', v_short; end if;
  if array_length(v_sids, 1) > 1 then raise exception 'more than one session matches %: refusing', v_short; end if;
  select host(s.ip), s.user_agent into v_ip, v_ua from auth.sessions s where s.id = v_sids[1];
  perform private.pk_open_session(v_id, v_sids[1], null, 'recovery', v_mins);
  insert into public.audit_log (admin_id, action, target_user, details)
  values ('00000000-0000-0000-0000-000000000000', 'admin_session_opened', v_id,
          jsonb_build_object('minutes', v_mins, 'short_id', v_short, 'ip', v_ip, 'user_agent', left(v_ua, 200)));
  return 'session ' || v_short || ' opened for ' || v_mins || ' minute(s) (ip ' || coalesce(v_ip, '?') || ', browser ' || coalesce(left(v_ua, 120), '?') || '): reload the admin site';
end $$;


-- The old two-argument version picked the newest session, which someone holding only the password could own. It is replaced.
drop function if exists private.open_admin_session(text, integer);
revoke execute on function private.open_admin_session(text, text, integer), private.list_admin_sessions(text),
  private.pk_locked(uuid, uuid), private.pk_prune() from public, anon, authenticated, service_role;
revoke execute on function public.pk_note(uuid, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.pk_note(uuid, text, jsonb, uuid) to service_role;
