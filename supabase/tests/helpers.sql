-- Test helpers shared by the assertion files. Load with \i supabase/tests/helpers.sql (from the repo root).
-- Each helper lives only for the current psql session (pg_temp).

create or replace function pg_temp.check(c boolean, m text) returns void language plpgsql as $$
begin if c is not true then raise exception 'ASSERT FAILED: %', m; end if; end $$;

-- Run one statement as a given database role (anon, authenticated, service_role) and user id.
-- Returns the first column of the first row as text.
create or replace function pg_temp.as_role(p_role text, p_uid uuid, p_sql text) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  execute format('set local role %I', p_role);
  begin
    if p_sql ~* '^\s*(select|with)\M' then execute p_sql into r; else execute p_sql; end if;   -- INSERT and friends return no row
  exception when others then
    reset role;
    raise;
  end;
  reset role;
  return r;
end $$;

create or replace function pg_temp.count_as(p_uid uuid, p_sql text) returns bigint language sql as $$
  select pg_temp.as_role('authenticated', p_uid, p_sql)::bigint $$;

-- The statement must be refused (any error), or the assertion fails.
create or replace function pg_temp.fails_as(p_role text, p_uid uuid, p_sql text, p_msg text) returns void language plpgsql as $$
begin
  begin
    perform pg_temp.as_role(p_role, p_uid, p_sql);
  exception when others then
    return;
  end;
  raise exception 'ASSERT FAILED (should have been refused): %', p_msg;
end $$;

-- Same, for a statement run directly (as the superuser running the tests).
create or replace function pg_temp.fails(p_sql text, p_msg text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    return;
  end;
  raise exception 'ASSERT FAILED (should have been refused): %', p_msg;
end $$;

-- A person as sign-up creates them: an email account whose metadata carries the role and the Terms version, so the real
-- handle_new_user trigger runs (profile, membership and the Terms/Privacy acceptances are made by it).
create or replace function pg_temp.new_user(p_id uuid, p_email text, p_role text default 'owner') returns void language plpgsql as $$
begin
  insert into auth.users (id, email, email_confirmed_at, created_at, raw_user_meta_data)
  values (p_id, p_email, now(), now(),
          jsonb_build_object('role', p_role, 'terms_version', (select current_version from public.legal_documents where doc = 'terms')));
end $$;

-- Approved by the founder and paid up for six months: the state in which every normal rule applies.
create or replace function pg_temp.activate(p_id uuid, p_name text default null) returns void language plpgsql as $$
begin
  update public.profiles set status = 'active', first_name = coalesce(p_name, first_name), face_verified = true, id_verified = true, is_adult = true
   where id = p_id;
  update public.memberships set paid_until = current_date + 180 where user_id = p_id;
end $$;

-- The statement must be refused with an error whose message contains p_part (for example a sign-up refusal code "[E5]").
create or replace function pg_temp.fails_with(p_sql text, p_part text, p_msg text) returns void language plpgsql as $$
declare e text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics e = message_text;
    if position(p_part in e) = 0 then raise exception 'ASSERT FAILED (refused with the wrong error "%", wanted "%"): %', e, p_part, p_msg; end if;
    return;
  end;
  raise exception 'ASSERT FAILED (should have been refused): %', p_msg;
end $$;

-- Make a person an admin (they must exist as a user first). Admin rights only apply to a session with aal2 (see as_aal).
create or replace function pg_temp.make_admin(p_id uuid) returns void language plpgsql as $$
begin insert into public.admins (user_id) values (p_id) on conflict do nothing; end $$;

-- Run a statement as a signed-in person whose session has the given authenticator level ('aal1', 'aal2' or null = none).
create or replace function pg_temp.as_aal(p_aal text, p_uid uuid, p_sql text) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claims', case when p_aal is null then '' else json_build_object('aal', p_aal)::text end, true);
  begin
    r := pg_temp.as_role('authenticated', p_uid, p_sql);
  exception when others then
    perform set_config('request.jwt.claims', '', true);
    raise;
  end;
  perform set_config('request.jwt.claims', '', true);
  return r;
end $$;

create or replace function pg_temp.fails_aal(p_aal text, p_uid uuid, p_sql text, p_msg text) returns void language plpgsql as $$
begin
  begin
    perform pg_temp.as_aal(p_aal, p_uid, p_sql);
  exception when others then
    return;
  end;
  raise exception 'ASSERT FAILED (should have been refused): %', p_msg;
end $$;
