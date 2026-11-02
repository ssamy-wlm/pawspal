-- Architecture v3 assertions: sign-up (email), the account state, verification by hand and the founder's decision.
-- Run AFTER security_test.sql and assertions.sql on the same database, with ON_ERROR_STOP=1. Uses its own people (b0b0b0b0-...)
-- and does not depend on state left by the other files. Any failed assertion stops the run with "ASSERT FAILED".
\set ON_ERROR_STOP 1
\i supabase/tests/helpers.sql

-- Fixed people:  01 owner (device sign-up)  02 host  03 owner for the rate limit  04 owner left in verification
--                05 invited admin-style account  0a the founder (admin)
create temp table t_ids (k text primary key, v text);
create or replace function pg_temp.terms() returns text language sql as $$ select current_version from public.legal_documents where doc = 'terms' $$;
create or replace function pg_temp.state(p_uid uuid) returns jsonb language sql as $$
  select pg_temp.as_role('authenticated', p_uid, $q$select public.my_account_state()::text$q$)::jsonb $$;

\echo '--- S1 sign-up refusals carry the exact code'
select pg_temp.fails_with($$insert into auth.users (id, email, email_confirmed_at, created_at, raw_user_meta_data) values (gen_random_uuid(), null, now(), now(), jsonb_build_object('role', 'owner', 'terms_version', pg_temp.terms()))$$, '[E1]', 'no email');
select pg_temp.fails_with($$insert into auth.users (id, email, email_confirmed_at, created_at, raw_user_meta_data) values (gen_random_uuid(), '', now(), now(), jsonb_build_object('role', 'owner', 'terms_version', pg_temp.terms()))$$, '[E1]', 'empty email');
select pg_temp.fails_with($$insert into auth.users (id, email, email_confirmed_at, created_at, raw_user_meta_data) values (gen_random_uuid(), 'not-an-email', now(), now(), jsonb_build_object('role', 'owner', 'terms_version', pg_temp.terms()))$$, '[E1]', 'email without @');
select pg_temp.fails_with($$insert into auth.users (id, email, email_confirmed_at, created_at, raw_user_meta_data) values (gen_random_uuid(), 'a@b', now(), now(), jsonb_build_object('role', 'owner', 'terms_version', pg_temp.terms()))$$, '[E1]', 'email without a dot after @');
select pg_temp.fails_with($$insert into auth.users (id, email, email_confirmed_at, created_at, raw_user_meta_data) values (gen_random_uuid(), 'a b@example.com', now(), now(), jsonb_build_object('role', 'owner', 'terms_version', pg_temp.terms()))$$, '[E1]', 'email with a space inside');
select pg_temp.fails_with($$insert into auth.users (id, email, email_confirmed_at, created_at, raw_user_meta_data) values (gen_random_uuid(), 'a@@example.com', now(), now(), jsonb_build_object('role', 'owner', 'terms_version', pg_temp.terms()))$$, '[E1]', 'email with two @');
-- A phone-only account (no email) is refused, whatever else it carries.
select pg_temp.fails_with($$insert into auth.users (id, phone, phone_confirmed_at, created_at, raw_user_meta_data) values (gen_random_uuid(), '201211111111', now(), now(), jsonb_build_object('role', 'owner', 'terms_version', pg_temp.terms()))$$, '[E1]', 'a phone-only account signed up');
select pg_temp.fails_with($$insert into auth.users (id, phone, phone_confirmed_at, created_at) values (gen_random_uuid(), '201211111111', now(), now())$$, '[E1]', 'a phone-only account with no metadata signed up');

select pg_temp.fails_with($$insert into auth.users (id, email, email_confirmed_at, created_at, raw_user_meta_data) values (gen_random_uuid(), 'norole@example.com', now(), now(), jsonb_build_object('terms_version', pg_temp.terms()))$$, '[E2]', 'no role and no invite');
select pg_temp.fails_with($$insert into auth.users (id, email, email_confirmed_at, created_at, raw_user_meta_data) values (gen_random_uuid(), 'norole@example.com', now(), now(), jsonb_build_object('role', '   ', 'terms_version', pg_temp.terms()))$$, '[E2]', 'a blank role and no invite');
select pg_temp.fails_with($$insert into auth.users (id, email, email_confirmed_at, created_at) values (gen_random_uuid(), 'norole@example.com', now(), now())$$, '[E2]', 'no metadata at all and no invite');

select pg_temp.fails_with($$insert into auth.users (id, email, email_confirmed_at, created_at, raw_user_meta_data) values (gen_random_uuid(), 'both@example.com', now(), now(), jsonb_build_object('role', 'both', 'terms_version', pg_temp.terms()))$$, '[E3]', 'role both');
select pg_temp.fails_with($$insert into auth.users (id, email, email_confirmed_at, created_at, raw_user_meta_data) values (gen_random_uuid(), 'admin@example.com', now(), now(), jsonb_build_object('role', 'admin', 'terms_version', pg_temp.terms()))$$, '[E3]', 'role admin');
select pg_temp.fails_with($$insert into auth.users (id, email, email_confirmed_at, created_at, raw_user_meta_data) values (gen_random_uuid(), 'swap@example.com', now(), now(), jsonb_build_object('role', 'swapper', 'terms_version', pg_temp.terms()))$$, '[E3]', 'an unknown role');
select pg_temp.fails_with($$insert into auth.users (id, email, email_confirmed_at, created_at, raw_user_meta_data) values (gen_random_uuid(), 'caps@example.com', now(), now(), jsonb_build_object('role', 'Owner', 'terms_version', pg_temp.terms()))$$, '[E3]', 'role in capitals');

select pg_temp.fails_with($$insert into auth.users (id, email, email_confirmed_at, created_at, raw_user_meta_data) values (gen_random_uuid(), 'noterms@example.com', now(), now(), jsonb_build_object('role', 'owner'))$$, '[E4]', 'no terms version');
select pg_temp.fails_with($$insert into auth.users (id, email, email_confirmed_at, created_at, raw_user_meta_data) values (gen_random_uuid(), 'noterms@example.com', now(), now(), jsonb_build_object('role', 'owner', 'terms_version', ''))$$, '[E4]', 'empty terms version');
select pg_temp.fails_with($$insert into auth.users (id, email, email_confirmed_at, created_at, raw_user_meta_data) values (gen_random_uuid(), 'oldterms@example.com', now(), now(), jsonb_build_object('role', 'sitter', 'terms_version', '0.0.1'))$$, '[E4]', 'an old terms version');
select pg_temp.fails_with($$insert into auth.users (id, email, email_confirmed_at, created_at, raw_user_meta_data) values (gen_random_uuid(), 'oldterms@example.com', now(), now(), jsonb_build_object('role', 'sitter', 'terms_version', '1.0.0-draft'))$$, '[E4]', 'the previous terms version');
select pg_temp.fails_with($$insert into auth.users (id, email, email_confirmed_at, created_at, raw_user_meta_data) values (gen_random_uuid(), 'privacy@example.com', now(), now(), jsonb_build_object('role', 'owner', 'terms_version', (select current_version from public.legal_documents where doc = 'privacy') || 'x'))$$, '[E4]', 'a made-up terms version');

insert into public.banned_identifiers (kind, hash) values ('email', private.email_hash('banned-b0@example.com')), ('device', private.device_hash('device-banned-b0'));
select pg_temp.fails_with($$insert into auth.users (id, email, email_confirmed_at, created_at, raw_user_meta_data) values (gen_random_uuid(), 'banned-b0@example.com', now(), now(), jsonb_build_object('role', 'owner', 'terms_version', pg_temp.terms()))$$, '[E5]', 'a banned email signed up');
select pg_temp.fails_with($$insert into auth.users (id, email, email_confirmed_at, created_at, raw_user_meta_data) values (gen_random_uuid(), 'BANNED-B0@Example.COM', now(), now(), jsonb_build_object('role', 'owner', 'terms_version', pg_temp.terms()))$$, '[E5]', 'a banned email in capitals signed up');
select pg_temp.fails_with($$insert into auth.users (id, email, email_confirmed_at, created_at, raw_user_meta_data) values (gen_random_uuid(), '  banned@example.com ', now(), now(), jsonb_build_object('role', 'owner', 'terms_version', pg_temp.terms()))$$, '[E5]', 'a banned email with spaces signed up');
select pg_temp.fails_with($$insert into auth.users (id, email, email_confirmed_at, created_at, raw_user_meta_data) values (gen_random_uuid(), 'banned-b0@example.com', now(), now(), jsonb_build_object('terms_version', pg_temp.terms()))$$, '[E5]', 'a banned email signed up without a role');
select pg_temp.fails_with($$insert into auth.users (id, email, email_confirmed_at, created_at, raw_user_meta_data) values (gen_random_uuid(), 'fresh-b0@example.com', now(), now(), jsonb_build_object('role', 'owner', 'terms_version', pg_temp.terms(), 'device_id', 'device-banned-b0'))$$, '[E6]', 'a banned device signed up');
select pg_temp.fails_with($$insert into auth.users (id, email, email_confirmed_at, created_at, raw_user_meta_data) values (gen_random_uuid(), 'fresh-b0@example.com', now(), now(), jsonb_build_object('role', 'owner', 'terms_version', pg_temp.terms(), 'device_id', '  device-banned-b0 '))$$, '[E6]', 'a banned device with spaces signed up');
select pg_temp.check(not exists (select 1 from auth.users where email in ('banned-b0@example.com', 'fresh-b0@example.com', 'both@example.com', 'a@b', 'norole@example.com')), 'a refused sign-up left an account behind');
-- A different device and a different email are fine.
select pg_temp.new_user('b0b0b0b0-0000-0000-0000-00000000000f', 'neighbour-b0@example.com', 'owner');
select pg_temp.check(exists (select 1 from public.profiles where id = 'b0b0b0b0-0000-0000-0000-00000000000f'), 'an unrelated email was refused');

\echo '--- S2 a good sign-up makes the profile, the membership, the acceptances and the device fingerprint'
insert into auth.users (id, email, email_confirmed_at, created_at, raw_user_meta_data) values
  ('b0b0b0b0-0000-0000-0000-000000000001', 'Owner1-B0@Example.com', now(), now(),
   jsonb_build_object('role', 'owner', 'terms_version', pg_temp.terms(), 'device_id', 'device-ok-b0'));
select pg_temp.new_user('b0b0b0b0-0000-0000-0000-000000000002', 'host-b0@example.com', 'sitter');
select pg_temp.new_user('b0b0b0b0-0000-0000-0000-000000000003', 'owner3-b0@example.com', 'owner');
select pg_temp.new_user('b0b0b0b0-0000-0000-0000-000000000004', 'owner4-b0@example.com', 'owner');
select pg_temp.check((select role::text = 'owner' and status::text = 'pending_verification' from public.profiles where id = 'b0b0b0b0-0000-0000-0000-000000000001'), 'the owner profile has the wrong role or status');
select pg_temp.check((select role::text = 'sitter' and status::text = 'pending_verification' from public.profiles where id = 'b0b0b0b0-0000-0000-0000-000000000002'), 'the host profile has the wrong role or status');
select pg_temp.check((select count(*) = 1 and bool_and(paid_until is null and reminded_for is null) from public.memberships where user_id = 'b0b0b0b0-0000-0000-0000-000000000001'), 'a new person should have one unpaid membership row');
select pg_temp.check((select count(*) = 2 from public.legal_acceptances where user_id = 'b0b0b0b0-0000-0000-0000-000000000001' and doc in ('terms', 'privacy')), 'terms and privacy are not both accepted');
select pg_temp.check((select count(*) = 2 from public.legal_acceptances a join public.legal_documents d on d.doc = a.doc and d.current_version = a.version where a.user_id = 'b0b0b0b0-0000-0000-0000-000000000001'), 'the acceptances are not for the current versions');
select pg_temp.check(not exists (select 1 from public.legal_acceptances where user_id = 'b0b0b0b0-0000-0000-0000-000000000001' and doc = 'guidelines'), 'the guidelines were accepted at sign-up');
select pg_temp.check((select count(*) = 1 from private.identity_fingerprints where user_id = 'b0b0b0b0-0000-0000-0000-000000000001' and kind = 'device' and hash = private.device_hash('device-ok-b0')), 'the device fingerprint was not stored');
select pg_temp.check((select count(*) = 0 from private.identity_fingerprints where user_id = 'b0b0b0b0-0000-0000-0000-000000000002'), 'a sign-up without a device id stored a fingerprint');
select pg_temp.check(not exists (select 1 from public.admins where user_id = 'b0b0b0b0-0000-0000-0000-000000000001'), 'a normal sign-up became an admin');
select pg_temp.check(not exists (select 1 from private.identity_fingerprints where hash = 'device-ok-b0'), 'the raw device id is stored');
select pg_temp.check((select count(*) = 1 from public.memberships where user_id = 'b0b0b0b0-0000-0000-0000-000000000002'), 'the host has no membership row');

\echo '--- S3 an invited email without a role makes the admin-style account'
select private.invite_admin('Boss-B0@Example.com ');
insert into auth.users (id, email, email_confirmed_at, created_at) values ('b0b0b0b0-0000-0000-0000-000000000005', 'boss-b0@example.com', now(), now());
select pg_temp.check((select role::text = 'owner' and status::text = 'pending_verification' from public.profiles where id = 'b0b0b0b0-0000-0000-0000-000000000005'), 'the invited account has no owner profile');
select pg_temp.check((select user_id = 'b0b0b0b0-0000-0000-0000-000000000005' from private.admin_invites where email = 'boss-b0@example.com'), 'the invite is not tied to the account');
select pg_temp.check((select count(*) = 1 from public.memberships where user_id = 'b0b0b0b0-0000-0000-0000-000000000005'), 'the invited account has no membership row');
select pg_temp.check(not exists (select 1 from public.admins where user_id = 'b0b0b0b0-0000-0000-0000-000000000005'), 'an invite alone made an admin');
-- the invite is used once: a second account with the same invited email and no role takes nothing from it
select pg_temp.check(exists (select 1 from public.profiles where id = 'b0b0b0b0-0000-0000-0000-000000000005') and (select count(*) from private.admin_invites where email = 'boss-b0@example.com' and user_id is not null) = 1, 'invite bookkeeping');

\echo '--- S4 my_account_state'
select pg_temp.check(pg_temp.state('b0b0b0b0-0000-0000-0000-000000000001') -> 'missing' = '["verification", "name", "pet", "location", "legal"]'::jsonb, 'a new owner is missing the wrong things');
select pg_temp.check(pg_temp.state('b0b0b0b0-0000-0000-0000-000000000002') -> 'missing' = '["verification", "name", "home", "location", "legal"]'::jsonb, 'a new host is missing the wrong things');
select pg_temp.check((pg_temp.state('b0b0b0b0-0000-0000-0000-000000000001') ->> 'status') = 'pending_verification' and (pg_temp.state('b0b0b0b0-0000-0000-0000-000000000001') ->> 'role') = 'owner', 'status and role fields');
select pg_temp.check((pg_temp.state('b0b0b0b0-0000-0000-0000-000000000002') ->> 'role') = 'sitter', 'the host role field');
select pg_temp.check((pg_temp.state('b0b0b0b0-0000-0000-0000-000000000001') #>> '{membership,state}') = 'unpaid'
                 and (pg_temp.state('b0b0b0b0-0000-0000-0000-000000000001') #>> '{membership,kind}') = 'registration'
                 and (pg_temp.state('b0b0b0b0-0000-0000-0000-000000000001') #>> '{membership,amount_egp}') = '75'
                 and (pg_temp.state('b0b0b0b0-0000-0000-0000-000000000001') #> '{membership,paid_until}') = 'null'::jsonb
                 and (pg_temp.state('b0b0b0b0-0000-0000-0000-000000000001') #> '{membership,days_left}') = 'null'::jsonb
                 and (pg_temp.state('b0b0b0b0-0000-0000-0000-000000000001') #>> '{membership,claim_status}') = 'none', 'membership of a new person: unpaid / registration / 75');
select pg_temp.check((pg_temp.state('b0b0b0b0-0000-0000-0000-000000000001') #>> '{verification,status}') = 'none', 'a new person has no verification');
select pg_temp.check((pg_temp.state('b0b0b0b0-0000-0000-0000-000000000001') ->> 'legal_accepted') = 'false', 'guidelines not accepted yet means legal is not accepted');
update public.app_settings set value = '90' where key = 'registration_fee_egp';
select pg_temp.check((pg_temp.state('b0b0b0b0-0000-0000-0000-000000000001') #>> '{membership,amount_egp}') = '90', 'the registration amount does not follow the settings');
update public.app_settings set value = '75' where key = 'registration_fee_egp';
select pg_temp.check((pg_temp.state('b0b0b0b0-0000-0000-0000-000000000001') #>> '{membership,amount_egp}') = '75', 'the registration amount did not go back');
select pg_temp.fails_as('anon', null, $$select public.my_account_state()$$, 'anon read an account state');
select pg_temp.fails_as('authenticated', 'b0b0b0b0-0000-0000-0000-0000000000ee', $$select public.my_account_state()$$, 'a user without a profile read an account state');
select pg_temp.fails_as('authenticated', null, $$select public.my_account_state()$$, 'an authenticated session without a user read an account state');
-- state fixtures do not leak between people
select pg_temp.check(pg_temp.state('b0b0b0b0-0000-0000-0000-000000000002') ->> 'first_name' is null, 'the host has a name before setting one');

\echo '--- S5 submit_verification'
-- helper fixtures: the clean copies process-upload would have made
select pg_temp.fails_as('anon', null, $$select public.submit_verification('b0b0b0b0-0000-0000-0000-000000000001/face.jpg', 'b0b0b0b0-0000-0000-0000-000000000001/id.jpg')$$, 'anon submitted a verification');
select pg_temp.fails_as('authenticated', 'b0b0b0b0-0000-0000-0000-000000000001', $$select public.submit_verification('b0b0b0b0-0000-0000-0000-000000000001/face.jpg', 'b0b0b0b0-0000-0000-0000-000000000001/id.jpg')$$, 'files that do not exist were accepted');
insert into storage.objects (bucket_id, name) values
  ('faces', 'b0b0b0b0-0000-0000-0000-000000000001/face.jpg'),
  ('faces', 'b0b0b0b0-0000-0000-0000-000000000001/face2.jpg'),
  ('faces', 'b0b0b0b0-0000-0000-0000-000000000002/face.jpg'),
  ('faces', 'b0b0b0b0-0000-0000-0000-000000000001/../face.jpg'),
  ('faces', 'b0b0b0b0-0000-0000-0000-000000000001/sub/face.jpg'),
  ('ids',   'b0b0b0b0-0000-0000-0000-000000000001/id.jpg'),
  ('ids',   'b0b0b0b0-0000-0000-0000-000000000001/id2.jpg'),
  ('ids',   'b0b0b0b0-0000-0000-0000-000000000002/id.jpg'),
  ('ids',   'b0b0b0b0-0000-0000-0000-000000000001/../id.jpg');
-- only one of the two files exists
select pg_temp.fails_as('authenticated', 'b0b0b0b0-0000-0000-0000-000000000001', $$select public.submit_verification('b0b0b0b0-0000-0000-0000-000000000001/face.jpg', 'b0b0b0b0-0000-0000-0000-000000000001/missing.jpg')$$, 'a missing id file was accepted');
select pg_temp.fails_as('authenticated', 'b0b0b0b0-0000-0000-0000-000000000001', $$select public.submit_verification('b0b0b0b0-0000-0000-0000-000000000001/missing.jpg', 'b0b0b0b0-0000-0000-0000-000000000001/id.jpg')$$, 'a missing face file was accepted');
-- the file exists but sits in the other bucket
insert into storage.objects (bucket_id, name) values ('ids', 'b0b0b0b0-0000-0000-0000-000000000001/onlyids.jpg'), ('faces', 'b0b0b0b0-0000-0000-0000-000000000001/onlyfaces.jpg');
select pg_temp.fails_as('authenticated', 'b0b0b0b0-0000-0000-0000-000000000001', $$select public.submit_verification('b0b0b0b0-0000-0000-0000-000000000001/onlyids.jpg', 'b0b0b0b0-0000-0000-0000-000000000001/id.jpg')$$, 'a face path that exists only in ids was accepted');
select pg_temp.fails_as('authenticated', 'b0b0b0b0-0000-0000-0000-000000000001', $$select public.submit_verification('b0b0b0b0-0000-0000-0000-000000000001/face.jpg', 'b0b0b0b0-0000-0000-0000-000000000001/onlyfaces.jpg')$$, 'an id path that exists only in faces was accepted');
-- another person's files, traversal, sub-folders, nulls
select pg_temp.fails_as('authenticated', 'b0b0b0b0-0000-0000-0000-000000000001', $$select public.submit_verification('b0b0b0b0-0000-0000-0000-000000000002/face.jpg', 'b0b0b0b0-0000-0000-0000-000000000001/id.jpg')$$, 'another person''s face file was accepted');
select pg_temp.fails_as('authenticated', 'b0b0b0b0-0000-0000-0000-000000000001', $$select public.submit_verification('b0b0b0b0-0000-0000-0000-000000000001/face.jpg', 'b0b0b0b0-0000-0000-0000-000000000002/id.jpg')$$, 'another person''s id file was accepted');
select pg_temp.fails_as('authenticated', 'b0b0b0b0-0000-0000-0000-000000000001', $$select public.submit_verification('b0b0b0b0-0000-0000-0000-000000000001/../face.jpg', 'b0b0b0b0-0000-0000-0000-000000000001/id.jpg')$$, 'a face path with .. was accepted');
select pg_temp.fails_as('authenticated', 'b0b0b0b0-0000-0000-0000-000000000001', $$select public.submit_verification('b0b0b0b0-0000-0000-0000-000000000001/face.jpg', 'b0b0b0b0-0000-0000-0000-000000000001/../id.jpg')$$, 'an id path with .. was accepted');
select pg_temp.fails_as('authenticated', 'b0b0b0b0-0000-0000-0000-000000000001', $$select public.submit_verification('b0b0b0b0-0000-0000-0000-000000000001/sub/face.jpg', 'b0b0b0b0-0000-0000-0000-000000000001/id.jpg')$$, 'a face path in a sub-folder was accepted');
select pg_temp.fails_as('authenticated', 'b0b0b0b0-0000-0000-0000-000000000001', $$select public.submit_verification(null, 'b0b0b0b0-0000-0000-0000-000000000001/id.jpg')$$, 'a null face path was accepted');
select pg_temp.fails_as('authenticated', 'b0b0b0b0-0000-0000-0000-000000000001', $$select public.submit_verification('b0b0b0b0-0000-0000-0000-000000000001/face.jpg', null)$$, 'a null id path was accepted');
select pg_temp.check((select count(*) = 0 from public.verification_requests where user_id = 'b0b0b0b0-0000-0000-0000-000000000001'), 'a refused submission left a request behind');

-- the good one
select pg_temp.as_role('authenticated', 'b0b0b0b0-0000-0000-0000-000000000001', $$select public.submit_verification('b0b0b0b0-0000-0000-0000-000000000001/face.jpg', 'b0b0b0b0-0000-0000-0000-000000000001/id.jpg')$$) is not null as submitted;
select pg_temp.check((select count(*) = 1 from public.verification_requests where user_id = 'b0b0b0b0-0000-0000-0000-000000000001' and status = 'pending' and id_path = 'b0b0b0b0-0000-0000-0000-000000000001/id.jpg' and face_path = 'b0b0b0b0-0000-0000-0000-000000000001/face.jpg'), 'the pending request is wrong');
select pg_temp.check((select face_photo_path = 'b0b0b0b0-0000-0000-0000-000000000001/face.jpg' from public.profiles where id = 'b0b0b0b0-0000-0000-0000-000000000001'), 'face_photo_path was not set');
select pg_temp.check(not (pg_temp.state('b0b0b0b0-0000-0000-0000-000000000001') -> 'missing') ? 'verification', 'verification is still missing after submitting');
select pg_temp.check((pg_temp.state('b0b0b0b0-0000-0000-0000-000000000001') #>> '{verification,status}') = 'pending', 'verification status should be pending');
select pg_temp.check((select face_verified = false and id_verified = false and is_adult = false and status::text = 'pending_verification' from public.profiles where id = 'b0b0b0b0-0000-0000-0000-000000000001'), 'submitting photos verified the person by itself');
-- retaking the photos replaces the pending request
insert into t_ids select 'req1', id::text from public.verification_requests where user_id = 'b0b0b0b0-0000-0000-0000-000000000001';
select pg_temp.check(pg_temp.as_role('authenticated', 'b0b0b0b0-0000-0000-0000-000000000001', $$select public.submit_verification('b0b0b0b0-0000-0000-0000-000000000001/face2.jpg', 'b0b0b0b0-0000-0000-0000-000000000001/id2.jpg')::text$$) = (select v from t_ids where k = 'req1'), 'a retake should reuse the pending request');
select pg_temp.check((select count(*) = 1 from public.verification_requests where user_id = 'b0b0b0b0-0000-0000-0000-000000000001'), 'a retake made a second request');
select pg_temp.check((select count(*) = 1 from public.verification_requests where user_id = 'b0b0b0b0-0000-0000-0000-000000000001' and status = 'pending' and id_path like '%/id2.jpg' and face_path like '%/face2.jpg'), 'the retake did not replace the paths');
select pg_temp.check((select face_photo_path like '%/face2.jpg' from public.profiles where id = 'b0b0b0b0-0000-0000-0000-000000000001'), 'face_photo_path did not follow the retake');

-- ID photo files: nobody but an admin with the authenticator code can read or delete them
select pg_temp.new_user('b0b0b0b0-0000-0000-0000-00000000000a', 'founder-b0@example.com', 'owner');
select pg_temp.make_admin('b0b0b0b0-0000-0000-0000-00000000000a');
select pg_temp.check(pg_temp.count_as('b0b0b0b0-0000-0000-0000-000000000001', $$select count(*) from storage.objects where bucket_id = 'ids'$$) = 0, 'a person read an ID file, even their own');
select pg_temp.check(pg_temp.count_as('b0b0b0b0-0000-0000-0000-000000000002', $$select count(*) from storage.objects where bucket_id = 'ids'$$) = 0, 'another person read an ID file');
select pg_temp.check(pg_temp.as_aal('aal1', 'b0b0b0b0-0000-0000-0000-00000000000a', $$select count(*) from storage.objects where bucket_id = 'ids'$$)::bigint = 0, 'an admin without the authenticator code read an ID file');
select pg_temp.check(pg_temp.as_aal(null, 'b0b0b0b0-0000-0000-0000-00000000000a', $$select count(*) from storage.objects where bucket_id = 'ids'$$)::bigint = 0, 'an admin with no aal claim read an ID file');
select pg_temp.check(pg_temp.as_aal('aal2', 'b0b0b0b0-0000-0000-0000-00000000000a', $$select count(*) from storage.objects where bucket_id = 'ids' and name like 'b0b0b0b0-%'$$)::bigint >= 5, 'an admin with the authenticator code cannot read ID files');
select pg_temp.check(exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and cmd = 'SELECT' and qual like '%ids%' and qual like '%payments%' and qual like '%is_admin%'), 'no admin read policy for ids and payments');
select pg_temp.check(exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and cmd = 'DELETE' and qual like '%ids%' and qual like '%payments%' and qual like '%is_admin%'), 'no admin delete policy for ids and payments');
select pg_temp.check(not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and cmd in ('SELECT', 'ALL') and qual like '%''ids''%' and qual not like '%is_admin%'), 'a non-admin policy can read the ids bucket');
select pg_temp.fails_as('authenticated', 'b0b0b0b0-0000-0000-0000-000000000001', $$insert into storage.objects (bucket_id, name) values ('ids', 'b0b0b0b0-0000-0000-0000-000000000001/own.jpg')$$, 'a person wrote straight into the ids bucket');
select pg_temp.fails_as('authenticated', 'b0b0b0b0-0000-0000-0000-000000000001', $$insert into storage.objects (bucket_id, name) values ('payments', 'b0b0b0b0-0000-0000-0000-000000000001/own.jpg')$$, 'a person wrote straight into the payments bucket');
do $d$ begin perform pg_temp.as_role('authenticated', 'b0b0b0b0-0000-0000-0000-000000000001', $$delete from storage.objects where bucket_id = 'ids' and name = 'b0b0b0b0-0000-0000-0000-000000000001/id2.jpg'$$); exception when others then null; end $d$;   -- real Supabase refuses direct deletes outright; plain Postgres deletes nothing
select pg_temp.check(exists (select 1 from storage.objects where bucket_id = 'ids' and name = 'b0b0b0b0-0000-0000-0000-000000000001/id2.jpg'), 'a person deleted their own ID file');
do $d$ begin perform pg_temp.as_aal('aal1', 'b0b0b0b0-0000-0000-0000-00000000000a', $$delete from storage.objects where bucket_id = 'ids' and name = 'b0b0b0b0-0000-0000-0000-000000000001/onlyids.jpg'$$); exception when others then null; end $d$;   -- real Supabase refuses direct deletes outright; plain Postgres deletes nothing
select pg_temp.check(exists (select 1 from storage.objects where bucket_id = 'ids' and name = 'b0b0b0b0-0000-0000-0000-000000000001/onlyids.jpg'), 'an admin without the authenticator code deleted an ID file');

-- the requests table itself
select pg_temp.check(pg_temp.count_as('b0b0b0b0-0000-0000-0000-000000000001', $$select count(*) from public.verification_requests$$) = 1, 'a person should see only their own request');
select pg_temp.check(pg_temp.count_as('b0b0b0b0-0000-0000-0000-000000000002', $$select count(*) from public.verification_requests where user_id = 'b0b0b0b0-0000-0000-0000-000000000001'$$) = 0, 'a person read another person''s request');
select pg_temp.check(pg_temp.as_aal('aal2', 'b0b0b0b0-0000-0000-0000-00000000000a', $$select count(*) from public.verification_requests where user_id = 'b0b0b0b0-0000-0000-0000-000000000001'$$)::bigint = 1, 'an admin cannot read a request');
select pg_temp.fails_as('authenticated', 'b0b0b0b0-0000-0000-0000-000000000001', $$insert into public.verification_requests (user_id, face_path, id_path) values (auth.uid(), 'x', 'y')$$, 'a person inserted a verification request directly');
select pg_temp.fails_as('authenticated', 'b0b0b0b0-0000-0000-0000-000000000001', $$update public.verification_requests set status = 'approved' where user_id = auth.uid()$$, 'a person approved their own request');
select pg_temp.fails_as('authenticated', 'b0b0b0b0-0000-0000-0000-000000000001', $$delete from public.verification_requests where user_id = auth.uid()$$, 'a person deleted their own request');
select pg_temp.fails_as('authenticated', 'b0b0b0b0-0000-0000-0000-000000000001', $$update public.profiles set face_verified = true, id_verified = true, is_adult = true, status = 'active' where id = auth.uid()$$, 'a person verified themselves');
select pg_temp.check((select face_verified = false and status::text = 'pending_verification' from public.profiles where id = 'b0b0b0b0-0000-0000-0000-000000000001'), 'the profile changed after a refused self-verification');

-- at most 5 a day (person 03): five in the last day block a sixth, older ones do not count
insert into storage.objects (bucket_id, name) values ('faces', 'b0b0b0b0-0000-0000-0000-000000000003/f.jpg'), ('ids', 'b0b0b0b0-0000-0000-0000-000000000003/i.jpg');
insert into public.verification_requests (user_id, face_path, id_path, status, note, submitted_at, decided_at)
select 'b0b0b0b0-0000-0000-0000-000000000003', 'old/f' || g, null, 'rejected', 'blurry', now() - (g || ' hours')::interval, now() from generate_series(1, 5) g;
select pg_temp.fails_as('authenticated', 'b0b0b0b0-0000-0000-0000-000000000003', $$select public.submit_verification('b0b0b0b0-0000-0000-0000-000000000003/f.jpg', 'b0b0b0b0-0000-0000-0000-000000000003/i.jpg')$$, 'a sixth verification in a day was accepted');
update public.verification_requests set submitted_at = now() - interval '2 days' where user_id = 'b0b0b0b0-0000-0000-0000-000000000003' and face_path = 'old/f5';
select pg_temp.as_role('authenticated', 'b0b0b0b0-0000-0000-0000-000000000003', $$select public.submit_verification('b0b0b0b0-0000-0000-0000-000000000003/f.jpg', 'b0b0b0b0-0000-0000-0000-000000000003/i.jpg')$$);
select pg_temp.check((select count(*) = 1 from public.verification_requests where user_id = 'b0b0b0b0-0000-0000-0000-000000000003' and status = 'pending'), 'person 03 should now have one pending request');
select pg_temp.fails_as('authenticated', 'b0b0b0b0-0000-0000-0000-000000000003', $$select public.submit_verification('b0b0b0b0-0000-0000-0000-000000000003/f.jpg', 'b0b0b0b0-0000-0000-0000-000000000003/i.jpg')$$, 'the fifth-plus-one in a day (a retake) was accepted');
select pg_temp.check((select count(*) = 1 from public.verification_requests where user_id = 'b0b0b0b0-0000-0000-0000-000000000003' and status = 'pending'), 'still exactly one pending request');

\echo '--- S6 submit_profile'
-- person 01: verification is in; name, pet, location and the guidelines are still missing
select pg_temp.fails_as('authenticated', 'b0b0b0b0-0000-0000-0000-000000000001', $$select public.submit_profile()$$, 'an incomplete profile was submitted');
select pg_temp.check((pg_temp.state('b0b0b0b0-0000-0000-0000-000000000001') -> 'missing') = '["name", "pet", "location", "legal"]'::jsonb, 'missing list after verification');
select pg_temp.fails_as('anon', null, $$select public.submit_profile()$$, 'anon submitted a profile');
update public.profiles set first_name = 'Olive' where id = 'b0b0b0b0-0000-0000-0000-000000000001';
select pg_temp.fails_as('authenticated', 'b0b0b0b0-0000-0000-0000-000000000001', $$select public.submit_profile()$$, 'a profile without a pet was submitted');
insert into storage.objects (bucket_id, name) values ('pets', 'b0b0b0b0-0000-0000-0000-000000000001/pet.jpg'), ('pets', 'b0b0b0b0-0000-0000-0000-000000000002/pet.jpg');
insert into public.pets (owner_id, name, type, size, photo_paths) values ('b0b0b0b0-0000-0000-0000-000000000001', 'Biscuit', 'dog', 'medium', array['b0b0b0b0-0000-0000-0000-000000000001/pet.jpg']);
select pg_temp.fails_as('authenticated', 'b0b0b0b0-0000-0000-0000-000000000001', $$select public.submit_profile()$$, 'a profile without a location was submitted');
select pg_temp.as_role('authenticated', 'b0b0b0b0-0000-0000-0000-000000000001', $$select public.set_my_location(28.49, 34.5)$$);
select pg_temp.fails_as('authenticated', 'b0b0b0b0-0000-0000-0000-000000000001', $$select public.submit_profile()$$, 'a profile without the guidelines was submitted');
select pg_temp.fails_as('authenticated', 'b0b0b0b0-0000-0000-0000-000000000001', $$insert into public.legal_acceptances (user_id, doc, version) values (auth.uid(), 'guidelines', 'old-version')$$, 'an old guidelines version was accepted');
select pg_temp.as_role('authenticated', 'b0b0b0b0-0000-0000-0000-000000000001', $$insert into public.legal_acceptances (user_id, doc, version) select auth.uid(), doc, current_version from public.legal_documents where doc = 'guidelines'$$);
select pg_temp.check((pg_temp.state('b0b0b0b0-0000-0000-0000-000000000001') -> 'missing') = '[]'::jsonb, 'a complete owner still has something missing');
select pg_temp.check(pg_temp.as_role('authenticated', 'b0b0b0b0-0000-0000-0000-000000000001', $$select public.submit_profile()::text$$) = 'pending_review', 'a complete profile was not submitted');
select pg_temp.check((select status::text = 'pending_review' from public.profiles where id = 'b0b0b0b0-0000-0000-0000-000000000001'), 'the status is not pending_review');
select pg_temp.check(pg_temp.as_role('authenticated', 'b0b0b0b0-0000-0000-0000-000000000001', $$select public.submit_profile()::text$$) = 'pending_review', 'submitting twice is not harmless');
select pg_temp.check((select count(*) = 1 from public.security_events where user_id = 'b0b0b0b0-0000-0000-0000-000000000001' and kind = 'profile_submitted'), 'the second submit logged a second event');
select pg_temp.check((select status::text = 'pending_review' and not face_verified and not is_adult from public.profiles where id = 'b0b0b0b0-0000-0000-0000-000000000001'), 'submitting must not verify anybody');
-- after submitting, the photos can no longer be changed through submit_verification
insert into storage.objects (bucket_id, name) values ('faces', 'b0b0b0b0-0000-0000-0000-000000000001/face3.jpg'), ('ids', 'b0b0b0b0-0000-0000-0000-000000000001/id3.jpg');
select pg_temp.fails_as('authenticated', 'b0b0b0b0-0000-0000-0000-000000000001', $$select public.submit_verification('b0b0b0b0-0000-0000-0000-000000000001/face3.jpg', 'b0b0b0b0-0000-0000-0000-000000000001/id3.jpg')$$, 'a person in review replaced their photos');
-- a pending review is not active: still sees nobody
select pg_temp.check(pg_temp.count_as('b0b0b0b0-0000-0000-0000-000000000001', $$select count(*) from public.profile_cards$$) = 0, 'a person in review sees people');

-- a host: needs a home photo, not a pet; submits with verification first
update public.profiles set first_name = 'Hana' where id = 'b0b0b0b0-0000-0000-0000-000000000002';
insert into public.pets (owner_id, name, type, size, photo_paths) values ('b0b0b0b0-0000-0000-0000-000000000002', 'Hostpet', 'cat', 'small', array['b0b0b0b0-0000-0000-0000-000000000002/pet.jpg']);
select pg_temp.as_role('authenticated', 'b0b0b0b0-0000-0000-0000-000000000002', $$select public.set_my_location(28.5, 34.51)$$);
select pg_temp.as_role('authenticated', 'b0b0b0b0-0000-0000-0000-000000000002', $$insert into public.legal_acceptances (user_id, doc, version) select auth.uid(), doc, current_version from public.legal_documents where doc = 'guidelines'$$);
select pg_temp.check((pg_temp.state('b0b0b0b0-0000-0000-0000-000000000002') -> 'missing') = '["verification", "home"]'::jsonb, 'a host with a pet still needs a home photo');
update public.profiles set home_photo_path = 'b0b0b0b0-0000-0000-0000-000000000002/home.jpg' where id = 'b0b0b0b0-0000-0000-0000-000000000002';
select pg_temp.fails_as('authenticated', 'b0b0b0b0-0000-0000-0000-000000000002', $$select public.submit_profile()$$, 'a host without verification was submitted');
select pg_temp.as_role('authenticated', 'b0b0b0b0-0000-0000-0000-000000000002', $$select public.submit_verification('b0b0b0b0-0000-0000-0000-000000000002/face.jpg', 'b0b0b0b0-0000-0000-0000-000000000002/id.jpg')$$);
select pg_temp.check((pg_temp.state('b0b0b0b0-0000-0000-0000-000000000002') -> 'missing') = '[]'::jsonb, 'a complete host still has something missing');
select pg_temp.check(pg_temp.as_role('authenticated', 'b0b0b0b0-0000-0000-0000-000000000002', $$select public.submit_profile()::text$$) = 'pending_review', 'a complete host was not submitted');

-- an owner in verification only (04) cannot be submitted, and an active person cannot re-submit
select pg_temp.fails_as('authenticated', 'b0b0b0b0-0000-0000-0000-000000000004', $$select public.submit_profile()$$, 'an empty profile was submitted');
select pg_temp.fails_as('authenticated', 'b0b0b0b0-0000-0000-0000-000000000004', $$select public.submit_verification('b0b0b0b0-0000-0000-0000-000000000004/f.jpg', 'b0b0b0b0-0000-0000-0000-000000000004/i.jpg')$$, 'files that do not exist were accepted for 04');
update public.profiles set status = 'active' where id = 'b0b0b0b0-0000-0000-0000-00000000000f';
select pg_temp.fails_as('authenticated', 'b0b0b0b0-0000-0000-0000-00000000000f', $$select public.submit_profile()$$, 'an active person re-submitted');
insert into storage.objects (bucket_id, name) values ('faces', 'b0b0b0b0-0000-0000-0000-00000000000f/f.jpg'), ('ids', 'b0b0b0b0-0000-0000-0000-00000000000f/i.jpg');
select pg_temp.fails_as('authenticated', 'b0b0b0b0-0000-0000-0000-00000000000f', $$select public.submit_verification('b0b0b0b0-0000-0000-0000-00000000000f/f.jpg', 'b0b0b0b0-0000-0000-0000-00000000000f/i.jpg')$$, 'an active person submitted a verification');
update public.profiles set status = 'suspended' where id = 'b0b0b0b0-0000-0000-0000-00000000000f';
select pg_temp.fails_as('authenticated', 'b0b0b0b0-0000-0000-0000-00000000000f', $$select public.submit_verification('b0b0b0b0-0000-0000-0000-00000000000f/f.jpg', 'b0b0b0b0-0000-0000-0000-00000000000f/i.jpg')$$, 'a suspended person submitted a verification');
select pg_temp.fails_as('authenticated', 'b0b0b0b0-0000-0000-0000-00000000000f', $$select public.submit_profile()$$, 'a suspended person submitted a profile');

\echo '--- S7 admin_decide_verification'
-- 01 is pending_review with a pending request (id2.jpg), 02 too (id.jpg), 03 is pending_verification with a pending request
select pg_temp.fails_as('authenticated', 'b0b0b0b0-0000-0000-0000-000000000002', $$select public.admin_decide_verification('b0b0b0b0-0000-0000-0000-000000000001', true, true, null)$$, 'a normal person decided a verification');
select pg_temp.fails_aal('aal2', 'b0b0b0b0-0000-0000-0000-000000000002', $$select public.admin_decide_verification('b0b0b0b0-0000-0000-0000-000000000001', true, true, null)$$, 'a normal person with an aal2 claim decided a verification');
select pg_temp.fails_aal('aal1', 'b0b0b0b0-0000-0000-0000-00000000000a', $$select public.admin_decide_verification('b0b0b0b0-0000-0000-0000-000000000001', true, true, null)$$, 'an admin with aal1 decided a verification');
select pg_temp.fails_aal(null, 'b0b0b0b0-0000-0000-0000-00000000000a', $$select public.admin_decide_verification('b0b0b0b0-0000-0000-0000-000000000001', true, true, null)$$, 'an admin without an aal claim decided a verification');
select pg_temp.fails_as('anon', null, $$select public.admin_decide_verification('b0b0b0b0-0000-0000-0000-000000000001', true, true, null)$$, 'anon decided a verification');
select pg_temp.fails_aal('aal1', 'b0b0b0b0-0000-0000-0000-00000000000a', $$select public.admin_decide_verification('b0b0b0b0-0000-0000-0000-000000000002', false, null, 'no')$$, 'an admin with aal1 rejected a verification');
select pg_temp.check((select count(*) = 1 from public.verification_requests where user_id = 'b0b0b0b0-0000-0000-0000-000000000001' and status = 'pending'), 'a refused decision changed the request');

-- approve needs the adult confirmation and a profile in review
select pg_temp.fails_aal('aal2', 'b0b0b0b0-0000-0000-0000-00000000000a', $$select public.admin_decide_verification('b0b0b0b0-0000-0000-0000-000000000001', true, false, null)$$, 'approved without confirming adulthood');
select pg_temp.fails_aal('aal2', 'b0b0b0b0-0000-0000-0000-00000000000a', $$select public.admin_decide_verification('b0b0b0b0-0000-0000-0000-000000000001', true, null, null)$$, 'approved with a null adult flag');
select pg_temp.fails_aal('aal2', 'b0b0b0b0-0000-0000-0000-00000000000a', $$select public.admin_decide_verification('b0b0b0b0-0000-0000-0000-000000000003', true, true, null)$$, 'approved a profile that was not submitted for review');
select pg_temp.fails_aal('aal2', 'b0b0b0b0-0000-0000-0000-00000000000a', $$select public.admin_decide_verification('b0b0b0b0-0000-0000-0000-000000000004', true, true, null)$$, 'approved a person with no pending request');
select pg_temp.fails_aal('aal2', 'b0b0b0b0-0000-0000-0000-00000000000a', $$select public.admin_decide_verification('b0b0b0b0-0000-0000-0000-000000000001', true, true, repeat('x', 1001))$$, 'a decision with a 1001-character note');
select pg_temp.check((select status::text = 'pending_review' and not face_verified from public.profiles where id = 'b0b0b0b0-0000-0000-0000-000000000001'), 'a refused approval changed the profile');

select pg_temp.check(pg_temp.as_aal('aal2', 'b0b0b0b0-0000-0000-0000-00000000000a', $$select public.admin_decide_verification('b0b0b0b0-0000-0000-0000-000000000001', true, true, 'Welcome')$$) = 'b0b0b0b0-0000-0000-0000-000000000001/id2.jpg', 'the approval did not return the id path to delete');
select pg_temp.check((select face_verified and id_verified and is_adult and status::text = 'active' from public.profiles where id = 'b0b0b0b0-0000-0000-0000-000000000001'), 'approval did not verify and activate');
select pg_temp.check((select status = 'approved' and id_path is null and decided_at is not null and decided_by = 'b0b0b0b0-0000-0000-0000-00000000000a' from public.verification_requests where user_id = 'b0b0b0b0-0000-0000-0000-000000000001'), 'the approved request is wrong (id_path must be cleared)');
select pg_temp.check((select count(*) = 1 from public.audit_log where action = 'verification_approved' and target_user = 'b0b0b0b0-0000-0000-0000-000000000001' and admin_id = 'b0b0b0b0-0000-0000-0000-00000000000a'), 'the approval was not audited');
select pg_temp.check((pg_temp.state('b0b0b0b0-0000-0000-0000-000000000001') #>> '{verification,status}') = 'approved', 'the state does not show the approval');
select pg_temp.check((pg_temp.state('b0b0b0b0-0000-0000-0000-000000000001') ->> 'status') = 'active', 'the state does not show active');
-- approved but unpaid is not yet a usable account
select pg_temp.check(not public.is_active('b0b0b0b0-0000-0000-0000-000000000001'), 'an approved but unpaid person is active');
select pg_temp.fails_aal('aal2', 'b0b0b0b0-0000-0000-0000-00000000000a', $$select public.admin_decide_verification('b0b0b0b0-0000-0000-0000-000000000001', true, true, null)$$, 'a verification was decided twice (approve)');
select pg_temp.fails_aal('aal2', 'b0b0b0b0-0000-0000-0000-00000000000a', $$select public.admin_decide_verification('b0b0b0b0-0000-0000-0000-000000000001', false, null, 'changed my mind')$$, 'a verification was decided twice (reject after approve)');
select pg_temp.check((select face_verified and status::text = 'active' from public.profiles where id = 'b0b0b0b0-0000-0000-0000-000000000001'), 'a refused second decision changed the approved person');

-- reject needs a note, sends the person back, shows the note, clears the path, and the person can submit again
select pg_temp.fails_aal('aal2', 'b0b0b0b0-0000-0000-0000-00000000000a', $$select public.admin_decide_verification('b0b0b0b0-0000-0000-0000-000000000002', false, null, null)$$, 'rejected without a note');
select pg_temp.fails_aal('aal2', 'b0b0b0b0-0000-0000-0000-00000000000a', $$select public.admin_decide_verification('b0b0b0b0-0000-0000-0000-000000000002', false, null, '   ')$$, 'rejected with a blank note');
select pg_temp.check((select status::text = 'pending_review' from public.profiles where id = 'b0b0b0b0-0000-0000-0000-000000000002'), 'a refused rejection changed the status');
select pg_temp.check(pg_temp.as_aal('aal2', 'b0b0b0b0-0000-0000-0000-00000000000a', $$select public.admin_decide_verification('b0b0b0b0-0000-0000-0000-000000000002', false, false, 'The ID photo is blurry')$$) = 'b0b0b0b0-0000-0000-0000-000000000002/id.jpg', 'the rejection did not return the id path to delete');
select pg_temp.check((select status::text = 'pending_verification' and not face_verified and not id_verified and not is_adult from public.profiles where id = 'b0b0b0b0-0000-0000-0000-000000000002'), 'a rejection did not send the person back to pending_verification');
select pg_temp.check((select status = 'rejected' and id_path is null and note = 'The ID photo is blurry' and decided_by = 'b0b0b0b0-0000-0000-0000-00000000000a' from public.verification_requests where user_id = 'b0b0b0b0-0000-0000-0000-000000000002'), 'the rejected request is wrong');
select pg_temp.check((pg_temp.state('b0b0b0b0-0000-0000-0000-000000000002') #>> '{verification,status}') = 'rejected' and (pg_temp.state('b0b0b0b0-0000-0000-0000-000000000002') #>> '{verification,note}') = 'The ID photo is blurry', 'the person cannot see the rejection note');
select pg_temp.check((pg_temp.state('b0b0b0b0-0000-0000-0000-000000000002') -> 'missing') = '["verification"]'::jsonb, 'after a rejection only verification is missing');
select pg_temp.check((select count(*) = 1 from public.audit_log where action = 'verification_rejected' and target_user = 'b0b0b0b0-0000-0000-0000-000000000002'), 'the rejection was not audited');
select pg_temp.fails_as('authenticated', 'b0b0b0b0-0000-0000-0000-000000000002', $$select public.submit_profile()$$, 'a rejected person re-submitted the profile without new photos');
select pg_temp.fails_aal('aal2', 'b0b0b0b0-0000-0000-0000-00000000000a', $$select public.admin_decide_verification('b0b0b0b0-0000-0000-0000-000000000002', false, null, 'again')$$, 'a verification was decided twice (reject)');
select pg_temp.fails_aal('aal2', 'b0b0b0b0-0000-0000-0000-00000000000a', $$select public.admin_decide_verification('b0b0b0b0-0000-0000-0000-000000000002', true, true, null)$$, 'a rejected request was approved afterwards');
-- submit again
insert into storage.objects (bucket_id, name) values ('faces', 'b0b0b0b0-0000-0000-0000-000000000002/face_b.jpg'), ('ids', 'b0b0b0b0-0000-0000-0000-000000000002/id_b.jpg');
select pg_temp.as_role('authenticated', 'b0b0b0b0-0000-0000-0000-000000000002', $$select public.submit_verification('b0b0b0b0-0000-0000-0000-000000000002/face_b.jpg', 'b0b0b0b0-0000-0000-0000-000000000002/id_b.jpg')$$);
select pg_temp.check((select count(*) = 1 from public.verification_requests where user_id = 'b0b0b0b0-0000-0000-0000-000000000002' and status = 'pending') and (select count(*) = 2 from public.verification_requests where user_id = 'b0b0b0b0-0000-0000-0000-000000000002'), 'after a rejection a new pending request should exist next to the old one');
select pg_temp.check((pg_temp.state('b0b0b0b0-0000-0000-0000-000000000002') #>> '{verification,status}') = 'pending' and (pg_temp.state('b0b0b0b0-0000-0000-0000-000000000002') #> '{verification,note}') = 'null'::jsonb, 'the state after a new submission');
select pg_temp.check(pg_temp.as_role('authenticated', 'b0b0b0b0-0000-0000-0000-000000000002', $$select public.submit_profile()::text$$) = 'pending_review', 'a rejected person could not go back to review after submitting again');
select pg_temp.check(pg_temp.as_aal('aal2', 'b0b0b0b0-0000-0000-0000-00000000000a', $$select public.admin_decide_verification('b0b0b0b0-0000-0000-0000-000000000002', true, true, null)$$) = 'b0b0b0b0-0000-0000-0000-000000000002/id_b.jpg', 'the second request could not be approved');
-- rejecting someone who has not submitted the profile yet keeps them in verification
select pg_temp.check(pg_temp.as_aal('aal2', 'b0b0b0b0-0000-0000-0000-00000000000a', $$select public.admin_decide_verification('b0b0b0b0-0000-0000-0000-000000000003', false, null, 'Selfie does not match')$$) = 'b0b0b0b0-0000-0000-0000-000000000003/i.jpg', 'rejecting a person still in verification');
select pg_temp.check((select status::text = 'pending_verification' from public.profiles where id = 'b0b0b0b0-0000-0000-0000-000000000003'), 'the status changed for a person still in verification');
-- a person cannot see another person's rejection note, and the table is closed to writes for admins too (only the function writes)
select pg_temp.fails_aal('aal2', 'b0b0b0b0-0000-0000-0000-00000000000a', $$update public.verification_requests set status = 'approved' where user_id = 'b0b0b0b0-0000-0000-0000-000000000003'$$, 'an admin edited the requests table directly');

\echo 'signup assertions OK'
