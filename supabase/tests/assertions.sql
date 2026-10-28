-- Hard assertions. Run AFTER security_test.sql on the same database, with ON_ERROR_STOP=1:
-- any failed assertion stops the run with "ASSERT FAILED". security_test.sql only prints results;
-- this file is what makes the important ones pass or fail. Add an assertion here for every new rule.
\set ON_ERROR_STOP 1

create function pg_temp.check(c boolean, m text) returns void language plpgsql as $$
begin if c is not true then raise exception 'ASSERT FAILED: %', m; end if; end $$;

-- count rows a given user can see (runs as the "authenticated" role with that user's id)
create function pg_temp.count_as(p_uid uuid, p_sql text) returns bigint language plpgsql as $$
declare n bigint;
begin
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  set local role authenticated;
  execute p_sql into n;
  reset role;
  return n;
end $$;

-- the statement must be refused (error), or the assertion fails
create function pg_temp.must_fail(p_uid uuid, p_sql text, p_msg text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  set local role authenticated;
  begin
    execute p_sql;
  exception when others then
    reset role;
    return;
  end;
  reset role;
  raise exception 'ASSERT FAILED (should have been refused): %', p_msg;
end $$;

\echo '--- A1 contact details are masked before payment, kept after'
select pg_temp.check((select masked and body !~ '[0-9]' and body !~* 'insta|wa\.me|@' from (select * from public.messages order by id limit 1 offset 0) m), 'message 1: numbers, handles and payment apps masked');
select pg_temp.check((select not masked and body like '%250 EGP%' from (select * from public.messages order by id limit 1 offset 1) m), 'message 2: dates and prices are not masked');
select pg_temp.check((select masked and body !~ '[٠-٩]' from (select * from public.messages order by id limit 1 offset 2) m), 'message 3: Arabic-Indic digits masked');
select pg_temp.check((select not masked and body like '%010 1234 5678%' from (select * from public.messages order by id limit 1 offset 3) m), 'message 4: unmasked after a paid booking');
select pg_temp.check((select count(*) = 4 from public.messages), 'exactly 4 messages were stored');

\echo '--- A2 strangers see nothing, tampering is refused'
select pg_temp.check(pg_temp.count_as('cccccccc-0000-0000-0000-000000000003', 'select count(*) from public.messages') = 0, 'stranger reads messages');
select pg_temp.check(pg_temp.count_as('cccccccc-0000-0000-0000-000000000003', 'select count(*) from public.bookings') = 0, 'stranger reads bookings');
insert into auth.users (id, phone, phone_confirmed_at) values ('77777777-0000-0000-0000-000000000007', '+201000000007', now());
select pg_temp.check((select status = 'pending_verification' from public.profiles where id = '77777777-0000-0000-0000-000000000007'), 'new profile starts as pending_verification');
select pg_temp.must_fail('77777777-0000-0000-0000-000000000007', $$update public.profiles set status = 'active' where id = auth.uid()$$, 'user set own status');
select pg_temp.must_fail('77777777-0000-0000-0000-000000000007', $$update public.profiles set id_verified = true where id = auth.uid()$$, 'user set own verification flag');
select pg_temp.must_fail('77777777-0000-0000-0000-000000000007', $$select public.set_verification(auth.uid(), true, true, true, null)$$, 'user called set_verification');
select pg_temp.must_fail('77777777-0000-0000-0000-000000000007', $$select public.confirm_booking_payment(gen_random_uuid())$$, 'user called confirm_booking_payment');
select pg_temp.must_fail('aaaaaaaa-0000-0000-0000-000000000001', $$update public.bookings set fee_status = 'paid'$$, 'user edited a booking directly');
select pg_temp.must_fail('cccccccc-0000-0000-0000-000000000003', $$select * from private.locations$$, 'client read private.locations');
select pg_temp.must_fail('cccccccc-0000-0000-0000-000000000003', $$select * from private.pet_care$$, 'client read private.pet_care');
select pg_temp.check(pg_temp.count_as('cccccccc-0000-0000-0000-000000000003', 'select count(*) from public.admins') = 0, 'client can see the admin list');
select pg_temp.must_fail('cccccccc-0000-0000-0000-000000000003', $$select public.admin_take_action(auth.uid(), 'warning', 'x', null, false, '[]', 'x')$$, 'non-admin ran an admin action');

\echo '--- A3 the public pin is secret, random and kept when the pin moves'
select pg_temp.check((select abs(approx_lat - 28.49512) <= 0.0033 and abs(approx_lng - 34.51345) <= 0.0038 from public.profiles where first_name = 'aaaaaaaa'), 'public point stays within about 300 m of the real one');
select pg_temp.check((select (select off_lat from private.locations where user_id = 'aaaaaaaa-0000-0000-0000-000000000001') <> (select off_lat from private.locations where user_id = 'ffffffff-0000-0000-0000-000000000006')), 'two users get different secret offsets');
select pg_temp.check((select off_lat = (select v from public.test_scratch where k = 'f_off_before') from private.locations where user_id = 'ffffffff-0000-0000-0000-000000000006'), 'offset unchanged after moving the pin');

\echo '--- A4 photos stay hidden until the owner is approved'
select pg_temp.check(pg_temp.count_as('bbbbbbbb-0000-0000-0000-000000000002', $$select count(*) from storage.objects where bucket_id = 'faces' and name like '99999999%'$$) = 1, 'approved face visible to others');
update public.profiles set status = 'pending_review' where id = '99999999-0000-0000-0000-000000000009';
select pg_temp.check(pg_temp.count_as('bbbbbbbb-0000-0000-0000-000000000002', $$select count(*) from storage.objects where bucket_id = 'faces' and name like '99999999%'$$) = 0, 'face of someone awaiting review hidden from others');
select pg_temp.check(pg_temp.count_as('99999999-0000-0000-0000-000000000009', $$select count(*) from storage.objects where bucket_id = 'faces' and name like '99999999%'$$) = 1, 'owner still sees own face');
update public.profiles set status = 'active' where id = '99999999-0000-0000-0000-000000000009';

\echo '--- A5 booking and pet state'
select pg_temp.check((select not locked from public.pets where id = '22222222-0000-0000-0000-000000000002'), 'cancelled booking unlocked the pet');
select pg_temp.check((select not locked from public.pets where id = '11111111-0000-0000-0000-000000000001'), 'completed stay unlocked the pet');
select pg_temp.check((select status = 'completed' from public.bookings order by created_at limit 1), 'first booking completed');
select pg_temp.check((select rating_avg = 5.0 and stays_count = 1 from public.profiles where first_name = 'bbbbbbbb'), 'rating and stays counted for the sitter');
select pg_temp.check((select stays_count = 1 from public.profiles where first_name = 'aaaaaaaa'), 'stays counted for the owner');

\echo '--- A6 reviews of suspended people are hidden'
select pg_temp.check(pg_temp.count_as('eeeeeeee-0000-0000-0000-000000000005', 'select count(*) from public.reviews') = 1, 'review of an active person is visible');
update public.profiles set status = 'suspended' where first_name = 'bbbbbbbb';
select pg_temp.check(pg_temp.count_as('eeeeeeee-0000-0000-0000-000000000005', 'select count(*) from public.reviews') = 0, 'review of a suspended person hidden from others');
select pg_temp.check(pg_temp.count_as('aaaaaaaa-0000-0000-0000-000000000001', 'select count(*) from public.reviews') = 1, 'review author still sees own review');
update public.profiles set status = 'active' where first_name = 'bbbbbbbb';

\echo '--- A7 blocks hide people both ways'
select pg_temp.check(pg_temp.count_as('aaaaaaaa-0000-0000-0000-000000000001', $$select count(*) from public.profile_cards where first_name = 'cccccccc'$$) = 0, 'blocked person hidden from the blocked');
select pg_temp.check(pg_temp.count_as('cccccccc-0000-0000-0000-000000000003', $$select count(*) from public.profile_cards where first_name = 'aaaaaaaa'$$) = 0, 'blocker does not see the person they blocked');

\echo '--- A8 admin actions are audited'
select pg_temp.check((select count(*) = 1 and bool_and(action = 'suspension') from public.audit_log), 'exactly one audit entry, for the admin suspension');
select pg_temp.check((select count(*) = 1 from public.enforcement_actions where action = 'suspension'), 'one enforcement action recorded');

\echo '--- A9 search: exact before close, no blocked people, not yourself'
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false) is not null as acting_as_owner_a;
select pg_temp.check((
  with r as (select first_name, match_label, match_score from public.search_stays(current_date + 3, current_date + 10, 'cat', 200, 300, '{food_provided}'))
  select (select count(*) from r) = 2
     and (select match_label from r order by match_score desc limit 1) = 'Exact match'
     and (select array_agg(first_name order by first_name) from r) = array['bbbbbbbb', 'eeeeeeee']
), 'cat search returns the exact match first and excludes blocked and own listings');

\echo 'assertions OK'
