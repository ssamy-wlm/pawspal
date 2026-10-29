-- Security behaviour tests. Run with: bash scripts/test-db.sh
-- Every line marked "expect ERROR" must fail. If one succeeds, a rule is broken: stop and fix it.
\set ON_ERROR_STOP 0
insert into auth.users (id, phone, phone_confirmed_at) values
 ('aaaaaaaa-0000-0000-0000-000000000001','+201000000001',now()),
 ('bbbbbbbb-0000-0000-0000-000000000002','+201000000002',now()),
 ('cccccccc-0000-0000-0000-000000000003','+201000000003',now()),
 ('dddddddd-0000-0000-0000-000000000004','+201000000004',now());
update public.profiles set first_name = split_part(id::text,'-',1), status='active', face_verified=true, id_verified=true, is_adult=true;
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

\echo '--- T5 location before payment (expect ERROR)'
select * from public.get_booking_location(:'booking');
\echo '--- T6 user calls the payment-confirm function directly (expect ERROR)'
select public.confirm_booking_payment(:'booking');
\echo '--- T7 user tries to edit booking directly (expect ERROR)'
update public.bookings set fee_status='paid', status='confirmed' where id = :'booking';
reset role;

\echo '--- T8 stranger cannot read the conversation or post into it (expect ERROR)'
set role authenticated; set request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000003';
select count(*) as stranger_sees_messages from public.messages;
insert into public.messages (conversation_id, sender_id, body) values (:'conv', auth.uid(), 'hi');
select count(*) as stranger_sees_bookings from public.bookings;
reset role;

\echo '--- T9 both accept terms, webhook confirms payment'
set role authenticated; set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select public.accept_terms(:'booking');
set request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
select public.accept_terms(:'booking');
reset role;
set role service_role; select public.confirm_booking_payment(:'booking'); reset role;

\echo '--- T10 owner gets the sitter exact pin; stranger cannot'
set role authenticated; set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select * from public.get_booking_location(:'booking');
\echo '--- T11 pet now locked (expect 0 rows updated)'
update public.pets set name = 'Other cat' where id='11111111-0000-0000-0000-000000000001';
\echo '--- T12 after payment numbers are no longer masked'
insert into public.messages (conversation_id, sender_id, body) values (:'conv', auth.uid(), 'My number 010 1234 5678');
select masked, body from public.messages order by id desc limit 1;
\echo '--- T13 review before stay completes (expect ERROR)'
insert into public.reviews (booking_id, author_id, subject_id, rating) values (:'booking', auth.uid(), 'bbbbbbbb-0000-0000-0000-000000000002', 5);
set request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000003';
select * from public.get_booking_location(:'booking');
reset role;

\echo '--- T14 drop-off photo starts stay, owner completes, review works'
set role authenticated; set request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
insert into public.handover_photos (booking_id, uploaded_by, kind, photo_path) values (:'booking', auth.uid(), 'dropoff', 'b/h1.jpg');
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select public.complete_booking(:'booking');
insert into public.reviews (booking_id, author_id, subject_id, rating, body) values (:'booking', auth.uid(), 'bbbbbbbb-0000-0000-0000-000000000002', 5, 'Lovely');
\echo '--- T15 second review same booking (expect ERROR)'
insert into public.reviews (booking_id, author_id, subject_id, rating) values (:'booking', auth.uid(), 'bbbbbbbb-0000-0000-0000-000000000002', 1);
reset role;
select first_name, rating_avg, stays_count from public.profiles where first_name in ('aaaaaaaa','bbbbbbbb') order by 1;

\echo '--- T16 block hides profiles'
set role authenticated; set request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000003';
insert into public.blocks values (auth.uid(), 'aaaaaaaa-0000-0000-0000-000000000001');
select first_name from public.profile_cards order by 1;
\echo '--- T17 non-admin enforcement (expect ERROR), then admin'
select public.admin_take_action('aaaaaaaa-0000-0000-0000-000000000001','warning','x',null,false,'[]','x');
set request.jwt.claim.sub = 'dddddddd-0000-0000-0000-000000000004';
select public.admin_take_action('cccccccc-0000-0000-0000-000000000003','suspension','Keep payments in the app',null,true,'["Stop asking for off-app payment"]','Please keep payments in the app') is not null as action_ok;
select action, target_user is not null as has_target from public.audit_log;
reset role;
select first_name, status from public.profiles where first_name='cccccccc';
\echo '--- T18 suspended user cannot message or list (expect ERROR)'
set role authenticated; set request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000003';
insert into public.availability (user_id, starts_on, ends_on, pets_accepted) values (auth.uid(), current_date, current_date+3, '{dog}');
select public.start_conversation('bbbbbbbb-0000-0000-0000-000000000002');
reset role;
\echo '--- T19 security events logged'
select kind, count(*) from public.security_events group by 1 order by 1;
\echo '--- T20 banned phone cannot sign up (expect ERROR)'
insert into public.banned_identifiers values ('phone', encode(extensions.digest('+201099999999','sha256'),'hex'));
insert into auth.users (phone) values ('+201099999999');

-- ================= search (migration 0002) =================
\echo '=== SEARCH TESTS ==='
-- reactivate C for search testing
update public.profiles set status='active' where first_name='cccccccc';
insert into public.availability (user_id, starts_on, ends_on, pets_accepted, offers, price_per_night, negotiable) values
 ('bbbbbbbb-0000-0000-0000-000000000002', current_date+1, current_date+20, '{cat,dog}', '{paid,food_provided}', 250, false),
 ('cccccccc-0000-0000-0000-000000000003', current_date+5, current_date+8,  '{cat}',     '{paid}', 330, true),
 ('dddddddd-0000-0000-0000-000000000004', current_date+2, current_date+12, '{dog}',     '{volunteer,swap}', null, false),
 ('aaaaaaaa-0000-0000-0000-000000000001', current_date+1, current_date+30, '{cat}',     '{swap}', null, false);
\echo '--- owner A searches cats, 3..10 days out, budget 200-300, wants food'
set role authenticated; set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select first_name, covers_dates, in_budget, price_per_night, match_score, match_label, distance_km
  from public.search_stays(current_date+3, current_date+10, 'cat', 200, 300, '{food_provided}', false, 28.495, 34.513, 25);
\echo '--- free only (volunteer/swap) for dogs'
select first_name, offers, match_label from public.search_stays(current_date+3, current_date+10, 'dog', 0, null, '{}', true);
\echo '--- random browse'
select count(*) as random_rows from public.browse_random(null, 30);
reset role;
\echo '--- anon cannot search (expect ERROR)'
set role anon;
select * from public.search_stays(current_date+3, current_date+10, 'cat');
reset role;
insert into auth.users (id, phone, phone_confirmed_at) values ('eeeeeeee-0000-0000-0000-000000000005','+201000000005',now());
update public.profiles set first_name='eeeeeeee', status='active' where id='eeeeeeee-0000-0000-0000-000000000005';
insert into public.availability (user_id, starts_on, ends_on, pets_accepted, offers, price_per_night, negotiable) values
 ('eeeeeeee-0000-0000-0000-000000000005', current_date+6, current_date+15, '{cat}', '{paid,food_provided}', 340, true),
 ('eeeeeeee-0000-0000-0000-000000000005', current_date+40, current_date+45, '{cat}', '{paid}', 100, false);
set role authenticated; set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select first_name, starts_on - current_date as from_day, covers_dates, in_budget, price_per_night, match_score, match_label
  from public.search_stays(current_date+3, current_date+10, 'cat', 200, 300, '{food_provided}');

-- ================= fixes from the first Claude Code review =================
reset role;
\echo '--- T21 public point uses a secret random offset, kept when the pin moves'
insert into auth.users (id, phone, phone_confirmed_at) values ('ffffffff-0000-0000-0000-000000000006','+201000000006',now());
update public.profiles set first_name='ffffffff', status='active' where id='ffffffff-0000-0000-0000-000000000006';
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
insert into auth.users (id, phone, phone_confirmed_at) values ('99999999-0000-0000-0000-000000000009','+201000000009',now());
insert into storage.objects (bucket_id, name) values ('faces', '99999999-0000-0000-0000-000000000009/selfie.jpg');
set role authenticated; set request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
select count(*) as pending_face_visible_to_others from storage.objects where bucket_id='faces';
set request.jwt.claim.sub = '99999999-0000-0000-0000-000000000009';
select count(*) as own_face_visible_to_self from storage.objects where bucket_id='faces';
reset role;
update public.profiles set status='active' where id='99999999-0000-0000-0000-000000000009';
set role authenticated; set request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
select count(*) as approved_face_visible_to_others from storage.objects where bucket_id='faces';
reset role;

\echo '--- T23 cancelling a confirmed booking unlocks the pet'
set role authenticated; set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
insert into public.pets (id, owner_id, name, type, size, photo_paths) values ('22222222-0000-0000-0000-000000000002', auth.uid(), 'Pepper','dog','small', array['aaaaaaaa-0000-0000-0000-000000000001/2.jpg']);
select public.request_booking('bbbbbbbb-0000-0000-0000-000000000002','22222222-0000-0000-0000-000000000002', current_date+1, current_date+2, 'sitter_home','paid', 200, false) as b2 \gset
select public.accept_terms(:'b2');
set request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
select public.accept_terms(:'b2');
reset role;
set role service_role; select public.confirm_booking_payment(:'b2'); reset role;
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
