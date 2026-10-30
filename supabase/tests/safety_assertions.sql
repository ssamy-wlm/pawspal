-- Phase 7 assertions (handover photos, reviews, reports, blocks, emergency). Run AFTER the other assertion files on the same
-- database, with ON_ERROR_STOP=1. Any failed assertion stops the run with "ASSERT FAILED".
\set ON_ERROR_STOP 1
\i supabase/tests/helpers.sql

insert into auth.users (id, phone, phone_confirmed_at) values
  ('f1f1f1f1-0000-0000-0000-000000000001', '201277800001', now()),   -- Olly, owns the pet
  ('f2f2f2f2-0000-0000-0000-000000000002', '201277800002', now()),   -- Sam, the sitter
  ('f3f3f3f3-0000-0000-0000-000000000003', '201277800003', now()),   -- Stan, a stranger
  ('f4f4f4f4-0000-0000-0000-000000000004', '201277800004', now());   -- Una, a second owner
update public.profiles set first_name = 'Olly', role = 'owner', status = 'active', face_verified = true, id_verified = true, is_adult = true where id = 'f1f1f1f1-0000-0000-0000-000000000001';
update public.profiles set first_name = 'Sam', role = 'sitter', status = 'active', face_verified = true, id_verified = true, is_adult = true where id = 'f2f2f2f2-0000-0000-0000-000000000002';
update public.profiles set first_name = 'Stan', role = 'both', status = 'active', face_verified = true, id_verified = true, is_adult = true where id = 'f3f3f3f3-0000-0000-0000-000000000003';
update public.profiles set first_name = 'Una', role = 'owner', status = 'active', face_verified = true, id_verified = true, is_adult = true where id = 'f4f4f4f4-0000-0000-0000-000000000004';
insert into storage.objects (bucket_id, name) values
  ('pets', 'f1f1f1f1-0000-0000-0000-000000000001/a.jpg'), ('pets', 'f4f4f4f4-0000-0000-0000-000000000004/b.jpg'),
  ('handovers', 'f2f2f2f2-0000-0000-0000-000000000002/d1.jpg'), ('handovers', 'f1f1f1f1-0000-0000-0000-000000000001/d2.jpg'),
  ('handovers', 'f2f2f2f2-0000-0000-0000-000000000002/p1.jpg'),
  ('handovers', 'f2f2f2f2-0000-0000-0000-000000000002/x1.jpg'), ('handovers', 'f2f2f2f2-0000-0000-0000-000000000002/x2.jpg'),
  ('handovers', 'f2f2f2f2-0000-0000-0000-000000000002/x3.jpg'), ('handovers', 'f2f2f2f2-0000-0000-0000-000000000002/x4.jpg');
insert into public.pets (id, owner_id, name, type, size, photo_paths) values
  ('f1f1f1f1-1111-0000-0000-000000000001', 'f1f1f1f1-0000-0000-0000-000000000001', 'Ollypet', 'dog', 'small', array['f1f1f1f1-0000-0000-0000-000000000001/a.jpg']),
  ('f4f4f4f4-1111-0000-0000-000000000004', 'f4f4f4f4-0000-0000-0000-000000000004', 'Unapet', 'cat', 'small', array['f4f4f4f4-0000-0000-0000-000000000004/b.jpg']);
create temp table t_ids (k text primary key, v text);

-- A confirmed booking that starts today and ends today (so it can be completed today).
create or replace function pg_temp.confirmed(p_key text, p_owner uuid, p_sitter uuid, p_pet uuid, p_start int) returns void language plpgsql as $$
declare v_id text; v_ver int;
begin
  v_id := pg_temp.as_role('authenticated', p_owner, format($q$select public.request_booking(%L, %L, current_date + %s, current_date + %s, 'sitter_home', 'paid', 200, false)$q$, p_sitter, p_pet, p_start, p_start + 3));
  insert into t_ids values (p_key, v_id);
  select terms_version into v_ver from public.bookings where id = v_id::uuid;
  perform pg_temp.as_role('authenticated', p_owner, format($q$select public.accept_terms(%L, %s)$q$, v_id, v_ver));
  perform pg_temp.as_role('authenticated', p_sitter, format($q$select public.accept_terms(%L, %s)$q$, v_id, v_ver));
  perform public.confirm_booking_payment(v_id::uuid);
  update public.bookings set starts_on = current_date, ends_on = current_date where id = v_id::uuid;
end $$;
select pg_temp.confirmed('b1', 'f1f1f1f1-0000-0000-0000-000000000001', 'f2f2f2f2-0000-0000-0000-000000000002', 'f1f1f1f1-1111-0000-0000-000000000001', 10);
select pg_temp.check((select status = 'confirmed' from public.bookings where id = (select v::uuid from t_ids where k = 'b1')), 'the test booking is not confirmed');

\echo '--- S1 handover photos go through add_handover_photo only'
select pg_temp.fails_as('authenticated', 'f2f2f2f2-0000-0000-0000-000000000002', format($$insert into public.handover_photos (booking_id, uploaded_by, kind, photo_path) values (%L, 'f2f2f2f2-0000-0000-0000-000000000002', 'dropoff', 'f2f2f2f2-0000-0000-0000-000000000002/d1.jpg')$$, (select v from t_ids where k = 'b1')), 'a handover photo was inserted directly');
select pg_temp.fails_as('authenticated', 'f3f3f3f3-0000-0000-0000-000000000003', format($$select public.add_handover_photo(%L, 'dropoff', 'f3f3f3f3-0000-0000-0000-000000000003/none.jpg')$$, (select v from t_ids where k = 'b1')), 'a stranger added a handover photo');
select pg_temp.fails_as('authenticated', 'f2f2f2f2-0000-0000-0000-000000000002', format($$select public.add_handover_photo(%L, 'dropoff', 'f1f1f1f1-0000-0000-0000-000000000001/d2.jpg')$$, (select v from t_ids where k = 'b1')), 'someone used a file from another person folder');
select pg_temp.fails_as('authenticated', 'f2f2f2f2-0000-0000-0000-000000000002', format($$select public.add_handover_photo(%L, 'dropoff', 'f2f2f2f2-0000-0000-0000-000000000002/missing.jpg')$$, (select v from t_ids where k = 'b1')), 'a photo that was never uploaded was accepted');
select pg_temp.fails_as('authenticated', 'f2f2f2f2-0000-0000-0000-000000000002', format($$select public.add_handover_photo(%L, 'dropoff', 'f2f2f2f2-0000-0000-0000-000000000002/../f1f1f1f1-0000-0000-0000-000000000001/d2.jpg')$$, (select v from t_ids where k = 'b1')), 'a path with .. was accepted');
select pg_temp.fails_as('authenticated', 'f2f2f2f2-0000-0000-0000-000000000002', format($$select public.add_handover_photo(%L, 'other', 'f2f2f2f2-0000-0000-0000-000000000002/d1.jpg')$$, (select v from t_ids where k = 'b1')), 'an unknown photo kind was accepted');
select pg_temp.fails_as('authenticated', 'f2f2f2f2-0000-0000-0000-000000000002', format($$select public.add_handover_photo(%L, 'pickup', 'f2f2f2f2-0000-0000-0000-000000000002/p1.jpg')$$, (select v from t_ids where k = 'b1')), 'a pick-up photo before the stay started');
select pg_temp.fails_as('anon', null, format($$select public.add_handover_photo(%L, 'dropoff', 'x/y.jpg')$$, (select v from t_ids where k = 'b1')), 'anon added a handover photo');

\echo '--- S2 a drop-off photo starts the stay; both sides can add one; at most three each'
select pg_temp.check(pg_temp.as_role('authenticated', 'f2f2f2f2-0000-0000-0000-000000000002', format($$select public.add_handover_photo(%L, 'dropoff', 'f2f2f2f2-0000-0000-0000-000000000002/d1.jpg') is not null$$, (select v from t_ids where k = 'b1')))::boolean, 'the sitter could not add a drop-off photo');
select pg_temp.check((select status = 'in_progress' from public.bookings where id = (select v::uuid from t_ids where k = 'b1')), 'the drop-off photo did not start the stay');
select pg_temp.check(pg_temp.as_role('authenticated', 'f1f1f1f1-0000-0000-0000-000000000001', format($$select public.add_handover_photo(%L, 'dropoff', 'f1f1f1f1-0000-0000-0000-000000000001/d2.jpg') is not null$$, (select v from t_ids where k = 'b1')))::boolean, 'the owner could not add a drop-off photo after the stay started');
select pg_temp.fails_as('authenticated', 'f2f2f2f2-0000-0000-0000-000000000002', format($$select public.add_handover_photo(%L, 'dropoff', 'f2f2f2f2-0000-0000-0000-000000000002/d1.jpg')$$, (select v from t_ids where k = 'b1')), 'the same file was saved twice');
select pg_temp.as_role('authenticated', 'f2f2f2f2-0000-0000-0000-000000000002', format($$select public.add_handover_photo(%L, 'dropoff', 'f2f2f2f2-0000-0000-0000-000000000002/x1.jpg')$$, (select v from t_ids where k = 'b1')));
select pg_temp.as_role('authenticated', 'f2f2f2f2-0000-0000-0000-000000000002', format($$select public.add_handover_photo(%L, 'dropoff', 'f2f2f2f2-0000-0000-0000-000000000002/x2.jpg')$$, (select v from t_ids where k = 'b1')));
select pg_temp.fails_as('authenticated', 'f2f2f2f2-0000-0000-0000-000000000002', format($$select public.add_handover_photo(%L, 'dropoff', 'f2f2f2f2-0000-0000-0000-000000000002/x3.jpg')$$, (select v from t_ids where k = 'b1')), 'a fourth drop-off photo was accepted');

\echo '--- S3 who sees the handover photos'
select pg_temp.check(pg_temp.count_as('f1f1f1f1-0000-0000-0000-000000000001', format($$select count(*) from public.list_handover_photos(%L)$$, (select v from t_ids where k = 'b1'))) = 4, 'the owner does not see every photo of the booking');
select pg_temp.check(pg_temp.count_as('f1f1f1f1-0000-0000-0000-000000000001', format($$select count(*) from public.list_handover_photos(%L) where mine$$, (select v from t_ids where k = 'b1'))) = 1, 'the owner sees the wrong "mine" count');
select pg_temp.fails_as('authenticated', 'f3f3f3f3-0000-0000-0000-000000000003', format($$select * from public.list_handover_photos(%L)$$, (select v from t_ids where k = 'b1')), 'a stranger listed handover photos');
select pg_temp.check(pg_temp.count_as('f3f3f3f3-0000-0000-0000-000000000003', 'select count(*) from public.handover_photos') = 0, 'a stranger read handover photo rows');
select pg_temp.check(public.handover_photo_for('f1f1f1f1-0000-0000-0000-000000000001', (select id from public.handover_photos where photo_path like 'f2f2f2f2%/d1.jpg')) = 'f2f2f2f2-0000-0000-0000-000000000002/d1.jpg', 'the partner could not get the sitter photo path');
select pg_temp.check(public.handover_photo_for('f3f3f3f3-0000-0000-0000-000000000003', (select id from public.handover_photos where photo_path like 'f2f2f2f2%/d1.jpg')) is null, 'a stranger got a handover photo path');
select pg_temp.fails_as('authenticated', 'f1f1f1f1-0000-0000-0000-000000000001', $$select public.handover_photo_for('f1f1f1f1-0000-0000-0000-000000000001', gen_random_uuid())$$, 'a signed-in person called the service-only photo lookup');
select pg_temp.check(pg_temp.count_as('f1f1f1f1-0000-0000-0000-000000000001', $$select count(*) from storage.objects where bucket_id = 'handovers' and name like 'f2f2f2f2%'$$) = 0, 'the partner read the sitter handover file straight from storage');
select pg_temp.check(pg_temp.count_as('f2f2f2f2-0000-0000-0000-000000000002', $$select count(*) from storage.objects where bucket_id = 'handovers' and name like 'f2f2f2f2%'$$) > 0, 'the uploader cannot read their own handover file');

\echo '--- S4 reviews: impossible before the stay is completed, then once per side'
select pg_temp.fails_as('authenticated', 'f1f1f1f1-0000-0000-0000-000000000001', format($$insert into public.reviews (booking_id, author_id, subject_id, rating) values (%L, 'f1f1f1f1-0000-0000-0000-000000000001', 'f2f2f2f2-0000-0000-0000-000000000002', 5)$$, (select v from t_ids where k = 'b1')), 'a review before completion');
select pg_temp.fails_as('authenticated', 'f2f2f2f2-0000-0000-0000-000000000002', format($$select public.complete_booking(%L)$$, (select v from t_ids where k = 'b1')), 'the sitter completed the stay');
select pg_temp.fails_as('authenticated', 'f3f3f3f3-0000-0000-0000-000000000003', format($$select public.complete_booking(%L)$$, (select v from t_ids where k = 'b1')), 'a stranger completed the stay');
select pg_temp.check(pg_temp.as_role('authenticated', 'f2f2f2f2-0000-0000-0000-000000000002', format($$select public.add_handover_photo(%L, 'pickup', 'f2f2f2f2-0000-0000-0000-000000000002/p1.jpg') is not null$$, (select v from t_ids where k = 'b1')))::boolean, 'a pick-up photo during the stay was refused');
select pg_temp.as_role('authenticated', 'f1f1f1f1-0000-0000-0000-000000000001', format($$select public.complete_booking(%L)$$, (select v from t_ids where k = 'b1')));
select pg_temp.check((select status = 'completed' from public.bookings where id = (select v::uuid from t_ids where k = 'b1')), 'the owner could not complete the stay');
select pg_temp.fails_as('authenticated', 'f2f2f2f2-0000-0000-0000-000000000002', format($$select public.add_handover_photo(%L, 'pickup', 'f2f2f2f2-0000-0000-0000-000000000002/x4.jpg')$$, (select v from t_ids where k = 'b1')), 'a handover photo after completion');
select pg_temp.as_role('authenticated', 'f1f1f1f1-0000-0000-0000-000000000001', format($$insert into public.reviews (booking_id, author_id, subject_id, rating, body) values (%L, 'f1f1f1f1-0000-0000-0000-000000000001', 'f2f2f2f2-0000-0000-0000-000000000002', 5, 'Lovely, call me on 0100 123 4567')$$, (select v from t_ids where k = 'b1')));
select pg_temp.check((select body not like '%4567%' from public.reviews where author_id = 'f1f1f1f1-0000-0000-0000-000000000001'), 'a phone number stayed in a review');
select pg_temp.check((select rating_avg = 5 from public.profiles where id = 'f2f2f2f2-0000-0000-0000-000000000002'), 'the rating was not refreshed');
select pg_temp.fails_as('authenticated', 'f1f1f1f1-0000-0000-0000-000000000001', format($$insert into public.reviews (booking_id, author_id, subject_id, rating) values (%L, 'f1f1f1f1-0000-0000-0000-000000000001', 'f2f2f2f2-0000-0000-0000-000000000002', 1)$$, (select v from t_ids where k = 'b1')), 'a second review for the same stay');
select pg_temp.fails_as('authenticated', 'f3f3f3f3-0000-0000-0000-000000000003', format($$insert into public.reviews (booking_id, author_id, subject_id, rating) values (%L, 'f3f3f3f3-0000-0000-0000-000000000003', 'f2f2f2f2-0000-0000-0000-000000000002', 1)$$, (select v from t_ids where k = 'b1')), 'a stranger reviewed a stay');
select pg_temp.fails_as('authenticated', 'f1f1f1f1-0000-0000-0000-000000000001', $$update public.reviews set rating = 1$$, 'a review was edited');
select pg_temp.fails_as('authenticated', 'f1f1f1f1-0000-0000-0000-000000000001', $$delete from public.reviews$$, 'a review was deleted');
update public.profiles set status = 'suspended' where id = 'f2f2f2f2-0000-0000-0000-000000000002';
select pg_temp.fails_as('authenticated', 'f2f2f2f2-0000-0000-0000-000000000002', format($$insert into public.reviews (booking_id, author_id, subject_id, rating) values (%L, 'f2f2f2f2-0000-0000-0000-000000000002', 'f1f1f1f1-0000-0000-0000-000000000001', 1)$$, (select v from t_ids where k = 'b1')), 'a suspended person wrote a review');
update public.profiles set status = 'active' where id = 'f2f2f2f2-0000-0000-0000-000000000002';
select pg_temp.check(pg_temp.as_role('authenticated', 'f2f2f2f2-0000-0000-0000-000000000002', format($$insert into public.reviews (booking_id, author_id, subject_id, rating) values (%L, 'f2f2f2f2-0000-0000-0000-000000000002', 'f1f1f1f1-0000-0000-0000-000000000001', 4)$$, (select v from t_ids where k = 'b1'))) is null, 'the sitter could not review the owner');
update public.bookings set ends_on = current_date - 20, starts_on = current_date - 21 where id = (select v::uuid from t_ids where k = 'b1');
delete from public.reviews where author_id = 'f2f2f2f2-0000-0000-0000-000000000002';
select pg_temp.fails_as('authenticated', 'f2f2f2f2-0000-0000-0000-000000000002', format($$insert into public.reviews (booking_id, author_id, subject_id, rating) values (%L, 'f2f2f2f2-0000-0000-0000-000000000002', 'f1f1f1f1-0000-0000-0000-000000000001', 4)$$, (select v from t_ids where k = 'b1')), 'a review more than 14 days after the stay');

\echo '--- S4b a blocked person cannot review the person who blocked them'
update public.bookings set ends_on = current_date, starts_on = current_date where id = (select v::uuid from t_ids where k = 'b1');
delete from public.reviews where author_id = 'f2f2f2f2-0000-0000-0000-000000000002';
insert into public.blocks (blocker_id, blocked_id) values ('f1f1f1f1-0000-0000-0000-000000000001', 'f2f2f2f2-0000-0000-0000-000000000002');
select pg_temp.fails_as('authenticated', 'f2f2f2f2-0000-0000-0000-000000000002', format($$insert into public.reviews (booking_id, author_id, subject_id, rating) values (%L, 'f2f2f2f2-0000-0000-0000-000000000002', 'f1f1f1f1-0000-0000-0000-000000000001', 4)$$, (select v from t_ids where k = 'b1')), 'a blocked person reviewed the person who blocked them');
delete from public.blocks where blocker_id = 'f1f1f1f1-0000-0000-0000-000000000001';

\echo '--- S5 reports'
select pg_temp.fails_as('authenticated', 'f3f3f3f3-0000-0000-0000-000000000003', $$insert into public.reports (reporter_id, reported_id, reason) values ('f3f3f3f3-0000-0000-0000-000000000003', 'f1f1f1f1-0000-0000-0000-000000000001', 'other')$$, 'a report was inserted directly');
select pg_temp.as_role('authenticated', 'f3f3f3f3-0000-0000-0000-000000000003', $$select public.file_report('f1f1f1f1-0000-0000-0000-000000000001', 'rude_or_harassment', 'rude', null, null)$$);
select pg_temp.check((select priority = 'normal' and not emergency and status = 'new' from public.reports where reporter_id = 'f3f3f3f3-0000-0000-0000-000000000003'), 'the report was not saved as a normal new report');
select pg_temp.check(pg_temp.as_role('authenticated', 'f3f3f3f3-0000-0000-0000-000000000003', $$select public.file_report('f1f1f1f1-0000-0000-0000-000000000001', 'rude_or_harassment', 'again', null, null)$$)::uuid = (select id from public.reports where reporter_id = 'f3f3f3f3-0000-0000-0000-000000000003'), 'the same report twice made two reports');
select pg_temp.as_role('authenticated', 'f3f3f3f3-0000-0000-0000-000000000003', $$select public.file_report('f1f1f1f1-0000-0000-0000-000000000001', 'animal_welfare', null, null, null)$$);
select pg_temp.check((select priority = 'high' from public.reports where reporter_id = 'f3f3f3f3-0000-0000-0000-000000000003' and reason = 'animal_welfare'), 'an animal welfare report was not high priority');
select pg_temp.fails_as('authenticated', 'f3f3f3f3-0000-0000-0000-000000000003', $$select public.file_report('f3f3f3f3-0000-0000-0000-000000000003', 'other', null, null, null)$$, 'a person reported themselves');
select pg_temp.fails_as('authenticated', 'f3f3f3f3-0000-0000-0000-000000000003', $$select public.file_report('f1f1f1f1-0000-0000-0000-000000000001', 'made_up', null, null, null)$$, 'a made-up reason was accepted');
select pg_temp.fails_as('authenticated', 'f3f3f3f3-0000-0000-0000-000000000003', $$select public.file_report(gen_random_uuid(), 'other', null, null, null)$$, 'a report about nobody was accepted');
select pg_temp.fails_as('authenticated', 'f3f3f3f3-0000-0000-0000-000000000003', format($$select public.file_report('f1f1f1f1-0000-0000-0000-000000000001', 'no_show', null, %L, null)$$, (select v from t_ids where k = 'b1')), 'a report pointed at a booking the reporter is not in');
select pg_temp.check(pg_temp.as_role('authenticated', 'f2f2f2f2-0000-0000-0000-000000000002', format($$select public.file_report('f1f1f1f1-0000-0000-0000-000000000001', 'no_show', null, %L, null) is not null$$, (select v from t_ids where k = 'b1')))::boolean, 'a report about the other person in a shared booking was refused');
insert into public.conversations (user_a, user_b) values ('f1f1f1f1-0000-0000-0000-000000000001', 'f2f2f2f2-0000-0000-0000-000000000002');
insert into t_ids select 'cv', id::text from public.conversations where user_a = 'f1f1f1f1-0000-0000-0000-000000000001' and user_b = 'f2f2f2f2-0000-0000-0000-000000000002';
select pg_temp.fails_as('authenticated', 'f3f3f3f3-0000-0000-0000-000000000003', format($$select public.file_report('f1f1f1f1-0000-0000-0000-000000000001', 'other', null, null, %L)$$, (select v from t_ids where k = 'cv')), 'a report pointed at a conversation the reporter is not in');
select pg_temp.check(pg_temp.as_role('authenticated', 'f2f2f2f2-0000-0000-0000-000000000002', format($$select public.file_report('f1f1f1f1-0000-0000-0000-000000000001', 'rude_or_harassment', null, null, %L) is not null$$, (select v from t_ids where k = 'cv')))::boolean, 'a report about the other person in a shared conversation was refused');
select pg_temp.fails_as('authenticated', 'f3f3f3f3-0000-0000-0000-000000000003', $$select public.file_report('f1f1f1f1-0000-0000-0000-000000000001', 'other', repeat('x', 2001), null, null)$$, 'a very long report was accepted');
select pg_temp.fails_as('anon', null, $$select public.file_report('f1f1f1f1-0000-0000-0000-000000000001', 'other', null, null, null)$$, 'anon filed a report');
select pg_temp.check(pg_temp.count_as('f3f3f3f3-0000-0000-0000-000000000003', 'select count(*) from public.reports') = 2, 'the reporter does not see their own reports');
select pg_temp.check(pg_temp.count_as('f1f1f1f1-0000-0000-0000-000000000001', 'select count(*) from public.reports') = 0, 'the reported person saw a report about them');
insert into public.reports (reporter_id, reported_id, reason) select 'f4f4f4f4-0000-0000-0000-000000000004', 'f1f1f1f1-0000-0000-0000-000000000001', 'other' from generate_series(1, 10);
select pg_temp.fails_as('authenticated', 'f4f4f4f4-0000-0000-0000-000000000004', $$select public.file_report('f2f2f2f2-0000-0000-0000-000000000002', 'other', null, null, null)$$, 'an eleventh report in a day was accepted');

select pg_temp.as_role('authenticated', 'f3f3f3f3-0000-0000-0000-000000000003', $$select public.file_report('f2f2f2f2-0000-0000-0000-000000000002', 'safety', null, null, null)$$);
select pg_temp.as_role('authenticated', 'f3f3f3f3-0000-0000-0000-000000000003', $$select public.file_report('f4f4f4f4-0000-0000-0000-000000000004', 'safety', null, null, null)$$);
select pg_temp.as_role('authenticated', 'f3f3f3f3-0000-0000-0000-000000000003', $$select public.file_report('f4f4f4f4-0000-0000-0000-000000000004', 'animal_welfare', null, null, null)$$);
select pg_temp.check((select count(*) from public.reports where reporter_id = 'f3f3f3f3-0000-0000-0000-000000000003' and priority = 'high') = 3, 'a person got more than three high-priority reports a day');
select pg_temp.check(pg_temp.count_as('f2f2f2f2-0000-0000-0000-000000000002', 'select count(*) from public.handover_photos') = 4, 'the sitter reads handover rows directly that are not their own');
select pg_temp.check(pg_temp.count_as('f1f1f1f1-0000-0000-0000-000000000001', 'select count(*) from public.handover_photos') = 1, 'the owner reads the partner handover rows directly');

\echo '--- S6 blocks'
select pg_temp.fails_as('authenticated', 'f3f3f3f3-0000-0000-0000-000000000003', $$insert into public.blocks (blocker_id, blocked_id) values ('f3f3f3f3-0000-0000-0000-000000000003', 'f1f1f1f1-0000-0000-0000-000000000001')$$, 'a block was inserted directly');
select pg_temp.fails_as('authenticated', 'f3f3f3f3-0000-0000-0000-000000000003', $$select public.block_user('f3f3f3f3-0000-0000-0000-000000000003')$$, 'a person blocked themselves');
select pg_temp.fails_as('authenticated', 'f3f3f3f3-0000-0000-0000-000000000003', $$select public.block_user(gen_random_uuid())$$, 'a person blocked nobody');
select pg_temp.as_role('authenticated', 'f3f3f3f3-0000-0000-0000-000000000003', $$select public.block_user('f1f1f1f1-0000-0000-0000-000000000001')$$);
select pg_temp.as_role('authenticated', 'f3f3f3f3-0000-0000-0000-000000000003', $$select public.block_user('f1f1f1f1-0000-0000-0000-000000000001')$$);      -- twice is fine
select pg_temp.check(pg_temp.count_as('f3f3f3f3-0000-0000-0000-000000000003', 'select count(*) from public.my_blocks()') = 1, 'the block list is wrong');
select pg_temp.check(pg_temp.as_role('authenticated', 'f3f3f3f3-0000-0000-0000-000000000003', 'select first_name from public.my_blocks()') = 'Olly', 'the block list does not show who was blocked');
select pg_temp.check(pg_temp.count_as('f1f1f1f1-0000-0000-0000-000000000001', 'select count(*) from public.my_blocks()') = 0, 'the blocked person saw the block');
select pg_temp.check(pg_temp.count_as('f1f1f1f1-0000-0000-0000-000000000001', 'select count(*) from public.blocks') = 0, 'the blocked person read the block row');
select pg_temp.check(pg_temp.count_as('f3f3f3f3-0000-0000-0000-000000000003', $$select count(*) from public.profile_cards where first_name = 'Olly'$$) = 0, 'a person I blocked is still in the cards');
select pg_temp.as_role('authenticated', 'f3f3f3f3-0000-0000-0000-000000000003', $$select public.unblock_user('f1f1f1f1-0000-0000-0000-000000000001')$$);
select pg_temp.check(pg_temp.count_as('f3f3f3f3-0000-0000-0000-000000000003', 'select count(*) from public.my_blocks()') = 0, 'unblocking did not work');
select pg_temp.fails_as('authenticated', 'f3f3f3f3-0000-0000-0000-000000000003', $$delete from public.blocks$$, 'a block was deleted directly');
select pg_temp.fails_as('anon', null, $$select public.block_user('f1f1f1f1-0000-0000-0000-000000000001')$$, 'anon blocked someone');

\echo '--- S7 emergency alerts the other person and opens a high-priority report'
select pg_temp.confirmed('b2', 'f4f4f4f4-0000-0000-0000-000000000004', 'f2f2f2f2-0000-0000-0000-000000000002', 'f4f4f4f4-1111-0000-0000-000000000004', 40);
select pg_temp.fails_as('authenticated', 'f2f2f2f2-0000-0000-0000-000000000002', format($$select public.raise_emergency('f2f2f2f2-0000-0000-0000-000000000002', %L, 'x')$$, (select v from t_ids where k = 'b2')), 'a signed-in person called raise_emergency directly');
select pg_temp.fails_as('anon', null, format($$select public.raise_emergency('f2f2f2f2-0000-0000-0000-000000000002', %L, 'x')$$, (select v from t_ids where k = 'b2')), 'anon called raise_emergency');
select pg_temp.check(public.raise_emergency('f3f3f3f3-0000-0000-0000-000000000003', (select v::uuid from t_ids where k = 'b2'), 'x') = 'not_allowed', 'a stranger raised an emergency');
select pg_temp.check(public.raise_emergency('f2f2f2f2-0000-0000-0000-000000000002', (select v::uuid from t_ids where k = 'b1'), 'x') = 'not_allowed', 'an emergency for a completed booking was accepted');
select pg_temp.check(public.raise_emergency('f2f2f2f2-0000-0000-0000-000000000002', (select v::uuid from t_ids where k = 'b2'), repeat('x', 501)) = 'invalid', 'a very long emergency note was accepted');
select pg_temp.check(public.raise_emergency('f2f2f2f2-0000-0000-0000-000000000002', (select v::uuid from t_ids where k = 'b2'), 'Bruno will not eat') = 'sent', 'the emergency was not sent');
select pg_temp.check((select priority = 'high' and emergency and reason = 'safety' and reporter_id = 'f2f2f2f2-0000-0000-0000-000000000002' and reported_id = 'f4f4f4f4-0000-0000-0000-000000000004' and booking_id = (select v::uuid from t_ids where k = 'b2')
                       from public.reports where emergency), 'no high-priority report was opened');
select pg_temp.check(pg_temp.count_as('f4f4f4f4-0000-0000-0000-000000000004', 'select count(*) from public.my_alerts()') = 1, 'the owner was not alerted');
select pg_temp.check(pg_temp.as_role('authenticated', 'f4f4f4f4-0000-0000-0000-000000000004', 'select pet_name from public.my_alerts()') = 'Unapet', 'the alert does not name the pet');
select pg_temp.check(pg_temp.count_as('f2f2f2f2-0000-0000-0000-000000000002', 'select count(*) from public.my_alerts()') = 0, 'the person who raised the emergency was alerted too');
select pg_temp.check(pg_temp.count_as('f3f3f3f3-0000-0000-0000-000000000003', 'select count(*) from public.alerts') = 0, 'a stranger read alerts');
select pg_temp.check(public.raise_emergency('f2f2f2f2-0000-0000-0000-000000000002', (select v::uuid from t_ids where k = 'b2'), 'again') = 'already_sent', 'the same emergency twice sent two alerts');
select pg_temp.check((select count(*) = 1 from public.reports where emergency), 'a repeat emergency opened a second report');
select pg_temp.as_role('authenticated', 'f2f2f2f2-0000-0000-0000-000000000002', format($$select public.dismiss_alert(%L)$$, (select id from public.alerts limit 1)));
select pg_temp.check(pg_temp.count_as('f4f4f4f4-0000-0000-0000-000000000004', 'select count(*) from public.my_alerts()') = 1, 'the wrong person dismissed an alert');
select pg_temp.as_role('authenticated', 'f4f4f4f4-0000-0000-0000-000000000004', format($$select public.dismiss_alert(%L)$$, (select id from public.alerts limit 1)));
select pg_temp.check(pg_temp.count_as('f4f4f4f4-0000-0000-0000-000000000004', 'select count(*) from public.my_alerts()') = 0, 'dismissing an alert did not work');
select pg_temp.check(public.raise_emergency('f4f4f4f4-0000-0000-0000-000000000004', (select v::uuid from t_ids where k = 'b2'), null) = 'sent', 'the owner could not raise an emergency');
select pg_temp.check(pg_temp.count_as('f2f2f2f2-0000-0000-0000-000000000002', 'select count(*) from public.my_alerts()') = 1, 'the sitter was not alerted when the owner raised it');
select pg_temp.fails_as('authenticated', 'f3f3f3f3-0000-0000-0000-000000000003', $$update public.alerts set read_at = now()$$, 'an alert was edited directly');

\echo '--- S8 unsaved handover photos are listed for clean-up'
insert into storage.objects (bucket_id, name, created_at) values ('handovers', 'f1f1f1f1-0000-0000-0000-000000000001/old-unsaved.jpg', now() - interval '3 days');
select pg_temp.check(exists (select 1 from public.list_unused_uploads() where name = 'f1f1f1f1-0000-0000-0000-000000000001/old-unsaved.jpg'), 'an unsaved handover photo was not listed');
select pg_temp.check(not exists (select 1 from public.list_unused_uploads() where name = 'f2f2f2f2-0000-0000-0000-000000000002/d1.jpg'), 'a saved handover photo was listed as unused');
