-- Phase 2 assertions (sign-up and verification). Run AFTER security_test.sql and assertions.sql on the same
-- database, with ON_ERROR_STOP=1. Any failed assertion stops the run with "ASSERT FAILED".
\set ON_ERROR_STOP 1
\i supabase/tests/helpers.sql

\echo '--- S1 only Egyptian mobile numbers can sign up'
select pg_temp.fails($$insert into auth.users (id, phone, phone_confirmed_at) values (gen_random_uuid(), '+14155550123', now())$$, 'a US number signed up');
select pg_temp.fails($$insert into auth.users (id, phone, phone_confirmed_at) values (gen_random_uuid(), '+201300000000', now())$$, 'an unknown Egyptian prefix signed up');
select pg_temp.fails($$insert into auth.users (id, phone, phone_confirmed_at) values (gen_random_uuid(), '+20100000', now())$$, 'a too-short number signed up');
select pg_temp.fails($$insert into auth.users (id, phone, phone_confirmed_at) values (gen_random_uuid(), null, now())$$, 'an account without a phone number signed up');
insert into auth.users (id, phone, phone_confirmed_at) values ('a1a1a1a1-0000-0000-0000-000000000001', '201211111111', now());   -- as GoTrue stores it: no plus
select pg_temp.check((select count(*) = 1 from public.profiles where id = 'a1a1a1a1-0000-0000-0000-000000000001'), 'a valid Egyptian number gets a profile');

\echo '--- S2 a banned number cannot come back, however it is written'
insert into public.banned_identifiers (kind, hash) values
  ('phone', encode(extensions.digest('201088888888', 'sha256'), 'hex')),
  ('phone', encode(extensions.digest('+201155555555', 'sha256'), 'hex'));
select pg_temp.fails($$insert into auth.users (id, phone, phone_confirmed_at) values (gen_random_uuid(), '201088888888', now())$$, 'banned number (digits) signed up');
select pg_temp.fails($$insert into auth.users (id, phone, phone_confirmed_at) values (gen_random_uuid(), '+201088888888', now())$$, 'banned number (with plus) signed up');
select pg_temp.fails($$insert into auth.users (id, phone, phone_confirmed_at) values (gen_random_uuid(), '201155555555', now())$$, 'banned number (hashed with plus) signed up');
select pg_temp.check(public.is_phone_banned('+20 108 888 8888'), 'is_phone_banned sees a banned number written with spaces');
select pg_temp.check(not public.is_phone_banned('+201233333333'), 'is_phone_banned lets other numbers through');

\echo '--- S3 sign-in code limits: 3 sends per number per hour, 10 requests per device per day, a CAPTCHA after 2 wrong codes'
select pg_temp.check((public.otp_check_and_log('ph1', null, false, 'send') ->> 'allowed')::boolean, 'send 1 allowed');
select pg_temp.check((public.otp_check_and_log('ph1', null, false, 'send') ->> 'allowed')::boolean, 'send 2 allowed');
select pg_temp.check((public.otp_check_and_log('ph1', null, false, 'send') ->> 'allowed')::boolean, 'send 3 allowed');
select pg_temp.check((public.otp_check_and_log('ph1', null, false, 'send') ->> 'reason') = 'phone_limit', 'send 4 to the same number is refused');
select pg_temp.check((public.otp_check_and_log('ph1', 'devX', false, 'check') ->> 'reason') = 'phone_limit', 'a plain check also refuses the number');
select pg_temp.check((public.otp_check_and_log('ph1', null, false, 'send') ->> 'retry_after_seconds')::int between 1 and 3600, 'the refusal says how long to wait');
select pg_temp.check((select count(*) = 3 from private.otp_events where phone_hash = 'ph1' and kind = 'send'), 'a refused send is not counted');
select pg_temp.check((public.otp_check_and_log('ph2', null, false, 'send') ->> 'allowed')::boolean, 'another number is not affected by the first');
select pg_temp.check((select count(*) = 0 from private.otp_events where phone_hash = 'ph2' and kind = 'request'), 'a send does not count as a device request');
do $$ begin
  for i in 1..10 loop perform public.otp_check_and_log('dphone' || i, 'dev2', false, 'request'); end loop;   -- device dev2: 10 requests
end $$;
select pg_temp.check((public.otp_check_and_log('dphone11', 'dev2', false, 'request') ->> 'reason') = 'device_limit', 'the 11th request from one device is refused');
select pg_temp.check((public.otp_check_and_log('dphone12', 'dev3', false, 'request') ->> 'allowed')::boolean, 'another device is not affected');
select pg_temp.check((select count(*) = 10 from private.otp_events where device_hash = 'dev2'), 'a refused request is not counted');
select public.otp_record_result('ph3', 'dev4', false);
select pg_temp.check((public.otp_check_and_log('ph3', 'dev4', false, 'check') ->> 'allowed')::boolean, 'one wrong code does not block');
select public.otp_record_result('ph3', 'dev4', false);
select pg_temp.check((public.otp_check_and_log('ph3', 'dev4', false, 'check') ->> 'reason') = 'captcha_required', 'two wrong codes need a CAPTCHA');
select pg_temp.check((public.otp_check_and_log('ph3', 'dev4', true, 'send') ->> 'allowed')::boolean, 'a passed CAPTCHA lets the send through');
select public.otp_record_result('ph3', 'dev4', true);
select pg_temp.check((public.otp_check_and_log('ph3', 'dev4', false, 'check') ->> 'allowed')::boolean, 'a correct code clears the failures');
select pg_temp.fails($$select public.otp_check_and_log('x', 'y', false, 'bogus')$$, 'an unknown mode was accepted');
select pg_temp.check((select count(*) >= 3 from public.security_events where kind = 'otp_blocked'), 'blocked requests are logged');
select pg_temp.check((select count(*) = 0 from public.security_events where kind = 'otp_blocked' and details::text ~ 'ph1|dev1|dev2|[0-9]{9}'), 'the log holds no phone or device data');
select pg_temp.fails_as('anon', null, $$select public.otp_check_and_log('x', 'y')$$, 'anon called otp_check_and_log');
select pg_temp.fails_as('authenticated', 'a1a1a1a1-0000-0000-0000-000000000001', $$select public.otp_check_and_log('x', 'y')$$, 'a user called otp_check_and_log');
select pg_temp.fails_as('authenticated', 'a1a1a1a1-0000-0000-0000-000000000001', $$select public.is_phone_banned('+201000000000')$$, 'a user called is_phone_banned');
select pg_temp.fails_as('authenticated', 'a1a1a1a1-0000-0000-0000-000000000001', $$select count(*) from private.otp_events$$, 'a user read the sign-in log');

\echo '--- S4 people still waiting for review cannot see anyone'
insert into auth.users (id, phone, phone_confirmed_at) values
  ('a2a2a2a2-0000-0000-0000-000000000002', '201222222222', now()),   -- a host who is active
  ('a3a3a3a3-0000-0000-0000-000000000003', '201233333333', now());   -- a new person, still pending
update public.profiles set first_name = 'host', status = 'active', face_verified = true, id_verified = true, is_adult = true,
       approx_lat = 28.5, approx_lng = 34.5 where id = 'a2a2a2a2-0000-0000-0000-000000000002';
update public.profiles set first_name = 'newbie' where id = 'a3a3a3a3-0000-0000-0000-000000000003';
insert into storage.objects (bucket_id, name) values ('faces', 'a2a2a2a2-0000-0000-0000-000000000002/face.jpg'), ('pets', 'a2a2a2a2-0000-0000-0000-000000000002/pet.jpg');
insert into public.pets (id, owner_id, name, type, size, photo_paths) values
  ('a2a2a2a2-1111-0000-0000-000000000002', 'a2a2a2a2-0000-0000-0000-000000000002', 'Rex', 'dog', 'medium', array['a2a2a2a2-0000-0000-0000-000000000002/pet.jpg']);
insert into public.availability (user_id, starts_on, ends_on, pets_accepted, offers) values
  ('a2a2a2a2-0000-0000-0000-000000000002', current_date + 1, current_date + 10, '{cat,dog}', '{volunteer}');
-- The setup is real: an active person sees the host...
select pg_temp.check(pg_temp.count_as('a1a1a1a1-0000-0000-0000-000000000001', $$select count(*) from public.profile_cards where first_name = 'host'$$) = 0, 'control: a1 is still pending, sees nothing');
update public.profiles set status = 'active', first_name = 'ctrl' where id = 'a1a1a1a1-0000-0000-0000-000000000001';
select pg_temp.check(pg_temp.count_as('a1a1a1a1-0000-0000-0000-000000000001', $$select count(*) from public.profile_cards where first_name = 'host'$$) = 1, 'control: an active person sees the host card');
select pg_temp.check(pg_temp.count_as('a1a1a1a1-0000-0000-0000-000000000001', $$select count(*) from public.availability where user_id = 'a2a2a2a2-0000-0000-0000-000000000002'$$) = 1, 'control: an active person sees the listing');
select pg_temp.check(pg_temp.count_as('a1a1a1a1-0000-0000-0000-000000000001', $$select count(*) from public.search_stays(current_date + 2, current_date + 5, 'dog') where first_name = 'host'$$) = 1, 'control: an active person finds the host by search');
select pg_temp.check(pg_temp.count_as('a1a1a1a1-0000-0000-0000-000000000001', $$select count(*) from storage.objects where bucket_id = 'faces' and name like 'a2a2a2a2%'$$) = 1, 'control: an active person can read an approved face photo');
-- ...and the waiting person sees none of it.
select pg_temp.check(pg_temp.count_as('a3a3a3a3-0000-0000-0000-000000000003', $$select count(*) from public.profile_cards$$) = 0, 'pending user sees profile cards');
select pg_temp.check(pg_temp.count_as('a3a3a3a3-0000-0000-0000-000000000003', $$select count(*) from public.availability where user_id <> auth.uid()$$) = 0, 'pending user sees listings');
select pg_temp.check(pg_temp.count_as('a3a3a3a3-0000-0000-0000-000000000003', $$select count(*) from public.pets where owner_id <> auth.uid()$$) = 0, 'pending user sees other people''s pets');
select pg_temp.check(pg_temp.count_as('a3a3a3a3-0000-0000-0000-000000000003', $$select count(*) from public.search_stays(current_date + 2, current_date + 5, 'dog')$$) = 0, 'pending user can search');
select pg_temp.check(pg_temp.count_as('a3a3a3a3-0000-0000-0000-000000000003', $$select count(*) from public.browse_random(null, 30)$$) = 0, 'pending user can swipe');
select pg_temp.check(pg_temp.count_as('a3a3a3a3-0000-0000-0000-000000000003', $$select count(*) from storage.objects where name like 'a2a2a2a2%'$$) = 0, 'pending user reads photos');
select pg_temp.fails_as('authenticated', 'a3a3a3a3-0000-0000-0000-000000000003', $$select public.start_conversation('a2a2a2a2-0000-0000-0000-000000000002')$$, 'pending user started a chat');
select pg_temp.fails_as('authenticated', 'a3a3a3a3-0000-0000-0000-000000000003', $$update public.profiles set status = 'active' where id = auth.uid()$$, 'pending user activated themselves');

\echo '--- S5 uploads: raw photos only into incoming/<own id>/, nothing written to the real buckets by the app'
select pg_temp.as_role('authenticated', 'a3a3a3a3-0000-0000-0000-000000000003', $$insert into storage.objects (bucket_id, name) values ('incoming', 'a3a3a3a3-0000-0000-0000-000000000003/raw1.jpg')$$);
select pg_temp.check((select count(*) = 1 from storage.objects where bucket_id = 'incoming' and name like 'a3a3a3a3%'), 'a user can upload a raw photo to their own incoming folder');
select pg_temp.fails_as('authenticated', 'a3a3a3a3-0000-0000-0000-000000000003', $$insert into storage.objects (bucket_id, name) values ('incoming', 'a2a2a2a2-0000-0000-0000-000000000002/evil.jpg')$$, 'upload into someone else''s incoming folder');
select pg_temp.fails_as('authenticated', 'a3a3a3a3-0000-0000-0000-000000000003', $$insert into storage.objects (bucket_id, name) values ('faces', 'a3a3a3a3-0000-0000-0000-000000000003/face.jpg')$$, 'direct upload to faces');
select pg_temp.fails_as('authenticated', 'a3a3a3a3-0000-0000-0000-000000000003', $$insert into storage.objects (bucket_id, name) values ('pets', 'a3a3a3a3-0000-0000-0000-000000000003/pet.jpg')$$, 'direct upload to pets');
select pg_temp.fails_as('authenticated', 'a3a3a3a3-0000-0000-0000-000000000003', $$insert into storage.objects (bucket_id, name) values ('homes', 'a3a3a3a3-0000-0000-0000-000000000003/home.jpg')$$, 'direct upload to homes');
select pg_temp.fails_as('authenticated', 'a3a3a3a3-0000-0000-0000-000000000003', $$insert into storage.objects (bucket_id, name) values ('handovers', 'a3a3a3a3-0000-0000-0000-000000000003/h.jpg')$$, 'direct upload to handovers');
select pg_temp.check(pg_temp.count_as('a3a3a3a3-0000-0000-0000-000000000003', $$select count(*) from storage.objects where bucket_id = 'incoming'$$) = 0, 'nobody reads incoming/ through the API, not even the uploader');
select pg_temp.check((select file_size_limit = 8388608 and allowed_mime_types = array['image/jpeg', 'image/png'] from storage.buckets where id = 'incoming'), 'incoming accepts only JPEG and PNG up to 8 MB');
select pg_temp.check((select bool_and(file_size_limit = 8388608 and allowed_mime_types = array['image/jpeg', 'image/png']) from storage.buckets where id in ('faces', 'pets', 'homes', 'handovers')), 'the real buckets accept only JPEG and PNG up to 8 MB');

\echo '--- S6 pet photos must be real, processed files in the owner''s own folder'
insert into storage.objects (bucket_id, name) values ('pets', 'a3a3a3a3-0000-0000-0000-000000000003/ok.jpg');
select pg_temp.fails_as('authenticated', 'a3a3a3a3-0000-0000-0000-000000000003', $$insert into public.pets (owner_id, name, type, size, photo_paths) values (auth.uid(), 'X', 'dog', 'small', array['a2a2a2a2-0000-0000-0000-000000000002/pet.jpg'])$$, 'pet pointing at someone else''s photo');
select pg_temp.fails_as('authenticated', 'a3a3a3a3-0000-0000-0000-000000000003', $$insert into public.pets (owner_id, name, type, size, photo_paths) values (auth.uid(), 'X', 'dog', 'small', array['a3a3a3a3-0000-0000-0000-000000000003/missing.jpg'])$$, 'pet pointing at a file that does not exist');
select pg_temp.fails_as('authenticated', 'a3a3a3a3-0000-0000-0000-000000000003', $$insert into public.pets (owner_id, name, type, size, photo_paths) values (auth.uid(), 'X', 'dog', 'small', array['../a2a2a2a2-0000-0000-0000-000000000002/pet.jpg'])$$, 'pet photo path with ..');
select pg_temp.as_role('authenticated', 'a3a3a3a3-0000-0000-0000-000000000003', $$insert into public.pets (id, owner_id, name, type, size, photo_paths) values ('a3a3a3a3-1111-0000-0000-000000000003', auth.uid(), 'Mimi', 'cat', 'small', array['a3a3a3a3-0000-0000-0000-000000000003/ok.jpg'])$$);
select pg_temp.check((select count(*) = 1 from public.pets where owner_id = 'a3a3a3a3-0000-0000-0000-000000000003'), 'a pet with a real photo of its own is saved');
select pg_temp.fails_as('authenticated', 'a3a3a3a3-0000-0000-0000-000000000003', $$update public.pets set photo_paths = array['a2a2a2a2-0000-0000-0000-000000000002/pet.jpg'] where id = 'a3a3a3a3-1111-0000-0000-000000000003'$$, 'swapping a pet photo for someone else''s');
do $$ begin
  for i in 1..9 loop
    insert into public.pets (owner_id, name, type, size, photo_paths) values ('a3a3a3a3-0000-0000-0000-000000000003', 'p' || i, 'cat', 'small', array['a3a3a3a3-0000-0000-0000-000000000003/ok.jpg']);
  end loop;
end $$;
select pg_temp.fails_as('authenticated', 'a3a3a3a3-0000-0000-0000-000000000003', $$insert into public.pets (owner_id, name, type, size, photo_paths) values (auth.uid(), 'eleven', 'cat', 'small', array['a3a3a3a3-0000-0000-0000-000000000003/ok.jpg'])$$, 'an 11th pet');
delete from public.pets where owner_id = 'a3a3a3a3-0000-0000-0000-000000000003' and name like 'p_';

\echo '--- S7 identity results: service role only, banned and duplicate documents refused, no image or ID number stored'
select pg_temp.fails_as('authenticated', 'a3a3a3a3-0000-0000-0000-000000000003', $$select public.record_verification(auth.uid(), true, true, true, null, 'idhash-self', 'devhash-self')$$, 'a user marked themselves verified');
select pg_temp.fails_as('anon', null, $$select public.record_verification('a3a3a3a3-0000-0000-0000-000000000003', true, true, true, null, null, null)$$, 'anon marked someone verified');
select pg_temp.fails_as('authenticated', 'a3a3a3a3-0000-0000-0000-000000000003', $$select public.set_verification(auth.uid(), true, true, true, null)$$, 'a user called set_verification');
select pg_temp.check(pg_temp.as_role('service_role', null, $$select public.record_verification('a3a3a3a3-0000-0000-0000-000000000003', true, true, true, 'a3a3a3a3-0000-0000-0000-000000000003/face.jpg', 'idhash-newbie', 'devhash-1')$$) = 'ok', 'a good provider result is accepted');
select pg_temp.check((select face_verified and id_verified and is_adult and face_photo_path = 'a3a3a3a3-0000-0000-0000-000000000003/face.jpg' from public.profiles where id = 'a3a3a3a3-0000-0000-0000-000000000003'), 'the provider result sets the flags');
select pg_temp.check((select status = 'pending_verification' from public.profiles where id = 'a3a3a3a3-0000-0000-0000-000000000003'), 'verification alone does not move the profile to review');
select pg_temp.check(pg_temp.as_role('service_role', null, $$select public.record_verification('a2a2a2a2-0000-0000-0000-000000000002', true, true, true, null, 'idhash-newbie', null)$$) = 'duplicate_id', 'the same ID document on a second account is refused');
select pg_temp.check((select count(*) = 1 from public.security_events where kind = 'duplicate_id_blocked'), 'a duplicate ID is logged');
select pg_temp.check((select not id_verified or true from public.profiles where id = 'a2a2a2a2-0000-0000-0000-000000000002') and (select count(*) = 0 from private.identity_fingerprints where user_id = 'a2a2a2a2-0000-0000-0000-000000000002'), 'a refused attempt leaves no fingerprint behind');
insert into public.banned_identifiers (kind, hash) values ('id_document', 'idhash-banned'), ('device', 'devhash-banned');
select pg_temp.check(pg_temp.as_role('service_role', null, $$select public.record_verification('a2a2a2a2-0000-0000-0000-000000000002', true, true, true, null, 'idhash-banned', null)$$) = 'banned_id', 'a banned ID document is refused');
select pg_temp.check(pg_temp.as_role('service_role', null, $$select public.record_verification('a2a2a2a2-0000-0000-0000-000000000002', true, true, true, null, null, 'devhash-banned')$$) = 'banned_device', 'a banned device is refused');
select pg_temp.check((select count(*) = 1 from public.security_events where kind = 'banned_id_blocked') and (select count(*) = 1 from public.security_events where kind = 'banned_device_blocked'), 'banned attempts are logged');
select pg_temp.fails_as('service_role', null, $$select public.record_verification('a2a2a2a2-0000-0000-0000-000000000002', true, true, true, 'someone-else/face.jpg', null, null)$$, 'a face photo from someone else''s folder');
select pg_temp.check((select count(*) = 2 from private.identity_fingerprints where user_id = 'a3a3a3a3-0000-0000-0000-000000000003') and
  (select bool_and(hash in ('idhash-newbie', 'devhash-1')) from private.identity_fingerprints where user_id = 'a3a3a3a3-0000-0000-0000-000000000003'), 'only one-way hashes are kept');
select pg_temp.fails_as('authenticated', 'a3a3a3a3-0000-0000-0000-000000000003', $$select count(*) from private.identity_fingerprints$$, 'a user read the identity hashes');

\echo '--- S8 legal acceptance: only the current version counts, and users cannot edit the list of versions'
select pg_temp.fails_as('authenticated', 'a3a3a3a3-0000-0000-0000-000000000003', $$insert into public.legal_acceptances (user_id, doc, version) values (auth.uid(), 'terms', '0.0.1')$$, 'accepting an old or invented version');
select pg_temp.fails_as('authenticated', 'a3a3a3a3-0000-0000-0000-000000000003', $$update public.legal_documents set current_version = '0.0.1'$$, 'a user changed the current version');
select pg_temp.check(pg_temp.as_role('anon', null, $$select count(*) from public.legal_documents$$)::bigint = 0, 'anon reads no legal versions (row security hides them)');
select pg_temp.check(pg_temp.count_as('a3a3a3a3-0000-0000-0000-000000000003', $$select count(*) from public.legal_documents$$) = 3, 'signed-in users read the three current versions');

\echo '--- S9 submit for review: every requirement is checked by the server'
select pg_temp.fails_as('anon', null, $$select public.submit_profile()$$, 'anon submitted a profile');
select pg_temp.fails_as('anon', null, $$select public.my_signup_state()$$, 'anon read a sign-up state');
-- a3 is an owner who is verified (S7) and has a pet (S6), but has no location or acceptances yet
update public.profiles set role = 'owner' where id = 'a3a3a3a3-0000-0000-0000-000000000003';
select pg_temp.check((pg_temp.as_role('authenticated', 'a3a3a3a3-0000-0000-0000-000000000003', $$select (public.my_signup_state() -> 'missing')::text$$))::jsonb ?& array['location', 'legal'], 'the state lists what is still missing');
select pg_temp.check(not ((pg_temp.as_role('authenticated', 'a3a3a3a3-0000-0000-0000-000000000003', $$select (public.my_signup_state() -> 'missing')::text$$))::jsonb ? 'pet'), 'a pet already added is not listed as missing');
select pg_temp.fails_as('authenticated', 'a3a3a3a3-0000-0000-0000-000000000003', $$select public.submit_profile()$$, 'submitting an incomplete profile');
select pg_temp.as_role('authenticated', 'a3a3a3a3-0000-0000-0000-000000000003', $$select public.set_my_location(28.5, 34.51, 'Masbat')$$);
select pg_temp.fails_as('authenticated', 'a3a3a3a3-0000-0000-0000-000000000003', $$select public.submit_profile()$$, 'submitting before accepting the legal documents');
select pg_temp.as_role('authenticated', 'a3a3a3a3-0000-0000-0000-000000000003', $$insert into public.legal_acceptances (user_id, doc, version) select auth.uid(), doc, current_version from public.legal_documents$$);
select pg_temp.check((pg_temp.as_role('authenticated', 'a3a3a3a3-0000-0000-0000-000000000003', $$select (public.my_signup_state() -> 'missing')::text$$)) = '[]', 'nothing is missing once every step is done');
select pg_temp.check((pg_temp.as_role('authenticated', 'a3a3a3a3-0000-0000-0000-000000000003', $$select public.submit_profile()::text$$)) = 'pending_review', 'a complete profile goes to review');
select pg_temp.check((select status = 'pending_review' from public.profiles where id = 'a3a3a3a3-0000-0000-0000-000000000003'), 'the status is pending_review');
select pg_temp.check((pg_temp.as_role('authenticated', 'a3a3a3a3-0000-0000-0000-000000000003', $$select public.submit_profile()::text$$)) = 'pending_review', 'submitting twice is harmless');
select pg_temp.check(pg_temp.count_as('a3a3a3a3-0000-0000-0000-000000000003', $$select count(*) from public.profile_cards$$) = 0, 'still pending review: still sees nobody');
select pg_temp.fails_as('authenticated', 'a2a2a2a2-0000-0000-0000-000000000002', $$select public.submit_profile()$$, 'an active person re-submitting');
-- a sitter needs a home photo, not a pet
insert into auth.users (id, phone, phone_confirmed_at) values ('a4a4a4a4-0000-0000-0000-000000000004', '201244444444', now());
update public.profiles set first_name = 'sitter', role = 'sitter' where id = 'a4a4a4a4-0000-0000-0000-000000000004';
select pg_temp.check(pg_temp.as_role('service_role', null, $$select public.record_verification('a4a4a4a4-0000-0000-0000-000000000004', true, true, true, null, 'idhash-sitter', null)$$) = 'ok', 'sitter verified');
select pg_temp.as_role('authenticated', 'a4a4a4a4-0000-0000-0000-000000000004', $$select public.set_my_location(28.49, 34.5)$$);
select pg_temp.as_role('authenticated', 'a4a4a4a4-0000-0000-0000-000000000004', $$insert into public.legal_acceptances (user_id, doc, version) select auth.uid(), doc, current_version from public.legal_documents$$);
select pg_temp.check((pg_temp.as_role('authenticated', 'a4a4a4a4-0000-0000-0000-000000000004', $$select (public.my_signup_state() -> 'missing')::text$$)) = '["home"]', 'a sitter with no pets only needs a home photo');
select pg_temp.fails_as('service_role', null, $$select public.attach_home_photo('a4a4a4a4-0000-0000-0000-000000000004', 'a4a4a4a4-0000-0000-0000-000000000004/home.jpg')$$, 'attaching a home photo that was never processed');
insert into storage.objects (bucket_id, name) values ('homes', 'a4a4a4a4-0000-0000-0000-000000000004/home.jpg');
select pg_temp.fails_as('service_role', null, $$select public.attach_home_photo('a3a3a3a3-0000-0000-0000-000000000003', 'a4a4a4a4-0000-0000-0000-000000000004/home.jpg')$$, 'attaching someone else''s home photo');
select pg_temp.fails_as('authenticated', 'a4a4a4a4-0000-0000-0000-000000000004', $$select public.attach_home_photo(auth.uid(), 'a4a4a4a4-0000-0000-0000-000000000004/home.jpg')$$, 'a user attached their own home photo directly');
select pg_temp.as_role('service_role', null, $$select public.attach_home_photo('a4a4a4a4-0000-0000-0000-000000000004', 'a4a4a4a4-0000-0000-0000-000000000004/home.jpg')$$);
select pg_temp.check((pg_temp.as_role('authenticated', 'a4a4a4a4-0000-0000-0000-000000000004', $$select public.submit_profile()::text$$)) = 'pending_review', 'a sitter with a home photo goes to review');

\echo '--- S10 once approved, the person gets in'
select public.admin_take_action('a3a3a3a3-0000-0000-0000-000000000003', 'approval', null, null, false, '[]', 'Welcome') is not null as approved_by_admin
  from (select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000004', false)) x;
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.check((select status = 'active' from public.profiles where id = 'a3a3a3a3-0000-0000-0000-000000000003'), 'an admin approval makes the profile active');
select pg_temp.check(pg_temp.count_as('a3a3a3a3-0000-0000-0000-000000000003', $$select count(*) from public.profile_cards where first_name = 'host'$$) = 1, 'after approval the person sees hosts');

\echo '--- S11 the role is fixed after submit'
select pg_temp.fails_as('authenticated', 'a3a3a3a3-0000-0000-0000-000000000003', $$update public.profiles set role = case role when 'owner' then 'sitter'::public.user_role else 'owner'::public.user_role end where id = 'a3a3a3a3-0000-0000-0000-000000000003'$$, 'an active person cannot switch role');

\echo 'signup assertions OK'
