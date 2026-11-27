-- Phase 9 assertions: account deletion (close + purge), shared history for the OTHER person, retention, and the data export.
-- Run AFTER the other assertion files on the same database, with ON_ERROR_STOP=1.
\set ON_ERROR_STOP 1
\i supabase/tests/helpers.sql

create or replace function pg_temp.du(n int) returns uuid language sql as $$ select ('d9d9d9d9-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
-- 1 D owner (deletes), 2 H host (the other person), 3 E host, 4 admin, 5 R removed owner (banned), 6 O owner (export), 7 Z plain user
select pg_temp.new_user(pg_temp.du(1), 'del-d-owner@example.com', 'owner');
select pg_temp.new_user(pg_temp.du(2), 'del-h-host@example.com', 'sitter');
select pg_temp.new_user(pg_temp.du(3), 'del-e-host@example.com', 'sitter');
select pg_temp.new_user(pg_temp.du(4), 'del-x-admin@example.com', 'sitter');
select pg_temp.new_user(pg_temp.du(5), 'del-r-removed@example.com', 'owner');
select pg_temp.new_user(pg_temp.du(6), 'del-o-owner@example.com', 'owner');
select pg_temp.new_user(pg_temp.du(7), 'del-z-plain@example.com', 'owner');
select pg_temp.new_user(pg_temp.du(8), 'del-y-clean@example.com', 'owner');
do $$ declare i int; begin for i in 1..6 loop perform pg_temp.activate(pg_temp.du(i), 'N' || i); end loop; end $$;
update public.profiles set first_name = 'Dina', bio = 'I love dogs', area = 'Masbat' where id = pg_temp.du(1);
update public.profiles set first_name = 'Hana' where id = pg_temp.du(2);
select pg_temp.activate(pg_temp.du(8), 'Yan');
select pg_temp.make_admin(pg_temp.du(4));

insert into storage.objects (bucket_id, name) values
  ('pets', pg_temp.du(1)::text || '/p1.jpg'), ('pets', pg_temp.du(1)::text || '/p2.jpg'), ('pets', pg_temp.du(1)::text || '/p3.jpg'), ('faces', pg_temp.du(1)::text || '/face.jpg'),
  ('handovers', pg_temp.du(1)::text || '/h.jpg'), ('payments', pg_temp.du(1)::text || '/pay.jpg'), ('ids', pg_temp.du(1)::text || '/id.jpg'),
  ('pets', pg_temp.du(6)::text || '/o.jpg'), ('homes', pg_temp.du(6)::text || '/home.jpg'), ('faces', pg_temp.du(6)::text || '/face.jpg'), ('faces', pg_temp.du(2)::text || '/hface.jpg');
update public.profiles set face_photo_path = pg_temp.du(1)::text || '/face.jpg' where id = pg_temp.du(1);
update public.profiles set face_photo_path = pg_temp.du(6)::text || '/face.jpg', home_photo_path = pg_temp.du(6)::text || '/home.jpg' where id = pg_temp.du(6);
insert into public.pets (id, owner_id, name, type, size, notes, photo_paths) values
  (pg_temp.du(101), pg_temp.du(1), 'Rexy', 'dog', 'small', 'bites sometimes', array[pg_temp.du(1)::text || '/p1.jpg']),
  (pg_temp.du(102), pg_temp.du(1), 'Lunny', 'cat', 'small', 'shy', array[pg_temp.du(1)::text || '/p2.jpg']),
  (pg_temp.du(103), pg_temp.du(1), 'Neverbooked', 'cat', 'small', 'n', array[pg_temp.du(1)::text || '/p3.jpg']),
  (pg_temp.du(106), pg_temp.du(6), 'Obie', 'dog', 'large', 'owner O notes', array[pg_temp.du(6)::text || '/o.jpg']);
insert into private.pet_care (pet_id, vet_name, vet_phone, care_notes) values
  (pg_temp.du(101), 'Dr Dee', '0100 111 2222', 'D care'), (pg_temp.du(106), 'Dr Oh', '0109 999 8888', 'O secret care notes');
select pg_temp.as_role('authenticated', pg_temp.du(1), $$select public.set_my_location(28.49, 34.51, 'Dina street 5')$$);
select pg_temp.as_role('authenticated', pg_temp.du(6), $$select public.set_my_location(28.50, 34.52, 'Olive road 77')$$);
insert into public.travel_posts (user_id, pet_type, starts_on, ends_on) values (pg_temp.du(1), 'dog', current_date + 30, current_date + 33);
insert into public.shortlist (user_id, host_id) values (pg_temp.du(1), pg_temp.du(2)), (pg_temp.du(2), pg_temp.du(1));
insert into public.availability (user_id, starts_on, ends_on, pets_accepted, offers) values (pg_temp.du(2), current_date + 1, current_date + 20, array['dog']::public.pet_type[], array['paid']);
insert into public.blocks (blocker_id, blocked_id) values (pg_temp.du(1), pg_temp.du(3));
insert into public.bookings (id, owner_id, sitter_id, pet_id, starts_on, ends_on, status, confirmed_at)
  values (pg_temp.du(201), pg_temp.du(1), pg_temp.du(2), pg_temp.du(101), current_date - 30, current_date - 27, 'completed', now() - interval '31 days');
insert into public.handover_photos (booking_id, uploaded_by, kind, photo_path) values (pg_temp.du(201), pg_temp.du(1), 'dropoff', pg_temp.du(1)::text || '/h.jpg');
insert into public.reviews (booking_id, author_id, subject_id, rating, body) values
  (pg_temp.du(201), pg_temp.du(2), pg_temp.du(1), 5, 'great owner'), (pg_temp.du(201), pg_temp.du(1), pg_temp.du(2), 4, 'great host');
create temp table t_ids (k text primary key, v text);
insert into t_ids select 'cv', pg_temp.as_role('authenticated', pg_temp.du(1), format($$select public.start_conversation(%L)$$, pg_temp.du(2)));
insert into public.messages (conversation_id, sender_id, body) values
  ((select v::uuid from t_ids where k = 'cv'), pg_temp.du(1), 'hello Hana'), ((select v::uuid from t_ids where k = 'cv'), pg_temp.du(2), 'hello Dina');
insert into public.reports (reporter_id, reported_id, reason, details) values (pg_temp.du(2), pg_temp.du(1), 'other', 'H report text');
insert into public.payment_claims (user_id, kind, amount_egp, reference, status, decided_at) values (pg_temp.du(1), 'registration', 75, 'REF-KEEP-1', 'confirmed', now());
insert into public.payment_claims (user_id, kind, amount_egp, reference, screenshot_path) values (pg_temp.du(1), 'renewal', 25, 'REF-PENDING', pg_temp.du(1)::text || '/pay.jpg');
insert into public.verification_requests (user_id, face_path, id_path) values (pg_temp.du(1), pg_temp.du(1)::text || '/face.jpg', pg_temp.du(1)::text || '/id.jpg');
insert into public.enforcement_actions (user_id, action, rule, message, admin_id) values (pg_temp.du(1), 'warning', 'r1', 'a warning to D', null);
insert into public.security_events (user_id, kind) values (pg_temp.du(1), 'test_event');

\echo '--- D1 the refusals change nothing'
select pg_temp.check((public.close_account(pg_temp.du(4)) ->> 'status') = 'admin', 'an admin was closed');
select pg_temp.check((public.close_account(gen_random_uuid()) ->> 'status') = 'not_found', 'an unknown id was closed');
insert into public.bookings (id, owner_id, sitter_id, pet_id, starts_on, ends_on, status) values (pg_temp.du(202), pg_temp.du(1), pg_temp.du(3), pg_temp.du(102), current_date + 5, current_date + 7, 'requested');
select pg_temp.check((public.close_account(pg_temp.du(1)) ->> 'status') = 'active_booking', 'a person with an open booking was closed');
select pg_temp.check((select status = 'active' and deleted_at is null and bio = 'I love dogs' from public.profiles where id = pg_temp.du(1)), 'a refused deletion changed the profile');
select pg_temp.check(public.reserve_password_attempt(pg_temp.du(1), 'delete_attempt') and public.reserve_password_attempt(pg_temp.du(1), 'delete_attempt')
                      and public.reserve_password_attempt(pg_temp.du(1), 'delete_attempt') and public.reserve_password_attempt(pg_temp.du(1), 'delete_attempt')
                      and public.reserve_password_attempt(pg_temp.du(1), 'delete_attempt'), 'five tries should be reserved');
select pg_temp.check(public.reserve_password_attempt(pg_temp.du(1), 'delete_attempt') = false, 'the sixth try in an hour was reserved');
select pg_temp.check(public.reserve_password_attempt(pg_temp.du(1), 'export_attempt'), 'the export counter shares the delete counter');
select pg_temp.check(public.reserve_password_attempt(pg_temp.du(2), 'delete_attempt'), 'one person''s tries blocked another');
select pg_temp.check(public.reserve_password_attempt(pg_temp.du(2), 'nonsense') = false and public.reserve_password_attempt(gen_random_uuid(), 'delete_attempt') = false, 'a bad kind or unknown person was reserved');
select public.release_password_attempt(pg_temp.du(1), 'delete_attempt');
select pg_temp.check(public.reserve_password_attempt(pg_temp.du(1), 'delete_attempt'), 'a released try was not given back');
select pg_temp.check(not exists (select 1 from public.security_events where user_id = pg_temp.du(1) and details::text ~* 'pass'), 'attempt rows hold something besides a count');
delete from public.security_events where user_id in (pg_temp.du(1), pg_temp.du(2)) and kind in ('delete_attempt', 'export_attempt');
-- nobody but the service role can call these
select pg_temp.fails_as('authenticated', pg_temp.du(1), format($$select public.close_account(%L)$$, pg_temp.du(1)), 'a user closed an account through the API');
select pg_temp.fails_as('authenticated', pg_temp.du(1), 'select public.purge_deleted_accounts()', 'a user ran the purge');
select pg_temp.fails_as('authenticated', pg_temp.du(1), format($$select public.export_user_data(%L)$$, pg_temp.du(2)), 'a user exported another person');
select pg_temp.fails_as('authenticated', pg_temp.du(1), format($$select public.list_user_files(%L)$$, pg_temp.du(2)), 'a user listed files');
select pg_temp.fails_as('anon', null, format($$select public.close_account(%L)$$, pg_temp.du(1)), 'anon closed an account');
select pg_temp.fails_as('authenticated', pg_temp.du(1), format($$select public.note_data_export(%L)$$, pg_temp.du(1)), 'a user reset their export counter');
select pg_temp.as_role('authenticated', pg_temp.du(1), format($$select public.cancel_booking(%L, 'no longer needed')$$, pg_temp.du(202)));
-- a disputed booking and an unresolved report or appeal against the person block closing, and change nothing
insert into public.bookings (id, owner_id, sitter_id, pet_id, starts_on, ends_on, status) values (pg_temp.du(203), pg_temp.du(1), pg_temp.du(3), pg_temp.du(101), current_date - 20, current_date - 18, 'disputed');
select pg_temp.check((public.close_account(pg_temp.du(1)) ->> 'status') = 'active_booking', 'a disputed booking did not block closing');
delete from public.bookings where id = pg_temp.du(203);
select pg_temp.check((public.close_account(pg_temp.du(1)) ->> 'status') = 'open_case', 'an unresolved report against the person did not block closing');
update public.reports set status = 'in_review' where reported_id = pg_temp.du(1);
select pg_temp.check((public.close_account(pg_temp.du(1)) ->> 'status') = 'open_case', 'a report in review did not block closing');
update public.reports set status = 'resolved' where reported_id = pg_temp.du(1);
insert into public.appeals (id, action_id, user_id, body) select pg_temp.du(301), id, pg_temp.du(1), 'please reconsider' from public.enforcement_actions where user_id = pg_temp.du(1) limit 1;
select pg_temp.check((public.close_account(pg_temp.du(1)) ->> 'status') = 'open_case', 'an unresolved appeal did not block closing');
update public.appeals set status = 'resolved' where id = pg_temp.du(301);
select pg_temp.check((select status = 'active' and deleted_at is null from public.profiles where id = pg_temp.du(1)) and not exists (select 1 from public.banned_identifiers where hash = private.email_hash('del-d-owner@example.com')), 'a refused deletion changed something');
-- a person with no sanction at all keeps no ban hash; one with a warning does
select pg_temp.check((public.close_account(pg_temp.du(8)) ->> 'status') = 'closed', 'the clean person could not close');
select pg_temp.check(not exists (select 1 from public.banned_identifiers where hash = private.email_hash('del-y-clean@example.com')), 'an unsanctioned person was banned by deleting');

\echo '--- D2 closing an account'
update public.app_settings set value = '45' where key = 'deletion_grace_days';
select pg_temp.as_role('authenticated', pg_temp.du(1), format($$select public.register_push_token('ExponentPushToken[delete-me-token]', 'ios')$$));
select pg_temp.as_role('authenticated', pg_temp.du(1), $$select public.set_notification_prefs('{"bookings": false}')$$);
select pg_temp.check((public.close_account(pg_temp.du(1)) ->> 'status') = 'closed', 'close_account did not close');
update public.app_settings set value = '30' where key = 'deletion_grace_days';
select pg_temp.check((select deleted_at is not null and status = 'removed' and first_name = 'Deleted user' and bio is null and area is null and approx_lat is null
                       and approx_lng is null and face_photo_path is null and home_photo_path is null and purged_at is null
                       and purge_after between now() + interval '44 days 23 hours' and now() + interval '45 days 1 hour' from public.profiles where id = pg_temp.du(1)), 'the stub is not anonymised or the purge date is wrong');
select pg_temp.check(not public.is_active(pg_temp.du(1)), 'a closed account is still active');
select pg_temp.check((select count(*) = 0 from public.availability where user_id = pg_temp.du(1)) and (select count(*) = 0 from public.travel_posts where user_id = pg_temp.du(1))
                      and (select count(*) = 0 from public.shortlist where pg_temp.du(1) in (user_id, host_id)) and (select count(*) = 0 from public.blocks where pg_temp.du(1) in (blocker_id, blocked_id))
                      and (select count(*) = 0 from private.locations where user_id = pg_temp.du(1)) and (select count(*) = 0 from public.push_tokens where user_id = pg_temp.du(1))
                      and (select count(*) = 0 from public.notification_prefs where user_id = pg_temp.du(1)) and (select count(*) = 0 from public.verification_requests where user_id = pg_temp.du(1)),
                     'personal rows were left after closing');
select pg_temp.check((select count(*) = 0 from public.pets where id = pg_temp.du(103)), 'a pet without shared bookings was kept');
select pg_temp.check((select name = 'Pet' and photo_paths = array['deleted'] from public.pets where id = pg_temp.du(102)), 'a pet in a cancelled (kept) booking was not scrubbed');
select pg_temp.check((select name = 'Pet' and notes is null and photo_paths = array['deleted'] and not locked from public.pets where id = pg_temp.du(101)), 'the pet in a shared booking was not scrubbed');
select pg_temp.check((select count(*) = 0 from private.pet_care where pet_id = pg_temp.du(101)), 'vet details were kept');
select pg_temp.check((select count(*) = 0 from public.handover_photos where uploaded_by = pg_temp.du(1)), 'handover photo rows were kept');
select pg_temp.check((select status = 'rejected' and screenshot_path is null from public.payment_claims where reference = 'REF-PENDING')
                      and (select status = 'confirmed' from public.payment_claims where reference = 'REF-KEEP-1'), 'payment claims after closing are wrong');
select pg_temp.check((select count(*) = 7 from public.list_user_files(pg_temp.du(1))), 'list_user_files should list the seven files of D');
select pg_temp.check((select count(*) = 0 from public.list_user_files(pg_temp.du(1)) where name not like pg_temp.du(1)::text || '/%'), 'list_user_files listed another folder');
select pg_temp.check(exists (select 1 from public.banned_identifiers where kind = 'email' and hash = private.email_hash('del-d-owner@example.com')), 'a person with a warning was not banned by deleting');
select pg_temp.check((public.close_account(pg_temp.du(1)) ->> 'status') = 'already_closed', 'closing twice was not idempotent');
select pg_temp.check((select count(*) = 1 from public.audit_log where action = 'account_deleted' and target_user = pg_temp.du(1) and details = '{"grace_days": 45}'), 'no clean audit entry');

\echo '--- D3 hidden everywhere, cannot be revived'
select pg_temp.check((select count(*) = 0 from public.profile_cards where id = pg_temp.du(1)) , 'a deleted person is in profile_cards (as postgres, no caller: expect none)');
select pg_temp.check(pg_temp.count_as(pg_temp.du(2), format($$select count(*) from public.profile_cards where id = %L$$, pg_temp.du(1))) = 0, 'a deleted person is in profile_cards');
select pg_temp.check(pg_temp.count_as(pg_temp.du(2), format($$select count(*) from public.map_availability() where user_id = %L$$, pg_temp.du(1))) = 0, 'a deleted person is on the map');
select pg_temp.check(pg_temp.count_as(pg_temp.du(2), format($$select count(*) from public.browse_travellers() where user_id = %L$$, pg_temp.du(1))) = 0, 'a deleted person is in the travellers list');
select pg_temp.fails_as('authenticated', pg_temp.du(2), format($$select public.start_conversation(%L)$$, pg_temp.du(1)), 'a conversation was started with a deleted person');
select pg_temp.fails_as('authenticated', pg_temp.du(2), format($$insert into public.messages (conversation_id, sender_id, body) values (%L, %L, 'anyone there')$$, (select v from t_ids where k = 'cv'), pg_temp.du(2)), 'a message was sent to a deleted person');
select pg_temp.fails_as('authenticated', pg_temp.du(1), $$select public.request_booking(gen_random_uuid(), gen_random_uuid(), current_date + 9, current_date + 10, 'sitter_home', 'volunteer', null, false)$$, 'a deleted person requested a booking');
select pg_temp.fails_as('authenticated', pg_temp.du(1), format($$insert into public.messages (conversation_id, sender_id, body) values (%L, %L, 'ghost')$$, (select v from t_ids where k = 'cv'), pg_temp.du(1)), 'a deleted person sent a message');
select pg_temp.fails('update public.profiles set status = ''active'' where id = ''' || pg_temp.du(1) || '''', 'a deleted profile became active again');
select pg_temp.fails_aal('aal2', pg_temp.du(4), format($$select public.admin_take_action(%L, 'reinstatement', null, null, false, '[]', 'back')$$, pg_temp.du(1)), 'an admin reinstated a deleted person');
select pg_temp.fails_aal('aal2', pg_temp.du(4), format($$select public.admin_take_action(%L, 'approval', null, null, false, '[]', null)$$, pg_temp.du(1)), 'an admin approved a deleted person');

-- an old access token of the closed person (the session claims still say it is them) can write nothing
select pg_temp.as_role('authenticated', pg_temp.du(1), $$update public.profiles set first_name = 'Zed', bio = 'haunting', area = 'Everywhere' where id = auth.uid()$$);
select pg_temp.check((select first_name = 'Deleted user' and bio is null and area is null from public.profiles where id = pg_temp.du(1)), 'a closed person edited their own stub');
select pg_temp.fails_as('authenticated', pg_temp.du(1), $$select public.set_my_location(28.5, 34.5, 'Back again 1')$$, 'a closed person re-created their exact location');
select pg_temp.check((select count(*) = 0 from private.locations where user_id = pg_temp.du(1)), 'the exact location came back');
select pg_temp.fails_as('authenticated', pg_temp.du(1), format($$insert into public.pets (owner_id, name, type, size, photo_paths) values (%L, 'Ghost', 'dog', 'small', array[%L])$$, pg_temp.du(1), pg_temp.du(1)::text || '/p1.jpg'), 'a closed person added a pet');
select pg_temp.fails_as('authenticated', pg_temp.du(1), format($$select public.set_pet_care(%L, 'Dr X', '0100', 'x')$$, pg_temp.du(101)), 'a closed person wrote vet details');
select pg_temp.fails_as('authenticated', pg_temp.du(1), format($$insert into public.legal_acceptances (user_id, doc, version) values (%L, 'guidelines', 'x9')$$, pg_temp.du(1)), 'a closed person accepted a document');
select pg_temp.fails_as('authenticated', pg_temp.du(1), format($$select public.block_user(%L)$$, pg_temp.du(3)), 'a closed person blocked someone');
select pg_temp.fails_as('authenticated', pg_temp.du(1), format($$select public.mark_conversation_read(%L)$$, (select v from t_ids where k = 'cv')), 'a closed person wrote a read mark');
select pg_temp.fails_as('authenticated', pg_temp.du(1), format($$insert into storage.objects (bucket_id, name) values ('incoming', %L)$$, pg_temp.du(1)::text || '/new.jpg'), 'a closed person uploaded a raw photo');
select pg_temp.fails_as('authenticated', pg_temp.du(1), $$select public.set_notification_prefs('{"messages": false}')$$, 'a closed person set preferences');
select pg_temp.fails_as('authenticated', pg_temp.du(1), format($$select public.register_push_token('ExponentPushToken[closed-user-token]', 'ios')$$), 'a closed person registered a token');
select pg_temp.fails_as('authenticated', pg_temp.du(1), format($$select public.submit_verification(%L, %L)$$, pg_temp.du(1)::text || '/a.jpg', pg_temp.du(1)::text || '/b.jpg'), 'a closed person submitted a verification');
select pg_temp.fails_as('authenticated', pg_temp.du(1), $$select public.submit_payment_claim('REF-GHOST', null)$$, 'a closed person submitted a payment claim');
select pg_temp.check((select count(*) = 0 from public.push_tokens where user_id = pg_temp.du(1)) and (select count(*) = 0 from public.verification_requests where user_id = pg_temp.du(1)), 'a closed person wrote rows');

\echo '--- D4 the OTHER person keeps working history'
select pg_temp.check(pg_temp.count_as(pg_temp.du(2), format($$select count(*) from public.my_conversations() where other_id = %L and first_name = 'Deleted user'$$, pg_temp.du(1))) = 1, 'the other person lost the conversation or it shows a real name');
select pg_temp.check(pg_temp.count_as(pg_temp.du(2), format($$select count(*) from public.messages where conversation_id = %L$$, (select v from t_ids where k = 'cv'))) = 2, 'the other person lost the messages');
select pg_temp.check(pg_temp.count_as(pg_temp.du(2), format($$select count(*) from public.bookings where id = %L$$, pg_temp.du(201))) = 1, 'the other person lost the booking');
select pg_temp.check(pg_temp.count_as(pg_temp.du(2), 'select count(*) from public.reviews') >= 2, 'the other person lost the reviews');
select pg_temp.check(pg_temp.count_as(pg_temp.du(2), format($$select count(*) from public.list_handover_photos(%L)$$, pg_temp.du(201))) = 0, 'list_handover_photos failed or listed a deleted photo');
select pg_temp.as_role('authenticated', pg_temp.du(2), format($$select public.mark_conversation_read(%L)$$, (select v from t_ids where k = 'cv')));
select pg_temp.check(pg_temp.count_as(pg_temp.du(2), 'select count(*) from public.my_blocks()') = 0, 'my_blocks failed');
select pg_temp.check(pg_temp.count_as(pg_temp.du(2), 'select count(*) from public.my_alerts()') = 0, 'my_alerts failed');
select pg_temp.as_role('authenticated', pg_temp.du(2), format($$select count(*) from public.search_stays(current_date + 2, current_date + 4, 'dog')$$));
select pg_temp.as_role('authenticated', pg_temp.du(2), $$select count(*) from public.browse_random()$$);

\echo '--- D5 the purge keeps what it must keep and removes the rest'
select pg_temp.check((public.purge_deleted_accounts() ->> 'purged') = '0', 'the purge ran before the grace period ended');
select pg_temp.check(exists (select 1 from auth.users where id = pg_temp.du(1)), 'the auth user was deleted before the grace period ended');
-- a removed, banned person who then deletes the account stays banned
select pg_temp.as_aal('aal2', pg_temp.du(4), format($$select public.admin_take_action(%L, 'removal', 'rule', null, false, '[]', 'bye')$$, pg_temp.du(5)));
delete from public.banned_identifiers where hash = private.email_hash('del-r-removed@example.com');          -- as if the ban list had lost it
select pg_temp.check((public.close_account(pg_temp.du(5)) ->> 'status') = 'closed', 'a removed person could not close the account');
select pg_temp.check(exists (select 1 from public.banned_identifiers where kind = 'email' and hash = private.email_hash('del-r-removed@example.com')), 'closing did not keep the ban hash');
alter table public.profiles disable trigger guard_deleted_profile_before_update;   -- the test moves the clock; nobody else can
update public.profiles set purge_after = now() - interval '1 minute' where id in (pg_temp.du(1), pg_temp.du(5));
alter table public.profiles enable trigger guard_deleted_profile_before_update;
create temp table t_purge as select public.purge_deleted_accounts() as r;
select pg_temp.check((select (r ->> 'purged')::int = 2 from t_purge), 'the purge should have purged two accounts');
select pg_temp.check((select jsonb_array_length(r -> 'files') = 7 and (r -> 'files') @> jsonb_build_array(jsonb_build_object('bucket', 'faces', 'name', pg_temp.du(1)::text || '/face.jpg')) from t_purge), 'the purge did not list the leftover files');
select pg_temp.check(not exists (select 1 from auth.users where id in (pg_temp.du(1), pg_temp.du(5))), 'the auth users were not deleted');
select pg_temp.check((select purged_at is not null and deleted_at is not null and status = 'removed' and first_name = 'Deleted user' from public.profiles where id = pg_temp.du(1)), 'the stub is gone or not anonymised');
select pg_temp.check((select count(*) = 0 from public.legal_acceptances where user_id = pg_temp.du(1)) and (select count(*) = 0 from public.memberships where user_id = pg_temp.du(1))
                      and (select count(*) = 0 from public.security_events where user_id = pg_temp.du(1)), 'personal rows survived the purge');
select pg_temp.check((select count(*) = 2 and bool_and(user_id is null) from public.payment_claims where reference in ('REF-KEEP-1', 'REF-PENDING')), 'payment records were not kept and detached');
select pg_temp.check((select amount_egp = 75 and reference = 'REF-KEEP-1' and decided_at is not null from public.payment_claims where reference = 'REF-KEEP-1'), 'the payment record lost its content');
select pg_temp.check((select count(*) = 2 from public.audit_log where action in ('account_deleted', 'account_purged') and target_user = pg_temp.du(1)), 'audit entries are missing');
select pg_temp.check(not exists (select 1 from public.audit_log where target_user = pg_temp.du(1) and details::text ~* 'Dina|del-d-owner|REF-'), 'the audit log holds personal data');
select pg_temp.check(exists (select 1 from public.banned_identifiers where kind = 'email' and hash = private.email_hash('del-r-removed@example.com')), 'the ban hash did not survive the purge');
select pg_temp.fails_with($$select pg_temp.new_user(gen_random_uuid(), 'del-r-removed@example.com', 'owner')$$, '[E5]', 'a banned person signed up again after deleting the account');
select pg_temp.check((select count(*) = 1 from public.enforcement_actions where user_id = pg_temp.du(1)) and (select count(*) = 1 from public.reports where reported_id = pg_temp.du(1)), 'moderation records were removed');
-- shared history is still there for the other person
select pg_temp.check(pg_temp.count_as(pg_temp.du(2), 'select count(*) from public.my_conversations() where first_name = ''Deleted user''') = 1, 'the conversation vanished after the purge');
select pg_temp.check(pg_temp.count_as(pg_temp.du(2), format($$select count(*) from public.messages where conversation_id = %L$$, (select v from t_ids where k = 'cv'))) = 2, 'messages vanished after the purge');
select pg_temp.check(pg_temp.count_as(pg_temp.du(2), format($$select count(*) from public.bookings where id = %L$$, pg_temp.du(201))) = 1, 'the booking vanished after the purge');
select pg_temp.check((public.purge_deleted_accounts() ->> 'purged') = '0', 'the purge is not idempotent');
-- an ordinary account's profile still goes with its auth user; the other tables of other people stay
delete from auth.users where id = pg_temp.du(7);
select pg_temp.check(not exists (select 1 from public.profiles where id = pg_temp.du(7)), 'deleting an ordinary auth user left the profile');

\echo '--- D6 retention of shared history'
update public.app_settings set value = '1' where key = 'shared_history_months';
-- a conversation or booking named by an unresolved report is kept, and a deleted booking's handover files are returned
insert into storage.objects (bucket_id, name) values ('handovers', pg_temp.du(2)::text || '/hand204.jpg');
insert into public.bookings (id, owner_id, sitter_id, pet_id, starts_on, ends_on, status) values (pg_temp.du(204), pg_temp.du(1), pg_temp.du(2), pg_temp.du(101), current_date - 92, current_date - 90, 'completed');
insert into public.handover_photos (booking_id, uploaded_by, kind, photo_path) values (pg_temp.du(204), pg_temp.du(2), 'dropoff', pg_temp.du(2)::text || '/hand204.jpg');
insert into public.reports (id, reporter_id, reported_id, reason, booking_id, conversation_id, details) values (pg_temp.du(401), pg_temp.du(2), pg_temp.du(1), 'other', pg_temp.du(204), (select v::uuid from t_ids where k = 'cv'), 'open evidence');
select pg_temp.check(private.case_protected((select v::uuid from t_ids where k = 'cv'), null, pg_temp.du(1), pg_temp.du(2)), 'an open report did not protect the conversation');
select pg_temp.check((public.purge_deleted_accounts() ->> 'bookings_deleted') = '0' and exists (select 1 from public.bookings where id = pg_temp.du(204)), 'a booking named by an open report was deleted');
update public.reports set status = 'resolved' where id = pg_temp.du(401);
create temp table t_ret as select public.purge_deleted_accounts() as r;
select pg_temp.check((select (r ->> 'bookings_deleted') = '1' and (r -> 'files') @> jsonb_build_array(jsonb_build_object('bucket', 'handovers', 'name', pg_temp.du(2)::text || '/hand204.jpg')) from t_ret), 'the handover files of a deleted booking were not returned');
select pg_temp.check(not private.case_protected((select v::uuid from t_ids where k = 'cv'), null, pg_temp.du(1), pg_temp.du(2)), 'a resolved report still protects');
delete from public.reports where id = pg_temp.du(401);
update public.messages set created_at = now() - interval '40 days' where conversation_id = (select v::uuid from t_ids where k = 'cv') and body = 'hello Hana';
update public.conversations set created_at = now() - interval '40 days' where id = (select v::uuid from t_ids where k = 'cv');
select pg_temp.check((public.purge_deleted_accounts() ->> 'messages_deleted') = '1', 'only the old message should go');
select pg_temp.check(pg_temp.count_as(pg_temp.du(2), format($$select count(*) from public.messages where conversation_id = %L$$, (select v from t_ids where k = 'cv'))) = 1, 'a recent message was deleted by retention');
select pg_temp.check(exists (select 1 from public.bookings where id = pg_temp.du(201)), 'a recent booking was deleted');   -- ended 27 days ago, 1 month = still kept
update public.bookings set ends_on = current_date - 60, starts_on = current_date - 62 where id = pg_temp.du(201);
update public.messages set created_at = now() - interval '40 days' where conversation_id = (select v::uuid from t_ids where k = 'cv');
select pg_temp.check((public.purge_deleted_accounts() ->> 'bookings_deleted') = '1', 'the old booking was not deleted');
select pg_temp.check(not exists (select 1 from public.bookings where id = pg_temp.du(201)) and not exists (select 1 from public.handover_photos where booking_id = pg_temp.du(201)), 'the booking or its photos survived retention');
select pg_temp.check((select count(*) = 2 and bool_and(booking_id is null) from public.reviews where author_id in (pg_temp.du(1), pg_temp.du(2))), 'reviews did not survive the booking with booking_id null');
select pg_temp.check(not exists (select 1 from public.conversations where id = (select v::uuid from t_ids where k = 'cv')), 'the empty old conversation was kept');
select pg_temp.check(not exists (select 1 from public.pets where id = pg_temp.du(101)), 'the pet shell was kept with no booking left');
select pg_temp.check(exists (select 1 from public.profiles where id = pg_temp.du(1)), 'the stub went while reports, reviews and moderation records still point to it');
select pg_temp.check(exists (select 1 from public.profiles where id = pg_temp.du(1)), 'the stub went while a kept booking points to it');
delete from public.bookings where id = pg_temp.du(202);
delete from public.reports where reported_id = pg_temp.du(1);
delete from public.reviews where pg_temp.du(1) in (author_id, subject_id);
delete from public.enforcement_actions where user_id = pg_temp.du(1);
select pg_temp.check((public.purge_deleted_accounts() ->> 'stubs_deleted')::int >= 1, 'no empty stub was removed');
select pg_temp.check(not exists (select 1 from public.profiles where id = pg_temp.du(1)), 'an empty stub was not removed');
update public.app_settings set value = '24' where key = 'shared_history_months';

\echo '--- D7 the data export'
select pg_temp.as_role('authenticated', pg_temp.du(2), format($$select public.start_conversation(%L)$$, pg_temp.du(6)));
insert into public.messages (conversation_id, sender_id, body) values
  ((select id from public.conversations where pg_temp.du(6) in (user_a, user_b) and pg_temp.du(2) in (user_a, user_b)), pg_temp.du(2), 'hello Olive'),
  ((select id from public.conversations where pg_temp.du(6) in (user_a, user_b) and pg_temp.du(2) in (user_a, user_b)), pg_temp.du(6), 'hello Hana, text me on 0100 555 6677');
insert into public.reports (reporter_id, reported_id, reason, details) values (pg_temp.du(6), pg_temp.du(2), 'other', 'O reports H'), (pg_temp.du(2), pg_temp.du(6), 'other', 'H reports O secret report');
insert into public.verification_requests (user_id, face_path, status, note, decided_at) values (pg_temp.du(6), pg_temp.du(6)::text || '/face.jpg', 'approved', 'internal approval note', now());
insert into public.payment_claims (user_id, kind, amount_egp, reference, status, note, decided_at) values (pg_temp.du(6), 'registration', 75, 'REF-O-1', 'confirmed', 'internal confirm note', now());
insert into public.blocks (blocker_id, blocked_id) values (pg_temp.du(6), pg_temp.du(3));
insert into public.reviews (booking_id, author_id, subject_id, rating, body) values (null, pg_temp.du(3), pg_temp.du(6), 3, 'review about O');
create temp table t_export as select public.export_user_data(pg_temp.du(6)) as j;
select pg_temp.check((select j -> 'profile' ->> 'id' = pg_temp.du(6)::text and j -> 'exact_location' ->> 'address' = 'Olive road 77' and j -> 'pets' -> 0 ->> 'vet_phone' = '0109 999 8888' from t_export), 'the export misses the person''s own profile, location or vet details');
select pg_temp.check((select jsonb_array_length(j -> 'conversations') = 1 and jsonb_array_length(j -> 'conversations' -> 0 -> 'messages') = 2 and (j -> 'conversations' -> 0 -> 'messages' -> 0 ->> 'sent_by_me')::boolean = false from t_export), 'the export misses own conversations');
select pg_temp.check((select (j -> 'reports_made' -> 0 ->> 'details') = 'O reports H' and jsonb_array_length(j -> 'reports_made') = 1 from t_export), 'reports made are wrong');
select pg_temp.check((select jsonb_array_length(j -> 'reviews_received') = 1 and jsonb_array_length(j -> 'blocks_made') = 1 and jsonb_array_length(j -> 'legal_acceptances') >= 2 and j -> 'payment_claims' -> 0 ->> 'reference' = 'REF-O-1' from t_export), 'reviews, blocks, acceptances or payments are wrong');
select pg_temp.check((select j -> 'notification_prefs' = '{"messages":true,"bookings":true,"membership":true,"verification":true}'::jsonb and j ? 'membership' and j ? 'files' from t_export), 'prefs or membership are missing');
select pg_temp.check((select (j -> 'files') @> jsonb_build_array(jsonb_build_object('kind', 'face', 'bucket', 'faces', 'path', pg_temp.du(6)::text || '/face.jpg')) and jsonb_array_length(j -> 'files') = 3 from t_export), 'the file list is wrong');
-- nothing private of other people, no admin notes, no hashes, no events
select pg_temp.check((select j::text !~ 'H reports O secret|internal approval note|internal confirm note|del-h-host@|del-e-host@|del-o-owner@|Dina street|\$2|sha256' from t_export), 'the export holds notes, emails or other people''s data');
select pg_temp.check((select not (j ? 'security_events') and not (j ? 'audit_log') and not (j ? 'admin_notes') and not (j ? 'push_tokens') from t_export), 'the export has internal sections');
select pg_temp.check((select j::text !~ (select string_agg(hash, '|') from public.banned_identifiers) from t_export) or not exists (select 1 from public.banned_identifiers), 'the export holds a ban hash');
-- the other person's export has nothing of O's private data
create temp table t_export_h as select public.export_user_data(pg_temp.du(2)) as j;
select pg_temp.check((select j::text !~ 'Olive road|O secret care|0109 999 8888|O reports H|O owner notes|REF-O-1|internal' from t_export_h), 'one person''s export holds another person''s private data');
select pg_temp.check((select j::text ~ 'hello Hana, text me' and jsonb_array_length(j -> 'reports_made') = 1 and j::text !~ 'O reports H' from t_export_h), 'the other side of a conversation or the reports against me are wrong');
select pg_temp.check((select j -> 'conversations' -> 0 ->> 'other_first_name' = 'N6' from t_export_h), 'the other person''s visible first name is not shown');
-- a rejected decision note is the person's own (the app shows it), an approved one is not exported
update public.verification_requests set status = 'rejected', note = 'photo was blurry' where user_id = pg_temp.du(6);
select pg_temp.check((select public.export_user_data(pg_temp.du(6)) -> 'verification_requests' -> 0 ->> 'note') = 'photo was blurry', 'a rejection note is missing from the export');
select pg_temp.check(public.export_user_data(gen_random_uuid()) is null, 'an unknown person exported something');
select pg_temp.check(public.export_user_data(pg_temp.du(5)) is null, 'a deleted person can be exported');
-- 3 exports a day
select pg_temp.check(public.note_data_export(pg_temp.du(6)) and public.note_data_export(pg_temp.du(6)) and public.note_data_export(pg_temp.du(6)), 'three exports should pass');
select pg_temp.check(public.note_data_export(pg_temp.du(6)) = false, 'a fourth export in a day passed');
select pg_temp.check(public.note_data_export(pg_temp.du(2)), 'one person''s exports limited another');
select pg_temp.check(public.note_data_export(gen_random_uuid()) = false, 'an unknown person was counted');
\echo 'deletion assertions OK'
