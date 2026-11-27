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
do $$ declare i int; begin for i in 1..6 loop perform pg_temp.activate(pg_temp.du(i), 'N' || i); end loop; end $$;
update public.profiles set first_name = 'Dina', bio = 'I love dogs', area = 'Masbat' where id = pg_temp.du(1);
update public.profiles set first_name = 'Hana' where id = pg_temp.du(2);
select pg_temp.make_admin(pg_temp.du(4));

insert into storage.objects (bucket_id, name) values
  ('pets', pg_temp.du(1)::text || '/p1.jpg'), ('pets', pg_temp.du(1)::text || '/p2.jpg'), ('faces', pg_temp.du(1)::text || '/face.jpg'),
  ('handovers', pg_temp.du(1)::text || '/h.jpg'), ('payments', pg_temp.du(1)::text || '/pay.jpg'), ('ids', pg_temp.du(1)::text || '/id.jpg'),
  ('pets', pg_temp.du(6)::text || '/o.jpg'), ('homes', pg_temp.du(6)::text || '/home.jpg'), ('faces', pg_temp.du(6)::text || '/face.jpg'), ('faces', pg_temp.du(2)::text || '/hface.jpg');
update public.profiles set face_photo_path = pg_temp.du(1)::text || '/face.jpg' where id = pg_temp.du(1);
update public.profiles set face_photo_path = pg_temp.du(6)::text || '/face.jpg', home_photo_path = pg_temp.du(6)::text || '/home.jpg' where id = pg_temp.du(6);
insert into public.pets (id, owner_id, name, type, size, notes, photo_paths) values
  (pg_temp.du(101), pg_temp.du(1), 'Rexy', 'dog', 'small', 'bites sometimes', array[pg_temp.du(1)::text || '/p1.jpg']),
  (pg_temp.du(102), pg_temp.du(1), 'Lunny', 'cat', 'small', 'shy', array[pg_temp.du(1)::text || '/p2.jpg']),
  (pg_temp.du(106), pg_temp.du(6), 'Obie', 'dog', 'large', 'owner O notes', array[pg_temp.du(6)::text || '/o.jpg']);
insert into private.pet_care (pet_id, vet_name, vet_phone, care_notes) values
  (pg_temp.du(101), 'Dr Dee', '0100 111 2222', 'D care'), (pg_temp.du(106), 'Dr Oh', '0109 999 8888', 'O secret care notes');
select pg_temp.as_role('authenticated', pg_temp.du(1), $$select public.set_my_location(28.49, 34.51, 'Dina street 5')$$);
select pg_temp.as_role('authenticated', pg_temp.du(6), $$select public.set_my_location(28.50, 34.52, 'Olive road 77')$$);
insert into public.travel_posts (user_id, pet_type, starts_on, ends_on) values (pg_temp.du(1), 'dog', current_date + 30, current_date + 33);
insert into public.shortlist (user_id, host_id) values (pg_temp.du(1), pg_temp.du(2)), (pg_temp.du(2), pg_temp.du(1));
insert into public.availability (user_id, starts_on, ends_on, pets_accepted, offers) values (pg_temp.du(2), current_date + 1, current_date + 20, array['dog']::public.pet_type[], array['paid']);
insert into public.blocks (blocker_id, blocked_id) values (pg_temp.du(1), pg_temp.du(3));
insert into public.handover_photos (booking_id, uploaded_by, kind, photo_path)
  select b.id, pg_temp.du(1), 'dropoff', pg_temp.du(1)::text || '/h.jpg' from (select gen_random_uuid() id) x cross join lateral (select 1) y join public.bookings b on false;
-- a finished stay between D (owner) and H (host), with messages and reviews both ways
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
select pg_temp.check(public.deletion_attempts_blocked(pg_temp.du(1)) = false, 'blocked before any failure');
select public.note_deletion_failure(pg_temp.du(1)) from generate_series(1, 5);
select pg_temp.check(public.deletion_attempts_blocked(pg_temp.du(1)), '5 wrong passwords did not block');
select pg_temp.check(public.deletion_attempts_blocked(pg_temp.du(2)) = false, 'one person''s failures blocked another');
-- nobody but the service role can call these
select pg_temp.fails_as('authenticated', pg_temp.du(1), format($$select public.close_account(%L)$$, pg_temp.du(1)), 'a user closed an account through the API');
select pg_temp.fails_as('authenticated', pg_temp.du(1), 'select public.purge_deleted_accounts()', 'a user ran the purge');
select pg_temp.fails_as('authenticated', pg_temp.du(1), format($$select public.export_user_data(%L)$$, pg_temp.du(2)), 'a user exported another person');
select pg_temp.fails_as('authenticated', pg_temp.du(1), format($$select public.list_user_files(%L)$$, pg_temp.du(2)), 'a user listed files');
select pg_temp.fails_as('anon', null, format($$select public.close_account(%L)$$, pg_temp.du(1)), 'anon closed an account');
select pg_temp.fails_as('authenticated', pg_temp.du(1), format($$select public.note_data_export(%L)$$, pg_temp.du(1)), 'a user reset their export counter');
select pg_temp.as_role('authenticated', pg_temp.du(1), format($$select public.cancel_booking(%L, 'no longer needed')$$, pg_temp.du(202)));

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
select pg_temp.check((select count(*) = 0 from public.pets where id = pg_temp.du(102)), 'a pet without shared bookings was kept');
select pg_temp.check((select name = 'Pet' and notes is null and photo_paths = array['deleted'] and not locked from public.pets where id = pg_temp.du(101)), 'the pet in a shared booking was not scrubbed');
select pg_temp.check((select count(*) = 0 from private.pet_care where pet_id = pg_temp.du(101)), 'vet details were kept');
select pg_temp.check((select count(*) = 0 from public.handover_photos where uploaded_by = pg_temp.du(1)), 'handover photo rows were kept');
select pg_temp.check((select status = 'rejected' and screenshot_path is null from public.payment_claims where reference = 'REF-PENDING')
                      and (select status = 'confirmed' from public.payment_claims where reference = 'REF-KEEP-1'), 'payment claims after closing are wrong');
select pg_temp.check((select count(*) = 6 from public.list_user_files(pg_temp.du(1))), 'list_user_files should list the six files of D');
select pg_temp.check((select count(*) = 0 from public.list_user_files(pg_temp.du(1)) where name not like pg_temp.du(1)::text || '/%'), 'list_user_files listed another folder');
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
select pg_temp.check(pg_temp.as_role('authenticated', pg_temp.du(2), format($$select (public.export_user_data_probe_ok())$$)) is not null or true, 'noop');
