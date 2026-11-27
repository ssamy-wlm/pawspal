-- Passkey assertions (migration 0014): the admin second step is a WebAuthn passkey, enforced by the database.
-- Covers: is_admin() and admin_status(), the private tables, the service-only helpers, challenges, setup codes, recovery codes,
-- the counter rule, the limits, and the founder's break-glass functions.
-- Run AFTER the other assertion files on the same database, with ON_ERROR_STOP=1.
\set ON_ERROR_STOP 1
\i supabase/tests/helpers.sql

select pg_temp.new_user('e7e7e7e7-0000-0000-0000-000000000001', 'ada-pk@example.com', 'owner');   -- Ada, admin
select pg_temp.new_user('e7e7e7e7-0000-0000-0000-000000000002', 'bo-pk@example.com', 'owner');    -- Bo, admin
select pg_temp.new_user('e7e7e7e7-0000-0000-0000-000000000003', 'cy-pk@example.com', 'owner');    -- Cy, a normal user
select pg_temp.new_user('e7e7e7e7-0000-0000-0000-000000000004', 'di-pk@example.com', 'owner');    -- Di, admin removed at the end
select pg_temp.make_admin('e7e7e7e7-0000-0000-0000-000000000001');
select pg_temp.make_admin('e7e7e7e7-0000-0000-0000-000000000002');
select pg_temp.make_admin('e7e7e7e7-0000-0000-0000-000000000004');

-- The Supabase sessions these tests use (is_admin() also needs the session itself to exist).
insert into auth.sessions (id, user_id) select ('e7e7e7e7-0000-0000-0000-0000000000' || n)::uuid, 'e7e7e7e7-0000-0000-0000-000000000001' from unnest(array['a1','a2','a3','a4','b1']) n;
insert into auth.sessions (id, user_id) values ('e7e7e7e7-0000-0000-0000-0000000000c1', 'e7e7e7e7-0000-0000-0000-000000000003'), ('e7e7e7e7-0000-0000-0000-0000000000d1', 'e7e7e7e7-0000-0000-0000-000000000004');

-- The edge function's role.
create or replace function pg_temp.svc(p_sql text) returns text language sql as $$ select pg_temp.as_role('service_role', null, p_sql) $$;
create or replace function pg_temp.st(p_user uuid, p_session uuid) returns jsonb language sql as $$
  select pg_temp.svc(format('select public.pk_state(%L, %L)::text', p_user, p_session))::jsonb $$;
-- Add a credential as the edge function would. Returns the status word.
create or replace function pg_temp.add_cred(p_user uuid, p_cred text, p_name text default 'Phone', p_code text default null, p_session uuid default null) returns text language sql as $$
  select (pg_temp.svc(format('select public.pk_add_credential(%L, %L, %L, 0, %L, %L, %L, %L, %L, %L)::text',
            p_user, p_cred, 'pk-' || p_cred, '{internal}'::text[], 'multiDevice', true, p_name, p_code, p_session))::jsonb) ->> 'status' $$;
create or replace function pg_temp.cred_id(p_cred text) returns uuid language sql as $$ select id from private.admin_passkeys where credential_id = p_cred $$;
-- Run is_admin() as a user with exactly these JWT claims.
create or replace function pg_temp.is_admin_with(p_uid uuid, p_claims text) returns boolean language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claims', p_claims, true);
  r := pg_temp.as_role('authenticated', p_uid, 'select public.is_admin()');
  perform set_config('request.jwt.claims', '', true);
  return r::boolean;
end $$;
create or replace function pg_temp.claims_for(p_sid text) returns text language sql as $$ select json_build_object('session_id', p_sid)::text $$;
create or replace function pg_temp.status_with(p_uid uuid, p_claims text) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claims', p_claims, true);
  r := pg_temp.as_role('authenticated', p_uid, 'select public.admin_status()');
  perform set_config('request.jwt.claims', '', true);
  return r;
end $$;
create or replace function pg_temp.hash_of(p_code text) returns text language sql as $$ select encode(extensions.digest(upper(regexp_replace(p_code, '[^A-Za-z0-9]', '', 'g')), 'sha256'), 'hex') $$;

-- =============================================================================================================== P1 tables
\echo '--- P1 the passkey tables are closed to the app'
select pg_temp.check((select count(*) = 6 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                       where n.nspname = 'private' and c.relname in ('admin_passkeys', 'admin_passkey_challenges', 'admin_passkey_sessions', 'admin_setup_codes', 'admin_recovery_codes', 'admin_passkey_events')
                         and c.relrowsecurity), 'a passkey table has no row-level security');
select pg_temp.check(not exists (select 1 from pg_policies where schemaname = 'private' and tablename like 'admin\_%'), 'a passkey table has a policy');
select pg_temp.check(not exists (
  select 1 from (values ('private.admin_passkeys'), ('private.admin_passkey_challenges'), ('private.admin_passkey_sessions'), ('private.admin_setup_codes'), ('private.admin_recovery_codes'), ('private.admin_passkey_events')) t(tbl),
                (values ('anon'), ('authenticated')) r(role), (values ('select'), ('insert'), ('update'), ('delete'), ('references'), ('trigger')) p(priv)
   where has_table_privilege(r.role, t.tbl, p.priv)), 'an app role holds a privilege on a passkey table');
select pg_temp.fails_as('authenticated', 'e7e7e7e7-0000-0000-0000-000000000001', 'select count(*) from private.admin_passkeys', 'a user read passkeys');
select pg_temp.fails_as('authenticated', 'e7e7e7e7-0000-0000-0000-000000000001', 'select count(*) from private.admin_passkey_sessions', 'a user read passkey sessions');
select pg_temp.fails_as('authenticated', 'e7e7e7e7-0000-0000-0000-000000000001', $$insert into private.admin_passkey_sessions (session_id, user_id, via, expires_at) values (gen_random_uuid(), 'e7e7e7e7-0000-0000-0000-000000000001', 'passkey', now() + interval '1 day')$$, 'an admin made themselves a passkey session');
select pg_temp.fails_as('authenticated', 'e7e7e7e7-0000-0000-0000-000000000001', 'select count(*) from private.admin_recovery_codes', 'a user read recovery codes');
select pg_temp.fails_as('authenticated', 'e7e7e7e7-0000-0000-0000-000000000001', 'select count(*) from private.admin_setup_codes', 'a user read setup codes');
select pg_temp.fails_as('authenticated', 'e7e7e7e7-0000-0000-0000-000000000001', 'delete from private.admin_passkey_challenges', 'a user deleted challenges');
select pg_temp.fails_as('anon', null, 'select count(*) from private.admin_passkeys', 'anon read passkeys');
select pg_temp.fails_as('anon', null, $$update private.admin_passkeys set name = 'x'$$, 'anon changed passkeys');
select pg_temp.fails_as('anon', null, 'select count(*) from private.admin_passkey_sessions', 'anon read passkey sessions');
select pg_temp.fails_as('anon', null, 'select count(*) from private.admin_recovery_codes', 'anon read recovery codes');
-- Even the service role does not read them directly: it goes through the helpers.
select pg_temp.fails_as('service_role', null, 'select count(*) from private.admin_recovery_codes', 'the service role read recovery codes directly');

-- =============================================================================================================== P2 functions
\echo '--- P2 the service-only helpers are for the service role only'
select pg_temp.check((select count(*) = 17 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'pk\_%'), 'fewer passkey helpers than expected');
select pg_temp.check(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                  where n.nspname = 'public' and p.proname like 'pk\_%'
                                    and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))), 'an app role can run a passkey helper');
select pg_temp.check(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                  where n.nspname = 'public' and p.proname like 'pk\_%' and not has_function_privilege('service_role', p.oid, 'execute')), 'the service role cannot run a passkey helper');
select pg_temp.check(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                  where n.nspname = 'public' and p.proname like 'pk\_%' and not p.prosecdef), 'a passkey helper is not security definer');
select pg_temp.fails_as('authenticated', 'e7e7e7e7-0000-0000-0000-000000000001', $$select public.pk_state('e7e7e7e7-0000-0000-0000-000000000001', gen_random_uuid())$$, 'a user ran pk_state');
select pg_temp.fails_as('authenticated', 'e7e7e7e7-0000-0000-0000-000000000001', $$select public.pk_start_session('e7e7e7e7-0000-0000-0000-000000000001', gen_random_uuid(), null, 'recovery', 30)$$, 'an admin started their own passkey session');
select pg_temp.fails_as('anon', null, $$select public.pk_credentials('e7e7e7e7-0000-0000-0000-000000000001')$$, 'anon listed credentials');
select pg_temp.fails_as('authenticated', 'e7e7e7e7-0000-0000-0000-000000000001', $$select public.pk_remove('e7e7e7e7-0000-0000-0000-000000000001', gen_random_uuid())$$, 'a user removed a passkey through the helper');
select pg_temp.check(pg_temp.svc($$select public.pk_state(gen_random_uuid(), null)::text$$) is not null, 'the service role could not run pk_state');
-- the founder-only functions and the internal ones: no app role and not even the service role
select pg_temp.check(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace, (values ('anon'), ('authenticated'), ('service_role')) r(role)
                                  where n.nspname = 'private'
                                    and p.proname in ('new_admin_setup_code', 'reset_admin_passkeys', 'open_admin_session', 'revoke_admin', 'list_admins', 'pk_prune', 'pk_event', 'pk_lock', 'pk_sec', 'pk_fail', 'pk_locked', 'pk_open_session', 'random_code', 'code_hash')
                                    and has_function_privilege(r.role, p.oid, 'execute')), 'a role besides the owner can run a break-glass or internal function');
select pg_temp.fails_as('authenticated', 'e7e7e7e7-0000-0000-0000-000000000001', $$select private.new_admin_setup_code('ada-pk@example.com')$$, 'an admin made their own setup code');
select pg_temp.fails_as('service_role', null, $$select private.new_admin_setup_code('ada-pk@example.com')$$, 'the service role made a setup code');
select pg_temp.fails_as('authenticated', 'e7e7e7e7-0000-0000-0000-000000000001', $$select private.reset_admin_passkeys('ada-pk@example.com')$$, 'an admin reset their passkeys');
select pg_temp.fails_as('service_role', null, $$select private.reset_admin_passkeys('ada-pk@example.com')$$, 'the service role reset passkeys');
select pg_temp.fails_as('authenticated', 'e7e7e7e7-0000-0000-0000-000000000003', $$select * from private.list_admins()$$, 'a user listed the admins');
select pg_temp.fails_as('anon', null, $$select * from private.list_admins()$$, 'anon listed the admins');

-- =============================================================================================================== P3 is_admin
\echo '--- P3 is_admin() is true only for a live passkey session of the same user'
-- Ada has no passkey yet: only the setup-code path can add one.
select pg_temp.check(pg_temp.status_with('e7e7e7e7-0000-0000-0000-000000000001', pg_temp.claims_for('e7e7e7e7-0000-0000-0000-0000000000a1')) = 'needs_setup', 'an admin with no passkey was not "needs_setup"');
select pg_temp.check(pg_temp.status_with('e7e7e7e7-0000-0000-0000-000000000003', pg_temp.claims_for('e7e7e7e7-0000-0000-0000-0000000000a1')) = 'not_admin', 'a normal user was not "not_admin"');
select pg_temp.fails_as('authenticated', 'e7e7e7e7-0000-0000-0000-000000000001', 'select public.admin_overview()', 'an admin with no passkey read the overview');

-- A setup code (the founder, in the SQL editor), then the first passkey.
create temp table t_ids (k text primary key, v text);
insert into t_ids select 'code_ada', private.new_admin_setup_code('ADA-pk@example.com ');
select pg_temp.check((select v ~ '^[A-HJ-NP-Z2-9]{12}$' from t_ids where k = 'code_ada'), 'the setup code is not 12 characters from the unambiguous alphabet');
select pg_temp.check(not exists (select 1 from private.admin_setup_codes c, t_ids t where t.k = 'code_ada' and (c.code_hash = t.v or position(t.v in c.code_hash) > 0)), 'the setup code is stored in plain text');
select pg_temp.check((select expires_at between now() + interval '14 minutes' and now() + interval '15 minutes' from private.admin_setup_codes where user_id = 'e7e7e7e7-0000-0000-0000-000000000001'), 'the setup code does not last 15 minutes');
select pg_temp.fails($$select private.new_admin_setup_code('cy-pk@example.com')$$, 'a setup code was made for a normal user');
select pg_temp.fails($$select private.new_admin_setup_code('nobody@example.com')$$, 'a setup code was made for nobody');
-- wrong user cannot use it, a wrong code fails, then the right one works once
select pg_temp.check(pg_temp.svc(format($$select public.pk_check_setup_code('e7e7e7e7-0000-0000-0000-000000000002', 'e7e7e7e7-0000-0000-0000-0000000000a1', %L)$$, (select v from t_ids where k = 'code_ada'))) = 'bad', 'another admin''s setup code check passed');
select pg_temp.check(pg_temp.svc($$select public.pk_check_setup_code('e7e7e7e7-0000-0000-0000-000000000001', 'e7e7e7e7-0000-0000-0000-0000000000a1', 'AAAAAAAAAAAA')$$) = 'bad', 'a wrong setup code checked as ok');
select pg_temp.check(pg_temp.svc(format($$select public.pk_check_setup_code('e7e7e7e7-0000-0000-0000-000000000001', 'e7e7e7e7-0000-0000-0000-0000000000a1', %L)$$, (select lower(substr(v, 1, 4) || '-' || substr(v, 5, 4) || ' ' || substr(v, 9)) from t_ids where k = 'code_ada'))) = 'ok', 'the setup code did not work in lower case with dashes');
select pg_temp.check(pg_temp.svc(format($$select public.pk_take_setup_code('e7e7e7e7-0000-0000-0000-000000000002', %L)$$, (select v from t_ids where k = 'code_ada')))::boolean = false, 'another admin used Ada''s setup code');
select pg_temp.check(pg_temp.add_cred('e7e7e7e7-0000-0000-0000-000000000001', 'cred-ada-1', 'Ada phone', 'WRONGCODE234') = 'bad_setup_code', 'a credential was saved with a wrong setup code');
select pg_temp.check(not exists (select 1 from private.admin_passkeys where credential_id = 'cred-ada-1'), 'a credential exists after a refused setup code');
select pg_temp.check(pg_temp.add_cred('e7e7e7e7-0000-0000-0000-000000000001', 'cred-ada-1', 'Ada phone', (select v from t_ids where k = 'code_ada')) = 'ok', 'the first passkey was not saved with a good setup code');
select pg_temp.check(pg_temp.svc(format($$select public.pk_take_setup_code('e7e7e7e7-0000-0000-0000-000000000001', %L)$$, (select v from t_ids where k = 'code_ada')))::boolean = false, 'a setup code worked twice');
select pg_temp.check(pg_temp.add_cred('e7e7e7e7-0000-0000-0000-000000000001', 'cred-ada-2', 'Ada laptop', (select v from t_ids where k = 'code_ada')) = 'bad_setup_code', 'a used setup code saved a second passkey');
select pg_temp.check(pg_temp.status_with('e7e7e7e7-0000-0000-0000-000000000001', pg_temp.claims_for('e7e7e7e7-0000-0000-0000-0000000000a1')) = 'needs_passkey', 'an admin with a passkey but no verified session was not "needs_passkey"');
-- an expired setup code
insert into t_ids select 'code_bo', private.new_admin_setup_code('bo-pk@example.com');
update private.admin_setup_codes set expires_at = now() - interval '1 minute' where user_id = 'e7e7e7e7-0000-0000-0000-000000000002';
select pg_temp.check(pg_temp.svc(format($$select public.pk_check_setup_code('e7e7e7e7-0000-0000-0000-000000000002', 'e7e7e7e7-0000-0000-0000-0000000000a1', %L)$$, (select v from t_ids where k = 'code_bo'))) = 'bad', 'an expired setup code checked as ok');
select pg_temp.check(pg_temp.add_cred('e7e7e7e7-0000-0000-0000-000000000002', 'cred-bo-1', 'Bo phone', (select v from t_ids where k = 'code_bo')) = 'bad_setup_code', 'an expired setup code saved a passkey');
-- a new code replaces the old one
insert into t_ids select 'code_bo2', private.new_admin_setup_code('bo-pk@example.com');
select pg_temp.check(pg_temp.svc(format($$select public.pk_check_setup_code('e7e7e7e7-0000-0000-0000-000000000002', 'e7e7e7e7-0000-0000-0000-0000000000a1', %L)$$, (select v from t_ids where k = 'code_bo2'))) = 'ok', 'the new setup code did not work');
select pg_temp.check(pg_temp.add_cred('e7e7e7e7-0000-0000-0000-000000000002', 'cred-bo-1', 'Bo phone', (select v from t_ids where k = 'code_bo2')) = 'ok', 'Bo could not save a passkey with a new code');
select pg_temp.check((select count(*) = 2 from private.admin_passkeys where user_id in ('e7e7e7e7-0000-0000-0000-000000000001', 'e7e7e7e7-0000-0000-0000-000000000002')), 'the passkey count is wrong');

-- Five wrong guesses in an hour from one session lock that session out of setup codes, even for the right one.
insert into t_ids select 'code_di', private.new_admin_setup_code('di-pk@example.com');
do $d$ begin for i in 1..5 loop perform pg_temp.svc($$select public.pk_take_setup_code('e7e7e7e7-0000-0000-0000-000000000004', 'WRONGWRONG22', 'e7e7e7e7-0000-0000-0000-0000000000d1')$$); end loop; end $d$;
select pg_temp.check(pg_temp.svc(format($$select public.pk_check_setup_code('e7e7e7e7-0000-0000-0000-000000000004', 'e7e7e7e7-0000-0000-0000-0000000000d1', %L)$$, (select v from t_ids where k = 'code_di'))) = 'locked', 'five wrong setup codes did not lock the session');
select pg_temp.check(pg_temp.add_cred('e7e7e7e7-0000-0000-0000-000000000004', 'cred-di-1', 'Di phone', (select v from t_ids where k = 'code_di'), 'e7e7e7e7-0000-0000-0000-0000000000d1') = 'bad_setup_code', 'a locked session saved a passkey with the right setup code');
select pg_temp.check(not exists (select 1 from private.admin_passkeys where user_id = 'e7e7e7e7-0000-0000-0000-000000000004'), 'Di has a passkey');

-- The session rule itself
insert into private.admin_passkey_sessions (session_id, user_id, passkey_id, via, expires_at)
values ('e7e7e7e7-0000-0000-0000-0000000000a1', 'e7e7e7e7-0000-0000-0000-000000000001', pg_temp.cred_id('cred-ada-1'), 'passkey', now() + interval '8 hours');
select pg_temp.check(pg_temp.is_admin_with('e7e7e7e7-0000-0000-0000-000000000001', pg_temp.claims_for('e7e7e7e7-0000-0000-0000-0000000000a1')), 'a verified passkey session was not admin');
select pg_temp.check(pg_temp.status_with('e7e7e7e7-0000-0000-0000-000000000001', pg_temp.claims_for('e7e7e7e7-0000-0000-0000-0000000000a1')) = 'admin', 'admin_status did not say admin');
select pg_temp.check(not pg_temp.is_admin_with('e7e7e7e7-0000-0000-0000-000000000001', pg_temp.claims_for('e7e7e7e7-0000-0000-0000-0000000000a2')), 'another session counted as verified');
select pg_temp.check(not pg_temp.is_admin_with('e7e7e7e7-0000-0000-0000-000000000002', pg_temp.claims_for('e7e7e7e7-0000-0000-0000-0000000000a1')), 'another admin used Ada''s session');
select pg_temp.check(not pg_temp.is_admin_with('e7e7e7e7-0000-0000-0000-000000000003', pg_temp.claims_for('e7e7e7e7-0000-0000-0000-0000000000a1')), 'a normal user used Ada''s session');
select pg_temp.check(not pg_temp.is_admin_with('e7e7e7e7-0000-0000-0000-000000000001', ''), 'no claims counted as admin');
select pg_temp.check(not pg_temp.is_admin_with('e7e7e7e7-0000-0000-0000-000000000001', '{}'), 'empty claims counted as admin');
select pg_temp.check(not pg_temp.is_admin_with('e7e7e7e7-0000-0000-0000-000000000001', '{"aal":"aal2"}'), 'the old aal2 claim still counts as admin');
select pg_temp.check(not pg_temp.is_admin_with('e7e7e7e7-0000-0000-0000-000000000001', '{"session_id":"not-a-uuid"}'), 'a garbage session_id counted as admin');
select pg_temp.check(not pg_temp.is_admin_with('e7e7e7e7-0000-0000-0000-000000000001', '{"session_id":12345}'), 'a numeric session_id counted as admin');
select pg_temp.check(not pg_temp.is_admin_with('e7e7e7e7-0000-0000-0000-000000000001', '{"session_id":null}'), 'a null session_id counted as admin');
select pg_temp.check(not pg_temp.is_admin_with('e7e7e7e7-0000-0000-0000-000000000001', '{"session_id":["e7e7e7e7-0000-0000-0000-0000000000a1"]}'), 'an array session_id counted as admin');
select pg_temp.check(not pg_temp.is_admin_with('e7e7e7e7-0000-0000-0000-000000000001', 'this is not json'), 'garbage claims counted as admin (or raised)');
select pg_temp.check(pg_temp.status_with('e7e7e7e7-0000-0000-0000-000000000001', 'this is not json') = 'needs_passkey', 'admin_status raised on garbage claims');
-- an expired row
update private.admin_passkey_sessions set expires_at = now() - interval '1 second' where session_id = 'e7e7e7e7-0000-0000-0000-0000000000a1';
select pg_temp.check(not pg_temp.is_admin_with('e7e7e7e7-0000-0000-0000-000000000001', pg_temp.claims_for('e7e7e7e7-0000-0000-0000-0000000000a1')), 'an expired passkey session counted as admin');
select pg_temp.check(pg_temp.status_with('e7e7e7e7-0000-0000-0000-000000000001', pg_temp.claims_for('e7e7e7e7-0000-0000-0000-0000000000a1')) = 'needs_passkey', 'an expired session was not "needs_passkey"');
update private.admin_passkey_sessions set expires_at = now() + interval '1 hour' where session_id = 'e7e7e7e7-0000-0000-0000-0000000000a1';
select pg_temp.check(pg_temp.is_admin_with('e7e7e7e7-0000-0000-0000-000000000001', pg_temp.claims_for('e7e7e7e7-0000-0000-0000-0000000000a1')), 'the live row stopped working');
-- a non-admin with a row (a row cannot be made through the helpers, so the table is written directly)
insert into private.admin_passkey_sessions (session_id, user_id, via, expires_at) values ('e7e7e7e7-0000-0000-0000-0000000000c1', 'e7e7e7e7-0000-0000-0000-000000000003', 'passkey', now() + interval '8 hours');
select pg_temp.check(not pg_temp.is_admin_with('e7e7e7e7-0000-0000-0000-000000000003', pg_temp.claims_for('e7e7e7e7-0000-0000-0000-0000000000c1')), 'a non-admin with a session row counted as admin');
select pg_temp.check(pg_temp.status_with('e7e7e7e7-0000-0000-0000-000000000003', pg_temp.claims_for('e7e7e7e7-0000-0000-0000-0000000000c1')) = 'not_admin', 'a non-admin with a row was not "not_admin"');
select pg_temp.fails_as('authenticated', 'e7e7e7e7-0000-0000-0000-000000000003', 'select public.admin_overview()', 'a non-admin with a row read the overview');
delete from private.admin_passkey_sessions where session_id = 'e7e7e7e7-0000-0000-0000-0000000000c1';
select pg_temp.check(pg_temp.add_cred('e7e7e7e7-0000-0000-0000-000000000003', 'cred-cy-1') = 'not_allowed', 'a normal user saved a passkey');
select pg_temp.check(pg_temp.svc($$select public.pk_start_session('e7e7e7e7-0000-0000-0000-000000000003', gen_random_uuid(), null, 'recovery', 30)::text$$) is null, 'a normal user got a passkey session');
select pg_temp.check(not exists (select 1 from private.admin_passkey_sessions where user_id = 'e7e7e7e7-0000-0000-0000-000000000003'), 'a normal user has a session row');
-- the claim of an admin whose row was ended
select pg_temp.svc($$select public.pk_end_session('e7e7e7e7-0000-0000-0000-0000000000a1')$$);
select pg_temp.check(not pg_temp.is_admin_with('e7e7e7e7-0000-0000-0000-000000000001', pg_temp.claims_for('e7e7e7e7-0000-0000-0000-0000000000a1')), 'sign-out did not end the passkey session');
-- an admin function works only with the session
select pg_temp.fails_aal('aal1', 'e7e7e7e7-0000-0000-0000-000000000001', 'select public.admin_overview()', 'the overview worked with no passkey session');
select pg_temp.check(pg_temp.as_aal('aal2', 'e7e7e7e7-0000-0000-0000-000000000001', 'select public.admin_overview()::text') is not null, 'the overview did not work with a passkey session');

-- =============================================================================================================== P4 sessions
\echo '--- P4 sessions: 8 hours for a passkey, 30 minutes for a recovery code'
select pg_temp.check(pg_temp.svc($$select public.pk_start_session('e7e7e7e7-0000-0000-0000-000000000001', 'e7e7e7e7-0000-0000-0000-0000000000a2', null, 'passkey', 60)::text$$) is null, 'a passkey session started without a passkey');
select pg_temp.check(pg_temp.svc(format($$select public.pk_start_session('e7e7e7e7-0000-0000-0000-000000000001', 'e7e7e7e7-0000-0000-0000-0000000000a2', %L, 'passkey', 60)::text$$, pg_temp.cred_id('cred-bo-1'))) is null, 'a session started with another admin''s passkey');
select pg_temp.check(pg_temp.svc(format($$select public.pk_start_session('e7e7e7e7-0000-0000-0000-000000000001', 'e7e7e7e7-0000-0000-0000-0000000000a2', %L, 'sms', 60)::text$$, pg_temp.cred_id('cred-ada-1'))) is null, 'a session started with an unknown way');
select pg_temp.check(pg_temp.svc(format($$select public.pk_start_session('e7e7e7e7-0000-0000-0000-000000000001', 'e7e7e7e7-0000-0000-0000-0000000000a2', %L, 'passkey', 100000)::text$$, pg_temp.cred_id('cred-ada-1'))) is not null, 'the passkey session did not start');
select pg_temp.check((select expires_at <= now() + interval '8 hours' and expires_at > now() + interval '7 hours 58 minutes' from private.admin_passkey_sessions where session_id = 'e7e7e7e7-0000-0000-0000-0000000000a2'), 'a passkey session is not capped at 8 hours');
select pg_temp.check((st.j ->> 'via') = 'passkey' and (st.j ->> 'verified')::boolean, 'pk_state does not show a passkey session') from (select pg_temp.st('e7e7e7e7-0000-0000-0000-000000000001', 'e7e7e7e7-0000-0000-0000-0000000000a2') j) st;
-- a recovery session never replaces a live passkey session, and never lasts more than 30 minutes
select pg_temp.svc($$select public.pk_start_session('e7e7e7e7-0000-0000-0000-000000000001', 'e7e7e7e7-0000-0000-0000-0000000000a2', null, 'recovery', 30)::text$$);
select pg_temp.check((select via = 'passkey' from private.admin_passkey_sessions where session_id = 'e7e7e7e7-0000-0000-0000-0000000000a2'), 'a recovery code downgraded a passkey session');
select pg_temp.svc(format($$select public.pk_start_session('e7e7e7e7-0000-0000-0000-000000000001', 'e7e7e7e7-0000-0000-0000-0000000000a3', %L, 'recovery', 600)::text$$, pg_temp.cred_id('cred-ada-1')));
select pg_temp.check((select via = 'recovery' and passkey_id is null and expires_at <= now() + interval '30 minutes' and expires_at > now() + interval '29 minutes' from private.admin_passkey_sessions where session_id = 'e7e7e7e7-0000-0000-0000-0000000000a3'), 'a recovery session is not capped at 30 minutes');
select pg_temp.check(pg_temp.is_admin_with('e7e7e7e7-0000-0000-0000-000000000001', pg_temp.claims_for('e7e7e7e7-0000-0000-0000-0000000000a3')), 'a recovery session was not admin');
select pg_temp.check((pg_temp.st('e7e7e7e7-0000-0000-0000-000000000001', 'e7e7e7e7-0000-0000-0000-0000000000a3') ->> 'via') = 'recovery', 'pk_state does not show a recovery session');
select pg_temp.check(not (pg_temp.st('e7e7e7e7-0000-0000-0000-000000000002', 'e7e7e7e7-0000-0000-0000-0000000000a3') ->> 'verified')::boolean, 'Bo''s state shows Ada''s session as verified');
-- a session belongs to one user: another admin cannot take its id over
select pg_temp.check(pg_temp.svc(format($$select public.pk_start_session('e7e7e7e7-0000-0000-0000-000000000002', 'e7e7e7e7-0000-0000-0000-0000000000a3', %L, 'passkey', 60)::text$$, pg_temp.cred_id('cred-bo-1'))) is null
                     or (select user_id = 'e7e7e7e7-0000-0000-0000-000000000001' from private.admin_passkey_sessions where session_id = 'e7e7e7e7-0000-0000-0000-0000000000a3'), 'a session id was taken over by another user');
select pg_temp.check((select user_id = 'e7e7e7e7-0000-0000-0000-000000000001' from private.admin_passkey_sessions where session_id = 'e7e7e7e7-0000-0000-0000-0000000000a3'), 'the session row now belongs to someone else');
select pg_temp.svc($$select public.pk_end_session('e7e7e7e7-0000-0000-0000-0000000000a3')$$);
select pg_temp.check(not exists (select 1 from private.admin_passkey_sessions where session_id = 'e7e7e7e7-0000-0000-0000-0000000000a3'), 'a session row survived the sign-out');
-- tidy-up of expired rows
insert into private.admin_passkey_sessions (session_id, user_id, via, expires_at) values ('e7e7e7e7-0000-0000-0000-0000000000a9', 'e7e7e7e7-0000-0000-0000-000000000002', 'recovery', now() - interval '1 hour');
select private.pk_prune();
select pg_temp.check(not exists (select 1 from private.admin_passkey_sessions where session_id = 'e7e7e7e7-0000-0000-0000-0000000000a9'), 'pk_prune left an expired session');
select pg_temp.check(exists (select 1 from private.admin_passkey_sessions where session_id = 'e7e7e7e7-0000-0000-0000-0000000000a2'), 'pk_prune removed a live session');

-- =============================================================================================================== P5 challenges
\echo '--- P5 challenges: single use, five minutes, bound to user, session and purpose'
select pg_temp.fails_as('service_role', null, $$select public.pk_new_challenge('e7e7e7e7-0000-0000-0000-000000000001', 'e7e7e7e7-0000-0000-0000-0000000000a2', 'register', 'short')$$, 'a short challenge was stored');
select pg_temp.fails_as('service_role', null, $$select public.pk_new_challenge('e7e7e7e7-0000-0000-0000-000000000001', 'e7e7e7e7-0000-0000-0000-0000000000a2', 'other', 'abcdefghijklmnopqrstuvwxyz')$$, 'a challenge with an unknown purpose was stored');
select pg_temp.svc($$select public.pk_new_challenge('e7e7e7e7-0000-0000-0000-000000000001', 'e7e7e7e7-0000-0000-0000-0000000000a2', 'register', 'challenge-one-abcdefghijklmnop')::text$$);
select pg_temp.check((select expires_at between now() + interval '4 minutes 55 seconds' and now() + interval '5 minutes' from private.admin_passkey_challenges where purpose = 'register' and user_id = 'e7e7e7e7-0000-0000-0000-000000000001'), 'a challenge does not last 5 minutes');
select pg_temp.check(pg_temp.svc($$select public.pk_take_challenge('e7e7e7e7-0000-0000-0000-000000000001', 'e7e7e7e7-0000-0000-0000-0000000000a2', 'login')$$) is null, 'a register challenge was taken as login');
select pg_temp.check(pg_temp.svc($$select public.pk_take_challenge('e7e7e7e7-0000-0000-0000-000000000001', 'e7e7e7e7-0000-0000-0000-0000000000a3', 'register')$$) is null, 'another session''s challenge was taken');
select pg_temp.check(pg_temp.svc($$select public.pk_take_challenge('e7e7e7e7-0000-0000-0000-000000000002', 'e7e7e7e7-0000-0000-0000-0000000000a2', 'register')$$) is null, 'another user''s challenge was taken');
select pg_temp.check(pg_temp.svc($$select public.pk_take_challenge('e7e7e7e7-0000-0000-0000-000000000001', 'e7e7e7e7-0000-0000-0000-0000000000a2', 'register')$$) = 'challenge-one-abcdefghijklmnop', 'the right challenge was not returned');
select pg_temp.check(pg_temp.svc($$select public.pk_take_challenge('e7e7e7e7-0000-0000-0000-000000000001', 'e7e7e7e7-0000-0000-0000-0000000000a2', 'register')$$) is null, 'a challenge was taken twice');
-- a new challenge replaces the older one for the same user, session and purpose
select pg_temp.svc($$select public.pk_new_challenge('e7e7e7e7-0000-0000-0000-000000000001', 'e7e7e7e7-0000-0000-0000-0000000000a2', 'login', 'challenge-old-abcdefghijklmnopq')::text$$);
select pg_temp.svc($$select public.pk_new_challenge('e7e7e7e7-0000-0000-0000-000000000001', 'e7e7e7e7-0000-0000-0000-0000000000a2', 'login', 'challenge-new-abcdefghijklmnopq')::text$$);
select pg_temp.check((select count(*) = 1 from private.admin_passkey_challenges where user_id = 'e7e7e7e7-0000-0000-0000-000000000001' and purpose = 'login'), 'two live login challenges for one session');
select pg_temp.check(pg_temp.svc($$select public.pk_take_challenge('e7e7e7e7-0000-0000-0000-000000000001', 'e7e7e7e7-0000-0000-0000-0000000000a2', 'login')$$) = 'challenge-new-abcdefghijklmnopq', 'the old challenge was returned');
-- expiry
select pg_temp.svc($$select public.pk_new_challenge('e7e7e7e7-0000-0000-0000-000000000001', 'e7e7e7e7-0000-0000-0000-0000000000a2', 'login', 'challenge-exp-abcdefghijklmnopq')::text$$);
update private.admin_passkey_challenges set expires_at = now() - interval '1 second' where user_id = 'e7e7e7e7-0000-0000-0000-000000000001';
select pg_temp.check(pg_temp.svc($$select public.pk_take_challenge('e7e7e7e7-0000-0000-0000-000000000001', 'e7e7e7e7-0000-0000-0000-0000000000a2', 'login')$$) is null, 'an expired challenge was returned');
select pg_temp.check(not exists (select 1 from private.admin_passkey_challenges where user_id = 'e7e7e7e7-0000-0000-0000-000000000001'), 'an expired challenge was left behind');

-- =============================================================================================================== P6 credentials
\echo '--- P6 credentials: limits, duplicates, names, counter rule, removal'
select pg_temp.check(pg_temp.add_cred('e7e7e7e7-0000-0000-0000-000000000001', 'cred-ada-1', 'Again') = 'duplicate', 'a credential id was saved twice');
select pg_temp.check(pg_temp.add_cred('e7e7e7e7-0000-0000-0000-000000000002', 'cred-ada-1', 'Steal') = 'duplicate', 'another admin saved Ada''s credential id');
select pg_temp.check(pg_temp.add_cred('e7e7e7e7-0000-0000-0000-000000000001', 'cred-x', '') = 'invalid', 'a passkey with no name was saved');
select pg_temp.check(pg_temp.add_cred('e7e7e7e7-0000-0000-0000-000000000001', 'cred-x', '   ') = 'invalid', 'a passkey with a blank name was saved');
select pg_temp.check(pg_temp.add_cred('e7e7e7e7-0000-0000-0000-000000000001', 'cred-x', repeat('n', 41)) = 'invalid', 'a passkey with a 41 character name was saved');
select pg_temp.check(pg_temp.add_cred('e7e7e7e7-0000-0000-0000-000000000001', 'cred-ada-2', repeat('n', 40)) = 'ok', 'a 40 character name was refused');
select pg_temp.check(not exists (select 1 from private.admin_passkeys where credential_id = 'cred-x'), 'a refused credential exists');
-- ten at most
do $d$ begin for i in 3..10 loop
  if pg_temp.add_cred('e7e7e7e7-0000-0000-0000-000000000001', 'cred-ada-' || i, 'Key ' || i) <> 'ok' then raise exception 'ASSERT FAILED: passkey % was refused', i; end if;
end loop; end $d$;
select pg_temp.check((select count(*) = 10 from private.admin_passkeys where user_id = 'e7e7e7e7-0000-0000-0000-000000000001'), 'Ada does not have 10 passkeys');
select pg_temp.check(pg_temp.add_cred('e7e7e7e7-0000-0000-0000-000000000001', 'cred-ada-11', 'Eleven') = 'limit', 'an 11th passkey was saved');
select pg_temp.check(not exists (select 1 from private.admin_passkeys where credential_id = 'cred-ada-11'), 'the 11th passkey exists');
select pg_temp.check(jsonb_array_length(pg_temp.st('e7e7e7e7-0000-0000-0000-000000000001', null) -> 'passkeys') = 10, 'pk_state does not list 10 passkeys');
select pg_temp.check(not (pg_temp.st('e7e7e7e7-0000-0000-0000-000000000001', null)::text like '%public_key%' or pg_temp.st('e7e7e7e7-0000-0000-0000-000000000001', null)::text like '%credential_id%' or pg_temp.st('e7e7e7e7-0000-0000-0000-000000000001', null)::text like '%pk-cred%'), 'pk_state shows credential material');
-- lists are per user
select pg_temp.check(jsonb_array_length(pg_temp.svc($$select public.pk_credentials('e7e7e7e7-0000-0000-0000-000000000001')::text$$)::jsonb) = 10, 'pk_credentials does not list 10');
select pg_temp.check(jsonb_array_length(pg_temp.svc($$select public.pk_credentials('e7e7e7e7-0000-0000-0000-000000000002')::text$$)::jsonb) = 1, 'Bo''s credential list is wrong');
select pg_temp.check(pg_temp.svc($$select public.pk_credential('e7e7e7e7-0000-0000-0000-000000000002', 'cred-ada-1')::text$$) is null, 'Bo looked up Ada''s credential');
select pg_temp.check((pg_temp.svc($$select public.pk_credential('e7e7e7e7-0000-0000-0000-000000000001', 'cred-ada-1')::text$$)::jsonb ->> 'public_key') = 'pk-cred-ada-1', 'Ada could not look up her credential');
-- the counter rule
create temp table t_ctr (k text primary key, v text);
select pg_temp.check(pg_temp.svc(format($$select public.pk_use_counter(%L, 0)$$, pg_temp.cred_id('cred-ada-1')))::boolean, 'a 0 -> 0 counter (synced passkey) was refused');
select pg_temp.check((select last_used_at is not null from private.admin_passkeys where credential_id = 'cred-ada-1'), 'last_used_at was not set');
select pg_temp.check(pg_temp.svc(format($$select public.pk_use_counter(%L, 5)$$, pg_temp.cred_id('cred-ada-1')))::boolean, 'a counter 0 -> 5 was refused');
select pg_temp.check(not pg_temp.svc(format($$select public.pk_use_counter(%L, 5)$$, pg_temp.cred_id('cred-ada-1')))::boolean, 'a repeated counter was accepted (clone)');
select pg_temp.check(not pg_temp.svc(format($$select public.pk_use_counter(%L, 4)$$, pg_temp.cred_id('cred-ada-1')))::boolean, 'a lower counter was accepted (clone)');
select pg_temp.check(not pg_temp.svc(format($$select public.pk_use_counter(%L, 0)$$, pg_temp.cred_id('cred-ada-1')))::boolean, 'a counter back to 0 was accepted after it had grown');
select pg_temp.check(not pg_temp.svc(format($$select public.pk_use_counter(%L, -1)$$, pg_temp.cred_id('cred-ada-1')))::boolean, 'a negative counter was accepted');
select pg_temp.check((select counter = 5 from private.admin_passkeys where credential_id = 'cred-ada-1'), 'a refused counter changed the stored one');
select pg_temp.check(pg_temp.svc(format($$select public.pk_use_counter(%L, 6)$$, pg_temp.cred_id('cred-ada-1')))::boolean, 'a counter 5 -> 6 was refused');
select pg_temp.check(not pg_temp.svc($$select public.pk_use_counter(gen_random_uuid(), 1)$$)::boolean, 'a counter was accepted for an unknown passkey');
-- rename
select pg_temp.check(pg_temp.svc(format($$select public.pk_rename('e7e7e7e7-0000-0000-0000-000000000001', %L, 'Renamed')$$, pg_temp.cred_id('cred-ada-3')))::boolean, 'a rename was refused');
select pg_temp.check((select name = 'Renamed' from private.admin_passkeys where credential_id = 'cred-ada-3'), 'the name did not change');
select pg_temp.check(not pg_temp.svc(format($$select public.pk_rename('e7e7e7e7-0000-0000-0000-000000000001', %L, %L)$$, pg_temp.cred_id('cred-ada-3'), repeat('n', 41)))::boolean, 'a 41 character name was accepted on rename');
select pg_temp.check(not pg_temp.svc(format($$select public.pk_rename('e7e7e7e7-0000-0000-0000-000000000001', %L, '  ')$$, pg_temp.cred_id('cred-ada-3')))::boolean, 'a blank name was accepted on rename');
select pg_temp.check(not pg_temp.svc(format($$select public.pk_rename('e7e7e7e7-0000-0000-0000-000000000002', %L, 'Mine')$$, pg_temp.cred_id('cred-ada-3')))::boolean, 'Bo renamed Ada''s passkey');
-- removal: the session a passkey opened ends with it; the last one stays
select pg_temp.svc(format($$select public.pk_start_session('e7e7e7e7-0000-0000-0000-000000000001', 'e7e7e7e7-0000-0000-0000-0000000000a4', %L, 'passkey', 60)::text$$, pg_temp.cred_id('cred-ada-4')));
select pg_temp.check(pg_temp.is_admin_with('e7e7e7e7-0000-0000-0000-000000000001', pg_temp.claims_for('e7e7e7e7-0000-0000-0000-0000000000a4')), 'the session of passkey 4 was not admin');
select pg_temp.check(pg_temp.svc(format($$select public.pk_remove('e7e7e7e7-0000-0000-0000-000000000002', %L)$$, pg_temp.cred_id('cred-ada-4'))) = 'not_found', 'Bo removed Ada''s passkey');
select pg_temp.check(pg_temp.svc(format($$select public.pk_remove('e7e7e7e7-0000-0000-0000-000000000001', %L)$$, pg_temp.cred_id('cred-ada-4'))) = 'ok', 'a passkey could not be removed');
select pg_temp.check(not pg_temp.is_admin_with('e7e7e7e7-0000-0000-0000-000000000001', pg_temp.claims_for('e7e7e7e7-0000-0000-0000-0000000000a4')), 'the session of a removed passkey stayed admin');
select pg_temp.check(pg_temp.svc($$select public.pk_remove('e7e7e7e7-0000-0000-0000-000000000001', gen_random_uuid())$$) = 'not_found', 'removing a missing passkey did not say not_found');
select pg_temp.check(pg_temp.svc(format($$select public.pk_remove('e7e7e7e7-0000-0000-0000-000000000002', %L)$$, pg_temp.cred_id('cred-bo-1'))) = 'last', 'the last passkey was removed');
select pg_temp.check((select count(*) = 1 from private.admin_passkeys where user_id = 'e7e7e7e7-0000-0000-0000-000000000002'), 'Bo lost his only passkey');
do $d$ begin for i in 2..10 loop
  perform pg_temp.svc(format($$select public.pk_remove('e7e7e7e7-0000-0000-0000-000000000001', %L)$$, pg_temp.cred_id('cred-ada-' || i)));
end loop; end $d$;
select pg_temp.check((select count(*) = 1 from private.admin_passkeys where user_id = 'e7e7e7e7-0000-0000-0000-000000000001'), 'Ada should be down to one passkey');
select pg_temp.check(pg_temp.svc(format($$select public.pk_remove('e7e7e7e7-0000-0000-0000-000000000001', %L)$$, (select id from private.admin_passkeys where user_id = 'e7e7e7e7-0000-0000-0000-000000000001'))) = 'last', 'Ada removed her last passkey');

-- =============================================================================================================== P7 recovery codes
\echo '--- P7 recovery codes: ten, replaced together, single use, locked per session and per user'
create or replace function pg_temp.ten(p_prefix text) returns text[] language sql as $$
  select array_agg(pg_temp.hash_of(p_prefix || lpad(i::text, 12, '0'))) from generate_series(1, 10) i $$;
-- a fresh Supabase session for Ada, and the answer of pk_use_recovery_code
create or replace function pg_temp.rsession(n integer) returns uuid language plpgsql as $$
declare v uuid := ('e7e7e7e7-0000-0000-0000-0000000001' || lpad(n::text, 2, '0'))::uuid;
begin insert into auth.sessions (id, user_id) values (v, 'e7e7e7e7-0000-0000-0000-000000000001') on conflict do nothing; return v; end $$;
create or replace function pg_temp.rc(p_user uuid, p_session uuid, p_hash text) returns text language sql as $$
  select (pg_temp.svc(format('select public.pk_use_recovery_code(%L, %L, %L)::text', p_user, p_session, p_hash))::jsonb) ->> 'status' $$;
select pg_temp.fails_as('service_role', null, format($$select public.pk_replace_recovery_codes('e7e7e7e7-0000-0000-0000-000000000001', %L)$$, (pg_temp.ten('AAAA'))[1:9]), 'nine codes were stored');
select pg_temp.fails_as('service_role', null, format($$select public.pk_replace_recovery_codes('e7e7e7e7-0000-0000-0000-000000000001', %L)$$, array_cat(pg_temp.ten('AAAA'), array[pg_temp.hash_of('X')])), 'eleven codes were stored');
select pg_temp.fails_as('service_role', null, format($$select public.pk_replace_recovery_codes('e7e7e7e7-0000-0000-0000-000000000001', %L)$$, array_fill(pg_temp.hash_of('SAME'), array[10])), 'ten identical codes were stored');
select pg_temp.fails_as('service_role', null, format($$select public.pk_replace_recovery_codes('e7e7e7e7-0000-0000-0000-000000000001', %L)$$, array_fill('plain-text-code'::text, array[10])), 'codes that are not hashes were stored');
select pg_temp.fails_as('service_role', null, format($$select public.pk_replace_recovery_codes('e7e7e7e7-0000-0000-0000-000000000003', %L)$$, pg_temp.ten('CCCC')), 'a normal user got recovery codes');
select pg_temp.check((select count(*) = 0 from private.admin_recovery_codes where user_id = 'e7e7e7e7-0000-0000-0000-000000000001'), 'a refused call stored codes');
select pg_temp.check(pg_temp.svc(format($$select public.pk_replace_recovery_codes('e7e7e7e7-0000-0000-0000-000000000001', %L)$$, pg_temp.ten('AAAA')))::int = 10, 'ten codes were not stored');
select pg_temp.check((pg_temp.st('e7e7e7e7-0000-0000-0000-000000000001', null) ->> 'recovery_codes_left')::int = 10, 'pk_state does not count 10 codes');
select pg_temp.check(not exists (select 1 from private.admin_recovery_codes where code_hash !~ '^[0-9a-f]{64}$'), 'a recovery code is not stored as a hash');
select pg_temp.check(pg_temp.rc('e7e7e7e7-0000-0000-0000-000000000002', pg_temp.rsession(1), (pg_temp.ten('AAAA'))[1]) = 'bad', 'Bo used Ada''s recovery code');
-- using a code starts the 30 minute recovery session in the same step
select pg_temp.check(pg_temp.rc('e7e7e7e7-0000-0000-0000-000000000001', pg_temp.rsession(2), (pg_temp.ten('AAAA'))[1]) = 'ok', 'a recovery code did not work');
select pg_temp.check((select via = 'recovery' and passkey_id is null and step_up_until is null and expires_at <= now() + interval '30 minutes' and expires_at > now() + interval '29 minutes'
                        from private.admin_passkey_sessions where session_id = pg_temp.rsession(2)), 'the code did not start a 30 minute recovery session');
select pg_temp.check(pg_temp.rc('e7e7e7e7-0000-0000-0000-000000000001', pg_temp.rsession(3), (pg_temp.ten('AAAA'))[1]) = 'bad', 'a recovery code worked twice');
select pg_temp.check(not exists (select 1 from private.admin_passkey_sessions where session_id = pg_temp.rsession(3)), 'a refused code started a session');
select pg_temp.check((pg_temp.st('e7e7e7e7-0000-0000-0000-000000000001', null) ->> 'recovery_codes_left')::int = 9, 'pk_state does not count 9 codes after one use');
-- on a session already verified by a passkey nothing is used up
insert into private.admin_passkey_sessions (session_id, user_id, passkey_id, via, expires_at) values (pg_temp.rsession(4), 'e7e7e7e7-0000-0000-0000-000000000001', pg_temp.cred_id('cred-ada-1'), 'passkey', now() + interval '1 hour');
select pg_temp.check(pg_temp.rc('e7e7e7e7-0000-0000-0000-000000000001', pg_temp.rsession(4), (pg_temp.ten('AAAA'))[5]) = 'already', 'a passkey-verified session burned a recovery code');
select pg_temp.check((pg_temp.st('e7e7e7e7-0000-0000-0000-000000000001', null) ->> 'recovery_codes_left')::int = 9, 'a code was used up on a passkey session');
delete from private.admin_passkey_sessions where session_id = pg_temp.rsession(4);
-- new codes replace all old ones
select pg_temp.check(pg_temp.svc(format($$select public.pk_replace_recovery_codes('e7e7e7e7-0000-0000-0000-000000000001', %L)$$, pg_temp.ten('BBBB')))::int = 10, 'ten new codes were not stored');
select pg_temp.check((select count(*) = 10 from private.admin_recovery_codes where user_id = 'e7e7e7e7-0000-0000-0000-000000000001'), 'old codes are still stored');
select pg_temp.check(pg_temp.rc('e7e7e7e7-0000-0000-0000-000000000001', pg_temp.rsession(5), (pg_temp.ten('AAAA'))[2]) = 'bad', 'an old recovery code worked after the codes were replaced');
select pg_temp.check((pg_temp.st('e7e7e7e7-0000-0000-0000-000000000001', null) ->> 'recovery_codes_left')::int = 10, 'the new codes are not all unused');
select pg_temp.check(pg_temp.svc(format($$select public.pk_replace_recovery_codes('e7e7e7e7-0000-0000-0000-000000000002', %L)$$, pg_temp.ten('DDDD')))::int = 10, 'Bo could not get codes');
select pg_temp.check((select count(*) = 10 from private.admin_recovery_codes where user_id = 'e7e7e7e7-0000-0000-0000-000000000001'), 'Bo''s codes replaced Ada''s');
-- the lock: five wrong codes from ONE session lock that session (even for a right code); other sessions are not locked
delete from private.admin_passkey_events where user_id = 'e7e7e7e7-0000-0000-0000-000000000001';
do $d$ begin for i in 1..5 loop
  if pg_temp.rc('e7e7e7e7-0000-0000-0000-000000000001', pg_temp.rsession(6), pg_temp.hash_of('WRONG' || i)) <> 'bad' then raise exception 'ASSERT FAILED: wrong code % was not "bad"', i; end if;
end loop; end $d$;
select pg_temp.check((pg_temp.st('e7e7e7e7-0000-0000-0000-000000000001', pg_temp.rsession(6)) ->> 'locked')::boolean, 'five wrong codes did not lock the session');
select pg_temp.check(not (pg_temp.st('e7e7e7e7-0000-0000-0000-000000000001', pg_temp.rsession(7)) ->> 'locked')::boolean, 'one session''s failures locked another session');
select pg_temp.check(pg_temp.rc('e7e7e7e7-0000-0000-0000-000000000001', pg_temp.rsession(6), pg_temp.hash_of('WRONG6')) = 'locked', 'a sixth wrong code was not "locked"');
select pg_temp.check(pg_temp.rc('e7e7e7e7-0000-0000-0000-000000000001', pg_temp.rsession(6), (pg_temp.ten('BBBB'))[3]) = 'locked', 'a locked session could use a right recovery code');
select pg_temp.check((select count(*) = 10 from private.admin_recovery_codes where user_id = 'e7e7e7e7-0000-0000-0000-000000000001' and used_at is null), 'a locked attempt used up a code');
-- the lock ends after an hour
update private.admin_passkey_events set created_at = now() - interval '2 hours' where user_id = 'e7e7e7e7-0000-0000-0000-000000000001';
select pg_temp.check(pg_temp.rc('e7e7e7e7-0000-0000-0000-000000000001', pg_temp.rsession(6), (pg_temp.ten('BBBB'))[3]) = 'ok', 'the lock did not end after an hour');


-- =============================================================================================================== P8 audit trail
\echo '--- P8 notes: security events and the audit log, never a code or a credential'
select pg_temp.svc($$select public.pk_note('e7e7e7e7-0000-0000-0000-000000000001', 'passkey_added', '{"name":"Ada phone","code":"SECRETCODE123","credential_id":"cred-secret","public_key":"PUBKEYSECRET","challenge":"CHALSECRET","nested":{"a":1}}'::jsonb)$$);
select pg_temp.check(exists (select 1 from public.security_events where user_id = 'e7e7e7e7-0000-0000-0000-000000000001' and kind = 'admin_passkey_added' and details ->> 'name' = 'Ada phone'), 'the security event was not written');
select pg_temp.check(exists (select 1 from public.audit_log where admin_id = 'e7e7e7e7-0000-0000-0000-000000000001' and action = 'admin_passkey_added' and target_user = 'e7e7e7e7-0000-0000-0000-000000000001'), 'the audit row was not written');
select pg_temp.check(not exists (select 1 from public.audit_log where details::text ~* 'SECRETCODE|cred-secret|PUBKEYSECRET|CHALSECRET|nested'), 'a secret reached the audit log');
select pg_temp.check(not exists (select 1 from public.security_events where details::text ~* 'SECRETCODE|cred-secret|PUBKEYSECRET|CHALSECRET|nested'), 'a secret reached the security events');
select pg_temp.svc(format($$select public.pk_note('e7e7e7e7-0000-0000-0000-000000000001', %L, '{}'::jsonb)$$, k)) from unnest(array['setup', 'passkey_removed', 'passkey_renamed', 'passkey_login', 'recovery_used', 'recovery_generated', 'login_failed']) k;
select pg_temp.check((select count(distinct kind) = 8 from public.security_events where user_id = 'e7e7e7e7-0000-0000-0000-000000000001' and kind in ('admin_setup', 'admin_passkey_added', 'admin_passkey_removed', 'admin_passkey_renamed', 'admin_passkey_login', 'admin_recovery_used', 'admin_recovery_generated', 'admin_login_failed')), 'a note kind did not reach the security events');
select pg_temp.fails_as('service_role', null, $$select public.pk_note('e7e7e7e7-0000-0000-0000-000000000001', 'made_up_kind', '{}'::jsonb)$$, 'an unknown note kind was written');
select pg_temp.fails_as('service_role', null, $$select public.pk_note('e7e7e7e7-0000-0000-0000-000000000001', 'admin_granted', '{}'::jsonb)$$, 'a note forged another audit kind');
select pg_temp.check(not exists (select 1 from public.security_events where details::text ~* 'WRONG[0-9]'), 'a recovery code reached the security events');
-- a setup code issue and a reset are audited by the database
select pg_temp.check(exists (select 1 from public.audit_log where action = 'admin_setup_code_issued' and target_user = 'e7e7e7e7-0000-0000-0000-000000000001'), 'issuing a setup code was not audited');
select pg_temp.check(not exists (select 1 from public.audit_log l, t_ids t where t.k like 'code_%' and l.details::text like '%' || t.v || '%'), 'a setup code reached the audit log');

-- =============================================================================================================== P9 break-glass
\echo '--- P9 break-glass: list admins, reset passkeys'
select pg_temp.check((select count(*) >= 3 from private.list_admins() where email in ('ada-pk@example.com', 'bo-pk@example.com', 'di-pk@example.com')), 'list_admins misses an admin');
select pg_temp.check(not exists (select 1 from private.list_admins() where email = 'cy-pk@example.com'), 'list_admins shows a normal user');
select pg_temp.check((select passkeys = 1 from private.list_admins() where email = 'ada-pk@example.com'), 'list_admins does not count the passkeys');
select pg_temp.fails($$select private.reset_admin_passkeys('cy-pk@example.com')$$, 'a normal user was reset');
select pg_temp.fails($$select private.reset_admin_passkeys('nobody@example.com')$$, 'nobody was reset');
insert into private.admin_passkey_sessions (session_id, user_id, via, expires_at) values ('e7e7e7e7-0000-0000-0000-0000000000b1', 'e7e7e7e7-0000-0000-0000-000000000001', 'recovery', now() + interval '20 minutes');
select pg_temp.svc($$select public.pk_new_challenge('e7e7e7e7-0000-0000-0000-000000000001', 'e7e7e7e7-0000-0000-0000-0000000000b1', 'login', 'challenge-reset-abcdefghijklmnop')::text$$);
select pg_temp.check(private.reset_admin_passkeys('ADA-pk@example.com') like 'reset: 1 passkey(s) removed%', 'the reset did not report the passkeys removed');
select pg_temp.check(not exists (select 1 from private.admin_passkeys where user_id = 'e7e7e7e7-0000-0000-0000-000000000001')
                 and not exists (select 1 from private.admin_passkey_sessions where user_id = 'e7e7e7e7-0000-0000-0000-000000000001')
                 and not exists (select 1 from private.admin_recovery_codes where user_id = 'e7e7e7e7-0000-0000-0000-000000000001')
                 and not exists (select 1 from private.admin_setup_codes where user_id = 'e7e7e7e7-0000-0000-0000-000000000001')
                 and not exists (select 1 from private.admin_passkey_challenges where user_id = 'e7e7e7e7-0000-0000-0000-000000000001'), 'the reset left something behind');
select pg_temp.check(exists (select 1 from public.admins where user_id = 'e7e7e7e7-0000-0000-0000-000000000001'), 'the reset removed the admin');
select pg_temp.check(exists (select 1 from public.audit_log where action = 'admin_passkeys_reset' and target_user = 'e7e7e7e7-0000-0000-0000-000000000001'), 'the reset was not audited');
select pg_temp.check(pg_temp.status_with('e7e7e7e7-0000-0000-0000-000000000001', pg_temp.claims_for('e7e7e7e7-0000-0000-0000-0000000000b1')) = 'needs_setup', 'after the reset the admin was not "needs_setup"');
select pg_temp.check(not pg_temp.is_admin_with('e7e7e7e7-0000-0000-0000-000000000001', pg_temp.claims_for('e7e7e7e7-0000-0000-0000-0000000000b1')), 'a session survived the reset');
select pg_temp.check((select passkeys = 1 from private.list_admins() where email = 'bo-pk@example.com'), 'the reset touched Bo''s passkeys');
select pg_temp.check((select count(*) = 10 from private.admin_recovery_codes where user_id = 'e7e7e7e7-0000-0000-0000-000000000002'), 'the reset touched Bo''s recovery codes');
-- back in with a new setup code
insert into t_ids select 'code_ada2', private.new_admin_setup_code('ada-pk@example.com');
select pg_temp.check((select v <> (select v from t_ids where k = 'code_ada') from t_ids where k = 'code_ada2'), 'two setup codes were equal');
select pg_temp.check((select passkeys = 0 and setup_code_open from private.list_admins() where email = 'ada-pk@example.com'), 'list_admins does not show the open setup code');
select pg_temp.check(pg_temp.add_cred('e7e7e7e7-0000-0000-0000-000000000001', 'cred-ada-new', 'Ada new phone', (select v from t_ids where k = 'code_ada2')) = 'ok', 'Ada could not enrol again after the reset');

-- =============================================================================================================== P10 cleanup
\echo '--- P10 deleting an account removes everything about it'
select pg_temp.check(pg_temp.add_cred('e7e7e7e7-0000-0000-0000-000000000004', 'cred-di-x', 'Di', (select v from t_ids where k = 'code_di'), 'e7e7e7e7-0000-0000-0000-0000000000d1') = 'bad_setup_code', 'sanity (Di is still locked)');
update private.admin_passkey_events set created_at = now() - interval '2 hours' where user_id = 'e7e7e7e7-0000-0000-0000-000000000004';
select pg_temp.check(pg_temp.add_cred('e7e7e7e7-0000-0000-0000-000000000004', 'cred-di-1', 'Di phone', (select v from t_ids where k = 'code_di'), 'e7e7e7e7-0000-0000-0000-0000000000d1') = 'ok', 'Di could not enrol once the lock ended');
select pg_temp.svc(format($$select public.pk_start_session('e7e7e7e7-0000-0000-0000-000000000004', 'e7e7e7e7-0000-0000-0000-0000000000d1', %L, 'passkey', 60)::text$$, pg_temp.cred_id('cred-di-1')));
select pg_temp.svc($$select public.pk_new_challenge('e7e7e7e7-0000-0000-0000-000000000004', 'e7e7e7e7-0000-0000-0000-0000000000d1', 'login', 'challenge-di-abcdefghijklmnopqr')::text$$);
select pg_temp.svc(format($$select public.pk_replace_recovery_codes('e7e7e7e7-0000-0000-0000-000000000004', %L)$$, pg_temp.ten('EEEE')));
delete from public.admins where user_id = 'e7e7e7e7-0000-0000-0000-000000000004';
select pg_temp.check(not pg_temp.is_admin_with('e7e7e7e7-0000-0000-0000-000000000004', pg_temp.claims_for('e7e7e7e7-0000-0000-0000-0000000000d1')), 'a removed admin stayed admin through an old session');
delete from auth.users where id = 'e7e7e7e7-0000-0000-0000-000000000004';
select pg_temp.check(not exists (select 1 from private.admin_passkeys where user_id = 'e7e7e7e7-0000-0000-0000-000000000004')
                 and not exists (select 1 from private.admin_passkey_sessions where user_id = 'e7e7e7e7-0000-0000-0000-000000000004')
                 and not exists (select 1 from private.admin_passkey_challenges where user_id = 'e7e7e7e7-0000-0000-0000-000000000004')
                 and not exists (select 1 from private.admin_recovery_codes where user_id = 'e7e7e7e7-0000-0000-0000-000000000004')
                 and not exists (select 1 from private.admin_setup_codes where user_id = 'e7e7e7e7-0000-0000-0000-000000000004'), 'deleting the account left passkey data behind');

-- =============================================================================================================== P11 review fixes
\echo '--- P11a is_admin() also needs the Supabase session to exist; a garbage sub never raises'
insert into private.admin_passkey_sessions (session_id, user_id, via, expires_at) values ('e7e7e7e7-0000-0000-0000-0000000000a5', 'e7e7e7e7-0000-0000-0000-000000000001', 'passkey', now() + interval '1 hour');
select pg_temp.check(not pg_temp.is_admin_with('e7e7e7e7-0000-0000-0000-000000000001', pg_temp.claims_for('e7e7e7e7-0000-0000-0000-0000000000a5')), 'a passkey row without a Supabase session counted as admin');
insert into auth.sessions (id, user_id) values ('e7e7e7e7-0000-0000-0000-0000000000a5', 'e7e7e7e7-0000-0000-0000-000000000001');
select pg_temp.check(pg_temp.is_admin_with('e7e7e7e7-0000-0000-0000-000000000001', pg_temp.claims_for('e7e7e7e7-0000-0000-0000-0000000000a5')), 'a live session with a passkey row was not admin');
update auth.sessions set user_id = 'e7e7e7e7-0000-0000-0000-000000000002' where id = 'e7e7e7e7-0000-0000-0000-0000000000a5';
select pg_temp.check(not pg_temp.is_admin_with('e7e7e7e7-0000-0000-0000-000000000001', pg_temp.claims_for('e7e7e7e7-0000-0000-0000-0000000000a5')), 'a session of another user counted');
update auth.sessions set user_id = 'e7e7e7e7-0000-0000-0000-000000000001' where id = 'e7e7e7e7-0000-0000-0000-0000000000a5';
delete from auth.sessions where id = 'e7e7e7e7-0000-0000-0000-0000000000a5';
select pg_temp.check(not pg_temp.is_admin_with('e7e7e7e7-0000-0000-0000-000000000001', pg_temp.claims_for('e7e7e7e7-0000-0000-0000-0000000000a5')), 'a signed-out Supabase session stayed admin');
do $d$
declare r boolean;
begin
  perform set_config('request.jwt.claim.sub', 'not-a-uuid', true);
  perform set_config('request.jwt.claims', '{"session_id":"e7e7e7e7-0000-0000-0000-0000000000a5"}', true);
  set local role authenticated;
  r := public.is_admin();
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  if r is distinct from false then raise exception 'ASSERT FAILED: a garbage sub counted as admin (or raised)'; end if;
end $d$;
delete from private.admin_passkey_sessions where session_id = 'e7e7e7e7-0000-0000-0000-0000000000a5';

\echo '--- P11b step-up: a fresh passkey proof lasts 5 minutes, passkey sessions only'
select pg_temp.svc(format($$select public.pk_start_session('e7e7e7e7-0000-0000-0000-000000000001', 'e7e7e7e7-0000-0000-0000-0000000000a3', %L, 'passkey', 60)::text$$, pg_temp.cred_id('cred-ada-new')));
select pg_temp.check((pg_temp.st('e7e7e7e7-0000-0000-0000-000000000001', 'e7e7e7e7-0000-0000-0000-0000000000a3') ->> 'step_up')::boolean, 'a new passkey session has no fresh step-up');
update private.admin_passkey_sessions set step_up_until = now() - interval '1 second' where session_id = 'e7e7e7e7-0000-0000-0000-0000000000a3';
select pg_temp.check(not (pg_temp.st('e7e7e7e7-0000-0000-0000-000000000001', 'e7e7e7e7-0000-0000-0000-0000000000a3') ->> 'step_up')::boolean, 'an old step-up still counted');
select pg_temp.check(pg_temp.svc($$select public.pk_set_step_up('e7e7e7e7-0000-0000-0000-000000000001', 'e7e7e7e7-0000-0000-0000-0000000000a3')::text$$) is not null, 'step-up could not be set');
select pg_temp.check((select step_up_until <= now() + interval '5 minutes' and step_up_until > now() + interval '4 minutes' from private.admin_passkey_sessions where session_id = 'e7e7e7e7-0000-0000-0000-0000000000a3'), 'step-up is not 5 minutes');
select pg_temp.check(pg_temp.svc($$select public.pk_set_step_up('e7e7e7e7-0000-0000-0000-000000000002', 'e7e7e7e7-0000-0000-0000-0000000000a3')::text$$) is null, 'another admin set the step-up of Ada''s session');
select pg_temp.check(pg_temp.svc($$select public.pk_set_step_up('e7e7e7e7-0000-0000-0000-000000000001', gen_random_uuid())::text$$) is null, 'step-up on a missing session');
update private.admin_passkey_sessions set via = 'recovery', passkey_id = null, step_up_until = null where session_id = 'e7e7e7e7-0000-0000-0000-0000000000a3';
select pg_temp.check(pg_temp.svc($$select public.pk_set_step_up('e7e7e7e7-0000-0000-0000-000000000001', 'e7e7e7e7-0000-0000-0000-0000000000a3')::text$$) is null, 'a recovery session got a step-up');
select pg_temp.svc($$select public.pk_new_challenge('e7e7e7e7-0000-0000-0000-000000000001', 'e7e7e7e7-0000-0000-0000-0000000000a3', 'stepup', 'challenge-step-abcdefghijklmnop')::text$$);
select pg_temp.check(pg_temp.svc($$select public.pk_take_challenge('e7e7e7e7-0000-0000-0000-000000000001', 'e7e7e7e7-0000-0000-0000-0000000000a3', 'login')$$) is null, 'a step-up challenge was taken as login');
select pg_temp.check(pg_temp.svc($$select public.pk_take_challenge('e7e7e7e7-0000-0000-0000-000000000001', 'e7e7e7e7-0000-0000-0000-0000000000a3', 'stepup')$$) = 'challenge-step-abcdefghijklmnop', 'the step-up challenge was not returned');
delete from private.admin_passkey_sessions where session_id = 'e7e7e7e7-0000-0000-0000-0000000000a3';

\echo '--- P11c lock-outs: 5 per session, 20 per user, a verified session is held back only by its own failures'
create or replace function pg_temp.locked(p_user uuid, p_session uuid) returns boolean language sql as $$ select (pg_temp.st(p_user, p_session) ->> 'locked')::boolean $$;
create or replace function pg_temp.fail_n(p_user uuid, p_session uuid, n integer) returns void language plpgsql as $$
begin for i in 1..n loop perform pg_temp.svc(format($q$select public.pk_note(%L, 'login_failed', '{}'::jsonb, %L)$q$, p_user, p_session)); end loop; end $$;
delete from private.admin_passkey_events where user_id = 'e7e7e7e7-0000-0000-0000-000000000001';
select pg_temp.fail_n('e7e7e7e7-0000-0000-0000-000000000001', 'e7e7e7e7-0000-0000-0000-0000000000a1', 4);
select pg_temp.check(not pg_temp.locked('e7e7e7e7-0000-0000-0000-000000000001', 'e7e7e7e7-0000-0000-0000-0000000000a1'), 'locked after 4 failures');
select pg_temp.fail_n('e7e7e7e7-0000-0000-0000-000000000001', 'e7e7e7e7-0000-0000-0000-0000000000a1', 1);
select pg_temp.check(pg_temp.locked('e7e7e7e7-0000-0000-0000-000000000001', 'e7e7e7e7-0000-0000-0000-0000000000a1'), 'five failures did not lock the session');
select pg_temp.check(not pg_temp.locked('e7e7e7e7-0000-0000-0000-000000000001', 'e7e7e7e7-0000-0000-0000-0000000000a2'), 'one attacker session locked the others');
select pg_temp.check(not pg_temp.locked('e7e7e7e7-0000-0000-0000-000000000002', 'e7e7e7e7-0000-0000-0000-0000000000a1'), 'the lock leaked to another user');
-- the per-user budget: 20 failures spread over sessions
select pg_temp.fail_n('e7e7e7e7-0000-0000-0000-000000000001', pg_temp.rsession(20 + i), 3) from generate_series(1, 4) i;
select pg_temp.fail_n('e7e7e7e7-0000-0000-0000-000000000001', pg_temp.rsession(25), 2);
select pg_temp.check(not pg_temp.locked('e7e7e7e7-0000-0000-0000-000000000001', 'e7e7e7e7-0000-0000-0000-0000000000a2'), 'locked at 20 minus one');
select pg_temp.fail_n('e7e7e7e7-0000-0000-0000-000000000001', pg_temp.rsession(30), 1);
select pg_temp.check(pg_temp.locked('e7e7e7e7-0000-0000-0000-000000000001', 'e7e7e7e7-0000-0000-0000-0000000000a2'), 'twenty failures did not lock the user');
select pg_temp.check(pg_temp.locked('e7e7e7e7-0000-0000-0000-000000000001', null), 'a missing session is not held to the user limit');
-- a session that is already verified is not blocked by the others' failures, only by its own
insert into private.admin_passkey_sessions (session_id, user_id, passkey_id, via, expires_at) values ('e7e7e7e7-0000-0000-0000-0000000000a4', 'e7e7e7e7-0000-0000-0000-000000000001', pg_temp.cred_id('cred-ada-new'), 'passkey', now() + interval '1 hour');
select pg_temp.check(not pg_temp.locked('e7e7e7e7-0000-0000-0000-000000000001', 'e7e7e7e7-0000-0000-0000-0000000000a4'), 'strangers failures locked a verified session');
select pg_temp.fail_n('e7e7e7e7-0000-0000-0000-000000000001', 'e7e7e7e7-0000-0000-0000-0000000000a4', 5);
select pg_temp.check(pg_temp.locked('e7e7e7e7-0000-0000-0000-000000000001', 'e7e7e7e7-0000-0000-0000-0000000000a4'), 'a verified session is not held back by its own failures');
delete from private.admin_passkey_sessions where session_id = 'e7e7e7e7-0000-0000-0000-0000000000a4';
-- the break-glass functions clear it
select pg_temp.check(pg_temp.locked('e7e7e7e7-0000-0000-0000-000000000001', 'e7e7e7e7-0000-0000-0000-0000000000a2'), 'precondition: locked');
select private.new_admin_setup_code('ada-pk@example.com') is not null;
select pg_temp.check(not pg_temp.locked('e7e7e7e7-0000-0000-0000-000000000001', 'e7e7e7e7-0000-0000-0000-0000000000a2') and not pg_temp.locked('e7e7e7e7-0000-0000-0000-000000000001', 'e7e7e7e7-0000-0000-0000-0000000000a1'), 'a new setup code did not clear the lock-out');
select pg_temp.fail_n('e7e7e7e7-0000-0000-0000-000000000001', 'e7e7e7e7-0000-0000-0000-0000000000a1', 5);
select pg_temp.check(pg_temp.locked('e7e7e7e7-0000-0000-0000-000000000001', 'e7e7e7e7-0000-0000-0000-0000000000a1'), 'precondition 2: locked');
delete from private.admin_passkey_events where user_id = 'e7e7e7e7-0000-0000-0000-000000000002';
select pg_temp.fail_n('e7e7e7e7-0000-0000-0000-000000000002', 'e7e7e7e7-0000-0000-0000-0000000000a1', 2);
-- (Ada's passkeys are reset in the next block; this only checks the lock-out part)
create temp table t_lock as select count(*) as n from private.admin_passkey_events where user_id = 'e7e7e7e7-0000-0000-0000-000000000001';
select private.reset_admin_passkeys('ada-pk@example.com') is not null;
select pg_temp.check(not exists (select 1 from private.admin_passkey_events where user_id = 'e7e7e7e7-0000-0000-0000-000000000001'), 'the reset did not clear the lock-out');
select pg_temp.check((select count(*) = 2 from private.admin_passkey_events where user_id = 'e7e7e7e7-0000-0000-0000-000000000002'), 'the reset cleared another admin');
select pg_temp.check(not pg_temp.locked('e7e7e7e7-0000-0000-0000-000000000001', 'e7e7e7e7-0000-0000-0000-0000000000a1'), 'still locked after the reset');

\echo '--- P11d open_admin_session: the founder opens the newest session when the function is down'
delete from auth.sessions where user_id = 'e7e7e7e7-0000-0000-0000-000000000001';
select pg_temp.fails($$select private.open_admin_session('ada-pk@example.com')$$, 'a session was opened with no signed-in session');
insert into auth.sessions (id, user_id, created_at) values
  ('e7e7e7e7-0000-0000-0000-0000000000e1', 'e7e7e7e7-0000-0000-0000-000000000001', now() - interval '2 hours'),
  ('e7e7e7e7-0000-0000-0000-0000000000e2', 'e7e7e7e7-0000-0000-0000-000000000001', now() - interval '1 minute');
select pg_temp.fails($$select private.open_admin_session('cy-pk@example.com')$$, 'a normal user got an admin session');
select pg_temp.fails($$select private.open_admin_session('nobody@example.com')$$, 'nobody got an admin session');
select pg_temp.check(private.open_admin_session('ADA-pk@example.com', 999) like 'session opened for 30 minute%', 'the minutes were not capped at 30');
select pg_temp.check((select via = 'recovery' and passkey_id is null and expires_at <= now() + interval '30 minutes' from private.admin_passkey_sessions where session_id = 'e7e7e7e7-0000-0000-0000-0000000000e2'), 'the newest session was not marked as a recovery session');
select pg_temp.check(not exists (select 1 from private.admin_passkey_sessions where session_id = 'e7e7e7e7-0000-0000-0000-0000000000e1'), 'an older session was opened');
select pg_temp.check(pg_temp.is_admin_with('e7e7e7e7-0000-0000-0000-000000000001', pg_temp.claims_for('e7e7e7e7-0000-0000-0000-0000000000e2')), 'the opened session is not admin');
select pg_temp.check(not pg_temp.is_admin_with('e7e7e7e7-0000-0000-0000-000000000001', pg_temp.claims_for('e7e7e7e7-0000-0000-0000-0000000000e1')), 'the older session is admin');
select pg_temp.check(exists (select 1 from public.audit_log where action = 'admin_session_opened' and target_user = 'e7e7e7e7-0000-0000-0000-000000000001'), 'opening a session was not audited');
select private.open_admin_session('ada-pk@example.com', 0);
select pg_temp.check((select expires_at <= now() + interval '1 minute 5 seconds' from private.admin_passkey_sessions where session_id = 'e7e7e7e7-0000-0000-0000-0000000000e2'), 'zero minutes was not raised to 1');
delete from private.admin_passkey_sessions where user_id = 'e7e7e7e7-0000-0000-0000-000000000001';

\echo '--- P11e failures and audit need no profile; revoke_admin wipes the passkey data'
select pg_temp.new_user('e7e7e7e7-0000-0000-0000-000000000005', 'ed-pk@example.com', 'owner');
select pg_temp.make_admin('e7e7e7e7-0000-0000-0000-000000000005');
delete from public.profiles where id = 'e7e7e7e7-0000-0000-0000-000000000005';
insert into auth.sessions (id, user_id) values ('e7e7e7e7-0000-0000-0000-0000000000f5', 'e7e7e7e7-0000-0000-0000-000000000005');
select pg_temp.fail_n('e7e7e7e7-0000-0000-0000-000000000005', 'e7e7e7e7-0000-0000-0000-0000000000f5', 5);
select pg_temp.check(pg_temp.locked('e7e7e7e7-0000-0000-0000-000000000005', 'e7e7e7e7-0000-0000-0000-0000000000f5'), 'an admin without a profile cannot be locked');
select pg_temp.check((select count(*) = 5 from public.audit_log where action = 'admin_login_failed' and target_user = 'e7e7e7e7-0000-0000-0000-000000000005'), 'failures of an admin without a profile were not audited');
select pg_temp.check(pg_temp.rc('e7e7e7e7-0000-0000-0000-000000000005', 'e7e7e7e7-0000-0000-0000-0000000000f5', pg_temp.hash_of('X')) = 'locked', 'a locked admin without a profile was not locked');
insert into t_ids select 'code_ed', private.new_admin_setup_code('ed-pk@example.com');
select pg_temp.check(pg_temp.add_cred('e7e7e7e7-0000-0000-0000-000000000005', 'cred-ed-1', 'Ed', (select v from t_ids where k = 'code_ed')) = 'ok', 'an admin without a profile could not enrol');
select pg_temp.check(exists (select 1 from public.profiles where id = 'e7e7e7e7-0000-0000-0000-000000000001'), 'sanity: Ada still has a profile');
-- invited admins do get a profile (0013 invite path) and grant_admin keeps it
select private.invite_admin('gus-pk@example.com');
insert into auth.users (id, email, email_confirmed_at, created_at) values ('e7e7e7e7-0000-0000-0000-000000000006', 'gus-pk@example.com', now(), now());
select pg_temp.check(private.grant_admin('gus-pk@example.com') = 'granted', 'an invited admin could not be granted');
select pg_temp.check(exists (select 1 from public.profiles where id = 'e7e7e7e7-0000-0000-0000-000000000006'), 'an invited admin has no profile');
-- revoke_admin
select pg_temp.check(pg_temp.add_cred('e7e7e7e7-0000-0000-0000-000000000006', 'cred-gus-1', 'Gus', null) = 'ok', 'Gus could not get a passkey');
select pg_temp.svc(format($$select public.pk_replace_recovery_codes('e7e7e7e7-0000-0000-0000-000000000006', %L)$$, pg_temp.ten('GGGG')));
insert into t_ids select 'code_gus', private.new_admin_setup_code('gus-pk@example.com');
insert into auth.sessions (id, user_id) values ('e7e7e7e7-0000-0000-0000-0000000000f6', 'e7e7e7e7-0000-0000-0000-000000000006');
insert into private.admin_passkey_sessions (session_id, user_id, via, expires_at) values ('e7e7e7e7-0000-0000-0000-0000000000f6', 'e7e7e7e7-0000-0000-0000-000000000006', 'passkey', now() + interval '1 hour');
select pg_temp.fail_n('e7e7e7e7-0000-0000-0000-000000000006', 'e7e7e7e7-0000-0000-0000-0000000000f6', 1);
select pg_temp.check(pg_temp.is_admin_with('e7e7e7e7-0000-0000-0000-000000000006', pg_temp.claims_for('e7e7e7e7-0000-0000-0000-0000000000f6')), 'Gus was not admin before the revoke');
select pg_temp.check(private.revoke_admin('gus-pk@example.com') = 'revoked', 'revoke_admin did not answer revoked');
select pg_temp.check(not exists (select 1 from public.admins where user_id = 'e7e7e7e7-0000-0000-0000-000000000006')
                 and not exists (select 1 from private.admin_passkeys where user_id = 'e7e7e7e7-0000-0000-0000-000000000006')
                 and not exists (select 1 from private.admin_passkey_sessions where user_id = 'e7e7e7e7-0000-0000-0000-000000000006')
                 and not exists (select 1 from private.admin_recovery_codes where user_id = 'e7e7e7e7-0000-0000-0000-000000000006')
                 and not exists (select 1 from private.admin_setup_codes where user_id = 'e7e7e7e7-0000-0000-0000-000000000006')
                 and not exists (select 1 from private.admin_passkey_events where user_id = 'e7e7e7e7-0000-0000-0000-000000000006'), 'revoke_admin left passkey data behind');
select pg_temp.check(exists (select 1 from public.audit_log where action = 'admin_revoked' and target_user = 'e7e7e7e7-0000-0000-0000-000000000006'), 'revoke_admin was not audited');
select pg_temp.check(not pg_temp.is_admin_with('e7e7e7e7-0000-0000-0000-000000000006', pg_temp.claims_for('e7e7e7e7-0000-0000-0000-0000000000f6')), 'a revoked admin stayed admin');
select pg_temp.fails_as('authenticated', 'e7e7e7e7-0000-0000-0000-000000000003', $$select private.revoke_admin('ada-pk@example.com')$$, 'a user revoked an admin');
select pg_temp.fails_as('authenticated', 'e7e7e7e7-0000-0000-0000-000000000003', $$select private.open_admin_session('ada-pk@example.com')$$, 'a user opened an admin session');
select pg_temp.fails_as('service_role', null, $$select private.open_admin_session('ada-pk@example.com')$$, 'the service role opened an admin session');

\echo 'passkey assertions OK'
