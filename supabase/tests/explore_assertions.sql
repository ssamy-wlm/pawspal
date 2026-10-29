-- Phase 4 assertions (Explore: shortlist, travel dates, tags). Run AFTER the other assertion files on the same database,
-- with ON_ERROR_STOP=1. Any failed assertion stops the run with "ASSERT FAILED".
\set ON_ERROR_STOP 1
\i supabase/tests/helpers.sql

insert into auth.users (id, phone, phone_confirmed_at) values
  ('c1c1c1c1-0000-0000-0000-000000000001', '201277100001', now()),   -- owner
  ('c2c2c2c2-0000-0000-0000-000000000002', '201277100002', now()),   -- host
  ('c3c3c3c3-0000-0000-0000-000000000003', '201277100003', now()),   -- host who gets blocked
  ('c4c4c4c4-0000-0000-0000-000000000004', '201277100004', now()),   -- still waiting for review
  ('c5c5c5c5-0000-0000-0000-000000000005', '201277100005', now());   -- another host
update public.profiles set first_name = 'Owen', role = 'owner', status = 'active', face_verified = true, id_verified = true, is_adult = true where id = 'c1c1c1c1-0000-0000-0000-000000000001';
update public.profiles set first_name = 'Hana', role = 'sitter', status = 'active', face_verified = true, id_verified = true, is_adult = true where id = 'c2c2c2c2-0000-0000-0000-000000000002';
update public.profiles set first_name = 'Bo', role = 'both', status = 'active', face_verified = true, id_verified = true, is_adult = true where id = 'c3c3c3c3-0000-0000-0000-000000000003';
update public.profiles set first_name = 'Pending', role = 'sitter' where id = 'c4c4c4c4-0000-0000-0000-000000000004';
update public.profiles set first_name = 'Sam', role = 'both', status = 'active', face_verified = true, id_verified = true, is_adult = true where id = 'c5c5c5c5-0000-0000-0000-000000000005';

\echo '--- E1 home tags'
select pg_temp.as_role('authenticated', 'c2c2c2c2-0000-0000-0000-000000000002', $$update public.profiles set home_tags = array['garden', 'pet_first_aid'] where id = 'c2c2c2c2-0000-0000-0000-000000000002'$$);
select pg_temp.check(pg_temp.count_as('c1c1c1c1-0000-0000-0000-000000000001', $$select count(*) from public.profile_cards where first_name = 'Hana' and home_tags = array['garden', 'pet_first_aid']$$) = 1, 'tags are not on the public card');
select pg_temp.fails_as('authenticated', 'c2c2c2c2-0000-0000-0000-000000000002', $$update public.profiles set home_tags = array['made_up'] where id = 'c2c2c2c2-0000-0000-0000-000000000002'$$, 'a made-up tag was accepted');
select pg_temp.fails_as('authenticated', 'c2c2c2c2-0000-0000-0000-000000000002', $$update public.profiles set home_tags = array['garden','fenced_yard','pet_first_aid','experienced','has_own_pets','quiet_home','near_beach','air_conditioning','works_from_home'] where id = 'c2c2c2c2-0000-0000-0000-000000000002'$$, 'nine tags were accepted');

\echo '--- E2 who may post which dates'
select pg_temp.fails_as('authenticated', 'c1c1c1c1-0000-0000-0000-000000000001', $$insert into public.availability (user_id, starts_on, ends_on, pets_accepted, offers) values ('c1c1c1c1-0000-0000-0000-000000000001', current_date + 3, current_date + 6, array['dog']::public.pet_type[], array['volunteer'])$$, 'an owner-only account posted availability');
select pg_temp.as_role('authenticated', 'c2c2c2c2-0000-0000-0000-000000000002', $$insert into public.availability (user_id, starts_on, ends_on, pets_accepted, offers, price_per_night) values ('c2c2c2c2-0000-0000-0000-000000000002', current_date + 3, current_date + 9, array['dog','cat']::public.pet_type[], array['paid'], 250)$$);
select pg_temp.check((select count(*) = 1 from public.availability where user_id = 'c2c2c2c2-0000-0000-0000-000000000002'), 'a host could not post availability');
select pg_temp.fails_as('authenticated', 'c2c2c2c2-0000-0000-0000-000000000002', $$insert into public.travel_posts (user_id, pet_type, starts_on, ends_on) values ('c2c2c2c2-0000-0000-0000-000000000002', 'dog', current_date + 3, current_date + 6)$$, 'a host-only account posted travel dates');
select pg_temp.fails_as('authenticated', 'c4c4c4c4-0000-0000-0000-000000000004', $$insert into public.availability (user_id, starts_on, ends_on, pets_accepted) values ('c4c4c4c4-0000-0000-0000-000000000004', current_date + 3, current_date + 6, array['dog']::public.pet_type[])$$, 'someone waiting for review posted availability');
do $$ begin
  for i in 1..9 loop
    insert into public.availability (user_id, starts_on, ends_on, pets_accepted) values ('c2c2c2c2-0000-0000-0000-000000000002', current_date + 20 + i, current_date + 21 + i, array['dog']::public.pet_type[]);
  end loop;
end $$;
select pg_temp.fails_as('authenticated', 'c2c2c2c2-0000-0000-0000-000000000002', $$insert into public.availability (user_id, starts_on, ends_on, pets_accepted) values ('c2c2c2c2-0000-0000-0000-000000000002', current_date + 50, current_date + 51, array['dog']::public.pet_type[])$$, 'an eleventh open post was accepted');

\echo '--- E3 travel posts'
select pg_temp.as_role('authenticated', 'c1c1c1c1-0000-0000-0000-000000000001', $$insert into public.travel_posts (user_id, pet_type, starts_on, ends_on, budget_per_night, note) values ('c1c1c1c1-0000-0000-0000-000000000001', 'dog', current_date + 5, current_date + 12, 200, 'Call 0101 234 5678 or find me on instagram')$$);
select pg_temp.check((select note !~ '[0-9]{4}' and note !~* 'instagram' from public.travel_posts where user_id = 'c1c1c1c1-0000-0000-0000-000000000001'), 'a travel note kept a phone number or app name');
select pg_temp.fails_as('authenticated', 'c1c1c1c1-0000-0000-0000-000000000001', $$insert into public.travel_posts (user_id, pet_type, starts_on, ends_on) values ('c1c1c1c1-0000-0000-0000-000000000001', 'cat', current_date - 2, current_date + 3)$$, 'a travel post in the past was accepted');
select pg_temp.fails_as('authenticated', 'c1c1c1c1-0000-0000-0000-000000000001', $$insert into public.travel_posts (user_id, pet_type, starts_on, ends_on) values ('c2c2c2c2-0000-0000-0000-000000000002', 'cat', current_date + 5, current_date + 8)$$, 'someone posted travel dates for another person');
select pg_temp.check(pg_temp.count_as('c2c2c2c2-0000-0000-0000-000000000002', $$select count(*) from public.browse_travellers()$$) = 1, 'a host cannot find an active owner travelling');
select pg_temp.check(pg_temp.count_as('c1c1c1c1-0000-0000-0000-000000000001', $$select count(*) from public.browse_travellers()$$) = 0, 'an owner saw their own post');
select pg_temp.check(pg_temp.count_as('c4c4c4c4-0000-0000-0000-000000000004', $$select count(*) from public.browse_travellers()$$) = 0, 'someone waiting for review saw travel posts');
select pg_temp.check(pg_temp.count_as('c4c4c4c4-0000-0000-0000-000000000004', $$select count(*) from public.travel_posts$$) = 0, 'someone waiting for review read travel posts directly');
select pg_temp.fails_as('anon', null, $$select * from public.browse_travellers()$$, 'anon browsed travellers');
insert into public.blocks (blocker_id, blocked_id) values ('c2c2c2c2-0000-0000-0000-000000000002', 'c1c1c1c1-0000-0000-0000-000000000001');
select pg_temp.check(pg_temp.count_as('c2c2c2c2-0000-0000-0000-000000000002', $$select count(*) from public.browse_travellers()$$) = 0, 'a blocked owner still showed up');
delete from public.blocks where blocker_id = 'c2c2c2c2-0000-0000-0000-000000000002';
do $$ begin
  for i in 1..4 loop
    insert into public.travel_posts (user_id, pet_type, starts_on, ends_on) values ('c1c1c1c1-0000-0000-0000-000000000001', 'cat', current_date + 20 + i, current_date + 21 + i);
  end loop;
end $$;
select pg_temp.fails_as('authenticated', 'c1c1c1c1-0000-0000-0000-000000000001', $$insert into public.travel_posts (user_id, pet_type, starts_on, ends_on) values ('c1c1c1c1-0000-0000-0000-000000000001', 'dog', current_date + 40, current_date + 41)$$, 'a sixth open travel post was accepted');

\echo '--- E4 shortlist'
select pg_temp.as_role('authenticated', 'c1c1c1c1-0000-0000-0000-000000000001', $$insert into public.shortlist (user_id, host_id) values ('c1c1c1c1-0000-0000-0000-000000000001', 'c2c2c2c2-0000-0000-0000-000000000002')$$);
select pg_temp.as_role('authenticated', 'c1c1c1c1-0000-0000-0000-000000000001', $$insert into public.shortlist (user_id, host_id) values ('c1c1c1c1-0000-0000-0000-000000000001', 'c3c3c3c3-0000-0000-0000-000000000003')$$);
select pg_temp.fails_as('authenticated', 'c1c1c1c1-0000-0000-0000-000000000001', $$insert into public.shortlist (user_id, host_id) values ('c1c1c1c1-0000-0000-0000-000000000001', 'c1c1c1c1-0000-0000-0000-000000000001')$$, 'saved yourself');
select pg_temp.fails_as('authenticated', 'c1c1c1c1-0000-0000-0000-000000000001', $$insert into public.shortlist (user_id, host_id) values ('c1c1c1c1-0000-0000-0000-000000000001', 'c4c4c4c4-0000-0000-0000-000000000004')$$, 'saved someone who is not active');
select pg_temp.fails_as('authenticated', 'c1c1c1c1-0000-0000-0000-000000000001', $$insert into public.shortlist (user_id, host_id) values ('c2c2c2c2-0000-0000-0000-000000000002', 'c5c5c5c5-0000-0000-0000-000000000005')$$, 'saved on behalf of someone else');
select pg_temp.fails_as('authenticated', 'c1c1c1c1-0000-0000-0000-000000000001', $$insert into public.shortlist (user_id, host_id) values ('c1c1c1c1-0000-0000-0000-000000000001', 'c2c2c2c2-0000-0000-0000-000000000002')$$, 'saved the same host twice');
select pg_temp.check(pg_temp.count_as('c1c1c1c1-0000-0000-0000-000000000001', $$select count(*) from public.my_shortlist()$$) = 2, 'the shortlist is not two hosts');
select pg_temp.check(pg_temp.count_as('c2c2c2c2-0000-0000-0000-000000000002', $$select count(*) from public.shortlist$$) = 0, 'a host saw who saved them');
select pg_temp.check(pg_temp.count_as('c5c5c5c5-0000-0000-0000-000000000005', $$select count(*) from public.my_shortlist()$$) = 0, 'someone saw another shortlist');
insert into public.blocks (blocker_id, blocked_id) values ('c3c3c3c3-0000-0000-0000-000000000003', 'c1c1c1c1-0000-0000-0000-000000000001');
select pg_temp.check(pg_temp.count_as('c1c1c1c1-0000-0000-0000-000000000001', $$select count(*) from public.my_shortlist()$$) = 1, 'a host who blocked you stayed on your shortlist');
delete from public.blocks where blocker_id = 'c3c3c3c3-0000-0000-0000-000000000003';
update public.profiles set status = 'suspended' where id = 'c2c2c2c2-0000-0000-0000-000000000002';
select pg_temp.check(pg_temp.count_as('c1c1c1c1-0000-0000-0000-000000000001', $$select count(*) from public.my_shortlist()$$) = 1, 'a suspended host stayed on your shortlist');
update public.profiles set status = 'active' where id = 'c2c2c2c2-0000-0000-0000-000000000002';
select pg_temp.as_role('authenticated', 'c1c1c1c1-0000-0000-0000-000000000001', $$delete from public.shortlist where host_id = 'c3c3c3c3-0000-0000-0000-000000000003'$$);
select pg_temp.check(pg_temp.count_as('c1c1c1c1-0000-0000-0000-000000000001', $$select count(*) from public.my_shortlist()$$) = 1, 'removing from the shortlist did nothing');
select pg_temp.fails_as('anon', null, $$select * from public.my_shortlist()$$, 'anon read a shortlist');
select pg_temp.fails_as('authenticated', 'c1c1c1c1-0000-0000-0000-000000000001', $$update public.shortlist set host_id = 'c5c5c5c5-0000-0000-0000-000000000005'$$, 'a shortlist row was changed');

\echo 'explore assertions OK'
