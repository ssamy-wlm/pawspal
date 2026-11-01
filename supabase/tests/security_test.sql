-- Security behaviour tests. Run with: bash scripts/test-db.sh
-- Every line marked "expect ERROR" must fail. If one succeeds, a rule is broken: stop and fix it.
\set ON_ERROR_STOP 0
\i supabase/tests/helpers.sql
-- Five people, made the way email sign-up makes them (the real handle_new_user trigger runs), then approved and paid up.
-- A owns a pet, B hosts, C hosts, D hosts and is an admin.
do $$ begin
  perform pg_temp.new_user('aaaaaaaa-0000-0000-0000-000000000001', 'a-owner@example.com', 'owner');
  perform pg_temp.new_user('bbbbbbbb-0000-0000-0000-000000000002', 'b-host@example.com', 'sitter');
  perform pg_temp.new_user('cccccccc-0000-0000-0000-000000000003', 'c-host@example.com', 'sitter');
  perform pg_temp.new_user('dddddddd-0000-0000-0000-000000000004', 'd-admin@example.com', 'sitter');
  perform pg_temp.activate(id, split_part(id::text, '-', 1)) from public.profiles;
end $$;
insert into public.admins values ('dddddddd-0000-0000-0000-000000000004');
-- Processed pet photos (as process-upload would leave them): a pet may only point at real files in its owner's folder.
insert into storage.objects (bucket_id, name) values ('pets', 'aaaaaaaa-0000-0000-0000-000000000001/1.jpg'), ('pets', 'aaaaaaaa-0000-0000-0000-000000000001/2.jpg');

\echo '--- T1 user tries to self-activate / verify (expect ERROR)'
set role authenticated; set request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000003';
update public.profiles set status='active', id_verified=true where id = auth.uid();
reset role;

\echo '--- T2 set exact locations'
set role authenticated; set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select public.set_my_location(28.49512, 34.51345, 'Masbat Road, Building 14');
set request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
select public.set_my_location(28.50021, 34.51811, 'Mashraba, Villa 3');
reset role;

\echo '--- T3 stranger reads cards (approx only) and tries private schema (expect ERROR)'
set role authenticated; set request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000003';
select first_name, approx_lat, approx_lng from public.profile_cards order by 1;
select * from private.locations;
reset role;

\echo '--- T4 owner adds pet, requests booking, opens chat'
set role authenticated; set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
insert into public.pets (id, owner_id, name, type, size, photo_paths) values ('11111111-0000-0000-0000-000000000001', auth.uid(), 'Luna','cat','small', array['aaaaaaaa-0000-0000-0000-000000000001/1.jpg']);
select public.request_booking('bbbbbbbb-0000-0000-0000-000000000002','11111111-0000-0000-0000-000000000001', current_date, current_date, 'sitter_home','volunteer', null, true) as booking \gset
select public.start_conversation('bbbbbbbb-0000-0000-0000-000000000002') as conv \gset
insert into public.messages (conversation_id, sender_id, body) values
 (:'conv', auth.uid(), 'Call me on 010 1234 5678 or +20 100 123 4567, pay by InstaPay, see wa.me/123 or me@mail.com, @luna_cat'),
 (:'conv', auth.uid(), 'Dates are 2026-11-02 to 9, price 250 EGP, she is 3 years old'),
 (:'conv', auth.uid(), 'رقمي ٠١٠١٢٣٤٥٦٧٨ واتساب');
select masked, body from public.messages order by id;

\echo '--- T5 location before the booking is confirmed (expect ERROR)'
select * from public.get_booking_location(:'booking');
\echo '--- T6 user confirms a payment or extends their own membership directly (expect ERROR)'
select public.admin_confirm_payment(gen_random_uuid(), true, null);
update public.memberships set paid_until = current_date + 999 where user_id = auth.uid();
\echo '--- T7 user tries to edit booking directly (expect ERROR)'
update public.bookings set status='confirmed' where id = :'booking';
reset role;

\echo '--- T8 stranger cannot read the conversation or post into it (expect ERROR)'
set role authenticated; set request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000003';
select count(*) as stranger_sees_messages from public.messages;
insert into public.messages (conversation_id, sender_id, body) values (:'conv', auth.uid(), 'hi');
select count(*) as stranger_sees_bookings from public.bookings;
reset role;

\echo '--- T9 both accept the terms: the booking is confirmed'
set role authenticated; set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select public.accept_terms(:'booking', (select terms_version from public.bookings where id = :'booking'));
set request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
select public.accept_terms(:'booking', (select terms_version from public.bookings where id = :'booking'));
reset role;

\echo '--- T10 owner gets the sitter exact pin; stranger cannot'
set role authenticated; set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select * from public.get_booking_location(:'booking');
\echo '--- T11 pet now locked (expect 0 rows updated)'
update public.pets set name = 'Other cat' where id='11111111-0000-0000-0000-000000000001';
\echo '--- T12 after confirmation numbers are no longer masked'
insert into public.messages (conversation_id, sender_id, body) values (:'conv', auth.uid(), 'My number 010 1234 5678');
select masked, body from public.messages order by id desc limit 1;
\echo '--- T13 review before stay completes (expect ERROR)'
insert into public.reviews (booking_id, author_id, subject_id, rating) values (:'booking', auth.uid(), 'bbbbbbbb-0000-0000-0000-000000000002', 5);
set request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000003';
select * from public.get_booking_location(:'booking');
reset role;

\echo '--- T14 drop-off photo starts stay, owner completes, review works'
insert into storage.objects (bucket_id, name) values ('handovers', 'bbbbbbbb-0000-0000-0000-000000000002/h1.jpg');
set role authenticated; set request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
select public.add_handover_photo(:'booking', 'dropoff', 'bbbbbbbb-0000-0000-0000-000000000002/h1.jpg') is not null as photo_saved;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select public.complete_booking(:'booking');
insert into public.reviews (booking_id, author_id, subject_id, rating, body) values (:'booking', auth.uid(), 'bbbbbbbb-0000-0000-0000-000000000002', 5, 'Lovely');
\echo '--- T15 second review same booking (expect ERROR)'
insert into public.reviews (booking_id, author_id, subject_id, rating) values (:'booking', auth.uid(), 'bbbbbbbb-0000-0000-0000-000000000002', 1);
reset role;
select first_name, rating_avg, stays_count from public.profiles where first_name in ('aaaaaaaa','bbbbbbbb') order by 1;

\echo '--- T16 block hides profiles'
set role authenticated; set request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000003';
select public.block_user('aaaaaaaa-0000-0000-0000-000000000001');
select first_name from public.profile_cards order by 1;
\echo '--- T17 non-admin enforcement (expect ERROR), then admin'
select public.admin_take_action('aaaaaaaa-0000-0000-0000-000000000001','warning','x',null,false,'[]','x');
set request.jwt.claim.sub = 'dddddddd-0000-0000-0000-000000000004'; set request.jwt.claims = '{"aal":"aal2"}';
select public.admin_take_action('cccccccc-0000-0000-0000-000000000003','suspension','Keep chats respectful',null,true,'["Stop rude messages"]','Please keep payments in the app') is not null as action_ok;
select action, target_user is not null as has_target from public.audit_log;
reset role; set request.jwt.claims = '';
select first_name, status from public.profiles where first_name='cccccccc';
\echo '--- T18 suspended user cannot message or list (expect ERROR)'
set role authenticated; set request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000003';
insert into public.availability (user_id, starts_on, ends_on, pets_accepted) values (auth.uid(), current_date, current_date+3, '{dog}');
select public.start_conversation('bbbbbbbb-0000-0000-0000-000000000002');
reset role;
\echo '--- T19 security events logged'
select kind, count(*) from public.security_events group by 1 order by 1;
\echo '--- T20 a banned email and a banned device cannot sign up (expect ERROR)'
insert into public.banned_identifiers values ('email', private.email_hash('banned@example.com'));
insert into auth.users (id, email, email_confirmed_at, created_at, raw_user_meta_data)
  values (gen_random_uuid(), 'Banned@Example.com', now(), now(), jsonb_build_object('role', 'owner', 'terms_version', (select current_version from public.legal_documents where doc = 'terms')));
insert into public.banned_identifiers values ('device', private.device_hash('device-banned-1'));
insert into auth.users (id, email, email_confirmed_at, created_at, raw_user_meta_data)
  values (gen_random_uuid(), 'fresh-face@example.com', now(), now(), jsonb_build_object('role', 'owner', 'device_id', 'device-banned-1', 'terms_version', (select current_version from public.legal_documents where doc = 'terms')));

-- ================= search (migration 0002) =================
\echo '=== SEARCH TESTS ==='
-- reactivate C for search testing
update public.profiles set status='active' where first_name='cccccccc';
insert into public.availability (user_id, starts_on, ends_on, pets_accepted, offers, price_per_night, negotiable) values
 ('bbbbbbbb-0000-0000-0000-000000000002', current_date+1, current_date+20, '{cat,dog}', '{paid,food_provided}', 250, false),
 ('cccccccc-0000-0000-0000-000000000003', current_date+5, current_date+8,  '{cat}',     '{paid}', 330, true),
 ('dddddddd-0000-0000-0000-000000000004', current_date+2, current_date+12, '{dog}',     '{volunteer}', null, false);
\echo '--- owner A searches cats, 3..10 days out, budget 200-300, wants food'
set role authenticated; set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select first_name, covers_dates, in_budget, price_per_night, match_score, match_label, distance_km
  from public.search_stays(current_date+3, current_date+10, 'cat', 200, 300, '{food_provided}', false, 28.495, 34.513, 25);
\echo '--- free only (volunteer) for dogs'
select first_name, offers, match_label from public.search_stays(current_date+3, current_date+10, 'dog', 0, null, '{}', true);
\echo '--- random browse'
select count(*) as random_rows from public.browse_random(null, 30);
reset role;
\echo '--- anon cannot search (expect ERROR)'
set role anon;
select * from public.search_stays(current_date+3, current_date+10, 'cat');
reset role;
select pg_temp.new_user('eeeeeeee-0000-0000-0000-000000000005', 'e-host@example.com', 'sitter');
select pg_temp.activate('eeeeeeee-0000-0000-0000-000000000005', 'eeeeeeee');
insert into public.availability (user_id, starts_on, ends_on, pets_accepted, offers, price_per_night, negotiable) values
 ('eeeeeeee-0000-0000-0000-000000000005', current_date+6, current_date+15, '{cat}', '{paid,food_provided}', 340, true),
 ('eeeeeeee-0000-0000-0000-000000000005', current_date+40, current_date+45, '{cat}', '{paid}', 100, false);
set role authenticated; set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select first_name, starts_on - current_date as from_day, covers_dates, in_budget, price_per_night, match_score, match_label
  from public.search_stays(current_date+3, current_date+10, 'cat', 200, 300, '{food_provided}');

-- ================= fixes from the first Claude Code review =================
reset role;
\echo '--- T21 public point uses a secret random offset, kept when the pin moves'
select pg_temp.new_user('ffffffff-0000-0000-0000-000000000006', 'f-owner@example.com', 'owner');
select pg_temp.activate('ffffffff-0000-0000-0000-000000000006', 'ffffffff');
set role authenticated; set request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000000006';
select public.set_my_location(28.49512, 34.51345);   -- same exact point as user A
reset role;
select (select approx_lat from public.profiles where first_name='aaaaaaaa') <> (select approx_lat from public.profiles where first_name='ffffffff')
    or (select approx_lng from public.profiles where first_name='aaaaaaaa') <> (select approx_lng from public.profiles where first_name='ffffffff') as same_spot_different_public_point;
-- keep the value inside the database: psql would round a float8 to 15 digits and make the comparison fail
create table public.test_scratch (k text primary key, v double precision);
insert into public.test_scratch select 'f_off_before', off_lat from private.locations where user_id='ffffffff-0000-0000-0000-000000000006';
set role authenticated; set request.jwt.claim.sub = 'ffffffff-0000-0000-0000-000000000006';
select public.set_my_location(28.5, 34.52);
reset role;
select off_lat = (select v from public.test_scratch where k='f_off_before') as offset_kept_after_move from private.locations where user_id='ffffffff-0000-0000-0000-000000000006';

\echo '--- T22 photos of people awaiting review are hidden from others'
select pg_temp.new_user('99999999-0000-0000-0000-000000000009', 'nine-owner@example.com', 'owner');     -- signed up, not yet approved
insert into storage.objects (bucket_id, name) values ('faces', '99999999-0000-0000-0000-000000000009/selfie.jpg');
set role authenticated; set request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
select count(*) as pending_face_visible_to_others from storage.objects where bucket_id='faces';
set request.jwt.claim.sub = '99999999-0000-0000-0000-000000000009';
select count(*) as own_face_visible_to_self from storage.objects where bucket_id='faces';
reset role;
select pg_temp.activate('99999999-0000-0000-0000-000000000009');
set role authenticated; set request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
select count(*) as approved_face_visible_to_others from storage.objects where bucket_id='faces';
reset role;

\echo '--- T23 cancelling a confirmed booking unlocks the pet'
set role authenticated; set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
insert into public.pets (id, owner_id, name, type, size, photo_paths) values ('22222222-0000-0000-0000-000000000002', auth.uid(), 'Pepper','dog','small', array['aaaaaaaa-0000-0000-0000-000000000001/2.jpg']);
select public.request_booking('bbbbbbbb-0000-0000-0000-000000000002','22222222-0000-0000-0000-000000000002', current_date+1, current_date+2, 'sitter_home','paid', 200, false) as b2 \gset
select public.accept_terms(:'b2', (select terms_version from public.bookings where id = :'b2'));
set request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
select public.accept_terms(:'b2', (select terms_version from public.bookings where id = :'b2'));
reset role;
select locked as locked_after_confirm from public.pets where id='22222222-0000-0000-0000-000000000002';
set role authenticated; set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select public.cancel_booking(:'b2', 'plans changed');
reset role;
select locked as locked_after_cancel from public.pets where id='22222222-0000-0000-0000-000000000002';

\echo '--- T24 reviews of suspended people are hidden from others'
update public.profiles set status='suspended' where first_name='bbbbbbbb';
set role authenticated; set request.jwt.claim.sub = 'eeeeeeee-0000-0000-0000-000000000005';
select count(*) as reviews_of_suspended_visible from public.reviews;
reset role;
update public.profiles set status='active' where first_name='bbbbbbbb';
