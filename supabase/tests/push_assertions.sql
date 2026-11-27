-- Phase 9 assertions: push notifications (tokens, preferences, outbox, claim/finish) and the phase 9 settings.
-- Run AFTER the other assertion files on the same database, with ON_ERROR_STOP=1.
\set ON_ERROR_STOP 1
\i supabase/tests/helpers.sql

create or replace function pg_temp.pu(n int) returns uuid language sql as $$ select ('e9e9e9e9-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
create or replace function pg_temp.tok(n int) returns text language sql as $$ select 'ExponentPushToken[token' || lpad(n::text, 10, '0') || ']' $$;

select pg_temp.new_user(pg_temp.pu(1), 'push-a-owner@example.com', 'owner');   -- A owns a pet
select pg_temp.new_user(pg_temp.pu(2), 'push-b-host@example.com', 'sitter');   -- B hosts
select pg_temp.new_user(pg_temp.pu(3), 'push-c-new@example.com', 'owner');     -- C is waiting for review
select pg_temp.new_user(pg_temp.pu(4), 'push-d-admin@example.com', 'sitter');  -- D is an admin
select pg_temp.activate(pg_temp.pu(1), 'Pia');
select pg_temp.activate(pg_temp.pu(2), 'Pat');
select pg_temp.activate(pg_temp.pu(4), 'Pol');
select pg_temp.make_admin(pg_temp.pu(4));
insert into storage.objects (bucket_id, name) values ('pets', pg_temp.pu(1)::text || '/p.jpg');
insert into public.pets (id, owner_id, name, type, size, photo_paths) values
  (pg_temp.pu(101), pg_temp.pu(1), 'Pipet', 'dog', 'small', array[pg_temp.pu(1)::text || '/p.jpg']);

\echo '--- P1 the tables are unreachable except through the functions'
select pg_temp.fails_as('authenticated', pg_temp.pu(1), 'select count(*) from public.push_tokens', 'read push_tokens');
select pg_temp.fails_as('authenticated', pg_temp.pu(1), 'select count(*) from public.notification_prefs', 'read notification_prefs');
select pg_temp.fails_as('authenticated', pg_temp.pu(1), 'select count(*) from public.notification_outbox', 'read the outbox');
select pg_temp.fails_as('authenticated', pg_temp.pu(1), format($$insert into public.push_tokens (user_id, token, platform) values (%L, %L, 'ios')$$, pg_temp.pu(1), pg_temp.tok(1)), 'wrote push_tokens');
select pg_temp.fails_as('authenticated', pg_temp.pu(1), format($$insert into public.notification_outbox (user_id, pref, title, body, data) values (%L, 'messages', 'x', 'x', '{}')$$, pg_temp.pu(1)), 'wrote the outbox');
select pg_temp.fails_as('anon', null, 'select count(*) from public.push_tokens', 'anon read push_tokens');
select pg_temp.fails_as('anon', null, format($$select public.register_push_token(%L, 'ios')$$, pg_temp.tok(1)), 'anon registered a token');
select pg_temp.fails_as('anon', null, 'select public.my_notification_prefs()', 'anon read prefs');
select pg_temp.fails_as('authenticated', pg_temp.pu(1), 'select * from public.claim_notifications(10)', 'a user claimed notifications');
select pg_temp.fails_as('authenticated', pg_temp.pu(1), 'select public.push_is_enabled()', 'a user read the switch');
select pg_temp.fails_as('authenticated', pg_temp.pu(1), 'select public.finish_notifications(array[1::bigint])', 'a user finished notifications');
select pg_temp.fails_as('authenticated', pg_temp.pu(1), $$select public.remove_push_tokens(array['x'])$$, 'a user removed tokens');
select pg_temp.fails_as('authenticated', pg_temp.pu(1), $$select private.enqueue_notification(gen_random_uuid(), 'messages', 'message', null, 'message')$$, 'a user called enqueue');
-- the push switch and retention settings are not readable by the app
select pg_temp.check(pg_temp.count_as(pg_temp.pu(1), $$select count(*) from public.app_settings where key in ('push_enabled', 'deletion_grace_days', 'shared_history_months')$$) = 0, 'the app can read the phase 9 settings');
select pg_temp.check(pg_temp.as_aal('aal2', pg_temp.pu(4), $$select count(*) from public.app_settings where key in ('push_enabled', 'deletion_grace_days', 'shared_history_months')$$)::bigint = 3, 'an admin with a passkey cannot read the phase 9 settings');
select pg_temp.check(pg_temp.as_aal('aal1', pg_temp.pu(4), $$select count(*) from public.app_settings where key in ('push_enabled', 'deletion_grace_days', 'shared_history_months')$$)::bigint = 0, 'an admin without a passkey can read the phase 9 settings');
select pg_temp.check(not (pg_temp.as_role('authenticated', pg_temp.pu(1), 'select public.get_payment_settings()::text') ~ 'push_enabled'), 'get_payment_settings leaks the push switch');

\echo '--- P2 registering tokens'
select pg_temp.as_role('authenticated', pg_temp.pu(1), format($$select public.register_push_token(%L, 'ios')$$, pg_temp.tok(1)));
select pg_temp.check((select count(*) = 1 and bool_and(user_id = pg_temp.pu(1)) from public.push_tokens where token = pg_temp.tok(1)), 'token was not saved');
select pg_temp.as_role('authenticated', pg_temp.pu(1), format($$select public.register_push_token(%L, 'android')$$, pg_temp.tok(1)));
select pg_temp.check((select count(*) = 1 and bool_and(platform = 'android') from public.push_tokens where token = pg_temp.tok(1)), 'registering twice made two rows');
select pg_temp.fails_as('authenticated', pg_temp.pu(1), $$select public.register_push_token('not-a-token', 'ios')$$, 'a bad token format');
select pg_temp.fails_as('authenticated', pg_temp.pu(1), $$select public.register_push_token('ExponentPushToken[]', 'ios')$$, 'an empty token');
select pg_temp.fails_as('authenticated', pg_temp.pu(1), format($$select public.register_push_token(%L, 'windows')$$, pg_temp.tok(2)), 'a bad platform');
select pg_temp.fails_as('authenticated', pg_temp.pu(1), $$select public.register_push_token(null, 'ios')$$, 'a null token');
-- at most five per person: the oldest go
do $$ begin for i in 2..8 loop
  perform pg_temp.as_role('authenticated', pg_temp.pu(1), format($q$select public.register_push_token(%L, 'ios')$q$, pg_temp.tok(i)));
  update public.push_tokens set last_seen_at = now() + (i || ' seconds')::interval where token = pg_temp.tok(i);
end loop; end $$;
select pg_temp.check((select count(*) = 5 from public.push_tokens where user_id = pg_temp.pu(1)), 'a person holds more than five tokens');
select pg_temp.check(not exists (select 1 from public.push_tokens where token = pg_temp.tok(1)), 'the oldest token was kept');
-- a person waiting for review may register; a removed one may not
select pg_temp.as_role('authenticated', pg_temp.pu(3), format($$select public.register_push_token(%L, 'ios')$$, pg_temp.tok(30)));
update public.profiles set status = 'removed' where id = pg_temp.pu(3);
select pg_temp.fails_as('authenticated', pg_temp.pu(3), format($$select public.register_push_token(%L, 'ios')$$, pg_temp.tok(31)), 'a removed person registered');
update public.profiles set status = 'pending_verification' where id = pg_temp.pu(3);
-- a device that signs in as someone else moves to that person
select pg_temp.as_role('authenticated', pg_temp.pu(2), format($$select public.register_push_token(%L, 'ios')$$, pg_temp.tok(8)));
select pg_temp.check((select user_id = pg_temp.pu(2) from public.push_tokens where token = pg_temp.tok(8)), 'the device stayed with the old person');
select pg_temp.as_role('authenticated', pg_temp.pu(2), format($$select public.unregister_push_token(%L)$$, pg_temp.tok(8)));
select pg_temp.check(not exists (select 1 from public.push_tokens where token = pg_temp.tok(8)), 'unregister did nothing');
select pg_temp.as_role('authenticated', pg_temp.pu(1), format($$select public.unregister_push_token(%L)$$, pg_temp.tok(2)));
select pg_temp.check(exists (select 1 from public.push_tokens where token = pg_temp.tok(2)) = false, 'own unregister did nothing');
select pg_temp.as_role('authenticated', pg_temp.pu(2), format($$select public.unregister_push_token(%L)$$, pg_temp.tok(3)));
select pg_temp.check(exists (select 1 from public.push_tokens where token = pg_temp.tok(3)), 'someone unregistered another person''s token');

\echo '--- P3 preferences'
select pg_temp.check(pg_temp.as_role('authenticated', pg_temp.pu(2), 'select public.my_notification_prefs()::text')::jsonb = '{"messages":true,"bookings":true,"membership":true,"verification":true}'::jsonb, 'defaults are not all true');
select pg_temp.as_role('authenticated', pg_temp.pu(2), $$select public.set_notification_prefs('{"messages": false}')$$);
select pg_temp.check(pg_temp.as_role('authenticated', pg_temp.pu(2), 'select public.my_notification_prefs()::text')::jsonb = '{"messages":false,"bookings":true,"membership":true,"verification":true}'::jsonb, 'partial update changed other keys');
select pg_temp.fails_as('authenticated', pg_temp.pu(2), $$select public.set_notification_prefs('{"email": true}')$$, 'unknown key');
select pg_temp.fails_as('authenticated', pg_temp.pu(2), $$select public.set_notification_prefs('{"messages": "yes"}')$$, 'non boolean');
select pg_temp.fails_as('authenticated', pg_temp.pu(2), $$select public.set_notification_prefs('[1]')$$, 'array');
select pg_temp.fails_as('authenticated', pg_temp.pu(2), $$select public.set_notification_prefs(null)$$, 'null');
select pg_temp.check(pg_temp.as_role('authenticated', pg_temp.pu(1), 'select public.my_notification_prefs()::text')::jsonb ->> 'messages' = 'true', 'one person''s prefs leaked to another');
select pg_temp.as_role('authenticated', pg_temp.pu(2), $$select public.set_notification_prefs('{"messages": true}')$$);

\echo '--- P4 nothing is queued while the switch is off'
select pg_temp.check((select value = 'false' from public.app_settings where key = 'push_enabled'), 'push_enabled should default to false');
select pg_temp.as_role('authenticated', pg_temp.pu(2), format($$select public.register_push_token(%L, 'ios')$$, pg_temp.tok(40)));
create temp table t_ids (k text primary key, v text);
insert into t_ids select 'cv', pg_temp.as_role('authenticated', pg_temp.pu(1), format($$select public.start_conversation(%L)$$, pg_temp.pu(2)));
select pg_temp.as_role('authenticated', pg_temp.pu(1), format($$insert into public.messages (conversation_id, sender_id, body) values (%L, %L, 'secret words about Rex 123')$$, (select v from t_ids where k = 'cv'), pg_temp.pu(1)));
select pg_temp.check((select count(*) = 0 from public.notification_outbox), 'a notification was queued with the switch off');
select pg_temp.check((select not public.push_is_enabled()), 'push_is_enabled is true by default');
select pg_temp.check((select count(*) = 0 from public.claim_notifications(100)), 'claim returned rows with the switch off');

\echo '--- P5 events with the switch on: generic content only'
update public.app_settings set value = 'true' where key = 'push_enabled';
select pg_temp.as_role('authenticated', pg_temp.pu(1), format($$insert into public.messages (conversation_id, sender_id, body) values (%L, %L, 'secret words about Rex 123')$$, (select v from t_ids where k = 'cv'), pg_temp.pu(1)));
select pg_temp.check((select count(*) = 1 from public.notification_outbox where user_id = pg_temp.pu(2)), 'a new message did not queue exactly one notification');
select pg_temp.check((select title = 'PawsPal' and body = 'You have a new message' and data = jsonb_build_object('type', 'message', 'id', (select v from t_ids where k = 'cv')) and pref = 'messages'
                       from public.notification_outbox where user_id = pg_temp.pu(2)), 'the message notification is not generic');
select pg_temp.check((select count(*) = 0 from public.notification_outbox where user_id = pg_temp.pu(1)), 'the sender was notified');
select pg_temp.as_role('authenticated', pg_temp.pu(1), format($$insert into public.messages (conversation_id, sender_id, body) values (%L, %L, 'again')$$, (select v from t_ids where k = 'cv'), pg_temp.pu(1)));
select pg_temp.check((select count(*) = 1 from public.notification_outbox where user_id = pg_temp.pu(2)), 'a second message queued a second notification');
select pg_temp.check((select not (to_jsonb(o)::text ~* 'secret|Rex|Pia|Pat|123|example.com') from public.notification_outbox o where user_id = pg_temp.pu(2)), 'the outbox holds personal data');
-- preferences and blocks
delete from public.notification_outbox;
select pg_temp.as_role('authenticated', pg_temp.pu(2), $$select public.set_notification_prefs('{"messages": false}')$$);
select pg_temp.as_role('authenticated', pg_temp.pu(1), format($$insert into public.messages (conversation_id, sender_id, body) values (%L, %L, 'third')$$, (select v from t_ids where k = 'cv'), pg_temp.pu(1)));
select pg_temp.check((select count(*) = 0 from public.notification_outbox), 'a switched-off preference still queued');
select pg_temp.as_role('authenticated', pg_temp.pu(2), $$select public.set_notification_prefs('{"messages": true}')$$);
-- Arabic
update public.profiles set locale = 'ar' where id = pg_temp.pu(2);
select pg_temp.as_role('authenticated', pg_temp.pu(1), format($$insert into public.messages (conversation_id, sender_id, body) values (%L, %L, 'fourth')$$, (select v from t_ids where k = 'cv'), pg_temp.pu(1)));
select pg_temp.check((select body = 'لديك رسالة جديدة' from public.notification_outbox where user_id = pg_temp.pu(2)), 'no Arabic text for an Arabic locale');
update public.profiles set locale = 'en' where id = pg_temp.pu(2);
-- bookings: request -> host; terms -> other; confirm -> first accepter; cancel -> other
delete from public.notification_outbox;
select pg_temp.as_role('authenticated', pg_temp.pu(1), format($$select public.register_push_token(%L, 'ios')$$, pg_temp.tok(41))) ;
insert into t_ids select 'b', pg_temp.as_role('authenticated', pg_temp.pu(1), format($$select public.request_booking(%L, %L, current_date + 10, current_date + 12, 'sitter_home', 'paid', 200, true)$$, pg_temp.pu(2), pg_temp.pu(101)));
select pg_temp.check((select count(*) = 1 and bool_and(user_id = pg_temp.pu(2) and body = 'There is news about your booking' and data = jsonb_build_object('type', 'booking', 'id', (select v from t_ids where k = 'b'))) from public.notification_outbox), 'a booking request did not notify the host generically');
delete from public.notification_outbox;
select pg_temp.as_role('authenticated', pg_temp.pu(2), format($$select public.propose_terms(%L, current_date + 10, current_date + 13, 'sitter_home', 'paid', 300, true)$$, (select v from t_ids where k = 'b')));
select pg_temp.check((select count(*) = 1 and bool_and(user_id = pg_temp.pu(1) and pref = 'bookings') from public.notification_outbox), 'changed terms did not notify the other person only');
delete from public.notification_outbox;
select pg_temp.as_role('authenticated', pg_temp.pu(1), format($$select public.accept_terms(%L, 2)$$, (select v from t_ids where k = 'b')));
select pg_temp.as_role('authenticated', pg_temp.pu(2), format($$select public.accept_terms(%L, 2)$$, (select v from t_ids where k = 'b')));
select pg_temp.check((select count(*) = 1 and bool_and(user_id = pg_temp.pu(1)) from public.notification_outbox), 'confirming did not notify the other person only');
delete from public.notification_outbox;
select pg_temp.as_role('authenticated', pg_temp.pu(1), format($$select public.cancel_booking(%L, 'private reason text')$$, (select v from t_ids where k = 'b')));
select pg_temp.check((select count(*) = 1 and bool_and(user_id = pg_temp.pu(2) and not (to_jsonb(o)::text ~* 'private reason')) from public.notification_outbox o), 'cancelling did not notify the other person only');
-- not active recipients get nothing
delete from public.notification_outbox;
update public.profiles set status = 'suspended' where id = pg_temp.pu(2);
select pg_temp.as_role('authenticated', pg_temp.pu(1), format($$insert into public.messages (conversation_id, sender_id, body) values (%L, %L, 'to a suspended host')$$, (select v from t_ids where k = 'cv'), pg_temp.pu(1)));
select pg_temp.check((select count(*) = 0 from public.notification_outbox), 'a suspended person was notified');
update public.profiles set status = 'active' where id = pg_temp.pu(2);
select pg_temp.check((select public.is_active(pg_temp.pu(2))), 'test setup: host should be active again');
-- verification and payment decisions reach people who are not active yet
select pg_temp.as_role('authenticated', pg_temp.pu(3), format($$select public.register_push_token(%L, 'ios')$$, pg_temp.tok(42)));
insert into public.verification_requests (user_id, face_path, id_path) values (pg_temp.pu(3), pg_temp.pu(3)::text || '/f.jpg', pg_temp.pu(3)::text || '/i.jpg');
update public.verification_requests set status = 'rejected', note = 'blurry' where user_id = pg_temp.pu(3);
select pg_temp.check((select count(*) = 1 and bool_and(body = 'We have news about your account' and pref = 'verification' and data ->> 'type' = 'account' and not (to_jsonb(o)::text ~* 'blurry')) from public.notification_outbox o where user_id = pg_temp.pu(3)), 'a verification decision did not queue a generic notification');
insert into public.payment_claims (user_id, kind, amount_egp, reference) values (pg_temp.pu(3), 'registration', 75, 'REF-PUSH');
delete from public.notification_outbox;
update public.payment_claims set status = 'confirmed' where user_id = pg_temp.pu(3);
select pg_temp.check((select count(*) = 1 and bool_and(pref = 'membership' and body = 'We have news about your account') from public.notification_outbox where user_id = pg_temp.pu(3)), 'a payment decision did not queue a notification');
-- membership reminder rides on mark_reminded
delete from public.notification_outbox;
update public.memberships set paid_until = current_date + 3 where user_id = pg_temp.pu(1);
select public.mark_reminded(pg_temp.pu(1), current_date + 3);
select pg_temp.check((select count(*) = 1 and bool_and(body = 'Your membership renews soon' and data ->> 'type' = 'membership') from public.notification_outbox where user_id = pg_temp.pu(1)), 'a reminder did not queue a membership notification');
update public.memberships set paid_until = current_date + 180 where user_id = pg_temp.pu(1);

\echo '--- P6 claim, retry, finish'
delete from public.notification_outbox;
insert into public.notification_outbox (user_id, pref, title, body, data) values
  (pg_temp.pu(1), 'messages', 'PawsPal', 'You have a new message', '{"type":"message","id":null}'),
  (pg_temp.pu(1), 'messages', 'PawsPal', 'You have a new message', '{"type":"message","id":null}');
select pg_temp.check((select count(*) = 2 from public.claim_notifications(100) c where cardinality(c.tokens) = 5), 'claim did not return both rows with the person''s five tokens');
select pg_temp.check((select count(*) = 0 from public.claim_notifications(100)), 'a claimed row was offered again at once');
select pg_temp.check((select count(*) = 2 from public.notification_outbox where attempts = 1 and next_attempt_at > now()), 'claimed rows have no backoff');
select pg_temp.check((select public.finish_notifications(array(select id from public.notification_outbox order by id limit 1))) = 1, 'finish did not mark one row');
select pg_temp.check((select count(*) = 1 from public.notification_outbox where status = 'sent' and sent_at is not null), 'sent row not marked');
-- cap of 100 and retries stop
insert into public.notification_outbox (user_id, pref, title, body, data) select pg_temp.pu(1), 'messages', 'PawsPal', 'x', '{"type":"message","id":null}' from generate_series(1, 130);
select pg_temp.check((select count(*) = 100 from public.claim_notifications(100000)), 'a claim returned more than 100 rows');
update public.notification_outbox set attempts = 4, next_attempt_at = now() - interval '1 minute' where status = 'pending';
select pg_temp.check((select count(*) = 0 from public.claim_notifications(100)), 'a row with four tries was tried again');
select pg_temp.check((select count(*) = 0 from public.notification_outbox where status = 'pending' and attempts >= 4), 'rows with four tries are not marked failed');
-- tokens the push service rejects are removed
select pg_temp.check((select public.remove_push_tokens(array[pg_temp.tok(40)])) = 1, 'a rejected token was not removed');
-- switch off again: nothing is handed out
delete from public.notification_outbox;
insert into public.notification_outbox (user_id, pref, title, body, data) values (pg_temp.pu(1), 'messages', 'PawsPal', 'x', '{"type":"message","id":null}');
update public.app_settings set value = 'false' where key = 'push_enabled';
select pg_temp.check((select count(*) = 0 from public.claim_notifications(100)), 'claim handed rows out with the switch off');
delete from public.notification_outbox;

\echo '--- P7 the phase 9 settings are validated'
select pg_temp.fails_aal('aal2', pg_temp.pu(4), $$select public.admin_set_setting('push_enabled', 'maybe')$$, 'push_enabled maybe');
select pg_temp.fails_aal('aal2', pg_temp.pu(4), $$select public.admin_set_setting('push_enabled', '1')$$, 'push_enabled 1');
select pg_temp.fails_aal('aal2', pg_temp.pu(4), $$select public.admin_set_setting('deletion_grace_days', '0')$$, 'grace 0');
select pg_temp.fails_aal('aal2', pg_temp.pu(4), $$select public.admin_set_setting('deletion_grace_days', '366')$$, 'grace 366');
select pg_temp.fails_aal('aal2', pg_temp.pu(4), $$select public.admin_set_setting('deletion_grace_days', '3.5')$$, 'grace 3.5');
select pg_temp.fails_aal('aal2', pg_temp.pu(4), $$select public.admin_set_setting('shared_history_months', '0')$$, 'months 0');
select pg_temp.fails_aal('aal2', pg_temp.pu(4), $$select public.admin_set_setting('shared_history_months', '121')$$, 'months 121');
select pg_temp.fails_aal('aal1', pg_temp.pu(4), $$select public.admin_set_setting('push_enabled', 'true')$$, 'an admin without a passkey changed push_enabled');
select pg_temp.fails_as('authenticated', pg_temp.pu(1), $$select public.admin_set_setting('push_enabled', 'true')$$, 'a user changed push_enabled');
select pg_temp.as_aal('aal2', pg_temp.pu(4), $$select public.admin_set_setting('deletion_grace_days', '30')$$);
select pg_temp.as_aal('aal2', pg_temp.pu(4), $$select public.admin_set_setting('shared_history_months', '24')$$);
select pg_temp.check((select value = 'false' from public.app_settings where key = 'push_enabled'), 'push_enabled was changed');
select pg_temp.check((select count(*) = 2 from public.audit_log where action = 'setting_changed' and details ->> 'key' in ('deletion_grace_days', 'shared_history_months')), 'setting changes are not audited');
\echo 'push assertions OK'
