-- Phase 8 assertions (admin sign-in rule, adding admins, actions, reports, appeals, photos, audit log, suspension lifting).
-- Run AFTER the other assertion files on the same database, with ON_ERROR_STOP=1.
\set ON_ERROR_STOP 1
\i supabase/tests/helpers.sql

select private.invite_admin('boss@example.com');
insert into auth.users (id, phone, phone_confirmed_at, email, email_confirmed_at, created_at) values
  ('a8a8a8a8-0000-0000-0000-000000000001', null, null, 'boss@example.com', now(), now()),                 -- the founder: an invited email
  ('a9a9a9a9-0000-0000-0000-000000000002', '201277600002', now(), null, null, now()),                      -- Una, a normal user
  ('aaaaaaa1-0000-0000-0000-000000000003', '201277600003', now(), null, null, now()),                      -- Vik, a normal user
  ('aaaaaaa2-0000-0000-0000-000000000004', '201277600004', now(), null, null, now());                      -- Wes, waiting for review
update public.profiles set first_name = 'Una', role = 'both', status = 'active', face_verified = true, id_verified = true, is_adult = true where id = 'a9a9a9a9-0000-0000-0000-000000000002';
update public.profiles set first_name = 'Vik', role = 'both', status = 'active', face_verified = true, id_verified = true, is_adult = true where id = 'aaaaaaa1-0000-0000-0000-000000000003';
update public.profiles set first_name = 'Wes', role = 'both', status = 'pending_review' where id = 'aaaaaaa2-0000-0000-0000-000000000004';
create temp table t_ids (k text primary key, v text);
-- Run a statement as a signed-in person, with or without the authenticator code (aal2).
create or replace function pg_temp.as_admin(p_aal text, p_sql text) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claims', case when p_aal is null then '' else json_build_object('aal', p_aal)::text end, true);
  r := pg_temp.as_role('authenticated', 'a8a8a8a8-0000-0000-0000-000000000001', p_sql);
  perform set_config('request.jwt.claims', '', true);
  return r;
end $$;
create or replace function pg_temp.fails_admin(p_aal text, p_sql text, p_msg text) returns void language plpgsql as $$
begin
  begin
    perform pg_temp.as_admin(p_aal, p_sql);
  exception when others then
    perform set_config('request.jwt.claims', '', true);
    return;
  end;
  raise exception 'ASSERT FAILED (should have been refused): %', p_msg;
end $$;

\echo '--- D1 adding the first admin'
delete from private.admin_invites;
select pg_temp.check(private.grant_admin('boss@example.com') = 'no_invite', 'an email that was never invited became an admin');
select pg_temp.check(private.grant_admin('nobody@example.com') = 'no_user', 'a missing account became an admin');
select pg_temp.check(left(private.invite_admin('Boss@Example.com '), 7) = 'invited', 'the invite was not recorded');
select pg_temp.check((select user_id is null from private.admin_invites where email = 'boss@example.com'), 'a fresh invite already has an account');
select pg_temp.check(private.grant_admin('boss@example.com') = 'no_invite', 'an invite not tied to the account made an admin');
update private.admin_invites set user_id = 'a8a8a8a8-0000-0000-0000-000000000001', created_at = now() - interval '1 hour' where email = 'boss@example.com';
select pg_temp.check(not exists (select 1 from public.admins where user_id = 'a8a8a8a8-0000-0000-0000-000000000001'), 'an invite alone made an admin');
select pg_temp.check(private.grant_admin('boss@example.com') = 'granted', 'an invited, confirmed account could not become an admin');
select pg_temp.check(exists (select 1 from public.admins where user_id = 'a8a8a8a8-0000-0000-0000-000000000001'), 'the admin row is missing');
select pg_temp.check((select count(*) >= 1 from public.audit_log where action = 'admin_granted'), 'granting an admin was not audited');
update auth.users set email_confirmed_at = null where id = 'a8a8a8a8-0000-0000-0000-000000000001';
delete from public.admins where user_id = 'a8a8a8a8-0000-0000-0000-000000000001';
select pg_temp.check(private.grant_admin('boss@example.com') = 'not_confirmed', 'an unconfirmed email became an admin');
update auth.users set email_confirmed_at = now() where id = 'a8a8a8a8-0000-0000-0000-000000000001';
select private.grant_admin('boss@example.com');
select pg_temp.fails_as('authenticated', 'a9a9a9a9-0000-0000-0000-000000000002', $$select private.grant_admin('boss@example.com')$$, 'a user called grant_admin');
select pg_temp.fails_as('anon', null, $$select private.invite_admin('x@y.com')$$, 'anon called invite_admin');
select pg_temp.fails_as('authenticated', 'a9a9a9a9-0000-0000-0000-000000000002', $$insert into public.admins values ('a9a9a9a9-0000-0000-0000-000000000002')$$, 'a user made themselves an admin');
select pg_temp.fails_as('authenticated', 'a9a9a9a9-0000-0000-0000-000000000002', $$insert into private.admin_invites values ('me@x.com')$$, 'a user invited themselves');

select pg_temp.fails($$insert into auth.users (id, email, email_confirmed_at) values (gen_random_uuid(), 'boss@example.com', now())$$, 'a second account was made for a used invite');
select private.invite_admin('phoneuser@example.com');
update auth.users set email = 'phoneuser@example.com', email_confirmed_at = now() where id = 'a9a9a9a9-0000-0000-0000-000000000002';
select pg_temp.check(private.grant_admin('phoneuser@example.com') = 'no_user', 'a phone account that took an invited email became an admin');
update auth.users set email = null, email_confirmed_at = null where id = 'a9a9a9a9-0000-0000-0000-000000000002';
delete from private.admin_invites where email = 'phoneuser@example.com';

\echo '--- D2 an email account without an invite cannot sign up, and a phone sign-up still works'
select pg_temp.fails($$insert into auth.users (id, email, email_confirmed_at) values (gen_random_uuid(), 'stranger@example.com', now())$$, 'an uninvited email account was created');
select pg_temp.fails($$insert into auth.users (id, phone, phone_confirmed_at) values (gen_random_uuid(), '14155550123', now())$$, 'a foreign phone sign-up was accepted');
select pg_temp.check(exists (select 1 from public.profiles where id = 'a8a8a8a8-0000-0000-0000-000000000001'), 'the admin account has no profile row');

\echo '--- D3 admin rights need the authenticator code'
select pg_temp.check(pg_temp.as_admin(null, 'select public.admin_status()') = 'needs_mfa', 'an admin without the code was not told to use it');
select pg_temp.check(pg_temp.as_admin('aal1', 'select public.admin_status()') = 'needs_mfa', 'aal1 counted as admin');
select pg_temp.check(pg_temp.as_admin('aal2', 'select public.admin_status()') = 'admin', 'aal2 did not count as admin');
select pg_temp.check(pg_temp.as_role('authenticated', 'a9a9a9a9-0000-0000-0000-000000000002', 'select public.admin_status()') = 'not_admin', 'a normal user was told they are an admin');
select pg_temp.fails_as('anon', null, 'select public.admin_status()', 'anon called admin_status');
select pg_temp.fails_admin(null, 'select public.admin_overview()', 'the overview worked without the code');
select pg_temp.fails_admin('aal1', 'select public.admin_overview()', 'the overview worked at aal1');
select pg_temp.fails_admin('aal1', $$select public.admin_take_action('a9a9a9a9-0000-0000-0000-000000000002', 'reminder', 'x', null, false, '[]', 'x')$$, 'an action worked without the code');
select pg_temp.check(pg_temp.as_admin('aal1', 'select count(*) from public.profiles')::int = 1, 'an admin without the code could read other people');
select pg_temp.check(pg_temp.as_admin('aal2', 'select count(*) from public.profiles')::int >= 5, 'an admin with the code could not read profiles');
select pg_temp.fails_as('authenticated', 'a9a9a9a9-0000-0000-0000-000000000002', 'select public.admin_overview()', 'a user read the overview');
select pg_temp.fails_as('authenticated', 'a9a9a9a9-0000-0000-0000-000000000002', 'select * from public.admin_audit_log()', 'a user read the audit log');
select pg_temp.fails_as('anon', null, 'select public.admin_overview()', 'anon read the overview');
select pg_temp.check(pg_temp.as_admin('aal2', 'select (public.admin_overview() ->> ''pending_approvals'')')::int >= 1, 'the overview does not count the profile waiting for review');

\echo '--- D4 actions follow the rules'
select pg_temp.fails_admin('aal2', $$select public.admin_take_action('a9a9a9a9-0000-0000-0000-000000000002', 'warning', null, null, false, '[]', 'x')$$, 'a warning without a rule');
select pg_temp.fails_admin('aal2', $$select public.admin_take_action('a9a9a9a9-0000-0000-0000-000000000002', 'warning', 'x', null, false, '[]', '')$$, 'a warning without a message');
select pg_temp.fails_admin('aal2', $$select public.admin_take_action('a9a9a9a9-0000-0000-0000-000000000002', 'suspension', 'x', null, false, '[]', 'x')$$, 'a suspension with no length');
select pg_temp.fails_admin('aal2', $$select public.admin_take_action('a9a9a9a9-0000-0000-0000-000000000002', 'suspension', 'x', 3, true, '[]', 'x')$$, 'a suspension with two lengths');
select pg_temp.fails_admin('aal2', $$select public.admin_take_action('a9a9a9a9-0000-0000-0000-000000000002', 'suspension', 'x', 5, false, '[]', 'x')$$, 'a suspension of 5 days');
select pg_temp.fails_admin('aal2', $$select public.admin_take_action('a9a9a9a9-0000-0000-0000-000000000002', 'suspension', 'x', -3, false, '[]', 'x')$$, 'a suspension of minus 3 days');
select pg_temp.fails_admin('aal2', $$select public.admin_take_action('a9a9a9a9-0000-0000-0000-000000000002', 'suspension', 'x', 999999999, false, '[]', 'x')$$, 'a huge suspension');
select pg_temp.fails_admin('aal2', $$select public.admin_take_action('a9a9a9a9-0000-0000-0000-000000000002', 'warning', 'x', 3, false, '[]', 'x')$$, 'a warning with a length');
select pg_temp.fails_admin('aal2', $$select public.admin_take_action('a9a9a9a9-0000-0000-0000-000000000002', 'warning', 'x', null, false, '{}', 'x')$$, 'a checklist that is not a list');
select pg_temp.fails_admin('aal2', $$select public.admin_take_action('a9a9a9a9-0000-0000-0000-000000000002', 'reinstatement', null, null, false, '[]', null)$$, 'reinstating someone who is active');
select pg_temp.fails_admin('aal2', $$select public.admin_take_action('a9a9a9a9-0000-0000-0000-000000000002', 'approval', null, null, false, '[]', null)$$, 'approving someone already active');
select pg_temp.fails_admin('aal2', $$select public.admin_take_action('aaaaaaa2-0000-0000-0000-000000000004', 'suspension', 'x', 3, false, '[]', 'x')$$, 'suspending someone who is not active yet');
select pg_temp.fails_admin('aal2', $$select public.admin_take_action('a8a8a8a8-0000-0000-0000-000000000001', 'warning', 'x', null, false, '[]', 'x')$$, 'an admin acted on themselves');
select pg_temp.fails_admin('aal2', $$select public.admin_take_action(gen_random_uuid(), 'warning', 'x', null, false, '[]', 'x')$$, 'an action on nobody');
select pg_temp.as_admin('aal2', $$select public.admin_take_action('aaaaaaa2-0000-0000-0000-000000000004', 'approval', null, null, false, '[]', 'Welcome')$$);
select pg_temp.check((select status = 'active' from public.profiles where id = 'aaaaaaa2-0000-0000-0000-000000000004'), 'approval did not activate the profile');
select pg_temp.as_admin('aal2', $$select public.admin_take_action('a9a9a9a9-0000-0000-0000-000000000002', 'warning', 'Keep payments in the app', null, false, '["Stop"]', 'Please keep payments in the app')$$);
select pg_temp.check((select status = 'active' from public.profiles where id = 'a9a9a9a9-0000-0000-0000-000000000002'), 'a warning changed the status');
select pg_temp.check(pg_temp.count_as('a9a9a9a9-0000-0000-0000-000000000002', $$select count(*) from public.enforcement_actions where action = 'warning'$$) = 1, 'the person cannot read their own warning');
select pg_temp.check(pg_temp.count_as('aaaaaaa1-0000-0000-0000-000000000003', $$select count(*) from public.enforcement_actions$$) = 0, 'someone read another person''s actions');

\echo '--- D5 removal bans the person, reinstatement lifts it, everything is audited'
insert into private.identity_fingerprints (kind, hash, user_id) values ('id_document', 'idhash-vik', 'aaaaaaa1-0000-0000-0000-000000000003'), ('device', 'devhash-vik', 'aaaaaaa1-0000-0000-0000-000000000003');
select pg_temp.as_admin('aal2', $$select public.admin_take_action('aaaaaaa1-0000-0000-0000-000000000003', 'removal', 'Animal harm', null, false, '[]', 'Removed')$$);
select pg_temp.check((select status = 'removed' from public.profiles where id = 'aaaaaaa1-0000-0000-0000-000000000003'), 'removal did not remove');
select pg_temp.check((select count(*) = 4 from public.banned_identifiers where hash in ('idhash-vik', 'devhash-vik') or hash in (select hash from private.identity_hashes('aaaaaaa1-0000-0000-0000-000000000003'))), 'removal did not ban the phone (both forms), id and device');
select pg_temp.check(exists (select 1 from public.banned_identifiers where kind = 'phone' and hash = private.phone_hash('201277600003')), 'removal did not ban the phone');
select pg_temp.fails($$insert into auth.users (id, phone, phone_confirmed_at) values (gen_random_uuid(), '201277600003', now())$$, 'a removed person signed up again with the same number');
select pg_temp.fails_admin('aal2', $$select public.admin_take_action('aaaaaaa1-0000-0000-0000-000000000003', 'removal', 'x', null, false, '[]', 'x')$$, 'removing someone twice');
select pg_temp.as_admin('aal2', $$select public.admin_take_action('aaaaaaa1-0000-0000-0000-000000000003', 'reinstatement', null, null, false, '[]', 'Mistake')$$);
select pg_temp.check((select status = 'active' from public.profiles where id = 'aaaaaaa1-0000-0000-0000-000000000003'), 'reinstatement did not restore');
select pg_temp.check(not exists (select 1 from public.banned_identifiers where hash in ('idhash-vik', 'devhash-vik')), 'reinstatement left the bans in place');
select pg_temp.check((select count(*) >= 4 from public.audit_log where target_user = 'aaaaaaa1-0000-0000-0000-000000000003' or action = 'approval'), 'actions are missing from the audit log');
select pg_temp.check((select bool_and(admin_id = 'a8a8a8a8-0000-0000-0000-000000000001') from public.audit_log where action in ('removal', 'reinstatement', 'approval', 'warning') and target_user in ('aaaaaaa1-0000-0000-0000-000000000003', 'aaaaaaa2-0000-0000-0000-000000000004', 'a9a9a9a9-0000-0000-0000-000000000002')), 'an audit entry names the wrong admin');
select pg_temp.fails_as('authenticated', 'a9a9a9a9-0000-0000-0000-000000000002', $$delete from public.audit_log$$, 'a user deleted the audit log');
select pg_temp.fails_admin('aal2', $$delete from public.audit_log$$, 'an admin deleted the audit log');
select pg_temp.fails_admin('aal2', $$update public.audit_log set action = 'x'$$, 'an admin edited the audit log');

-- two removed accounts that share a device: reinstating one must not lift the ban the other still needs
insert into auth.users (id, phone, phone_confirmed_at) values ('aaaaaaa3-0000-0000-0000-000000000005', '201277600005', now());
update public.profiles set first_name = 'Xan', status = 'active', face_verified = true, id_verified = true, is_adult = true where id = 'aaaaaaa3-0000-0000-0000-000000000005';
insert into private.identity_fingerprints (kind, hash, user_id) values ('device', 'devhash-shared', 'aaaaaaa3-0000-0000-0000-000000000005'), ('device', 'devhash-shared', 'aaaaaaa1-0000-0000-0000-000000000003');
select pg_temp.as_admin('aal2', $$select public.admin_take_action('aaaaaaa3-0000-0000-0000-000000000005', 'removal', 'Fraud', null, false, '[]', 'Removed')$$);
select pg_temp.as_admin('aal2', $$select public.admin_take_action('aaaaaaa1-0000-0000-0000-000000000003', 'removal', 'Fraud', null, false, '[]', 'Removed')$$);
select pg_temp.as_admin('aal2', $$select public.admin_take_action('aaaaaaa1-0000-0000-0000-000000000003', 'reinstatement', null, null, false, '[]', 'Mistake')$$);
select pg_temp.check(exists (select 1 from public.banned_identifiers where hash = 'devhash-shared'), 'reinstating one person lifted a ban another removed person still needs');
select pg_temp.as_admin('aal2', $$select public.admin_take_action('aaaaaaa3-0000-0000-0000-000000000005', 'reinstatement', null, null, false, '[]', 'Mistake')$$);
select pg_temp.check(not exists (select 1 from public.banned_identifiers where hash = 'devhash-shared'), 'the shared ban stayed after both people were reinstated');

\echo '--- D6 reports'
insert into public.reports (id, reporter_id, reported_id, reason, details, priority) values
  ('a0000000-0000-0000-0000-000000000001', 'a9a9a9a9-0000-0000-0000-000000000002', 'aaaaaaa1-0000-0000-0000-000000000003', 'rude_or_harassment', 'rude', 'normal');
select pg_temp.check(pg_temp.as_admin('aal2', 'select count(*) from public.reports')::int >= 1, 'an admin cannot read reports');
select pg_temp.check(pg_temp.as_admin('aal1', 'select count(*) from public.reports')::int = 0, 'an admin without the code read reports');
select pg_temp.fails_admin('aal2', $$select public.admin_set_report_status('a0000000-0000-0000-0000-000000000001', 'new', null)$$, 'a report was reopened as new');
select pg_temp.fails_admin('aal2', $$select public.admin_set_report_status(gen_random_uuid(), 'resolved', null)$$, 'a missing report was resolved');
select pg_temp.fails_as('authenticated', 'a9a9a9a9-0000-0000-0000-000000000002', $$select public.admin_set_report_status('a0000000-0000-0000-0000-000000000001', 'resolved', null)$$, 'a user resolved a report');
select pg_temp.as_admin('aal2', $$select public.admin_set_report_status('a0000000-0000-0000-0000-000000000001', 'resolved', 'warned')$$);
select pg_temp.check((select status = 'resolved' from public.reports where id = 'a0000000-0000-0000-0000-000000000001'), 'the report was not resolved');
select pg_temp.check((select count(*) = 1 from public.audit_log where action = 'report_resolved'), 'resolving a report was not audited');
select pg_temp.fails_admin('aal2', $$select * from public.admin_report_messages('a0000000-0000-0000-0000-000000000001')$$, 'reading messages of a report with no conversation');
insert into public.conversations (id, user_a, user_b) values ('a1000000-0000-0000-0000-000000000001', 'a9a9a9a9-0000-0000-0000-000000000002', 'aaaaaaa1-0000-0000-0000-000000000003');
insert into public.messages (conversation_id, sender_id, body) values ('a1000000-0000-0000-0000-000000000001', 'aaaaaaa1-0000-0000-0000-000000000003', 'hello');
update public.reports set conversation_id = 'a1000000-0000-0000-0000-000000000001' where id = 'a0000000-0000-0000-0000-000000000001';
select pg_temp.check(pg_temp.as_admin('aal2', $$select count(*) from public.admin_report_messages('a0000000-0000-0000-0000-000000000001')$$)::int = 1, 'the admin could not read the reported conversation');
select pg_temp.check((select count(*) = 1 from public.audit_log where action = 'read_conversation'), 'reading a chat was not audited');
select pg_temp.check(pg_temp.as_admin('aal2', 'select count(*) from public.messages')::int = 0, 'an admin read chats straight from the table, skipping the audit log');
select pg_temp.fails_as('authenticated', 'a9a9a9a9-0000-0000-0000-000000000002', $$select * from public.admin_report_messages('a0000000-0000-0000-0000-000000000001')$$, 'a user read a chat through the admin function');

\echo '--- D7 appeals'
select pg_temp.as_admin('aal2', $$select public.admin_take_action('aaaaaaa1-0000-0000-0000-000000000003', 'suspension', 'Keep payments in the app', null, true, '[]', 'Suspended')$$);
insert into t_ids select 'act', id::text from public.enforcement_actions where user_id = 'aaaaaaa1-0000-0000-0000-000000000003' and action = 'suspension';
insert into public.appeals (id, action_id, user_id, body) values ('a2000000-0000-0000-0000-000000000001', (select v::uuid from t_ids where k = 'act'), 'aaaaaaa1-0000-0000-0000-000000000003', 'I am sorry');
select pg_temp.fails_as('authenticated', 'aaaaaaa1-0000-0000-0000-000000000003', $$select public.admin_decide_appeal('a2000000-0000-0000-0000-000000000001', true, 'ok')$$, 'a person decided their own appeal');
select pg_temp.as_admin('aal2', $$select public.admin_decide_appeal('a2000000-0000-0000-0000-000000000001', true, 'Back you come')$$);
select pg_temp.check((select status = 'active' from public.profiles where id = 'aaaaaaa1-0000-0000-0000-000000000003'), 'an upheld appeal did not reinstate');
select pg_temp.check((select status = 'resolved' from public.appeals where id = 'a2000000-0000-0000-0000-000000000001'), 'the appeal was not marked decided');
select pg_temp.fails_admin('aal2', $$select public.admin_decide_appeal('a2000000-0000-0000-0000-000000000001', false, null)$$, 'an appeal was decided twice');
select pg_temp.check((select count(*) = 1 from public.audit_log where action = 'appeal_upheld'), 'an upheld appeal was not audited');

\echo '--- D8 photos'
insert into storage.objects (bucket_id, name) values ('homes', 'a9a9a9a9-0000-0000-0000-000000000002/home.jpg');
update public.profiles set home_photo_path = 'a9a9a9a9-0000-0000-0000-000000000002/home.jpg' where id = 'a9a9a9a9-0000-0000-0000-000000000002';
select pg_temp.fails_admin('aal2', $$select public.admin_remove_photo('home', 'a9a9a9a9-0000-0000-0000-000000000002', 'a9a9a9a9-0000-0000-0000-000000000002/home.jpg', '')$$, 'a photo was removed without a reason');
select pg_temp.fails_admin('aal2', $$select public.admin_remove_photo('home', 'a9a9a9a9-0000-0000-0000-000000000002', 'other.jpg', 'fake')$$, 'a photo that is not there was removed');
select pg_temp.fails_admin('aal2', $$select public.admin_remove_photo('face', 'a9a9a9a9-0000-0000-0000-000000000002', 'x', 'fake')$$, 'an unknown photo kind');
select pg_temp.fails_as('authenticated', 'a9a9a9a9-0000-0000-0000-000000000002', $$select public.admin_remove_photo('home', 'a9a9a9a9-0000-0000-0000-000000000002', 'a9a9a9a9-0000-0000-0000-000000000002/home.jpg', 'x')$$, 'a user used the admin photo function');
select pg_temp.as_admin('aal2', $$select public.admin_remove_photo('home', 'a9a9a9a9-0000-0000-0000-000000000002', 'a9a9a9a9-0000-0000-0000-000000000002/home.jpg', 'Not a real home')$$);
select pg_temp.check((select home_photo_path is null from public.profiles where id = 'a9a9a9a9-0000-0000-0000-000000000002'), 'the home photo was not removed');
select pg_temp.check((select count(*) = 1 from public.audit_log where action = 'photo_removed'), 'removing a photo was not audited');
select pg_temp.check(exists (select 1 from public.list_unused_uploads(interval '0 seconds') where name = 'a9a9a9a9-0000-0000-0000-000000000002/home.jpg'), 'the removed photo file is not queued for clean-up');

insert into storage.objects (bucket_id, name) values ('pets', 'a9a9a9a9-0000-0000-0000-000000000002/p1.jpg'), ('pets', 'a9a9a9a9-0000-0000-0000-000000000002/p2.jpg');
insert into public.pets (id, owner_id, name, type, size, photo_paths) values ('a3000000-0000-0000-0000-000000000001', 'a9a9a9a9-0000-0000-0000-000000000002', 'Rex', 'dog', 'small', array['a9a9a9a9-0000-0000-0000-000000000002/p1.jpg', 'a9a9a9a9-0000-0000-0000-000000000002/p2.jpg']);
select pg_temp.as_admin('aal2', $$select public.admin_remove_photo('pet', 'a9a9a9a9-0000-0000-0000-000000000002', 'a9a9a9a9-0000-0000-0000-000000000002/p1.jpg', 'Not my dog')$$);
select pg_temp.check((select photo_paths = array['a9a9a9a9-0000-0000-0000-000000000002/p2.jpg'] from public.pets where id = 'a3000000-0000-0000-0000-000000000001'), 'the pet photo was not removed');
select pg_temp.fails_admin('aal2', $$select public.admin_remove_photo('pet', 'a9a9a9a9-0000-0000-0000-000000000002', 'a9a9a9a9-0000-0000-0000-000000000002/p2.jpg', 'Not my dog')$$, 'a pet lost its last photo');

\echo '--- D9 audit log and overview'
select pg_temp.check(pg_temp.as_admin('aal2', 'select count(*) from public.admin_audit_log(500)')::int >= 10, 'the audit log is empty');
select pg_temp.check(pg_temp.as_admin('aal2', 'select count(*) from public.admin_audit_log(2)')::int = 2, 'the audit log ignores its limit');
select pg_temp.check((pg_temp.as_admin('aal2', 'select public.admin_overview()::text'))::jsonb ? 'open_reports', 'the overview has no report count');

\echo '--- D10 fixed-length suspensions end by themselves'
select pg_temp.as_admin('aal2', $$select public.admin_take_action('a9a9a9a9-0000-0000-0000-000000000002', 'suspension', 'Rude', 3, false, '[]', 'Three days')$$);
select pg_temp.check(private.lift_expired_suspensions() = 0, 'a suspension was lifted early');
select pg_temp.check((select status = 'suspended' from public.profiles where id = 'a9a9a9a9-0000-0000-0000-000000000002'), 'the suspension is gone before its end');
update public.enforcement_actions set ends_at = now() - interval '1 minute' where user_id = 'a9a9a9a9-0000-0000-0000-000000000002' and action = 'suspension';
select pg_temp.as_admin('aal2', $$select public.admin_take_action('aaaaaaa2-0000-0000-0000-000000000004', 'suspension', 'Rude', null, true, '[]', 'Until fixed')$$);
select pg_temp.check(private.lift_expired_suspensions() = 1, 'exactly one ended suspension should have been lifted');
select pg_temp.check((select status = 'active' from public.profiles where id = 'a9a9a9a9-0000-0000-0000-000000000002'), 'the ended suspension was not lifted');
select pg_temp.check((select status = 'suspended' from public.profiles where id = 'aaaaaaa2-0000-0000-0000-000000000004'), 'an until-fixed suspension was lifted by the timer');
select pg_temp.check((select count(*) = 1 from public.audit_log where action = 'auto_reinstatement' and target_user = 'a9a9a9a9-0000-0000-0000-000000000002'), 'the automatic lifting was not audited');
select pg_temp.check((select admin_id is null and rule = 'suspension ended' from public.enforcement_actions where user_id = 'a9a9a9a9-0000-0000-0000-000000000002' and action = 'reinstatement'), 'the automatic reinstatement is not marked as the system');
select pg_temp.check(private.lift_expired_suspensions() = 0, 'the timer lifted something twice');
select pg_temp.fails_as('authenticated', 'a9a9a9a9-0000-0000-0000-000000000002', $$select private.lift_expired_suspensions()$$, 'a user ran the suspension timer');
