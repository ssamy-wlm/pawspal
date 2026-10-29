-- Phase 5 assertions (chat, bookings, swaps, search chips, clean-up list). Run AFTER the other assertion files on the same
-- database, with ON_ERROR_STOP=1. Any failed assertion stops the run with "ASSERT FAILED".
\set ON_ERROR_STOP 1
\i supabase/tests/helpers.sql

insert into auth.users (id, phone, phone_confirmed_at) values
  ('d1d1d1d1-0000-0000-0000-000000000001', '201277500001', now()),   -- Ana: owns pets and hosts (role both)
  ('d2d2d2d2-0000-0000-0000-000000000002', '201277500002', now()),   -- Bea: owns pets and hosts (role both)
  ('d3d3d3d3-0000-0000-0000-000000000003', '201277500003', now()),   -- Cai: only owns pets
  ('d4d4d4d4-0000-0000-0000-000000000004', '201277500004', now()),   -- Dee: only hosts
  ('d5d5d5d5-0000-0000-0000-000000000005', '201277500005', now());   -- Eli: still waiting for review
update public.profiles set first_name = 'Ana', role = 'both', status = 'active', face_verified = true, id_verified = true, is_adult = true, home_tags = array['garden'] where id = 'd1d1d1d1-0000-0000-0000-000000000001';
update public.profiles set first_name = 'Bea', role = 'both', status = 'active', face_verified = true, id_verified = true, is_adult = true where id = 'd2d2d2d2-0000-0000-0000-000000000002';
update public.profiles set first_name = 'Cai', role = 'owner', status = 'active', face_verified = true, id_verified = true, is_adult = true where id = 'd3d3d3d3-0000-0000-0000-000000000003';
update public.profiles set first_name = 'Dee', role = 'sitter', status = 'active', face_verified = true, id_verified = true, is_adult = true where id = 'd4d4d4d4-0000-0000-0000-000000000004';
update public.profiles set first_name = 'Eli', role = 'both' where id = 'd5d5d5d5-0000-0000-0000-000000000005';
insert into storage.objects (bucket_id, name) values
  ('pets', 'd1d1d1d1-0000-0000-0000-000000000001/a.jpg'), ('pets', 'd2d2d2d2-0000-0000-0000-000000000002/b.jpg'), ('pets', 'd3d3d3d3-0000-0000-0000-000000000003/c.jpg');
insert into public.pets (id, owner_id, name, type, size, photo_paths) values
  ('d1d1d1d1-1111-0000-0000-000000000001', 'd1d1d1d1-0000-0000-0000-000000000001', 'Anapet', 'dog', 'small', array['d1d1d1d1-0000-0000-0000-000000000001/a.jpg']),
  ('d2d2d2d2-1111-0000-0000-000000000002', 'd2d2d2d2-0000-0000-0000-000000000002', 'Beapet', 'cat', 'small', array['d2d2d2d2-0000-0000-0000-000000000002/b.jpg']),
  ('d3d3d3d3-1111-0000-0000-000000000003', 'd3d3d3d3-0000-0000-0000-000000000003', 'Caipet', 'dog', 'large', array['d3d3d3d3-0000-0000-0000-000000000003/c.jpg']);

\echo '--- B1 booking requests'
create temp table t_ids (k text primary key, v text);
insert into t_ids select 'b1', pg_temp.as_role('authenticated', 'd3d3d3d3-0000-0000-0000-000000000003', $$select public.request_booking('d4d4d4d4-0000-0000-0000-000000000004', 'd3d3d3d3-1111-0000-0000-000000000003', current_date + 10, current_date + 14, 'sitter_home', 'paid', 250, true)$$);
select pg_temp.check((select status = 'requested' and price_per_night = 250 and owner_id = 'd3d3d3d3-0000-0000-0000-000000000003' from public.bookings where id = (select v::uuid from t_ids where k = 'b1')), 'the request was not saved as requested');
select pg_temp.fails_as('authenticated', 'd3d3d3d3-0000-0000-0000-000000000003', $$select public.request_booking('d4d4d4d4-0000-0000-0000-000000000004', 'd3d3d3d3-1111-0000-0000-000000000003', current_date + 12, current_date + 16, 'sitter_home', 'volunteer', null, false)$$, 'an overlapping duplicate request was accepted');
select pg_temp.fails_as('authenticated', 'd3d3d3d3-0000-0000-0000-000000000003', $$select public.request_booking('d3d3d3d3-0000-0000-0000-000000000003', 'd3d3d3d3-1111-0000-0000-000000000003', current_date + 30, current_date + 32, 'sitter_home', 'volunteer', null, false)$$, 'a booking with yourself');
select pg_temp.fails_as('authenticated', 'd4d4d4d4-0000-0000-0000-000000000004', $$select public.request_booking('d1d1d1d1-0000-0000-0000-000000000001', 'd3d3d3d3-1111-0000-0000-000000000003', current_date + 30, current_date + 32, 'sitter_home', 'volunteer', null, false)$$, 'a host-only account requested a stay');
select pg_temp.fails_as('authenticated', 'd1d1d1d1-0000-0000-0000-000000000001', $$select public.request_booking('d3d3d3d3-0000-0000-0000-000000000003', 'd1d1d1d1-1111-0000-0000-000000000001', current_date + 30, current_date + 32, 'sitter_home', 'volunteer', null, false)$$, 'someone asked an owner-only account to host');
select pg_temp.fails_as('authenticated', 'd1d1d1d1-0000-0000-0000-000000000001', $$select public.request_booking('d2d2d2d2-0000-0000-0000-000000000002', 'd3d3d3d3-1111-0000-0000-000000000003', current_date + 30, current_date + 32, 'sitter_home', 'volunteer', null, false)$$, 'a booking with someone else pet');
select pg_temp.fails_as('authenticated', 'd1d1d1d1-0000-0000-0000-000000000001', $$select public.request_booking('d2d2d2d2-0000-0000-0000-000000000002', 'd1d1d1d1-1111-0000-0000-000000000001', current_date + 30, current_date + 32, 'sitter_home', 'swap', null, false)$$, 'a swap was made through request_booking');
select pg_temp.fails_as('authenticated', 'd1d1d1d1-0000-0000-0000-000000000001', $$select public.request_booking('d2d2d2d2-0000-0000-0000-000000000002', 'd1d1d1d1-1111-0000-0000-000000000001', current_date - 1, current_date + 2, 'sitter_home', 'volunteer', null, false)$$, 'a booking that starts in the past');
select pg_temp.fails_as('authenticated', 'd1d1d1d1-0000-0000-0000-000000000001', $$select public.request_booking('d2d2d2d2-0000-0000-0000-000000000002', 'd1d1d1d1-1111-0000-0000-000000000001', current_date + 30, current_date + 32, 'sitter_home', 'paid', null, false)$$, 'a paid booking without a price');
select pg_temp.fails_as('authenticated', 'd5d5d5d5-0000-0000-0000-000000000005', $$select public.request_booking('d2d2d2d2-0000-0000-0000-000000000002', 'd1d1d1d1-1111-0000-0000-000000000001', current_date + 30, current_date + 32, 'sitter_home', 'volunteer', null, false)$$, 'someone waiting for review requested a stay');
select pg_temp.fails_as('anon', null, $$select public.request_booking('d2d2d2d2-0000-0000-0000-000000000002', 'd1d1d1d1-1111-0000-0000-000000000001', current_date + 30, current_date + 32, 'sitter_home', 'volunteer', null, false)$$, 'anon requested a stay');

\echo '--- B2 terms: any change clears both acceptances'
select pg_temp.as_role('authenticated', 'd3d3d3d3-0000-0000-0000-000000000003', format($$select public.accept_terms(%L, (select terms_version from public.bookings where id = %L))$$, (select v from t_ids where k = 'b1'), (select v from t_ids where k = 'b1')));
select pg_temp.check((select owner_accepted_at is not null and sitter_accepted_at is null and status = 'requested' from public.bookings where id = (select v::uuid from t_ids where k = 'b1')), 'one acceptance should leave it requested');
select pg_temp.check(pg_temp.as_role('authenticated', 'd4d4d4d4-0000-0000-0000-000000000004', format($$select public.accept_terms(%L, (select terms_version from public.bookings where id = %L))$$, (select v from t_ids where k = 'b1'), (select v from t_ids where k = 'b1'))) = 'terms_agreed', 'two acceptances did not agree the terms');
select pg_temp.as_role('authenticated', 'd4d4d4d4-0000-0000-0000-000000000004', format($$select public.propose_terms(%L, current_date + 10, current_date + 15, 'sitter_home', 'paid', 300, true)$$, (select v from t_ids where k = 'b1')));
select pg_temp.check((select owner_accepted_at is null and sitter_accepted_at is null and status = 'requested' and price_per_night = 300 from public.bookings where id = (select v::uuid from t_ids where k = 'b1')), 'changing the terms did not clear both acceptances');
select pg_temp.fails_as('authenticated', 'd1d1d1d1-0000-0000-0000-000000000001', format($$select public.accept_terms(%L, (select terms_version from public.bookings where id = %L))$$, (select v from t_ids where k = 'b1'), (select v from t_ids where k = 'b1')), 'a stranger accepted terms');
select pg_temp.fails_as('authenticated', 'd1d1d1d1-0000-0000-0000-000000000001', format($$select public.propose_terms(%L, current_date + 10, current_date + 15, 'sitter_home', 'volunteer', null, true)$$, (select v from t_ids where k = 'b1')), 'a stranger changed terms');
select pg_temp.fails_as('authenticated', 'd3d3d3d3-0000-0000-0000-000000000003', format($$select public.propose_terms(%L, current_date + 10, current_date + 15, 'sitter_home', 'swap', null, true)$$, (select v from t_ids where k = 'b1')), 'a paid booking became a swap');
select pg_temp.check(pg_temp.count_as('d1d1d1d1-0000-0000-0000-000000000001', $$select count(*) from public.bookings where owner_id = 'd3d3d3d3-0000-0000-0000-000000000003'$$) = 0, 'a stranger read someone else booking');
select pg_temp.fails_as('anon', null, format($$select public.accept_terms(%L, (select terms_version from public.bookings where id = %L))$$, (select v from t_ids where k = 'b1'), (select v from t_ids where k = 'b1')), 'anon accepted terms');
select pg_temp.fails_as('authenticated', 'd3d3d3d3-0000-0000-0000-000000000003', $$select public.confirm_booking_payment(gen_random_uuid())$$, 'a user confirmed a payment');
select pg_temp.as_role('authenticated', 'd3d3d3d3-0000-0000-0000-000000000003', format($$select public.cancel_booking(%L, 'plans changed')$$, (select v from t_ids where k = 'b1')));
select pg_temp.check((select status = 'cancelled' from public.bookings where id = (select v::uuid from t_ids where k = 'b1')), 'cancel did nothing');

\echo '--- B3 swaps are two linked bookings'
insert into t_ids select 'sw', pg_temp.as_role('authenticated', 'd1d1d1d1-0000-0000-0000-000000000001', $$select public.request_swap('d2d2d2d2-0000-0000-0000-000000000002', 'd1d1d1d1-1111-0000-0000-000000000001', 'd2d2d2d2-1111-0000-0000-000000000002', current_date + 20, current_date + 24, current_date + 40, current_date + 44, true)$$);
select pg_temp.check((select count(*) = 2 and count(distinct swap_group) = 1 and bool_and(cost_type = 'swap') from public.bookings where swap_group = (select v::uuid from t_ids where k = 'sw')), 'a swap is not two linked bookings');
select pg_temp.check((select count(*) = 1 from public.bookings where swap_group = (select v::uuid from t_ids where k = 'sw') and owner_id = 'd1d1d1d1-0000-0000-0000-000000000001' and sitter_id = 'd2d2d2d2-0000-0000-0000-000000000002' and pet_id = 'd1d1d1d1-1111-0000-0000-000000000001'), 'leg one is wrong');
select pg_temp.check((select count(*) = 1 from public.bookings where swap_group = (select v::uuid from t_ids where k = 'sw') and owner_id = 'd2d2d2d2-0000-0000-0000-000000000002' and sitter_id = 'd1d1d1d1-0000-0000-0000-000000000001' and pet_id = 'd2d2d2d2-1111-0000-0000-000000000002'), 'leg two is wrong');
select pg_temp.fails_as('authenticated', 'd1d1d1d1-0000-0000-0000-000000000001', $$select public.request_swap('d3d3d3d3-0000-0000-0000-000000000003', 'd1d1d1d1-1111-0000-0000-000000000001', 'd3d3d3d3-1111-0000-0000-000000000003', current_date + 20, current_date + 24, current_date + 40, current_date + 44, true)$$, 'a swap with an owner-only account');
select pg_temp.fails_as('authenticated', 'd1d1d1d1-0000-0000-0000-000000000001', $$select public.request_swap('d2d2d2d2-0000-0000-0000-000000000002', 'd2d2d2d2-1111-0000-0000-000000000002', 'd1d1d1d1-1111-0000-0000-000000000001', current_date + 20, current_date + 24, current_date + 40, current_date + 44, true)$$, 'a swap with the pets the wrong way round');
select pg_temp.as_role('authenticated', 'd1d1d1d1-0000-0000-0000-000000000001', format($$select public.accept_terms((select id from public.bookings where swap_group = %L and owner_id = 'd1d1d1d1-0000-0000-0000-000000000001'), (select terms_version from public.bookings where swap_group = %L limit 1))$$, (select v from t_ids where k = 'sw'), (select v from t_ids where k = 'sw')));
select pg_temp.check((select count(*) = 2 and bool_and(status = 'requested') from public.bookings where swap_group = (select v::uuid from t_ids where k = 'sw')), 'one person accepting should leave both legs requested');
select pg_temp.check((select count(*) filter (where owner_accepted_at is not null or sitter_accepted_at is not null) = 2 from public.bookings where swap_group = (select v::uuid from t_ids where k = 'sw')), 'accepting did not count on both legs');
select pg_temp.as_role('authenticated', 'd2d2d2d2-0000-0000-0000-000000000002', format($$select public.accept_terms((select id from public.bookings where swap_group = %L and owner_id = 'd2d2d2d2-0000-0000-0000-000000000002'), (select terms_version from public.bookings where swap_group = %L limit 1))$$, (select v from t_ids where k = 'sw'), (select v from t_ids where k = 'sw')));
select pg_temp.check((select count(*) = 2 and bool_and(status = 'terms_agreed') from public.bookings where swap_group = (select v::uuid from t_ids where k = 'sw')), 'both people accepting should agree both legs');
select pg_temp.as_role('authenticated', 'd2d2d2d2-0000-0000-0000-000000000002', format($$select public.propose_terms((select id from public.bookings where swap_group = %L and owner_id = 'd2d2d2d2-0000-0000-0000-000000000002'), current_date + 41, current_date + 45, 'sitter_home', 'swap', null, false)$$, (select v from t_ids where k = 'sw')));
select pg_temp.check((select count(*) = 2 and bool_and(status = 'requested' and owner_accepted_at is null and sitter_accepted_at is null) from public.bookings where swap_group = (select v::uuid from t_ids where k = 'sw')), 'changing one leg did not clear acceptance on both legs');
select pg_temp.fails_as('authenticated', 'd2d2d2d2-0000-0000-0000-000000000002', format($$select public.propose_terms((select id from public.bookings where swap_group = %L limit 1), current_date + 41, current_date + 45, 'sitter_home', 'paid', 100, false)$$, (select v from t_ids where k = 'sw')), 'a swap turned into a paid booking');
select pg_temp.as_role('authenticated', 'd1d1d1d1-0000-0000-0000-000000000001', format($$select public.accept_terms((select id from public.bookings where swap_group = %L and owner_id = 'd1d1d1d1-0000-0000-0000-000000000001'), (select terms_version from public.bookings where swap_group = %L limit 1))$$, (select v from t_ids where k = 'sw'), (select v from t_ids where k = 'sw')));
select pg_temp.as_role('authenticated', 'd2d2d2d2-0000-0000-0000-000000000002', format($$select public.accept_terms((select id from public.bookings where swap_group = %L and owner_id = 'd2d2d2d2-0000-0000-0000-000000000002'), (select terms_version from public.bookings where swap_group = %L limit 1))$$, (select v from t_ids where k = 'sw'), (select v from t_ids where k = 'sw')));
select public.confirm_booking_payment((select id from public.bookings where swap_group = (select v::uuid from t_ids where k = 'sw') limit 1));
select pg_temp.check((select count(*) = 2 and bool_and(status = 'confirmed' and fee_status = 'paid') from public.bookings where swap_group = (select v::uuid from t_ids where k = 'sw')), 'a paid swap was not confirmed as one');
select pg_temp.check((select bool_and(locked) from public.pets where id in ('d1d1d1d1-1111-0000-0000-000000000001', 'd2d2d2d2-1111-0000-0000-000000000002')), 'a confirmed swap did not lock both pets');
select pg_temp.as_role('authenticated', 'd1d1d1d1-0000-0000-0000-000000000001', format($$select public.cancel_booking((select id from public.bookings where swap_group = %L limit 1), 'cannot make it')$$, (select v from t_ids where k = 'sw')));
select pg_temp.check((select count(*) = 2 and bool_and(status = 'cancelled') from public.bookings where swap_group = (select v::uuid from t_ids where k = 'sw')), 'cancelling a swap did not cancel both legs');
select pg_temp.check((select not bool_or(locked) from public.pets where id in ('d1d1d1d1-1111-0000-0000-000000000001', 'd2d2d2d2-1111-0000-0000-000000000002')), 'cancelling a swap did not unlock both pets');

\echo '--- C1 chat: contact details are hidden until a paid booking'
insert into t_ids select 'cv', pg_temp.as_role('authenticated', 'd1d1d1d1-0000-0000-0000-000000000001', $$select public.start_conversation('d2d2d2d2-0000-0000-0000-000000000002')$$);
select pg_temp.check((select v = pg_temp.as_role('authenticated', 'd2d2d2d2-0000-0000-0000-000000000002', $$select public.start_conversation('d1d1d1d1-0000-0000-0000-000000000001')$$) from t_ids where k = 'cv'), 'the same two people got two conversations');
select pg_temp.as_role('authenticated', 'd1d1d1d1-0000-0000-0000-000000000001', format($$insert into public.messages (conversation_id, sender_id, body) values (%L, 'd1d1d1d1-0000-0000-0000-000000000001', 'Call me 0101 234 5678 or 010/1234/5678 or ٠١٠١٢٣٤٥٦٧٨ or mona@mail.com or on whatsapp or instagram')$$, (select v from t_ids where k = 'cv')));
select pg_temp.check((select masked and body !~ '[0-9٠-٩]{4}' and body !~* 'mail|whatsapp|instagram' from public.messages order by id desc limit 1), 'a phone number, email or app name got through before a paid booking');
select pg_temp.as_role('authenticated', 'd1d1d1d1-0000-0000-0000-000000000001', format($$insert into public.messages (conversation_id, sender_id, body) values (%L, 'd1d1d1d1-0000-0000-0000-000000000001', 'Can you do 12/12 to 20/12 for 250 EGP per night? Dec 1 to Dec 9 works too')$$, (select v from t_ids where k = 'cv')));
select pg_temp.check((select not masked and body like '%250 EGP%' and body like '%12/12 to 20/12%' from public.messages order by id desc limit 1), 'dates and prices were masked');
select pg_temp.fails_as('authenticated', 'd1d1d1d1-0000-0000-0000-000000000001', format($$insert into public.messages (conversation_id, sender_id, body) values (%L, 'd1d1d1d1-0000-0000-0000-000000000001', '   ')$$, (select v from t_ids where k = 'cv')), 'an empty message was sent');
select pg_temp.fails_as('authenticated', 'd1d1d1d1-0000-0000-0000-000000000001', format($$insert into public.messages (conversation_id, sender_id, body, masked) values (%L, 'd2d2d2d2-0000-0000-0000-000000000002', 'hi')$$, (select v from t_ids where k = 'cv')), 'someone sent as another person');
select pg_temp.fails_as('authenticated', 'd3d3d3d3-0000-0000-0000-000000000003', format($$insert into public.messages (conversation_id, sender_id, body) values (%L, 'd3d3d3d3-0000-0000-0000-000000000003', 'hello')$$, (select v from t_ids where k = 'cv')), 'a stranger sent into a conversation');
select pg_temp.check(pg_temp.count_as('d3d3d3d3-0000-0000-0000-000000000003', format($$select count(*) from public.messages where conversation_id = %L$$, (select v from t_ids where k = 'cv'))) = 0, 'a stranger read a conversation');
select pg_temp.fails_as('authenticated', 'd1d1d1d1-0000-0000-0000-000000000001', format($$update public.messages set body = 'x' where conversation_id = %L$$, (select v from t_ids where k = 'cv')), 'a message was edited');
select pg_temp.fails_as('authenticated', 'd3d3d3d3-0000-0000-0000-000000000003', $$select public.start_conversation('d5d5d5d5-0000-0000-0000-000000000005')$$, 'a chat with someone not active');
select pg_temp.fails_as('anon', null, $$select * from public.my_conversations()$$, 'anon listed conversations');

\echo '--- C2 a paid booking unlocks contact details'
insert into public.bookings (owner_id, sitter_id, pet_id, starts_on, ends_on, status, fee_status)
  values ('d1d1d1d1-0000-0000-0000-000000000001', 'd2d2d2d2-0000-0000-0000-000000000002', 'd1d1d1d1-1111-0000-0000-000000000001', current_date + 60, current_date + 62, 'confirmed', 'paid');
select pg_temp.as_role('authenticated', 'd1d1d1d1-0000-0000-0000-000000000001', format($$insert into public.messages (conversation_id, sender_id, body) values (%L, 'd1d1d1d1-0000-0000-0000-000000000001', 'My number is 0101 234 5678')$$, (select v from t_ids where k = 'cv')));
select pg_temp.check((select not masked and body like '%0101 234 5678%' from public.messages order by id desc limit 1), 'a paid booking did not unlock the number');

\echo '--- C3 message rate limit'
do $$ begin
  for i in 1..20 loop
    insert into public.messages (conversation_id, sender_id, body) select (select v::uuid from t_ids where k = 'cv'), 'd2d2d2d2-0000-0000-0000-000000000002', 'm' || i;
  end loop;
end $$;
select pg_temp.fails_as('authenticated', 'd2d2d2d2-0000-0000-0000-000000000002', format($$insert into public.messages (conversation_id, sender_id, body) values (%L, 'd2d2d2d2-0000-0000-0000-000000000002', 'one too many')$$, (select v from t_ids where k = 'cv')), 'the 21st message in a minute was accepted');

\echo '--- C4 the conversation list and unread counts'
select pg_temp.check(pg_temp.count_as('d1d1d1d1-0000-0000-0000-000000000001', $$select count(*) from public.my_conversations() where first_name = 'Bea' and unread = 20$$) = 1, 'unread is not 20 for Ana');
select pg_temp.as_role('authenticated', 'd1d1d1d1-0000-0000-0000-000000000001', format($$select public.mark_conversation_read(%L)$$, (select v from t_ids where k = 'cv')));
select pg_temp.check(pg_temp.count_as('d1d1d1d1-0000-0000-0000-000000000001', $$select count(*) from public.my_conversations() where first_name = 'Bea' and unread = 0$$) = 1, 'marking as read did not clear unread');
select pg_temp.check(pg_temp.count_as('d2d2d2d2-0000-0000-0000-000000000002', $$select count(*) from public.my_conversations() where first_name = 'Ana' and unread = 3$$) = 1, 'unread is not 3 for Bea');
select pg_temp.fails_as('authenticated', 'd3d3d3d3-0000-0000-0000-000000000003', format($$select public.mark_conversation_read(%L)$$, (select v from t_ids where k = 'cv')), 'a stranger marked a conversation read');
select pg_temp.check(pg_temp.count_as('d3d3d3d3-0000-0000-0000-000000000003', $$select count(*) from public.my_conversations()$$) = 0, 'a stranger saw a conversation in their list');
select pg_temp.check(pg_temp.count_as('d1d1d1d1-0000-0000-0000-000000000001', $$select count(*) from public.conversation_reads where user_id <> 'd1d1d1d1-0000-0000-0000-000000000001'$$) = 0, 'someone read other read marks');
insert into public.blocks (blocker_id, blocked_id) values ('d2d2d2d2-0000-0000-0000-000000000002', 'd1d1d1d1-0000-0000-0000-000000000001');
select pg_temp.check(pg_temp.count_as('d1d1d1d1-0000-0000-0000-000000000001', $$select count(*) from public.my_conversations()$$) = 0, 'a conversation with someone who blocked you stayed in the list');
select pg_temp.fails_as('authenticated', 'd1d1d1d1-0000-0000-0000-000000000001', format($$insert into public.messages (conversation_id, sender_id, body) values (%L, 'd1d1d1d1-0000-0000-0000-000000000001', 'hello?')$$, (select v from t_ids where k = 'cv')), 'a blocked person kept messaging');
delete from public.blocks where blocker_id = 'd2d2d2d2-0000-0000-0000-000000000002';

\echo '--- S1 search results carry home tags and a resident pet'
insert into public.availability (user_id, starts_on, ends_on, pets_accepted, offers, price_per_night) values
  ('d1d1d1d1-0000-0000-0000-000000000001', current_date + 3, current_date + 9, array['dog']::public.pet_type[], array['paid'], 200);
select pg_temp.check(pg_temp.count_as('d2d2d2d2-0000-0000-0000-000000000002', $$select count(*) from public.search_stays(current_date + 4, current_date + 6, 'dog') where first_name = 'Ana' and pet_name = 'Anapet' and home_tags = array['garden']$$) = 1, 'search did not return the tags and the pet name');
select pg_temp.check(pg_temp.count_as('d2d2d2d2-0000-0000-0000-000000000002', $$select count(*) from public.browse_random('dog') where first_name = 'Ana' and pet_name = 'Anapet' and home_tags = array['garden']$$) = 1, 'browse did not return the tags and the pet name');
select pg_temp.fails_as('anon', null, $$select * from public.search_stays(current_date + 4, current_date + 6, 'dog')$$, 'anon searched');

\echo '--- U1 the clean-up list of unused photo files'
insert into storage.objects (bucket_id, name, created_at) values
  ('incoming', 'x/old-raw.jpg', now() - interval '3 hours'), ('incoming', 'x/new-raw.jpg', now() - interval '5 minutes'),
  ('pets', 'x/old-unused.jpg', now() - interval '3 days'), ('pets', 'x/new-unused.jpg', now() - interval '1 hour'),
  ('homes', 'x/old-home.jpg', now() - interval '3 days'), ('faces', 'x/old-face.jpg', now() - interval '10 days'), ('faces', 'x/waiting-face.jpg', now() - interval '3 days');
update storage.objects set created_at = now() - interval '3 days' where name = 'd1d1d1d1-0000-0000-0000-000000000001/a.jpg';   -- in use by a pet
select pg_temp.check((select array_agg(name order by name) from public.list_unused_uploads() where name like 'x/%') = array['x/old-face.jpg', 'x/old-home.jpg', 'x/old-raw.jpg', 'x/old-unused.jpg'], 'the unused-file list is wrong');
select pg_temp.check(not exists (select 1 from public.list_unused_uploads() where name = 'd1d1d1d1-0000-0000-0000-000000000001/a.jpg'), 'a photo a pet uses was listed as unused');
select pg_temp.fails_as('authenticated', 'd1d1d1d1-0000-0000-0000-000000000001', $$select * from public.list_unused_uploads()$$, 'a user listed unused uploads');
select pg_temp.fails_as('anon', null, $$select * from public.list_unused_uploads()$$, 'anon listed unused uploads');

\echo '--- R1 review fixes: the server decides when a message was sent'
select pg_temp.as_role('authenticated', 'd1d1d1d1-0000-0000-0000-000000000001', format($$insert into public.messages (conversation_id, sender_id, body, created_at) values (%L, 'd1d1d1d1-0000-0000-0000-000000000001', 'back-dated', '2000-01-01')$$, (select v from t_ids where k = 'cv')));
select pg_temp.check((select created_at > now() - interval '1 minute' from public.messages where body = 'back-dated'), 'a back-dated message kept its fake time');
do $$ declare n int := 0; begin
  begin
    for i in 1..30 loop
      insert into public.messages (conversation_id, sender_id, body, created_at) values ((select v::uuid from t_ids where k = 'cv'), 'd1d1d1d1-0000-0000-0000-000000000001', 'again ' || i, '2000-01-01');
      n := n + 1;
    end loop;
  exception when others then null; end;
  if n >= 30 then raise exception 'ASSERT FAILED: back-dated messages escaped the rate limit'; end if;
end $$;

\echo '--- R2 masking hides phone numbers but not dates, prices and lists'
select pg_temp.check(public.mask_contact_text('10/11/2026 12/11/2026') = '10/11/2026 12/11/2026', 'a date range was masked');
select pg_temp.check(public.mask_contact_text('2026-11-10 2026-11-12') = '2026-11-10 2026-11-12', 'an ISO date range was masked');
select pg_temp.check(public.mask_contact_text('10,11,12,13,14') = '10,11,12,13,14', 'a list of days was masked');
select pg_temp.check(public.mask_contact_text('300 350 400 or 1500 2000 2500 EGP') = '300 350 400 or 1500 2000 2500 EGP', 'prices were masked');
select pg_temp.check(public.mask_contact_text('٣ ليالي من ١٠/١١') = '٣ ليالي من ١٠/١١', 'a message with harmless Arabic digits was changed');
select pg_temp.check(public.mask_contact_text('0101 234 5678') = '•••' and public.mask_contact_text('+44 7911 123456') = '•••' and public.mask_contact_text('0693 640 123') = '•••', 'a phone number got through');
select pg_temp.check(public.mask_contact_text('call 0101 234 5678 12/12') !~ '[0-9]{4}', 'a phone number next to a date got through');
select pg_temp.check(public.mask_contact_text('+20 100 123 4567') = '•••' and public.mask_contact_text('201012345678') = '•••', 'a +20 number got through');
select pg_temp.as_role('authenticated', 'd1d1d1d1-0000-0000-0000-000000000001', format($$insert into public.messages (conversation_id, sender_id, body) values (%L, 'd1d1d1d1-0000-0000-0000-000000000001', '٣ ليالي')$$, (select v from t_ids where k = 'cv')));
select pg_temp.check((select not masked and body = '٣ ليالي' from public.messages where body = '٣ ليالي'), 'an innocent Arabic message was marked as masked');

\echo '--- R3 terms: acceptance names the version it saw'
insert into t_ids select 'b2', pg_temp.as_role('authenticated', 'd3d3d3d3-0000-0000-0000-000000000003', $$select public.request_booking('d4d4d4d4-0000-0000-0000-000000000004', 'd3d3d3d3-1111-0000-0000-000000000003', current_date + 70, current_date + 72, 'sitter_home', 'paid', 100, false)$$);
select pg_temp.as_role('authenticated', 'd4d4d4d4-0000-0000-0000-000000000004', format($$select public.propose_terms(%L, current_date + 70, current_date + 72, 'sitter_home', 'paid', 500, false)$$, (select v from t_ids where k = 'b2')));
select pg_temp.fails_as('authenticated', 'd3d3d3d3-0000-0000-0000-000000000003', format($$select public.accept_terms(%L, 1)$$, (select v from t_ids where k = 'b2')), 'terms were accepted by version while a newer version existed');
select pg_temp.check((select terms_version = 2 and owner_accepted_at is null from public.bookings where id = (select v::uuid from t_ids where k = 'b2')), 'the version did not go up or acceptance was not cleared');
select pg_temp.as_role('authenticated', 'd3d3d3d3-0000-0000-0000-000000000003', format($$select public.accept_terms(%L, 2)$$, (select v from t_ids where k = 'b2')));
select pg_temp.check((select owner_accepted_at is not null from public.bookings where id = (select v::uuid from t_ids where k = 'b2')), 'accepting the current version did not work');

\echo '--- R4 a blocked or suspended person cannot change or accept terms'
insert into public.blocks (blocker_id, blocked_id) values ('d4d4d4d4-0000-0000-0000-000000000004', 'd3d3d3d3-0000-0000-0000-000000000003');
select pg_temp.fails_as('authenticated', 'd3d3d3d3-0000-0000-0000-000000000003', format($$select public.propose_terms(%L, current_date + 70, current_date + 72, 'sitter_home', 'paid', 50, false)$$, (select v from t_ids where k = 'b2')), 'a blocked person changed terms');
select pg_temp.fails_as('authenticated', 'd4d4d4d4-0000-0000-0000-000000000004', format($$select public.accept_terms(%L, 2)$$, (select v from t_ids where k = 'b2')), 'a person accepted terms for someone they blocked');
delete from public.blocks where blocker_id = 'd4d4d4d4-0000-0000-0000-000000000004';

\echo '--- R5 a swap stays at each other home, and a pet cannot be booked twice'
insert into t_ids select 'sw2', pg_temp.as_role('authenticated', 'd1d1d1d1-0000-0000-0000-000000000001', $$select public.request_swap('d2d2d2d2-0000-0000-0000-000000000002', 'd1d1d1d1-1111-0000-0000-000000000001', 'd2d2d2d2-1111-0000-0000-000000000002', current_date + 80, current_date + 83, current_date + 90, current_date + 93, false)$$);
select pg_temp.fails_as('authenticated', 'd2d2d2d2-0000-0000-0000-000000000002', format($$select public.propose_terms((select id from public.bookings where swap_group = %L limit 1), current_date + 80, current_date + 83, 'owner_home', 'swap', null, false)$$, (select v from t_ids where k = 'sw2')), 'a swap leg was moved to the other home');
insert into public.bookings (owner_id, sitter_id, pet_id, starts_on, ends_on, status, fee_status)
  values ('d1d1d1d1-0000-0000-0000-000000000001', 'd4d4d4d4-0000-0000-0000-000000000004', 'd1d1d1d1-1111-0000-0000-000000000001', current_date + 81, current_date + 82, 'confirmed', 'paid');
select pg_temp.fails_as('authenticated', 'd1d1d1d1-0000-0000-0000-000000000001', $$select public.request_booking('d2d2d2d2-0000-0000-0000-000000000002', 'd1d1d1d1-1111-0000-0000-000000000001', current_date + 82, current_date + 85, 'sitter_home', 'volunteer', null, false)$$, 'a pet that is confirmed elsewhere was requested for the same dates');
select pg_temp.fails_as('authenticated', 'd2d2d2d2-0000-0000-0000-000000000002', format($$select public.propose_terms((select id from public.bookings where swap_group = %L and owner_id = 'd1d1d1d1-0000-0000-0000-000000000001'), current_date + 80, current_date + 83, 'sitter_home', 'swap', null, false)$$, (select v from t_ids where k = 'sw2')), 'terms were changed onto dates the pet is already booked');
select pg_temp.as_role('authenticated', 'd1d1d1d1-0000-0000-0000-000000000001', format($$select public.accept_terms((select id from public.bookings where swap_group = %L limit 1), (select terms_version from public.bookings where swap_group = %L limit 1))$$, (select v from t_ids where k = 'sw2'), (select v from t_ids where k = 'sw2')));
select pg_temp.as_role('authenticated', 'd2d2d2d2-0000-0000-0000-000000000002', format($$select public.accept_terms((select id from public.bookings where swap_group = %L limit 1), (select terms_version from public.bookings where swap_group = %L limit 1))$$, (select v from t_ids where k = 'sw2'), (select v from t_ids where k = 'sw2')));
select pg_temp.fails($$select public.confirm_booking_payment((select id from public.bookings where swap_group = (select v::uuid from t_ids where k = 'sw2') limit 1))$$, 'a payment confirmed a booking for a pet that is already booked');

\echo 'chat assertions OK'
