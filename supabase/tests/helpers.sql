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
