-- Architecture v3 assertions: membership (paid up / due soon / paused), settings, payment claims, the founder's confirmation,
-- reminders, bookings without a fee, the map of availability and the clean-up list. Run AFTER the other assertion files
-- (or on its own) on the same database, with ON_ERROR_STOP=1. Uses its own people (f7f7f7f7-...-0000000000NN, see u(NN))
-- and does not depend on state left by the other files. Any failed assertion stops the run with "ASSERT FAILED".
\set ON_ERROR_STOP 1
\i supabase/tests/helpers.sql

create temp table t_ids (k text primary key, v text);
create or replace function pg_temp.u(n integer) returns uuid language sql immutable as $$ select ('f7f7f7f7-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
create or replace function pg_temp.state(p_uid uuid) returns jsonb language sql as $$
  select pg_temp.as_role('authenticated', p_uid, $q$select public.my_account_state()::text$q$)::jsonb $$;
-- A signed-up, approved and paid-up person (paid for 180 days). Roles: 'owner' or 'sitter'.
create or replace function pg_temp.person(n integer, p_role text, p_name text) returns void language plpgsql as $$
begin
  perform pg_temp.new_user(pg_temp.u(n), 'p' || n || '-b1@example.com', p_role);
  perform pg_temp.activate(pg_temp.u(n), p_name);
end $$;
-- Set paid_until to today + p_days (null = never paid).
create or replace function pg_temp.setpaid(n integer, p_days integer) returns void language sql as $$
  update public.memberships set paid_until = case when p_days is null then null else (now() at time zone 'Africa/Cairo')::date + p_days end where user_id = pg_temp.u(n) $$;
create or replace function pg_temp.mkpet(n integer, p_name text) returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into storage.objects (bucket_id, name) values ('pets', pg_temp.u(n)::text || '/' || lower(p_name) || '.jpg');
  insert into public.pets (owner_id, name, type, size, photo_paths) values (pg_temp.u(n), p_name, 'dog', 'medium', array[pg_temp.u(n)::text || '/' || lower(p_name) || '.jpg']) returning id into v_id;
  return v_id;
end $$;
create or replace function pg_temp.setloc(n integer, p_lat double precision, p_lng double precision) returns void language sql as $$
  select pg_temp.as_role('authenticated', pg_temp.u(n), format('select public.set_my_location(%s, %s, %L)', p_lat, p_lng, 'Secret street 1')) $$;
create or replace function pg_temp.avail(n integer, p_pets text, p_from integer, p_to integer) returns void language sql as $$
  insert into public.availability (user_id, starts_on, ends_on, pets_accepted, offers, price_per_night)
  values (pg_temp.u(n), (now() at time zone 'Africa/Cairo')::date + p_from, (now() at time zone 'Africa/Cairo')::date + p_to, p_pets::public.pet_type[], array['paid'], 100) $$;
-- Run a statement as a person and ignore a refusal (the check afterwards looks at what really changed).
create or replace function pg_temp.try_as(p_role text, p_uid uuid, p_sql text) returns void language plpgsql as $$
begin
  begin perform pg_temp.as_role(p_role, p_uid, p_sql); exception when others then null; end;
end $$;
create or replace function pg_temp.adm(p_sql text) returns text language sql as $$ select pg_temp.as_aal('aal2', pg_temp.u(5), p_sql) $$;
create or replace function pg_temp.fails_adm(p_sql text, p_msg text) returns void language sql as $$ select pg_temp.fails_aal('aal2', pg_temp.u(5), p_sql, p_msg) $$;
create or replace function pg_temp.claim_of(n integer) returns uuid language sql as $$ select id from public.payment_claims where user_id = pg_temp.u(n) and status = 'pending' $$;
-- What a caller sees of a target person: profile card / map / search / random browse, as a count each ("1/1/1/1" = fully visible).
create or replace function pg_temp.seen(p_caller integer, p_target integer) returns text language plpgsql as $$
declare c bigint; m bigint; s bigint; b bigint; t uuid := pg_temp.u(p_target);
begin
  c := pg_temp.count_as(pg_temp.u(p_caller), format('select count(*) from public.profile_cards where id = %L', t));
  m := pg_temp.count_as(pg_temp.u(p_caller), format('select count(*) from public.map_availability(null, 300) where user_id = %L', t));
  s := pg_temp.count_as(pg_temp.u(p_caller), format($q$select count(*) from public.search_stays((now() at time zone 'Africa/Cairo')::date + 2, (now() at time zone 'Africa/Cairo')::date + 5, 'other'::public.pet_type, 0, null::integer, '{}'::text[], false, null::double precision, null::double precision, 25::double precision, 100) where user_id = %L$q$, t));
  b := pg_temp.count_as(pg_temp.u(p_caller), format($q$select count(*) from public.browse_random('other'::public.pet_type, 60) where user_id = %L$q$, t));
  return c || '/' || m || '/' || s || '/' || b;
end $$;

-- 01 owner (Rex)   02 host H   03 owner O2 (Tom)   04 host H2   05 the founder (admin)
select pg_temp.person(1, 'owner', 'Olive');
select pg_temp.person(2, 'sitter', 'Hana');
select pg_temp.person(3, 'owner', 'Otto');
select pg_temp.person(4, 'sitter', 'Hugo');
select pg_temp.new_user(pg_temp.u(5), 'founder-b1@example.com', 'owner');
select pg_temp.make_admin(pg_temp.u(5));
select pg_temp.mkpet(1, 'Rex') as rex \gset
select pg_temp.mkpet(3, 'Tom') as tom \gset
select pg_temp.setloc(2, 28.4987654, 34.5123456);
select pg_temp.setloc(4, 28.52, 34.49);
select pg_temp.avail(2, '{dog,cat,other}', 1, 30);
select pg_temp.avail(4, '{dog,cat,other}', 1, 30);

\echo '--- M1 paid up, last day, paused: is_active, the account state, and who can see whom'
select pg_temp.person(10, 'sitter', 'Pia');         -- the paused-or-not host
select pg_temp.person(11, 'owner', 'Paco');         -- the paused-or-not owner
select pg_temp.mkpet(11, 'Pip') as pip \gset
select pg_temp.setloc(10, 28.51, 34.5);
select pg_temp.avail(10, '{other}', 1, 30);
-- approved but never paid
select pg_temp.setpaid(10, null);
select pg_temp.check(not public.is_active(pg_temp.u(10)), 'an approved but unpaid person is active');
select pg_temp.check(pg_temp.seen(1, 10) = '0/0/0/0', 'an unpaid host is visible to others: ' || pg_temp.seen(1, 10));
select pg_temp.check((pg_temp.state(pg_temp.u(10)) #>> '{membership,state}') = 'unpaid' and (pg_temp.state(pg_temp.u(10)) #>> '{membership,kind}') = 'registration' and (pg_temp.state(pg_temp.u(10)) #>> '{membership,amount_egp}') = '75', 'unpaid state');
-- paid for a long time
select pg_temp.setpaid(10, 100);
select pg_temp.check(public.is_active(pg_temp.u(10)), 'a paid-up person is not active');
select pg_temp.check(pg_temp.seen(1, 10) = '1/1/1/1', 'a paid-up host is not visible: ' || pg_temp.seen(1, 10));
select pg_temp.check((pg_temp.state(pg_temp.u(10)) #>> '{membership,state}') = 'active' and (pg_temp.state(pg_temp.u(10)) #>> '{membership,days_left}') = '100'
                 and (pg_temp.state(pg_temp.u(10)) #>> '{membership,amount_egp}') = '25' and (pg_temp.state(pg_temp.u(10)) #>> '{membership,kind}') = 'renewal', 'active state');
select pg_temp.setpaid(10, 8);
select pg_temp.check((pg_temp.state(pg_temp.u(10)) #>> '{membership,state}') = 'active' and (pg_temp.state(pg_temp.u(10)) #>> '{membership,days_left}') = '8', '8 days left is still plain active');
select pg_temp.setpaid(10, 7);
select pg_temp.check(public.is_active(pg_temp.u(10)) and (pg_temp.state(pg_temp.u(10)) #>> '{membership,state}') = 'due_soon' and (pg_temp.state(pg_temp.u(10)) #>> '{membership,days_left}') = '7' and (pg_temp.state(pg_temp.u(10)) #>> '{membership,amount_egp}') = '25', '7 days left is due_soon');
select pg_temp.check(pg_temp.seen(1, 10) = '1/1/1/1', 'a due-soon host is hidden');
-- the reminder window follows the setting
update public.app_settings set value = '10' where key = 'reminder_days';
select pg_temp.setpaid(10, 9);
select pg_temp.check((pg_temp.state(pg_temp.u(10)) #>> '{membership,state}') = 'due_soon', 'due_soon does not follow reminder_days');
update public.app_settings set value = '7' where key = 'reminder_days';
select pg_temp.check((pg_temp.state(pg_temp.u(10)) #>> '{membership,state}') = 'active', 'due_soon did not go back after reminder_days was restored');
-- the last day
select pg_temp.setpaid(10, 0);
select pg_temp.check(public.is_active(pg_temp.u(10)), 'the last paid day is not active');
select pg_temp.check((pg_temp.state(pg_temp.u(10)) #>> '{membership,state}') = 'due_soon' and (pg_temp.state(pg_temp.u(10)) #>> '{membership,days_left}') = '0', 'last day state');
select pg_temp.check(pg_temp.seen(1, 10) = '1/1/1/1', 'a host on the last paid day is hidden');
-- a conversation made while paid up
insert into t_ids select 'conv', pg_temp.as_role('authenticated', pg_temp.u(1), format('select public.start_conversation(%L)::text', pg_temp.u(10)));
select pg_temp.as_role('authenticated', pg_temp.u(10), format($$insert into public.messages (conversation_id, sender_id, body) values (%L, %L, 'hello while paid')$$, (select v from t_ids where k = 'conv'), pg_temp.u(10)));
-- the day after: paused
select pg_temp.setpaid(10, -1);
select pg_temp.setpaid(11, -1);
select pg_temp.check(not public.is_active(pg_temp.u(10)) and not public.is_active(pg_temp.u(11)), 'a lapsed person is still active');
select pg_temp.check((select status::text = 'active' from public.profiles where id = pg_temp.u(10)), 'the lapse should not change the approved status');
select pg_temp.check((pg_temp.state(pg_temp.u(10)) #>> '{membership,state}') = 'paused' and (pg_temp.state(pg_temp.u(10)) #>> '{membership,days_left}') = '-1'
                 and (pg_temp.state(pg_temp.u(10)) #>> '{membership,amount_egp}') = '25' and (pg_temp.state(pg_temp.u(10)) #>> '{membership,kind}') = 'renewal'
                 and (pg_temp.state(pg_temp.u(10)) ->> 'status') = 'active', 'paused state');
select pg_temp.check(pg_temp.seen(1, 10) = '0/0/0/0', 'a paused host is still visible to others: ' || pg_temp.seen(1, 10));
select pg_temp.check(pg_temp.count_as(pg_temp.u(10), 'select count(*) from public.profile_cards') = 0, 'a paused person still sees profile cards');
select pg_temp.check(pg_temp.count_as(pg_temp.u(10), 'select count(*) from public.search_stays((now() at time zone ''Africa/Cairo'')::date + 2, (now() at time zone ''Africa/Cairo'')::date + 5, ''other''::public.pet_type, 0, null::integer, ''{}''::text[], false, null::double precision, null::double precision, 25::double precision, 100)') = 0, 'a paused person still searches');
select pg_temp.check(pg_temp.count_as(pg_temp.u(11), 'select count(*) from public.browse_random(null, 60)') = 0, 'a paused person still browses');
select pg_temp.check(pg_temp.count_as(pg_temp.u(11), 'select count(*) from public.map_availability(null, 300)') = 0, 'a paused person still sees the map');
select pg_temp.fails_as('authenticated', pg_temp.u(10), format($$insert into public.messages (conversation_id, sender_id, body) values (%L, %L, 'hello while paused')$$, (select v from t_ids where k = 'conv'), pg_temp.u(10)), 'a paused person sent a message');
select pg_temp.fails_as('authenticated', pg_temp.u(10), format($$select public.start_conversation(%L)$$, pg_temp.u(1)), 'a paused person started a conversation');
select pg_temp.fails_as('authenticated', pg_temp.u(1), format($$select public.start_conversation(%L)$$, pg_temp.u(10)), 'someone started a conversation with a paused person');
select pg_temp.fails_as('authenticated', pg_temp.u(11), format($$select public.request_booking(%L, %L, (now() at time zone 'Africa/Cairo')::date + 50, (now() at time zone 'Africa/Cairo')::date + 52, 'sitter_home', 'volunteer', null, false)$$, pg_temp.u(2), :'pip'), 'a paused owner requested a booking');
select pg_temp.fails_as('authenticated', pg_temp.u(1), format($$select public.request_booking(%L, %L, (now() at time zone 'Africa/Cairo')::date + 50, (now() at time zone 'Africa/Cairo')::date + 52, 'sitter_home', 'volunteer', null, false)$$, pg_temp.u(10), :'rex'), 'a booking was requested from a paused host');
select pg_temp.check(not exists (select 1 from public.bookings where owner_id in (pg_temp.u(11)) or sitter_id = pg_temp.u(10)), 'a refused request left a booking');
-- paying again makes them visible again
select pg_temp.setpaid(10, 180);
select pg_temp.check(pg_temp.seen(1, 10) = '1/1/1/1', 'a renewed host is not visible again');
-- amounts follow the settings
update public.app_settings set value = '30' where key = 'renewal_fee_egp';
select pg_temp.setpaid(10, -5);
select pg_temp.check((pg_temp.state(pg_temp.u(10)) #>> '{membership,amount_egp}') = '30', 'the renewal amount does not follow the settings');
update public.app_settings set value = '25' where key = 'renewal_fee_egp';
select pg_temp.setpaid(10, 180);
-- the membership table is closed to writes and to other people's eyes
select pg_temp.fails_as('authenticated', pg_temp.u(10), format($$update public.memberships set paid_until = (now() at time zone 'Africa/Cairo')::date + 999 where user_id = %L$$, pg_temp.u(10)), 'a person extended their own membership');
select pg_temp.fails_as('authenticated', pg_temp.u(10), format($$insert into public.memberships (user_id, paid_until) values (%L, (now() at time zone 'Africa/Cairo')::date + 999) on conflict (user_id) do update set paid_until = excluded.paid_until$$, pg_temp.u(10)), 'a person upserted their own membership');
select pg_temp.fails_as('authenticated', pg_temp.u(10), format($$delete from public.memberships where user_id = %L$$, pg_temp.u(10)), 'a person deleted their own membership');
select pg_temp.check((select paid_until = (now() at time zone 'Africa/Cairo')::date + 180 from public.memberships where user_id = pg_temp.u(10)), 'a refused write changed the membership');
select pg_temp.check(pg_temp.count_as(pg_temp.u(10), 'select count(*) from public.memberships') = 1, 'a person should read only their own membership row');
select pg_temp.check(pg_temp.as_role('anon', null, 'select count(*) from public.memberships')::bigint = 0, 'anon read memberships');
select pg_temp.check(pg_temp.as_aal('aal2', pg_temp.u(5), 'select count(*) from public.memberships')::bigint >= 5, 'an admin cannot read memberships');
select pg_temp.check(pg_temp.as_aal('aal1', pg_temp.u(5), 'select count(*) from public.memberships')::bigint = 1, 'an admin without the authenticator code read other memberships');

\echo '--- M2 payment settings'
select pg_temp.check(pg_temp.as_role('authenticated', pg_temp.u(10), 'select count(*) from jsonb_object_keys(public.get_payment_settings())')::bigint = 11, 'get_payment_settings should have 11 keys');
select pg_temp.check(pg_temp.as_role('authenticated', pg_temp.u(10), 'select string_agg(k, '','' order by k) from jsonb_object_keys(public.get_payment_settings()) k') = 'bank_account_name,bank_account_number,bank_iban,bank_name,instapay_link,instapay_qr_url,membership_months,payment_note,registration_fee_egp,reminder_days,renewal_fee_egp', 'the payment setting keys are wrong');
select pg_temp.check((pg_temp.as_role('authenticated', pg_temp.u(10), $$select (public.get_payment_settings() ->> 'registration_fee_egp')$$)) = '75' and (pg_temp.as_role('authenticated', pg_temp.u(10), $$select (public.get_payment_settings() ->> 'renewal_fee_egp')$$)) = '25', 'default fees are not 75 and 25');
select pg_temp.check((select count(*) = 11 from public.app_settings), 'app_settings should hold exactly 11 settings');
select pg_temp.fails_as('anon', null, $$select public.get_payment_settings()$$, 'anon read the payment settings');
select pg_temp.check(pg_temp.as_role('authenticated', null, $$select public.get_payment_settings()::text$$) = '{}', 'a session without a person read the settings');
select pg_temp.check(pg_temp.as_role('anon', null, 'select count(*) from public.app_settings')::bigint = 0, 'anon read app_settings');
select pg_temp.check(pg_temp.count_as(pg_temp.u(10), 'select count(*) from public.app_settings') = 11, 'a signed-in person should read the settings');
select pg_temp.fails_as('authenticated', pg_temp.u(10), $$update public.app_settings set value = '1' where key = 'registration_fee_egp'$$, 'a user updated a setting');
select pg_temp.fails_as('authenticated', pg_temp.u(10), $$insert into public.app_settings (key, value) values ('evil', 'x')$$, 'a user inserted a setting');
select pg_temp.fails_as('authenticated', pg_temp.u(10), $$delete from public.app_settings$$, 'a user deleted settings');
select pg_temp.fails_aal('aal2', pg_temp.u(5), $$update public.app_settings set value = '1' where key = 'registration_fee_egp'$$, 'an admin wrote a setting straight into the table');
select pg_temp.fails_as('anon', null, $$update public.app_settings set value = '1' where key = 'registration_fee_egp'$$, 'anon updated a setting');
select pg_temp.check((select value = '75' from public.app_settings where key = 'registration_fee_egp'), 'a refused write changed a setting');
-- admin_set_setting
select pg_temp.fails_as('authenticated', pg_temp.u(10), $$select public.admin_set_setting('registration_fee_egp', '80')$$, 'a normal person set a setting');
select pg_temp.fails_aal('aal2', pg_temp.u(10), $$select public.admin_set_setting('registration_fee_egp', '80')$$, 'a normal person with an aal2 claim set a setting');
select pg_temp.fails_aal('aal1', pg_temp.u(5), $$select public.admin_set_setting('registration_fee_egp', '80')$$, 'an admin with aal1 set a setting');
select pg_temp.fails_aal(null, pg_temp.u(5), $$select public.admin_set_setting('registration_fee_egp', '80')$$, 'an admin without a claim set a setting');
select pg_temp.fails_as('anon', null, $$select public.admin_set_setting('registration_fee_egp', '80')$$, 'anon set a setting');
select pg_temp.check(not exists (select 1 from public.audit_log where action = 'setting_changed' and details ->> 'new' = '80'), 'a refused setting change was audited');
-- numbers
select pg_temp.fails_adm($$select public.admin_set_setting('registration_fee_egp', '0')$$, 'fee 0');
select pg_temp.fails_adm($$select public.admin_set_setting('registration_fee_egp', '-1')$$, 'fee -1');
select pg_temp.fails_adm($$select public.admin_set_setting('registration_fee_egp', 'abc')$$, 'fee abc');
select pg_temp.fails_adm($$select public.admin_set_setting('registration_fee_egp', '')$$, 'empty fee');
select pg_temp.fails_adm($$select public.admin_set_setting('registration_fee_egp', null)$$, 'null fee');
select pg_temp.fails_adm($$select public.admin_set_setting('registration_fee_egp', '12.5')$$, 'decimal fee');
select pg_temp.fails_adm($$select public.admin_set_setting('registration_fee_egp', '+50')$$, 'fee with a plus');
select pg_temp.fails_adm($$select public.admin_set_setting('registration_fee_egp', '1e3')$$, 'fee in exponent form');
select pg_temp.fails_adm($$select public.admin_set_setting('registration_fee_egp', '100001')$$, 'fee too big');
select pg_temp.fails_adm($$select public.admin_set_setting('registration_fee_egp', '99999999999999999999')$$, 'fee that overflows');
select pg_temp.fails_adm($$select public.admin_set_setting('renewal_fee_egp', '0')$$, 'renewal 0');
select pg_temp.fails_adm($$select public.admin_set_setting('renewal_fee_egp', '-5')$$, 'renewal -5');
select pg_temp.fails_adm($$select public.admin_set_setting('renewal_fee_egp', '1000000')$$, 'renewal too big');
select pg_temp.fails_adm($$select public.admin_set_setting('membership_months', '0')$$, 'months 0');
select pg_temp.fails_adm($$select public.admin_set_setting('membership_months', '61')$$, 'months 61');
select pg_temp.fails_adm($$select public.admin_set_setting('membership_months', 'six')$$, 'months six');
select pg_temp.fails_adm($$select public.admin_set_setting('reminder_days', '0')$$, 'reminder 0');
select pg_temp.fails_adm($$select public.admin_set_setting('reminder_days', '61')$$, 'reminder 61');
select pg_temp.fails_adm($$select public.admin_set_setting('reminder_days', '-3')$$, 'reminder -3');
-- links: https only
select pg_temp.fails_adm($$select public.admin_set_setting('instapay_link', 'http://ipn.eg/S/x')$$, 'http link');
select pg_temp.fails_adm($$select public.admin_set_setting('instapay_link', 'javascript:alert(1)')$$, 'javascript link');
select pg_temp.fails_adm($$select public.admin_set_setting('instapay_link', 'data:text/html;base64,AAAA')$$, 'data link');
select pg_temp.fails_adm($$select public.admin_set_setting('instapay_link', 'https://')$$, 'empty https link');
select pg_temp.fails_adm($$select public.admin_set_setting('instapay_link', 'https://a b.example')$$, 'link with a space');
select pg_temp.fails_adm($$select public.admin_set_setting('instapay_link', 'HTTPS://ipn.eg/S/x')$$, 'upper-case scheme');
select pg_temp.fails_adm($$select public.admin_set_setting('instapay_qr_url', 'ftp://x.example/q.png')$$, 'ftp qr link');
select pg_temp.fails_adm($$select public.admin_set_setting('instapay_qr_url', '//x.example/q.png')$$, 'scheme-less qr link');
select pg_temp.fails_adm(format($$select public.admin_set_setting('instapay_link', 'https://%s')$$, repeat('a', 500)), 'link of 500+ characters');
-- text and unknown keys
select pg_temp.fails_adm(format($$select public.admin_set_setting('bank_name', %L)$$, repeat('x', 501)), 'bank name of 501 characters');
select pg_temp.fails_adm(format($$select public.admin_set_setting('payment_note', %L)$$, repeat('x', 501)), 'payment note of 501 characters');
select pg_temp.fails_adm($$select public.admin_set_setting('nope', 'x')$$, 'unknown key');
select pg_temp.fails_adm($$select public.admin_set_setting('Registration_fee_egp', '80')$$, 'key in the wrong case');
select pg_temp.fails_adm($$select public.admin_set_setting('registration_fee_egp ', '80')$$, 'key with a trailing space');
select pg_temp.fails_adm($$select public.admin_set_setting(null, '80')$$, 'null key');
select pg_temp.check((select count(*) = 11 from public.app_settings) and (select value = '75' from public.app_settings where key = 'registration_fee_egp') and (select value = '' from public.app_settings where key = 'instapay_link'), 'a refused setting change changed the settings');
select pg_temp.check(not exists (select 1 from public.audit_log where action = 'setting_changed' and admin_id = pg_temp.u(5)), 'refused setting changes were audited');
-- accepted ones
select pg_temp.adm($$select public.admin_set_setting('registration_fee_egp', ' 80 ')$$);
select pg_temp.check((select value = '80' from public.app_settings where key = 'registration_fee_egp'), 'the fee did not change (or was stored with spaces)');
select pg_temp.check((select count(*) = 1 from public.audit_log where action = 'setting_changed' and admin_id = pg_temp.u(5) and details ->> 'key' = 'registration_fee_egp' and details ->> 'old' = '75' and details ->> 'new' = '80' and target_user is null), 'the setting change was not audited with key, old and new');
select pg_temp.check((pg_temp.as_role('authenticated', pg_temp.u(10), $$select public.get_payment_settings() ->> 'registration_fee_egp'$$)) = '80', 'the new fee is not shown to people');
select pg_temp.adm($$select public.admin_set_setting('registration_fee_egp', '75')$$);
select pg_temp.adm($$select public.admin_set_setting('instapay_link', '')$$);        -- clearing a link is allowed
select pg_temp.check((select value = '' from public.app_settings where key = 'instapay_link'), 'a link could not be cleared');
select pg_temp.adm($$select public.admin_set_setting('instapay_qr_url', '')$$);
select pg_temp.adm(format($$select public.admin_set_setting('payment_note', %L)$$, repeat('n', 500)));
select pg_temp.adm($$select public.admin_set_setting('payment_note', '')$$);
select pg_temp.adm($$select public.admin_set_setting('membership_months', '12')$$);
select pg_temp.adm($$select public.admin_set_setting('membership_months', '6')$$);
select pg_temp.adm($$select public.admin_set_setting('reminder_days', '14')$$);
select pg_temp.adm($$select public.admin_set_setting('reminder_days', '7')$$);
select pg_temp.adm($$select public.admin_set_setting('renewal_fee_egp', '100000')$$);
select pg_temp.adm($$select public.admin_set_setting('renewal_fee_egp', '25')$$);
select pg_temp.check((select count(*) = 11 from public.app_settings) and (select value = '75' from public.app_settings where key = 'registration_fee_egp')
                 and (select value = '25' from public.app_settings where key = 'renewal_fee_egp') and (select value = '6' from public.app_settings where key = 'membership_months')
                 and (select value = '7' from public.app_settings where key = 'reminder_days'), 'settings were not restored to the defaults');
select pg_temp.check((select count(*) = 12 from public.audit_log where action = 'setting_changed' and admin_id = pg_temp.u(5)), 'every accepted setting change should be audited exactly once (got ' || (select count(*) from public.audit_log where action = 'setting_changed' and admin_id = pg_temp.u(5)) || ')');

\echo '--- M3 payment claims'
select pg_temp.new_user(pg_temp.u(20), 'p20-b1@example.com', 'owner');     -- C: new, unpaid, still in verification
select pg_temp.new_user(pg_temp.u(21), 'p21-b1@example.com', 'owner');     -- D: five claims already today
select pg_temp.new_user(pg_temp.u(22), 'p22-b1@example.com', 'owner');     -- E: amount follows the settings, then a rejection
select pg_temp.person(23, 'owner', 'Fay1');                                -- F1: 7 days left
select pg_temp.person(24, 'owner', 'Fay2');                                -- F2: 8 days left (not due)
select pg_temp.person(25, 'owner', 'Fay3');                                -- F3: paused
select pg_temp.person(26, 'owner', 'Gus');                                 -- suspended
select pg_temp.person(27, 'owner', 'Rae');                                 -- removed
select pg_temp.new_user(pg_temp.u(28), 'p28-b1@example.com', 'owner');     -- S: screenshots
select pg_temp.setpaid(23, 7); select pg_temp.setpaid(24, 8); select pg_temp.setpaid(25, -3);
update public.profiles set status = 'suspended' where id = pg_temp.u(26);
update public.profiles set status = 'removed' where id = pg_temp.u(27);
insert into storage.objects (bucket_id, name) values
  ('payments', pg_temp.u(20)::text || '/own.jpg'), ('payments', pg_temp.u(21)::text || '/x.jpg'), ('payments', pg_temp.u(20)::text || '/../x.jpg'),
  ('faces', pg_temp.u(20)::text || '/wrongbucket.jpg'), ('payments', pg_temp.u(20)::text || '/sub/own.jpg'),
  ('payments', pg_temp.u(28)::text || '/shot.jpg'), ('payments', pg_temp.u(21)::text || '/shot.jpg');
select pg_temp.fails_as('anon', null, $$select public.submit_payment_claim('ref-1', null)$$, 'anon submitted a payment claim');
select pg_temp.fails_as('authenticated', pg_temp.u(20), $$select public.submit_payment_claim(null, null)$$, 'a claim with nothing in it');
select pg_temp.fails_as('authenticated', pg_temp.u(20), $$select public.submit_payment_claim('', null)$$, 'a claim with an empty reference');
select pg_temp.fails_as('authenticated', pg_temp.u(20), $$select public.submit_payment_claim('    ', null)$$, 'a claim with a blank reference');
select pg_temp.fails_as('authenticated', pg_temp.u(20), format($$select public.submit_payment_claim(%L, null)$$, repeat('r', 81)), 'a reference of 81 characters');
select pg_temp.fails_as('authenticated', pg_temp.u(20), format($$select public.submit_payment_claim(%L, %L)$$, 'ok', pg_temp.u(21)::text || '/x.jpg'), 'another person''s screenshot');
select pg_temp.fails_as('authenticated', pg_temp.u(20), format($$select public.submit_payment_claim(null, %L)$$, pg_temp.u(20)::text || '/../x.jpg'), 'a screenshot path with ..');
select pg_temp.fails_as('authenticated', pg_temp.u(20), format($$select public.submit_payment_claim(null, %L)$$, pg_temp.u(20)::text || '/sub/own.jpg'), 'a screenshot in a sub-folder');
select pg_temp.fails_as('authenticated', pg_temp.u(20), format($$select public.submit_payment_claim(null, %L)$$, pg_temp.u(20)::text || '/missing.jpg'), 'a screenshot that does not exist');
select pg_temp.fails_as('authenticated', pg_temp.u(20), format($$select public.submit_payment_claim(null, %L)$$, pg_temp.u(20)::text || '/wrongbucket.jpg'), 'a screenshot that exists in another bucket');
select pg_temp.fails_as('authenticated', pg_temp.u(20), $$select public.submit_payment_claim(null, '../x.jpg')$$, 'a relative screenshot path');
select pg_temp.fails_as('authenticated', pg_temp.u(26), $$select public.submit_payment_claim('ref', null)$$, 'a suspended person claimed a payment');
select pg_temp.fails_as('authenticated', pg_temp.u(27), $$select public.submit_payment_claim('ref', null)$$, 'a removed person claimed a payment');
select pg_temp.fails_as('authenticated', pg_temp.u(24), $$select public.submit_payment_claim('ref', null)$$, 'a claim 8 days before the end');
select pg_temp.fails_as('authenticated', pg_temp.u(1), $$select public.submit_payment_claim('ref', null)$$, 'a claim 150+ days before the end');
select pg_temp.check((select count(*) = 0 from public.payment_claims where user_id in (pg_temp.u(20), pg_temp.u(24), pg_temp.u(26), pg_temp.u(27), pg_temp.u(1))), 'a refused claim was stored');
-- accepted ones
select pg_temp.as_role('authenticated', pg_temp.u(20), $$select public.submit_payment_claim('IPN-12345', null)$$);
select pg_temp.check((select count(*) = 1 and bool_and(kind = 'registration' and amount_egp = 75 and reference = 'IPN-12345' and screenshot_path is null and status = 'pending') from public.payment_claims where user_id = pg_temp.u(20)), 'a first claim should be a pending registration of 75');
select pg_temp.check((pg_temp.state(pg_temp.u(20)) #>> '{membership,claim_status}') = 'pending', 'the state does not show the pending claim');
select pg_temp.fails_as('authenticated', pg_temp.u(20), $$select public.submit_payment_claim('IPN-2', null)$$, 'a second claim while one is pending');
select pg_temp.as_role('authenticated', pg_temp.u(28), format($$select public.submit_payment_claim(null, %L)$$, pg_temp.u(28)::text || '/shot.jpg'));
select pg_temp.check((select kind = 'registration' and reference is null and screenshot_path = pg_temp.u(28)::text || '/shot.jpg' from public.payment_claims where user_id = pg_temp.u(28)), 'a screenshot-only claim is wrong');
-- amounts come from the settings
select pg_temp.adm($$select public.admin_set_setting('registration_fee_egp', '90')$$);
select pg_temp.as_role('authenticated', pg_temp.u(22), format($$select public.submit_payment_claim(%L, null)$$, repeat('e', 80)));
select pg_temp.adm($$select public.admin_set_setting('registration_fee_egp', '75')$$);
select pg_temp.check((select kind = 'registration' and amount_egp = 90 and length(reference) = 80 from public.payment_claims where user_id = pg_temp.u(22)), 'a claim should take its amount from the settings (and 80 characters are fine)');
-- renewals: 7 days left is due, paused is due
select pg_temp.adm($$select public.admin_set_setting('renewal_fee_egp', '30')$$);
select pg_temp.as_role('authenticated', pg_temp.u(23), $$select public.submit_payment_claim('renew-23', null)$$);
select pg_temp.adm($$select public.admin_set_setting('renewal_fee_egp', '25')$$);
select pg_temp.as_role('authenticated', pg_temp.u(25), $$select public.submit_payment_claim('renew-25', null)$$);
select pg_temp.check((select kind = 'renewal' and amount_egp = 30 from public.payment_claims where user_id = pg_temp.u(23)), 'a due-soon claim should be a renewal of the setting amount');
select pg_temp.check((select kind = 'renewal' and amount_egp = 25 from public.payment_claims where user_id = pg_temp.u(25)), 'a paused person''s claim should be a renewal of 25');
-- five a day
insert into public.payment_claims (user_id, kind, amount_egp, reference, status, note, created_at, decided_at)
select pg_temp.u(21), 'registration', 75, 'old' || g, 'rejected', 'no', now() - (g || ' hours')::interval, now() from generate_series(1, 5) g;
select pg_temp.fails_as('authenticated', pg_temp.u(21), $$select public.submit_payment_claim('sixth', null)$$, 'a sixth claim in a day');
update public.payment_claims set created_at = now() - interval '3 days' where user_id = pg_temp.u(21) and reference = 'old5';
select pg_temp.as_role('authenticated', pg_temp.u(21), format($$select public.submit_payment_claim('fifth', %L)$$, pg_temp.u(21)::text || '/shot.jpg'));
select pg_temp.check((select count(*) = 1 from public.payment_claims where user_id = pg_temp.u(21) and status = 'pending'), 'D should have one pending claim');
-- the table is closed
select pg_temp.fails_as('authenticated', pg_temp.u(20), format($$insert into public.payment_claims (user_id, kind, amount_egp, reference) values (%L, 'registration', 1, 'x')$$, pg_temp.u(20)), 'a person inserted a claim directly');
select pg_temp.fails_as('authenticated', pg_temp.u(20), format($$insert into public.payment_claims (user_id, kind, amount_egp, reference, status) values (%L, 'registration', 1, 'x', 'confirmed')$$, pg_temp.u(24)), 'a person inserted a confirmed claim');
select pg_temp.fails_as('authenticated', pg_temp.u(20), $$update public.payment_claims set status = 'confirmed' where user_id = auth.uid()$$, 'a person confirmed their own claim');
select pg_temp.fails_as('authenticated', pg_temp.u(20), $$update public.payment_claims set amount_egp = 1 where user_id = auth.uid()$$, 'a person changed their own claim amount');
select pg_temp.fails_as('authenticated', pg_temp.u(20), $$delete from public.payment_claims where user_id = auth.uid()$$, 'a person deleted their own claim');
select pg_temp.check((select status = 'pending' and amount_egp = 75 from public.payment_claims where user_id = pg_temp.u(20)), 'a refused write changed a claim');
select pg_temp.check(pg_temp.count_as(pg_temp.u(20), 'select count(*) from public.payment_claims') = 1, 'a person should read only their own claim');
select pg_temp.check(pg_temp.count_as(pg_temp.u(23), format('select count(*) from public.payment_claims where user_id = %L', pg_temp.u(20))) = 0, 'a person read another person''s claim');
select pg_temp.check(pg_temp.as_role('anon', null, 'select count(*) from public.payment_claims')::bigint = 0, 'anon read claims');
select pg_temp.check(pg_temp.as_aal('aal2', pg_temp.u(5), 'select count(*) from public.payment_claims')::bigint >= 6, 'an admin cannot read claims');
select pg_temp.check(pg_temp.as_aal('aal1', pg_temp.u(5), 'select count(*) from public.payment_claims')::bigint = 0, 'an admin without the authenticator code read claims');
-- screenshot files
select pg_temp.check(pg_temp.count_as(pg_temp.u(28), $$select count(*) from storage.objects where bucket_id = 'payments'$$) = 0, 'a person read their own payment screenshot');
select pg_temp.check(pg_temp.as_aal('aal2', pg_temp.u(5), $$select count(*) from storage.objects where bucket_id = 'payments' and name like 'f7f7f7f7-%'$$)::bigint >= 3, 'an admin cannot read payment screenshots');

\echo '--- M4 admin_confirm_payment'
-- C (20): first payment, still in verification
update public.memberships set reminded_for = (now() at time zone 'Africa/Cairo')::date where user_id = pg_temp.u(20);
select pg_temp.fails_as('authenticated', pg_temp.u(23), format($$select public.admin_confirm_payment(%L, true, null)$$, pg_temp.claim_of(20)), 'a normal person confirmed a payment');
select pg_temp.fails_aal('aal2', pg_temp.u(23), format($$select public.admin_confirm_payment(%L, true, null)$$, pg_temp.claim_of(20)), 'a normal person with an aal2 claim confirmed a payment');
select pg_temp.fails_aal('aal1', pg_temp.u(5), format($$select public.admin_confirm_payment(%L, true, null)$$, pg_temp.claim_of(20)), 'an admin with aal1 confirmed a payment');
select pg_temp.fails_aal(null, pg_temp.u(5), format($$select public.admin_confirm_payment(%L, true, null)$$, pg_temp.claim_of(20)), 'an admin without a claim confirmed a payment');
select pg_temp.fails_as('anon', null, format($$select public.admin_confirm_payment(%L, true, null)$$, pg_temp.claim_of(20)), 'anon confirmed a payment');
select pg_temp.fails_aal('aal1', pg_temp.u(5), format($$select public.admin_confirm_payment(%L, false, 'no')$$, pg_temp.claim_of(20)), 'an admin with aal1 rejected a payment');
select pg_temp.fails_adm($$select public.admin_confirm_payment(gen_random_uuid(), true, null)$$, 'confirmed a claim that does not exist');
select pg_temp.fails_adm(format($$select public.admin_confirm_payment(%L, true, %L)$$, pg_temp.claim_of(20), repeat('x', 1001)), 'a note of 1001 characters');
select pg_temp.check((select paid_until is null and reminded_for = (now() at time zone 'Africa/Cairo')::date from public.memberships where user_id = pg_temp.u(20)) and (select status = 'pending' from public.payment_claims where user_id = pg_temp.u(20)), 'a refused confirmation changed something');
insert into t_ids select 'claim20', pg_temp.claim_of(20)::text;
select pg_temp.check(pg_temp.adm(format($$select public.admin_confirm_payment(%L, true, 'Thank you')$$, (select v from t_ids where k = 'claim20'))) = '', 'a claim without a screenshot should return an empty path');
select pg_temp.check((select paid_until = ((now() at time zone 'Africa/Cairo')::date + interval '6 months')::date and reminded_for is null from public.memberships where user_id = pg_temp.u(20)), 'a first payment should give today + 6 months and clear reminded_for');
select pg_temp.check((select status = 'confirmed' and screenshot_path is null and decided_by = pg_temp.u(5) and decided_at is not null and note = 'Thank you' from public.payment_claims where id = (select v::uuid from t_ids where k = 'claim20')), 'the confirmed claim is wrong');
select pg_temp.check((select count(*) = 1 from public.audit_log where action = 'payment_confirmed' and target_user = pg_temp.u(20) and admin_id = pg_temp.u(5) and details ->> 'kind' = 'registration' and (details ->> 'amount_egp')::integer = 75), 'the confirmation was not audited');
select pg_temp.check(not public.is_active(pg_temp.u(20)), 'a person still in verification became active by paying');
select pg_temp.check((pg_temp.state(pg_temp.u(20)) #>> '{membership,state}') = 'active' and (pg_temp.state(pg_temp.u(20)) #>> '{membership,claim_status}') = 'none' and (pg_temp.state(pg_temp.u(20)) #>> '{membership,days_left}')::integer >= 180, 'the state after a first payment');
select pg_temp.fails_as('authenticated', pg_temp.u(20), $$select public.submit_payment_claim('again', null)$$, 'a claim right after paying (not due yet)');
select pg_temp.fails_adm(format($$select public.admin_confirm_payment(%L, true, null)$$, (select v from t_ids where k = 'claim20')), 'a claim was confirmed twice');
select pg_temp.fails_adm(format($$select public.admin_confirm_payment(%L, false, 'oops')$$, (select v from t_ids where k = 'claim20')), 'a confirmed claim was rejected afterwards');
select pg_temp.check((select paid_until = ((now() at time zone 'Africa/Cairo')::date + interval '6 months')::date from public.memberships where user_id = pg_temp.u(20)), 'a second decision changed the membership');

-- S (28): screenshot returned and cleared
select pg_temp.check(pg_temp.adm(format($$select public.admin_confirm_payment(%L, true, null)$$, pg_temp.claim_of(28))) = pg_temp.u(28)::text || '/shot.jpg', 'the screenshot path was not returned');
select pg_temp.check((select screenshot_path is null and status = 'confirmed' and note is null from public.payment_claims where user_id = pg_temp.u(28)), 'the screenshot path was not cleared');

-- F1 (23): early renewal extends from the old end date, not from today
insert into t_ids select 'oldend23', paid_until::text from public.memberships where user_id = pg_temp.u(23);
update public.memberships set reminded_for = paid_until where user_id = pg_temp.u(23);
select pg_temp.adm(format($$select public.admin_confirm_payment(%L, true, null)$$, pg_temp.claim_of(23)));
select pg_temp.check((select paid_until = ((select v::date from t_ids where k = 'oldend23') + interval '6 months')::date from public.memberships where user_id = pg_temp.u(23)), 'an early renewal should extend from the old end date');
select pg_temp.check((select paid_until <> ((now() at time zone 'Africa/Cairo')::date + interval '6 months')::date and reminded_for is null from public.memberships where user_id = pg_temp.u(23)), 'an early renewal must not start from today, and must clear reminded_for');
select pg_temp.check((select count(*) = 1 from public.audit_log where action = 'payment_confirmed' and target_user = pg_temp.u(23) and details ->> 'kind' = 'renewal' and (details ->> 'amount_egp')::integer = 30), 'the renewal was not audited with its amount');

-- F3 (25): paused, comes back from today
select pg_temp.check(not public.is_active(pg_temp.u(25)), 'a paused person is active');
select pg_temp.adm(format($$select public.admin_confirm_payment(%L, true, null)$$, pg_temp.claim_of(25)));
select pg_temp.check((select paid_until = ((now() at time zone 'Africa/Cairo')::date + interval '6 months')::date from public.memberships where user_id = pg_temp.u(25)), 'a lapsed person should be extended from today');
select pg_temp.check(public.is_active(pg_temp.u(25)), 'a lapsed person is not active again after paying');

-- the setting for the length applies
select pg_temp.adm($$select public.admin_set_setting('membership_months', '12')$$);
select pg_temp.person(29, 'owner', 'Zed'); select pg_temp.setpaid(29, 2);
select pg_temp.as_role('authenticated', pg_temp.u(29), $$select public.submit_payment_claim('long', null)$$);
select pg_temp.adm(format($$select public.admin_confirm_payment(%L, true, null)$$, pg_temp.claim_of(29)));
select pg_temp.adm($$select public.admin_set_setting('membership_months', '6')$$);
select pg_temp.check((select paid_until = ((now() at time zone 'Africa/Cairo')::date + 2 + interval '12 months')::date from public.memberships where user_id = pg_temp.u(29)), 'membership_months is not used');

-- U (30): approved but never paid becomes active only when the payment is confirmed
select pg_temp.person(30, 'sitter', 'Una'); select pg_temp.setpaid(30, null);
select pg_temp.check(not public.is_active(pg_temp.u(30)) and pg_temp.count_as(pg_temp.u(1), format('select count(*) from public.profile_cards where id = %L', pg_temp.u(30))) = 0, 'an unpaid approved person is active or visible');
select pg_temp.as_role('authenticated', pg_temp.u(30), $$select public.submit_payment_claim('first-30', null)$$);
select pg_temp.check(not public.is_active(pg_temp.u(30)), 'a claim alone made someone active');
select pg_temp.adm(format($$select public.admin_confirm_payment(%L, true, null)$$, pg_temp.claim_of(30)));
select pg_temp.check(public.is_active(pg_temp.u(30)) and pg_temp.count_as(pg_temp.u(1), format('select count(*) from public.profile_cards where id = %L', pg_temp.u(30))) = 1, 'an approved person did not become active and visible after the confirmation');

-- rejection: needs a note, returns the path, leaves the membership alone, shows the note, and the person can try again
select pg_temp.fails_adm(format($$select public.admin_confirm_payment(%L, false, null)$$, pg_temp.claim_of(21)), 'a rejection without a note');
select pg_temp.fails_adm(format($$select public.admin_confirm_payment(%L, false, '   ')$$, pg_temp.claim_of(21)), 'a rejection with a blank note');
insert into t_ids select 'claim21', pg_temp.claim_of(21)::text;
select pg_temp.check(pg_temp.adm(format($$select public.admin_confirm_payment(%L, false, 'Amount does not match')$$, (select v from t_ids where k = 'claim21'))) = pg_temp.u(21)::text || '/shot.jpg', 'a rejection should return the screenshot path');
select pg_temp.check((select status = 'rejected' and screenshot_path is null and note = 'Amount does not match' and decided_by = pg_temp.u(5) from public.payment_claims where id = (select v::uuid from t_ids where k = 'claim21')), 'the rejected claim is wrong');
select pg_temp.check((select paid_until is null from public.memberships where user_id = pg_temp.u(21)), 'a rejection gave membership');
select pg_temp.check((select count(*) = 1 from public.audit_log where action = 'payment_rejected' and target_user = pg_temp.u(21)), 'the rejection was not audited');
select pg_temp.check((pg_temp.state(pg_temp.u(21)) #>> '{membership,claim_status}') = 'rejected' and (pg_temp.state(pg_temp.u(21)) #>> '{membership,claim_note}') = 'Amount does not match' and (pg_temp.state(pg_temp.u(21)) #>> '{membership,state}') = 'unpaid', 'the person cannot see the rejection');
select pg_temp.fails_adm(format($$select public.admin_confirm_payment(%L, true, null)$$, (select v from t_ids where k = 'claim21')), 'a rejected claim was confirmed');
select pg_temp.fails_adm(format($$select public.admin_confirm_payment(%L, false, 'again')$$, (select v from t_ids where k = 'claim21')), 'a rejected claim was rejected twice');
-- E (22) after a rejection tries again (not blocked by the earlier claim)
select pg_temp.adm(format($$select public.admin_confirm_payment(%L, false, 'Wrong amount')$$, pg_temp.claim_of(22)));
select pg_temp.as_role('authenticated', pg_temp.u(22), $$select public.submit_payment_claim('second try', null)$$);
select pg_temp.check((select count(*) = 2 and count(*) filter (where status = 'pending' and amount_egp = 75) = 1 from public.payment_claims where user_id = pg_temp.u(22)), 'a person should be able to claim again after a rejection');
select pg_temp.check((pg_temp.state(pg_temp.u(22)) #>> '{membership,claim_status}') = 'pending', 'the state should follow the newest claim');

\echo '--- M5 reminders'
select pg_temp.person(40, 'owner', 'Rem0'); select pg_temp.setpaid(40, 3);      -- due
select pg_temp.person(41, 'owner', 'Rem1'); select pg_temp.setpaid(41, 7);      -- due (the edge)
select pg_temp.person(42, 'owner', 'Rem2'); select pg_temp.setpaid(42, 8);      -- not yet
select pg_temp.person(43, 'owner', 'Rem3'); select pg_temp.setpaid(43, -1);     -- lapsed
select pg_temp.person(44, 'owner', 'Rem4'); select pg_temp.setpaid(44, 3); update public.profiles set status = 'pending_review' where id = pg_temp.u(44);   -- not approved
select pg_temp.person(45, 'owner', 'Rem5'); select pg_temp.setpaid(45, 3);      -- renews
select pg_temp.person(46, 'owner', 'Rem6'); select pg_temp.setpaid(46, 0);      -- last day: due
select pg_temp.person(47, 'owner', 'Rem7'); select pg_temp.setpaid(47, 3); update public.memberships set reminded_for = paid_until where user_id = pg_temp.u(47);     -- already reminded
select pg_temp.person(48, 'owner', 'Rem8'); select pg_temp.setpaid(48, 3); update public.profiles set status = 'suspended' where id = pg_temp.u(48);
select pg_temp.person(49, 'owner', 'Rem9'); update public.memberships set paid_until = null where user_id = pg_temp.u(49);     -- never paid
create or replace function pg_temp.due(n integer) returns bigint language sql as $$
  select pg_temp.as_role('service_role', null, format('select count(*) from public.list_due_reminders() where user_id = %L', pg_temp.u(n)))::bigint $$;
select pg_temp.check(pg_temp.due(40) = 1 and pg_temp.due(41) = 1 and pg_temp.due(46) = 1, 'a person within 7 days is not listed');
select pg_temp.check(pg_temp.due(42) = 0, 'a person with 8 days left is listed');
select pg_temp.check(pg_temp.due(43) = 0, 'a lapsed person is listed');
select pg_temp.check(pg_temp.due(44) = 0 and pg_temp.due(48) = 0, 'an unapproved or suspended person is listed');
select pg_temp.check(pg_temp.due(47) = 0, 'a person already reminded is listed');
select pg_temp.check(pg_temp.due(49) = 0, 'a person who never paid is listed');
select pg_temp.check(pg_temp.as_role('service_role', null, format('select email from public.list_due_reminders() where user_id = %L', pg_temp.u(40))) = 'p40-b1@example.com', 'the reminder does not carry the email');
select pg_temp.check(pg_temp.as_role('service_role', null, format('select paid_until::text from public.list_due_reminders() where user_id = %L', pg_temp.u(40))) = ((now() at time zone 'Africa/Cairo')::date + 3)::text, 'the reminder does not carry the end date');
select pg_temp.check(pg_temp.as_role('service_role', null, format('select first_name from public.list_due_reminders() where user_id = %L', pg_temp.u(40))) = 'Rem0', 'the reminder does not carry the first name');
select pg_temp.check(pg_temp.as_role('service_role', null, format('select amount_egp::text from public.list_due_reminders() where user_id = %L', pg_temp.u(40))) = '25', 'the reminder does not carry the renewal fee');
-- only the service role
select pg_temp.fails_as('anon', null, $$select count(*) from public.list_due_reminders()$$, 'anon listed reminders');
select pg_temp.fails_as('authenticated', pg_temp.u(40), $$select count(*) from public.list_due_reminders()$$, 'a person listed reminders');
select pg_temp.fails_aal('aal2', pg_temp.u(5), $$select count(*) from public.list_due_reminders()$$, 'an admin listed reminders through the API');
select pg_temp.fails_as('anon', null, format($$select public.mark_reminded(%L, (now() at time zone 'Africa/Cairo')::date + 3)$$, pg_temp.u(40)), 'anon marked a reminder');
select pg_temp.fails_as('authenticated', pg_temp.u(40), format($$select public.mark_reminded(%L, (now() at time zone 'Africa/Cairo')::date + 3)$$, pg_temp.u(40)), 'a person marked their own reminder');
-- mark_reminded
select pg_temp.as_role('service_role', null, format($$select public.mark_reminded(%L, (now() at time zone 'Africa/Cairo')::date + 99)$$, pg_temp.u(41)));       -- the wrong date: nothing happens
select pg_temp.check(pg_temp.due(41) = 1 and (select reminded_for is null from public.memberships where user_id = pg_temp.u(41)), 'marking the wrong date stopped a reminder');
select pg_temp.as_role('service_role', null, format($$select public.mark_reminded(%L, (now() at time zone 'Africa/Cairo')::date + 3)$$, pg_temp.u(40)));
select pg_temp.check(pg_temp.due(40) = 0 and (select reminded_for = (now() at time zone 'Africa/Cairo')::date + 3 from public.memberships where user_id = pg_temp.u(40)), 'marking a person did not stop the reminder');
select pg_temp.check(pg_temp.due(41) = 1 and pg_temp.due(46) = 1, 'marking one person stopped the others');
-- a renewal makes them due again later
update public.memberships set reminded_for = paid_until where user_id = pg_temp.u(45);
select pg_temp.check(pg_temp.due(45) = 0, 'a reminded person is listed');
select pg_temp.as_role('authenticated', pg_temp.u(45), $$select public.submit_payment_claim('renew-45', null)$$);
select pg_temp.adm(format($$select public.admin_confirm_payment(%L, true, null)$$, pg_temp.claim_of(45)));
select pg_temp.check(pg_temp.due(45) = 0 and (select reminded_for is null and paid_until = ((now() at time zone 'Africa/Cairo')::date + 3 + interval '6 months')::date from public.memberships where user_id = pg_temp.u(45)), 'a renewed person should not be due, and reminded_for must be cleared');
update public.memberships set paid_until = (now() at time zone 'Africa/Cairo')::date + 2 where user_id = pg_temp.u(45);     -- time passes: the new end date is near
select pg_temp.check(pg_temp.due(45) = 1, 'a renewed person should be reminded again when the new end date comes near');
-- the window follows the setting
update public.app_settings set value = '10' where key = 'reminder_days';
select pg_temp.check(pg_temp.due(42) = 1, 'the reminder window does not follow reminder_days');
update public.app_settings set value = '7' where key = 'reminder_days';
select pg_temp.check(pg_temp.due(42) = 0, 'the reminder window did not go back');

\echo '--- M6 bookings without a fee'
select pg_temp.check(enum_range(null::public.cost_type)::text = '{paid,volunteer}', 'cost_type should be paid and volunteer only');
select pg_temp.check(enum_range(null::public.user_role)::text = '{owner,sitter}', 'user_role should be owner and sitter only');
select pg_temp.fails_as('authenticated', pg_temp.u(1), format($$select public.request_booking(%L, %L, (now() at time zone 'Africa/Cairo')::date + 10, (now() at time zone 'Africa/Cairo')::date + 14, 'sitter_home', 'swap', null, false)$$, pg_temp.u(2), :'rex'), 'a swap booking was requested');
select pg_temp.fails_with($$select 'swap'::public.cost_type$$, 'invalid input value for enum', 'swap is still a cost type');
-- who may request what
select pg_temp.fails_as('anon', null, format($$select public.request_booking(%L, %L, (now() at time zone 'Africa/Cairo')::date + 10, (now() at time zone 'Africa/Cairo')::date + 14, 'sitter_home', 'paid', 200, false)$$, pg_temp.u(2), :'rex'), 'anon requested a booking');
select pg_temp.fails_as('authenticated', pg_temp.u(2), format($$select public.request_booking(%L, %L, (now() at time zone 'Africa/Cairo')::date + 10, (now() at time zone 'Africa/Cairo')::date + 14, 'sitter_home', 'paid', 200, false)$$, pg_temp.u(1), :'rex'), 'a host requested a booking as the owner');
select pg_temp.fails_as('authenticated', pg_temp.u(1), format($$select public.request_booking(%L, %L, (now() at time zone 'Africa/Cairo')::date + 10, (now() at time zone 'Africa/Cairo')::date + 14, 'sitter_home', 'paid', 200, false)$$, pg_temp.u(3), :'rex'), 'an owner requested another owner');
select pg_temp.fails_as('authenticated', pg_temp.u(1), format($$select public.request_booking(%L, %L, (now() at time zone 'Africa/Cairo')::date + 10, (now() at time zone 'Africa/Cairo')::date + 14, 'sitter_home', 'paid', 200, false)$$, pg_temp.u(1), :'rex'), 'a person requested themselves');
select pg_temp.fails_as('authenticated', pg_temp.u(3), format($$select public.request_booking(%L, %L, (now() at time zone 'Africa/Cairo')::date + 10, (now() at time zone 'Africa/Cairo')::date + 14, 'sitter_home', 'paid', 200, false)$$, pg_temp.u(2), :'rex'), 'an owner used someone else''s pet');
select pg_temp.fails_as('authenticated', pg_temp.u(1), format($$select public.request_booking(%L, %L, (now() at time zone 'Africa/Cairo')::date - 1, (now() at time zone 'Africa/Cairo')::date + 2, 'sitter_home', 'paid', 200, false)$$, pg_temp.u(2), :'rex'), 'dates in the past');
select pg_temp.fails_as('authenticated', pg_temp.u(1), format($$select public.request_booking(%L, %L, (now() at time zone 'Africa/Cairo')::date + 14, (now() at time zone 'Africa/Cairo')::date + 10, 'sitter_home', 'paid', 200, false)$$, pg_temp.u(2), :'rex'), 'dates in the wrong order');
select pg_temp.fails_as('authenticated', pg_temp.u(1), format($$select public.request_booking(%L, %L, (now() at time zone 'Africa/Cairo')::date + 10, (now() at time zone 'Africa/Cairo')::date + 71, 'sitter_home', 'paid', 200, false)$$, pg_temp.u(2), :'rex'), 'a 61-night stay');
select pg_temp.fails_as('authenticated', pg_temp.u(1), format($$select public.request_booking(%L, %L, (now() at time zone 'Africa/Cairo')::date + 10, (now() at time zone 'Africa/Cairo')::date + 14, 'sitter_home', 'paid', -1, false)$$, pg_temp.u(2), :'rex'), 'a negative price');
select pg_temp.fails_as('authenticated', pg_temp.u(1), format($$select public.request_booking(%L, %L, (now() at time zone 'Africa/Cairo')::date + 10, (now() at time zone 'Africa/Cairo')::date + 14, 'sitter_home', 'paid', null, false)$$, pg_temp.u(2), :'rex'), 'a paid stay without a price');
select pg_temp.fails_as('authenticated', pg_temp.u(1), format($$select public.request_booking(%L, %L, (now() at time zone 'Africa/Cairo')::date + 10, (now() at time zone 'Africa/Cairo')::date + 14, 'sitter_home', 'paid', 100001, false)$$, pg_temp.u(2), :'rex'), 'a price over the limit');
select pg_temp.check((select count(*) = 0 from public.bookings where owner_id in (pg_temp.u(1), pg_temp.u(3))), 'a refused request left a booking');
select pg_temp.fails_as('authenticated', pg_temp.u(1), $$update public.bookings set status = 'confirmed'$$, 'a person updated bookings directly');
select pg_temp.fails_as('authenticated', pg_temp.u(1), $$insert into public.bookings (owner_id, sitter_id, pet_id, starts_on, ends_on, status) select owner_id, sitter_id, pet_id, starts_on, ends_on, 'confirmed' from public.bookings limit 1$$, 'a person inserted a booking directly');
-- a volunteer stay keeps no price
insert into t_ids select 'vol', pg_temp.as_role('authenticated', pg_temp.u(1), format($$select public.request_booking(%L, %L, (now() at time zone 'Africa/Cairo')::date + 60, (now() at time zone 'Africa/Cairo')::date + 62, 'sitter_home', 'volunteer', 500, false)::text$$, pg_temp.u(2), :'rex'));
select pg_temp.check((select cost_type::text = 'volunteer' and price_per_night is null from public.bookings where id = (select v::uuid from t_ids where k = 'vol')), 'a volunteer stay should store no price');
select pg_temp.as_role('authenticated', pg_temp.u(1), format($$select public.cancel_booking(%L, 'test')$$, (select v from t_ids where k = 'vol')));
-- B1: O (Rex) -> H, B2: O (Rex) -> H2 on the same dates
insert into t_ids select 'b1', pg_temp.as_role('authenticated', pg_temp.u(1), format($$select public.request_booking(%L, %L, (now() at time zone 'Africa/Cairo')::date + 10, (now() at time zone 'Africa/Cairo')::date + 14, 'sitter_home', 'paid', 200, false)::text$$, pg_temp.u(2), :'rex'));
insert into t_ids select 'b2', pg_temp.as_role('authenticated', pg_temp.u(1), format($$select public.request_booking(%L, %L, (now() at time zone 'Africa/Cairo')::date + 10, (now() at time zone 'Africa/Cairo')::date + 14, 'sitter_home', 'paid', 180, true)::text$$, pg_temp.u(4), :'rex'));
select pg_temp.check((select status::text = 'requested' and cost_type::text = 'paid' and price_per_night = 200 and owner_accepted_at is null and sitter_accepted_at is null and terms_version = 1 and confirmed_at is null from public.bookings where id = (select v::uuid from t_ids where k = 'b1')), 'a new request is wrong');
select pg_temp.check((select not locked from public.pets where id = :'rex'), 'a request locked the pet');
select pg_temp.fails_as('authenticated', pg_temp.u(1), format($$select public.request_booking(%L, %L, (now() at time zone 'Africa/Cairo')::date + 11, (now() at time zone 'Africa/Cairo')::date + 12, 'sitter_home', 'paid', 200, false)$$, pg_temp.u(2), :'rex'), 'a duplicate request for overlapping dates');
select pg_temp.check((select count(*) = 1 from public.bookings where id = (select v::uuid from t_ids where k = 'b1')) and pg_temp.count_as(pg_temp.u(3), 'select count(*) from public.bookings') = 0, 'a stranger can read bookings');
-- chat: a phone number is masked before confirmation
insert into t_ids select 'conv12', pg_temp.as_role('authenticated', pg_temp.u(1), format($$select public.start_conversation(%L)::text$$, pg_temp.u(2)));
select pg_temp.as_role('authenticated', pg_temp.u(1), format($$insert into public.messages (conversation_id, sender_id, body) values (%L, %L, 'Call me on 0101 234 5678 please')$$, (select v from t_ids where k = 'conv12'), pg_temp.u(1)));
select pg_temp.check((select masked and body not like '%5678%' and body like '%•••%' from public.messages where conversation_id = (select v::uuid from t_ids where k = 'conv12') order by id desc limit 1), 'a phone number was not masked before the booking was confirmed');
-- location is not released before confirmation
select pg_temp.fails_as('authenticated', pg_temp.u(1), format($$select * from public.get_booking_location(%L)$$, (select v from t_ids where k = 'b1')), 'the location was released before confirmation');
select pg_temp.fails_as('authenticated', pg_temp.u(2), format($$select * from public.get_booking_location(%L)$$, (select v from t_ids where k = 'b1')), 'the location was released to the host before confirmation');
-- accepting the terms
select pg_temp.fails_as('anon', null, format($$select public.accept_terms(%L, 1)$$, (select v from t_ids where k = 'b1')), 'anon accepted terms');
select pg_temp.fails_as('authenticated', pg_temp.u(3), format($$select public.accept_terms(%L, 1)$$, (select v from t_ids where k = 'b1')), 'a stranger accepted terms');
select pg_temp.fails_as('authenticated', pg_temp.u(1), format($$select public.accept_terms(%L, 2)$$, (select v from t_ids where k = 'b1')), 'terms accepted for a version that does not exist yet');
select pg_temp.fails_as('authenticated', pg_temp.u(1), format($$select public.accept_terms(%L, 0)$$, (select v from t_ids where k = 'b1')), 'terms accepted for version 0');
select pg_temp.check(pg_temp.as_role('authenticated', pg_temp.u(1), format($$select public.accept_terms(%L, 1)::text$$, (select v from t_ids where k = 'b1'))) = 'requested', 'one acceptance should not confirm');
select pg_temp.check(pg_temp.as_role('authenticated', pg_temp.u(1), format($$select public.accept_terms(%L, 1)::text$$, (select v from t_ids where k = 'b1'))) = 'requested', 'accepting twice should be harmless');
select pg_temp.check((select owner_accepted_at is not null and sitter_accepted_at is null and status::text = 'requested' and confirmed_at is null from public.bookings where id = (select v::uuid from t_ids where k = 'b1')), 'state after the owner accepted');
-- changing the terms resets both acceptances
select pg_temp.fails_as('authenticated', pg_temp.u(3), format($$select public.propose_terms(%L, (now() at time zone 'Africa/Cairo')::date + 10, (now() at time zone 'Africa/Cairo')::date + 15, 'sitter_home', 'paid', 220, false)$$, (select v from t_ids where k = 'b1')), 'a stranger proposed terms');
select pg_temp.fails_as('authenticated', pg_temp.u(2), format($$select public.propose_terms(%L, (now() at time zone 'Africa/Cairo')::date - 2, (now() at time zone 'Africa/Cairo')::date + 15, 'sitter_home', 'paid', 220, false)$$, (select v from t_ids where k = 'b1')), 'terms with past dates');
select pg_temp.fails_as('authenticated', pg_temp.u(2), format($$select public.propose_terms(%L, (now() at time zone 'Africa/Cairo')::date + 10, (now() at time zone 'Africa/Cairo')::date + 15, 'sitter_home', 'swap', 220, false)$$, (select v from t_ids where k = 'b1')), 'terms with cost swap');
select pg_temp.as_role('authenticated', pg_temp.u(2), format($$select public.propose_terms(%L, (now() at time zone 'Africa/Cairo')::date + 10, (now() at time zone 'Africa/Cairo')::date + 15, 'sitter_home', 'paid', 220, false)$$, (select v from t_ids where k = 'b1')));
select pg_temp.check((select owner_accepted_at is null and sitter_accepted_at is null and terms_version = 2 and price_per_night = 220 and ends_on = (now() at time zone 'Africa/Cairo')::date + 15 and status::text = 'requested' from public.bookings where id = (select v::uuid from t_ids where k = 'b1')), 'proposing terms should reset both acceptances and bump the version');
select pg_temp.fails_as('authenticated', pg_temp.u(1), format($$select public.accept_terms(%L, 1)$$, (select v from t_ids where k = 'b1')), 'old terms were accepted after a change');
-- a paused participant cannot accept
select pg_temp.setpaid(2, -1);
select pg_temp.fails_as('authenticated', pg_temp.u(2), format($$select public.accept_terms(%L, 2)$$, (select v from t_ids where k = 'b1')), 'a paused host accepted terms');
select pg_temp.fails_as('authenticated', pg_temp.u(1), format($$select public.accept_terms(%L, 2)$$, (select v from t_ids where k = 'b1')), 'terms were accepted with a paused partner');
select pg_temp.fails_as('authenticated', pg_temp.u(2), format($$select public.propose_terms(%L, (now() at time zone 'Africa/Cairo')::date + 10, (now() at time zone 'Africa/Cairo')::date + 15, 'sitter_home', 'paid', 230, false)$$, (select v from t_ids where k = 'b1')), 'a paused host proposed terms');
select pg_temp.setpaid(2, 180);
select pg_temp.setpaid(1, -1);
select pg_temp.fails_as('authenticated', pg_temp.u(2), format($$select public.accept_terms(%L, 2)$$, (select v from t_ids where k = 'b1')), 'terms were accepted with a paused owner');
select pg_temp.fails_as('authenticated', pg_temp.u(1), format($$select public.accept_terms(%L, 2)$$, (select v from t_ids where k = 'b1')), 'a paused owner accepted terms');
select pg_temp.setpaid(1, 180);
select pg_temp.check((select owner_accepted_at is null and sitter_accepted_at is null and status::text = 'requested' from public.bookings where id = (select v::uuid from t_ids where k = 'b1')), 'a refused acceptance changed the booking');
-- both accept: confirmed
select pg_temp.check(pg_temp.as_role('authenticated', pg_temp.u(1), format($$select public.accept_terms(%L, 2)::text$$, (select v from t_ids where k = 'b1'))) = 'requested', 'owner acceptance of v2');
-- B2 is accepted by the owner too, while B1 is not yet confirmed
select pg_temp.check(pg_temp.as_role('authenticated', pg_temp.u(1), format($$select public.accept_terms(%L, 1)::text$$, (select v from t_ids where k = 'b2'))) = 'requested', 'owner acceptance of b2');
select pg_temp.check(pg_temp.as_role('authenticated', pg_temp.u(2), format($$select public.accept_terms(%L, 2)::text$$, (select v from t_ids where k = 'b1'))) = 'confirmed', 'both acceptances should confirm the booking');
select pg_temp.check((select status::text = 'confirmed' and confirmed_at is not null and owner_accepted_at is not null and sitter_accepted_at is not null from public.bookings where id = (select v::uuid from t_ids where k = 'b1')), 'the confirmed booking is wrong');
select pg_temp.check((select locked from public.pets where id = :'rex'), 'a confirmed booking should lock the pet');
select pg_temp.try_as('authenticated', pg_temp.u(1), $$update public.pets set name = 'Hacked' where name = 'Rex' and owner_id = auth.uid()$$);
select pg_temp.check((select name = 'Rex' from public.pets where id = :'rex'), 'an owner changed a locked pet');
select pg_temp.fails_as('authenticated', pg_temp.u(2), format($$select public.propose_terms(%L, (now() at time zone 'Africa/Cairo')::date + 10, (now() at time zone 'Africa/Cairo')::date + 15, 'sitter_home', 'paid', 100, false)$$, (select v from t_ids where k = 'b1')), 'terms were changed after confirmation');
select pg_temp.fails_as('authenticated', pg_temp.u(2), format($$select public.accept_terms(%L, 2)$$, (select v from t_ids where k = 'b1')), 'terms were accepted again after confirmation');
-- the same pet cannot be confirmed twice for overlapping dates
select pg_temp.fails_as('authenticated', pg_temp.u(4), format($$select public.accept_terms(%L, 1)$$, (select v from t_ids where k = 'b2')), 'a pet already confirmed elsewhere was confirmed again');
select pg_temp.check((select status::text = 'requested' and confirmed_at is null and sitter_accepted_at is null from public.bookings where id = (select v::uuid from t_ids where k = 'b2')), 'the blocked second confirmation changed the booking');
select pg_temp.fails_as('authenticated', pg_temp.u(1), format($$select public.request_booking(%L, %L, (now() at time zone 'Africa/Cairo')::date + 12, (now() at time zone 'Africa/Cairo')::date + 13, 'sitter_home', 'paid', 100, false)$$, pg_temp.u(4), :'rex'), 'a request for a pet already confirmed for these dates');
-- contact details unlock after confirmation, both ways
select pg_temp.as_role('authenticated', pg_temp.u(1), format($$insert into public.messages (conversation_id, sender_id, body) values (%L, %L, 'Now: 0101 234 5678 or mona@mail.com')$$, (select v from t_ids where k = 'conv12'), pg_temp.u(1)));
select pg_temp.check((select not masked and body = 'Now: 0101 234 5678 or mona@mail.com' from public.messages where conversation_id = (select v::uuid from t_ids where k = 'conv12') order by id desc limit 1), 'contact details stayed masked after confirmation');
select pg_temp.as_role('authenticated', pg_temp.u(2), format($$insert into public.messages (conversation_id, sender_id, body) values (%L, %L, 'Mine is 0100 999 8888')$$, (select v from t_ids where k = 'conv12'), pg_temp.u(2)));
select pg_temp.check((select not masked and body like '%999 8888' from public.messages where conversation_id = (select v::uuid from t_ids where k = 'conv12') order by id desc limit 1), 'the host''s contact details stayed masked after confirmation');
-- ...but only for the confirmed pair: O2 talking to H is still masked
insert into t_ids select 'conv32', pg_temp.as_role('authenticated', pg_temp.u(3), format($$select public.start_conversation(%L)::text$$, pg_temp.u(2)));
select pg_temp.as_role('authenticated', pg_temp.u(3), format($$insert into public.messages (conversation_id, sender_id, body) values (%L, %L, 'Call 0101 234 5678')$$, (select v from t_ids where k = 'conv32'), pg_temp.u(3)));
select pg_temp.check((select masked and body not like '%5678%' from public.messages where conversation_id = (select v::uuid from t_ids where k = 'conv32') order by id desc limit 1), 'a confirmed booking elsewhere unmasked another pair');
-- the exact location
select pg_temp.check(pg_temp.as_role('authenticated', pg_temp.u(1), format($$select lat::text from public.get_booking_location(%L)$$, (select v from t_ids where k = 'b1'))) = (select lat::text from private.locations where user_id = pg_temp.u(2)), 'the owner could not read the host''s exact location after confirmation');
select pg_temp.check(pg_temp.as_role('authenticated', pg_temp.u(2), format($$select address from public.get_booking_location(%L)$$, (select v from t_ids where k = 'b1'))) = 'Secret street 1', 'the host could not read their own location through the booking');
select pg_temp.fails_as('authenticated', pg_temp.u(3), format($$select * from public.get_booking_location(%L)$$, (select v from t_ids where k = 'b1')), 'a stranger read the location');
select pg_temp.fails_as('authenticated', pg_temp.u(4), format($$select * from public.get_booking_location(%L)$$, (select v from t_ids where k = 'b1')), 'another host read the location');
select pg_temp.fails_as('anon', null, format($$select * from public.get_booking_location(%L)$$, (select v from t_ids where k = 'b1')), 'anon read the location');
select pg_temp.fails_as('authenticated', pg_temp.u(1), format($$select * from public.get_booking_location(%L)$$, gen_random_uuid()), 'the location of a booking that does not exist');
select pg_temp.fails_as('authenticated', pg_temp.u(1), format($$select * from public.get_booking_location(%L)$$, (select v from t_ids where k = 'b2')), 'the location of an unconfirmed booking');
-- cancelling
select pg_temp.fails_as('authenticated', pg_temp.u(3), format($$select public.cancel_booking(%L, 'x')$$, (select v from t_ids where k = 'b1')), 'a stranger cancelled a booking');
select pg_temp.fails_as('anon', null, format($$select public.cancel_booking(%L, 'x')$$, (select v from t_ids where k = 'b1')), 'anon cancelled a booking');
-- B4 (Rex, later dates) confirmed too: cancelling B1 keeps the pet locked while B4 stands
insert into t_ids select 'b4', pg_temp.as_role('authenticated', pg_temp.u(1), format($$select public.request_booking(%L, %L, (now() at time zone 'Africa/Cairo')::date + 30, (now() at time zone 'Africa/Cairo')::date + 33, 'sitter_home', 'volunteer', null, true)::text$$, pg_temp.u(2), :'rex'));
select pg_temp.as_role('authenticated', pg_temp.u(1), format($$select public.accept_terms(%L, 1)$$, (select v from t_ids where k = 'b4')));
select pg_temp.check(pg_temp.as_role('authenticated', pg_temp.u(2), format($$select public.accept_terms(%L, 1)::text$$, (select v from t_ids where k = 'b4'))) = 'confirmed', 'a second, non-overlapping booking was not confirmed');
select pg_temp.as_role('authenticated', pg_temp.u(2), format($$select public.cancel_booking(%L, 'plans changed')$$, (select v from t_ids where k = 'b1')));
select pg_temp.check((select status::text = 'cancelled' and cancelled_by = pg_temp.u(2) from public.bookings where id = (select v::uuid from t_ids where k = 'b1')), 'the cancelled booking is wrong');
select pg_temp.check((select locked from public.pets where id = :'rex'), 'cancelling one booking unlocked a pet that is confirmed elsewhere');
select pg_temp.fails_as('authenticated', pg_temp.u(1), format($$select * from public.get_booking_location(%L)$$, (select v from t_ids where k = 'b1')), 'the location of a cancelled booking');
select pg_temp.fails_as('authenticated', pg_temp.u(1), format($$select public.cancel_booking(%L, 'x')$$, (select v from t_ids where k = 'b1')), 'a booking was cancelled twice');
select pg_temp.as_role('authenticated', pg_temp.u(1), format($$select public.cancel_booking(%L, 'x')$$, (select v from t_ids where k = 'b4')));
select pg_temp.check((select not locked from public.pets where id = :'rex'), 'cancelling the last confirmed booking should unlock the pet');
-- the pet is free again: B2 can now be confirmed
select pg_temp.check(pg_temp.as_role('authenticated', pg_temp.u(4), format($$select public.accept_terms(%L, 1)::text$$, (select v from t_ids where k = 'b2'))) = 'confirmed', 'the second booking should confirm once the pet is free');
select pg_temp.check((select locked from public.pets where id = :'rex'), 'the pet should be locked again');
select pg_temp.as_role('authenticated', pg_temp.u(1), format($$select public.cancel_booking(%L, 'x')$$, (select v from t_ids where k = 'b2')));
-- an owner-home stay releases the owner's location instead
select pg_temp.setloc(1, 28.55, 34.45);
insert into t_ids select 'b5', pg_temp.as_role('authenticated', pg_temp.u(1), format($$select public.request_booking(%L, %L, (now() at time zone 'Africa/Cairo')::date + 40, (now() at time zone 'Africa/Cairo')::date + 42, 'owner_home', 'paid', 150, false)::text$$, pg_temp.u(2), :'rex'));
select pg_temp.as_role('authenticated', pg_temp.u(1), format($$select public.accept_terms(%L, 1)$$, (select v from t_ids where k = 'b5')));
select pg_temp.as_role('authenticated', pg_temp.u(2), format($$select public.accept_terms(%L, 1)$$, (select v from t_ids where k = 'b5')));
select pg_temp.check(pg_temp.as_role('authenticated', pg_temp.u(2), format($$select lat::text from public.get_booking_location(%L)$$, (select v from t_ids where k = 'b5'))) = (select lat::text from private.locations where user_id = pg_temp.u(1)), 'an owner-home stay should release the owner''s location');
select pg_temp.as_role('authenticated', pg_temp.u(2), format($$select public.cancel_booking(%L, 'x')$$, (select v from t_ids where k = 'b5')));
select pg_temp.check((select not locked from public.pets where id = :'rex'), 'the pet is still locked at the end');

\echo '--- M7 map of availability'
select pg_temp.person(60, 'sitter', 'Map1'); select pg_temp.setloc(60, 28.4987654, 34.5123456); select pg_temp.avail(60, '{dog,cat}', 1, 20);
select pg_temp.person(61, 'sitter', 'Map2'); select pg_temp.setloc(61, 28.46, 34.52);   select pg_temp.avail(61, '{cat}', 5, 25);
select pg_temp.person(62, 'sitter', 'Map3'); select pg_temp.setloc(62, 28.47, 34.53);   select pg_temp.avail(62, '{dog,cat}', 1, 20); select pg_temp.setpaid(62, null);      -- unpaid
select pg_temp.person(63, 'sitter', 'Map4'); select pg_temp.setloc(63, 28.48, 34.54);   select pg_temp.avail(63, '{dog,cat}', 1, 20); select pg_temp.setpaid(63, -1);        -- paused
select pg_temp.person(64, 'sitter', 'Map5'); select pg_temp.setloc(64, 28.49, 34.55);   select pg_temp.avail(64, '{dog,cat}', 1, 20);                                       -- blocked by the caller
select pg_temp.person(65, 'sitter', 'Map6'); select pg_temp.setloc(65, 28.50, 34.56);   select pg_temp.avail(65, '{dog,cat}', 1, 20); update public.profiles set status = 'suspended' where id = pg_temp.u(65);
select pg_temp.person(66, 'sitter', 'Map7'); select pg_temp.setloc(66, 28.51, 34.57);   insert into public.availability (user_id, starts_on, ends_on, pets_accepted, offers) values (pg_temp.u(66), (now() at time zone 'Africa/Cairo')::date - 10, (now() at time zone 'Africa/Cairo')::date - 1, '{dog,cat}', array['paid']);   -- ended yesterday
select pg_temp.person(67, 'sitter', 'Map8');                                            select pg_temp.avail(67, '{dog,cat}', 1, 20);                                          -- no location, so no area on the map
select pg_temp.person(68, 'owner', 'Mapper');
select pg_temp.person(69, 'sitter', 'Map9'); select pg_temp.setloc(69, 28.52, 34.58);   insert into public.availability (user_id, starts_on, ends_on, pets_accepted, offers) values (pg_temp.u(69), (now() at time zone 'Africa/Cairo')::date - 5, (now() at time zone 'Africa/Cairo')::date, '{dog,cat}', array['paid']);          -- ends today: still open
insert into public.blocks (blocker_id, blocked_id) values (pg_temp.u(68), pg_temp.u(64));
create or replace function pg_temp.mapped(p_caller integer, p_type text, p_limit integer default 300) returns text language sql as $$
  select coalesce(pg_temp.as_role('authenticated', pg_temp.u(p_caller),
    format($q$select string_agg(right(user_id::text, 2), ',' order by user_id) from public.map_availability(%L, %s) where user_id::text like 'f7f7f7f7-0000-0000-0000-0000000000%%' and right(user_id::text, 2)::integer >= 60$q$, p_type, p_limit)), '') $$;
select pg_temp.check(pg_temp.mapped(68, null) = '60,61,69', 'the map shows the wrong hosts: ' || pg_temp.mapped(68, null));
select pg_temp.check(pg_temp.mapped(68, 'cat') = '60,61,69', 'the cat filter: ' || pg_temp.mapped(68, 'cat'));
select pg_temp.check(pg_temp.mapped(68, 'dog') = '60,69', 'the dog filter: ' || pg_temp.mapped(68, 'dog'));
select pg_temp.check(pg_temp.mapped(68, 'other') = '', 'the other filter: ' || pg_temp.mapped(68, 'other'));
select pg_temp.check(pg_temp.count_as(pg_temp.u(68), 'select count(*) from public.map_availability(null, 1)') = 1, 'the limit of 1 was not respected');
select pg_temp.check(pg_temp.count_as(pg_temp.u(68), 'select count(*) from public.map_availability(null, 0)') = 1, 'a limit of 0 should still give at most one row');
select pg_temp.check(pg_temp.count_as(pg_temp.u(68), 'select count(*) from public.map_availability(null, -5)') = 1, 'a negative limit should give one row');
select pg_temp.check(pg_temp.count_as(pg_temp.u(68), 'select count(*) from public.map_availability(null, 1000000)') <= 300, 'the limit is not capped at 300');
select pg_temp.check(pg_temp.count_as(pg_temp.u(68), 'select count(*) from public.map_availability(null, null)') >= 3, 'a null limit should use the default');
-- the caller never sees their own post, a blocked host or a paused one
select pg_temp.check(pg_temp.mapped(60, null) = '61,64,69', 'a host sees their own post on the map: ' || pg_temp.mapped(60, null));
select pg_temp.check(pg_temp.count_as(pg_temp.u(60), format('select count(*) from public.map_availability(null, 300) where user_id = %L', pg_temp.u(60))) = 0, 'own post on the map');
select pg_temp.check(pg_temp.count_as(pg_temp.u(64), format('select count(*) from public.map_availability(null, 300) where user_id = %L', pg_temp.u(68))) = 0, 'an owner appears on the map');
select pg_temp.check(pg_temp.mapped(64, null) = '60,61,69', 'a blocked host should see the others but the blocker has no posts: ' || pg_temp.mapped(64, null));
select pg_temp.check(pg_temp.count_as(pg_temp.u(1), format('select count(*) from public.map_availability(null, 300) where user_id = %L', pg_temp.u(64))) = 1, 'blocked host should still show for people who did not block them');
-- approximate coordinates only
select pg_temp.check(pg_temp.as_role('authenticated', pg_temp.u(68), format($$select approx_lat::text from public.map_availability(null, 300) where user_id = %L$$, pg_temp.u(60))) = (select approx_lat::text from public.profiles where id = pg_temp.u(60)), 'the map latitude is not the profile''s approximate latitude');
select pg_temp.check(pg_temp.as_role('authenticated', pg_temp.u(68), format($$select approx_lng::text from public.map_availability(null, 300) where user_id = %L$$, pg_temp.u(60))) = (select approx_lng::text from public.profiles where id = pg_temp.u(60)), 'the map longitude is not the profile''s approximate longitude');
select pg_temp.check((select approx_lat is not null and approx_lng is not null and approx_lat = round(approx_lat::numeric, 3) and approx_lng = round(approx_lng::numeric, 3) from public.profiles where id = pg_temp.u(60)), 'the approximate position is not rounded to 3 decimals');
select pg_temp.check(pg_temp.as_role('authenticated', pg_temp.u(68), format($$select row_to_json(m)::text from public.map_availability(null, 300) m where user_id = %L$$, pg_temp.u(60))) !~ '28\.4987654|34\.5123456|Secret street', 'the map leaked the exact position or the address');
select pg_temp.check(not exists (select 1 from pg_proc p where p.proname = 'map_availability' and p.pronamespace = 'public'::regnamespace and (p.proargnames && array['lat', 'lng', 'address', 'exact_lat', 'exact_lng'])), 'the map function exposes exact columns');
select pg_temp.check(pg_temp.as_role('authenticated', pg_temp.u(68), format($$select (offers = array['paid'] and price_per_night = 100 and first_name = 'Map1')::text from public.map_availability(null, 300) where user_id = %L$$, pg_temp.u(60))) = 'true', 'the map row has the wrong public details');
select pg_temp.fails_as('anon', null, $$select count(*) from public.map_availability(null, 10)$$, 'anon read the map');
select pg_temp.fails_as('authenticated', pg_temp.u(68), $$insert into public.availability (user_id, starts_on, ends_on, pets_accepted, offers) values (auth.uid(), (now() at time zone 'Africa/Cairo')::date + 1, (now() at time zone 'Africa/Cairo')::date + 5, '{dog}', array['paid'])$$, 'an owner posted availability');
select pg_temp.fails(format($$insert into public.availability (user_id, starts_on, ends_on, pets_accepted, offers) values (%L, (now() at time zone 'Africa/Cairo')::date + 1, (now() at time zone 'Africa/Cairo')::date + 5, '{dog}', array['swap'])$$, pg_temp.u(60)), 'a swap offer was stored');

\echo '--- M8 the clean-up list'
select pg_temp.new_user(pg_temp.u(50), 'p50-b1@example.com', 'owner');
select pg_temp.new_user(pg_temp.u(51), 'p51-b1@example.com', 'owner');
insert into storage.objects (bucket_id, name, created_at) values
  ('ids',      pg_temp.u(50)::text || '/idref.jpg',     now() - interval '2 hours'),     -- used by the pending request
  ('ids',      pg_temp.u(50)::text || '/idorphan.jpg',  now() - interval '2 hours'),     -- nobody uses it
  ('ids',      pg_temp.u(50)::text || '/idfresh.jpg',   now()),                          -- too new to judge
  ('payments', pg_temp.u(51)::text || '/shotref.jpg',   now() - interval '2 hours'),
  ('payments', pg_temp.u(51)::text || '/shotorphan.jpg', now() - interval '2 hours'),
  ('payments', pg_temp.u(51)::text || '/shotfresh.jpg', now()),
  ('incoming', pg_temp.u(50)::text || '/raw_old.jpg',   now() - interval '2 hours'),
  ('incoming', pg_temp.u(50)::text || '/raw_new.jpg',   now()),
  ('faces',    pg_temp.u(50)::text || '/face_ref.jpg',  now() - interval '30 days'),     -- used by the pending request
  ('faces',    pg_temp.u(50)::text || '/face_old.jpg',  now() - interval '30 days'),     -- unused for a month
  ('faces',    pg_temp.u(50)::text || '/face_3d.jpg',   now() - interval '3 days');      -- a selfie waits a week for review
insert into public.verification_requests (user_id, face_path, id_path) values (pg_temp.u(50), pg_temp.u(50)::text || '/face_ref.jpg', pg_temp.u(50)::text || '/idref.jpg');
insert into public.payment_claims (user_id, kind, amount_egp, screenshot_path) values (pg_temp.u(51), 'registration', 75, pg_temp.u(51)::text || '/shotref.jpg');
create or replace function pg_temp.unused() returns text language sql as $$
  select coalesce(pg_temp.as_role('service_role', null,
    format($q$select string_agg(bucket_id || ':' || right(name, length(name) - 37), ',' order by bucket_id, name) from public.list_unused_uploads() where name like %L or name like %L$q$, pg_temp.u(50)::text || '/%', pg_temp.u(51)::text || '/%')), '') $$;
select pg_temp.check(pg_temp.unused() = 'faces:face_old.jpg,ids:idorphan.jpg,incoming:raw_old.jpg,payments:shotorphan.jpg', 'the clean-up list is wrong: ' || pg_temp.unused());
-- once the founder decides, the ID photo and the screenshot are not needed any more
select pg_temp.adm(format($$select public.admin_decide_verification(%L, false, null, 'Please retake the photos')$$, pg_temp.u(50)));
select pg_temp.adm(format($$select public.admin_confirm_payment(%L, true, null)$$, pg_temp.claim_of(51)));
select pg_temp.check(pg_temp.unused() = 'faces:face_old.jpg,ids:idorphan.jpg,ids:idref.jpg,incoming:raw_old.jpg,payments:shotorphan.jpg,payments:shotref.jpg', 'a decided request or claim is still protected in the clean-up list: ' || pg_temp.unused());
select pg_temp.fails_as('anon', null, $$select count(*) from public.list_unused_uploads()$$, 'anon listed uploads');
select pg_temp.fails_as('authenticated', pg_temp.u(50), $$select count(*) from public.list_unused_uploads()$$, 'a person listed uploads');
select pg_temp.fails_aal('aal2', pg_temp.u(5), $$select count(*) from public.list_unused_uploads()$$, 'an admin listed uploads through the API');
select pg_temp.fails_as('authenticated', pg_temp.u(50), $$select count(*) from public.list_unused_uploads(interval '0 seconds')$$, 'a person listed uploads with a zero age');

\echo '--- M9 the removed things are gone, and the new ones are closed'
select pg_temp.check(to_regproc('public.confirm_booking_payment') is null, 'confirm_booking_payment still exists');
select pg_temp.check(to_regproc('public.request_swap') is null, 'request_swap still exists');
select pg_temp.check(to_regproc('public.begin_fee_payment') is null, 'begin_fee_payment still exists');
select pg_temp.check(to_regproc('public.complete_fee_payment') is null and to_regproc('public.fail_fee_payment') is null, 'a fee function still exists');
select pg_temp.check(to_regproc('public.refund_preview') is null and to_regproc('public.list_refunds_due') is null and to_regproc('public.mark_refund_result') is null, 'a refund function still exists');
select pg_temp.check(to_regproc('public.otp_check_and_log') is null and to_regproc('private.otp_check_and_log') is null and to_regproc('public.otp_record_result') is null, 'an OTP function still exists');
select pg_temp.check(to_regproc('public.my_signup_state') is null, 'my_signup_state still exists');
select pg_temp.check(to_regproc('public.record_verification') is null and to_regproc('public.set_verification') is null, 'an old verification function still exists');
select pg_temp.check(to_regproc('public.handle_phone_confirmed') is null, 'the phone confirmation function still exists');
select pg_temp.check(to_regclass('public.booking_payments') is null, 'booking_payments still exists');
select pg_temp.check(to_regclass('private.otp_events') is null, 'otp_events still exists');
select pg_temp.check(to_regtype('public.fee_status') is null, 'the fee_status type still exists');
select pg_temp.check(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'phone_verified'), 'profiles still has phone_verified');
select pg_temp.check(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bookings' and column_name in ('fee_status', 'opened_by', 'swap_group')), 'bookings still has a fee or swap column');
select pg_temp.check(not exists (select 1 from information_schema.columns where table_schema = 'public' and column_name like '%phone%'), 'a phone column still exists in public');
select pg_temp.check(not exists (select 1 from pg_trigger where tgname = 'on_auth_phone_confirmed'), 'the phone trigger still exists');
select pg_temp.check(not exists (select 1 from public.banned_identifiers where kind = 'phone'), 'a phone ban survived');
select pg_temp.fails($$insert into public.banned_identifiers (kind, hash) values ('phone', 'abc')$$, 'a phone ban was accepted');
select pg_temp.check(not exists (select 1 from public.availability where 'swap' = any (offers)), 'a swap offer survived');
-- security basics of the new objects
select pg_temp.check((select bool_and(relrowsecurity) from pg_class where oid in ('public.app_settings'::regclass, 'public.memberships'::regclass, 'public.verification_requests'::regclass, 'public.payment_claims'::regclass)), 'a new table has no row level security');
select pg_temp.check(not has_table_privilege('anon', 'public.payment_claims', 'insert, update, delete') and not has_table_privilege('authenticated', 'public.payment_claims', 'insert, update, delete')
                 and not has_table_privilege('authenticated', 'public.verification_requests', 'insert, update, delete') and not has_table_privilege('authenticated', 'public.memberships', 'insert, update, delete')
                 and not has_table_privilege('authenticated', 'public.app_settings', 'insert, update, delete'), 'a client role can write a new table');
select pg_temp.check((select bool_and(not has_function_privilege('anon', f, 'execute')) from unnest(array[
    'public.my_account_state()', 'public.submit_profile()', 'public.submit_verification(text, text)', 'public.get_payment_settings()', 'public.submit_payment_claim(text, text)',
    'public.admin_decide_verification(uuid, boolean, boolean, text)', 'public.admin_confirm_payment(uuid, boolean, text)', 'public.admin_set_setting(text, text)', 'public.admin_overview()',
    'public.list_due_reminders()', 'public.mark_reminded(uuid, date)', 'public.list_unused_uploads(interval)', 'public.map_availability(public.pet_type, integer)',
    'public.accept_terms(uuid, integer)', 'public.cancel_booking(uuid, text)', 'public.get_booking_location(uuid)']) f), 'anon can run a new function');
select pg_temp.check((select bool_and(not has_function_privilege('authenticated', f, 'execute') and has_function_privilege('service_role', f, 'execute')) from unnest(array[
    'public.list_due_reminders()', 'public.mark_reminded(uuid, date)', 'public.list_unused_uploads(interval)']) f), 'the service-only functions are not service-only');
select pg_temp.check((select bool_and(not has_function_privilege('authenticated', f, 'execute')) from unnest(array['private.identity_hashes(uuid)', 'private.setting_int(text, integer)', 'private.grant_admin(text)']) f), 'a private function can be run by a signed-in person');
select pg_temp.check((select count(*) = 0 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.proname in ('my_account_state', 'submit_profile', 'submit_verification', 'get_payment_settings', 'submit_payment_claim', 'admin_decide_verification', 'admin_confirm_payment', 'admin_set_setting', 'list_due_reminders', 'mark_reminded', 'list_unused_uploads', 'accept_terms', 'cancel_booking', 'request_booking')
                   and (p.proconfig is null or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))), 'a security definer function has no fixed search_path');

-- put the shared settings back as every other file expects them
select pg_temp.check((select count(*) = 11 from public.app_settings) and (select value = '75' from public.app_settings where key = 'registration_fee_egp') and (select value = '25' from public.app_settings where key = 'renewal_fee_egp'), 'the settings are not back to the defaults');

\echo '--- M2b a valid https link is accepted (kept last: it fails today, see the report on migration 0013)'
select pg_temp.adm($$select public.admin_set_setting('instapay_link', 'https://ipn.eg/S/pawspal')$$);
select pg_temp.check((select value = 'https://ipn.eg/S/pawspal' from public.app_settings where key = 'instapay_link'), 'a valid https link was not stored');
select pg_temp.adm($$select public.admin_set_setting('instapay_qr_url', 'https://x.example/qr.png')$$);
select pg_temp.adm($$select public.admin_set_setting('instapay_link', '')$$);
select pg_temp.adm($$select public.admin_set_setting('instapay_qr_url', '')$$);

\echo 'membership assertions OK'

-- review fixes: reminder carries the renewal fee, helper oracles closed to anon, verification tries are counted
select pg_temp.check(not has_function_privilege('anon', 'public.is_active(uuid)', 'execute') and not has_function_privilege('anon', 'public.has_confirmed_booking(uuid, uuid)', 'execute')
                 and not has_function_privilege('anon', 'public.is_blocked_between(uuid, uuid)', 'execute'), 'anon can call a helper that answers questions about people');
select pg_temp.check(private.today() = (now() at time zone 'Africa/Cairo')::date, 'today is not the Cairo date');
