-- Phase 3 assertions (profiles, pets, private vet details). Run AFTER the other assertion files on the same database,
-- with ON_ERROR_STOP=1. Any failed assertion stops the run with "ASSERT FAILED".
\set ON_ERROR_STOP 1
\i supabase/tests/helpers.sql

insert into auth.users (id, phone, phone_confirmed_at) values
  ('b1b1b1b1-0000-0000-0000-000000000001', '201277000001', now()),   -- an owner
  ('b2b2b2b2-0000-0000-0000-000000000002', '201277000002', now()),   -- a stranger, active
  ('b3b3b3b3-0000-0000-0000-000000000003', '201277000003', now());   -- someone still waiting for review
update public.profiles set first_name = 'Owner', status = 'active', face_verified = true, id_verified = true, is_adult = true where id = 'b1b1b1b1-0000-0000-0000-000000000001';
update public.profiles set first_name = 'Stranger', status = 'active', face_verified = true, id_verified = true, is_adult = true where id = 'b2b2b2b2-0000-0000-0000-000000000002';
insert into storage.objects (bucket_id, name) values ('pets', 'b1b1b1b1-0000-0000-0000-000000000001/p1.jpg'), ('pets', 'b1b1b1b1-0000-0000-0000-000000000001/p2.jpg');
insert into public.pets (id, owner_id, name, type, size, photo_paths) values
  ('b1b1b1b1-1111-0000-0000-000000000001', 'b1b1b1b1-0000-0000-0000-000000000001', 'Biscuit', 'dog', 'medium', array['b1b1b1b1-0000-0000-0000-000000000001/p1.jpg']);

\echo '--- P1 contact details cannot be hidden in public text'
select pg_temp.as_role('authenticated', 'b1b1b1b1-0000-0000-0000-000000000001', $$update public.profiles set bio = 'Call me on 0101 234 5678 or whatsapp, mona@example.com', area = 'Masbat' where id = 'b1b1b1b1-0000-0000-0000-000000000001'$$);
select pg_temp.check((select bio !~ '[0-9]{4}' and bio !~ 'example' and bio !~* 'whatsapp' from public.profiles where id = 'b1b1b1b1-0000-0000-0000-000000000001'), 'bio still holds a phone number, email or app name');
select pg_temp.check((select area = 'Masbat' from public.profiles where id = 'b1b1b1b1-0000-0000-0000-000000000001'), 'normal text is left alone');
select pg_temp.as_role('authenticated', 'b1b1b1b1-0000-0000-0000-000000000001', $$update public.pets set notes = 'Loves walks. Text +20 100 123 4567 for the vet' where id = 'b1b1b1b1-1111-0000-0000-000000000001'$$);
select pg_temp.check((select notes !~ '123 4567' and notes like 'Loves walks.%' from public.pets where id = 'b1b1b1b1-1111-0000-0000-000000000001'), 'pet notes still hold a phone number');
select pg_temp.check(public.mask_contact_text('Born 2019, weighs 12 kg, 3 years') = 'Born 2019, weighs 12 kg, 3 years', 'ordinary numbers were masked');
select pg_temp.check(public.mask_contact_text('010/1234/5678') !~ '[0-9]', 'a number split by slashes survived');
select pg_temp.check(public.mask_contact_text('010_1234_5678') !~ '[0-9]', 'a number split by underscores survived');
select pg_temp.check(public.mask_contact_text('010,1234,5678') !~ '[0-9]', 'a number split by commas survived');
select pg_temp.check(public.mask_contact_text(E'0101\n2345\n678') !~ '[0-9]', 'a number split over lines survived');
select pg_temp.check(public.mask_contact_text('٠١٠١٢٣٤٥٦٧٨') !~ '[0-9٠-٩]', 'an Arabic-digit number survived');
select pg_temp.check(public.mask_contact_text('۰۱۰۱۲۳۴۵۶۷۸') !~ '[0-9۰-۹]', 'a Persian-digit number survived');
select pg_temp.check(public.mask_contact_text('find me on instagram or signal or viber') !~* 'instagram|signal|viber', 'a messaging app name survived');
select pg_temp.check(public.mask_contact_text('mona at gmail dot com') !~* 'gmail', 'a spelled-out email survived');
select pg_temp.check(public.mask_contact_text('linktr.ee/mona and mona.co') !~* 'linktr|\.co', 'a link survived');
select pg_temp.check(public.mask_contact_text('انستجرام وفايبر') !~ 'انستجرام|فايبر', 'an Arabic app name survived');

\echo '--- P2 vet details are private to the owner'
select pg_temp.as_role('authenticated', 'b1b1b1b1-0000-0000-0000-000000000001', $$select public.set_pet_care('b1b1b1b1-1111-0000-0000-000000000001', 'Dr Samir', '0620000000', 'Gets anxious in storms')$$);
select pg_temp.check((select vet_name = 'Dr Samir' from private.pet_care where pet_id = 'b1b1b1b1-1111-0000-0000-000000000001'), 'vet details were not saved');
select pg_temp.check(pg_temp.as_role('authenticated', 'b1b1b1b1-0000-0000-0000-000000000001', $$select vet_name from public.get_my_pet_care('b1b1b1b1-1111-0000-0000-000000000001')$$) = 'Dr Samir', 'the owner cannot read their own vet details');
select pg_temp.fails_as('authenticated', 'b2b2b2b2-0000-0000-0000-000000000002', $$select * from public.get_my_pet_care('b1b1b1b1-1111-0000-0000-000000000001')$$, 'a stranger read vet details');
select pg_temp.fails_as('authenticated', 'b2b2b2b2-0000-0000-0000-000000000002', $$select * from private.pet_care$$, 'a stranger read the private table');
select pg_temp.fails_as('authenticated', 'b2b2b2b2-0000-0000-0000-000000000002', $$select public.set_pet_care('b1b1b1b1-1111-0000-0000-000000000001', 'Hacked', '1', '1')$$, 'a stranger changed vet details');
select pg_temp.fails_as('authenticated', 'b1b1b1b1-0000-0000-0000-000000000001', $$select * from private.pet_care$$, 'the owner read the private table directly');
select pg_temp.fails_as('anon', null, $$select * from public.get_my_pet_care('b1b1b1b1-1111-0000-0000-000000000001')$$, 'anon read vet details');
select pg_temp.fails_as('authenticated', 'b2b2b2b2-0000-0000-0000-000000000002', $$select * from public.get_pet_care(gen_random_uuid())$$, 'a stranger got vet details through a made-up booking');
select pg_temp.check(pg_temp.count_as('b2b2b2b2-0000-0000-0000-000000000002', $$select count(*) from public.pets where id = 'b1b1b1b1-1111-0000-0000-000000000001'$$) = 1, 'an active person cannot see the pet itself');
select pg_temp.check(pg_temp.count_as('b3b3b3b3-0000-0000-0000-000000000003', $$select count(*) from public.pets where id = 'b1b1b1b1-1111-0000-0000-000000000001'$$) = 0, 'someone waiting for review can see pets');

\echo '--- P3 a pet in a confirmed booking cannot be changed'
update public.pets set locked = true where id = 'b1b1b1b1-1111-0000-0000-000000000001';
select pg_temp.as_role('authenticated', 'b1b1b1b1-0000-0000-0000-000000000001', $$update public.pets set name = 'Renamed', size = 'large' where id = 'b1b1b1b1-1111-0000-0000-000000000001'$$);
select pg_temp.check((select name = 'Biscuit' and size = 'medium' from public.pets where id = 'b1b1b1b1-1111-0000-0000-000000000001'), 'a locked pet was edited');
select pg_temp.as_role('authenticated', 'b1b1b1b1-0000-0000-0000-000000000001', $$update public.pets set photo_paths = array['b1b1b1b1-0000-0000-0000-000000000001/p2.jpg'] where id = 'b1b1b1b1-1111-0000-0000-000000000001'$$);
select pg_temp.check((select photo_paths = array['b1b1b1b1-0000-0000-0000-000000000001/p1.jpg'] from public.pets where id = 'b1b1b1b1-1111-0000-0000-000000000001'), 'a locked pet got new photos');
select pg_temp.as_role('authenticated', 'b1b1b1b1-0000-0000-0000-000000000001', $$delete from public.pets where id = 'b1b1b1b1-1111-0000-0000-000000000001'$$);
select pg_temp.check(exists (select 1 from public.pets where id = 'b1b1b1b1-1111-0000-0000-000000000001'), 'a locked pet was deleted');
select pg_temp.fails_as('authenticated', 'b1b1b1b1-0000-0000-0000-000000000001', $$select public.set_pet_care('b1b1b1b1-1111-0000-0000-000000000001', 'Changed', '1', '1')$$, 'vet details of a locked pet were changed');
select pg_temp.check((select vet_name = 'Dr Samir' from private.pet_care where pet_id = 'b1b1b1b1-1111-0000-0000-000000000001'), 'vet details of a locked pet changed');
insert into storage.objects (bucket_id, name) values ('pets', 'b1b1b1b1-0000-0000-0000-000000000001/free.jpg');
-- Real Supabase refuses direct SQL deletes on storage.objects (it wants the Storage API), so the delete itself may raise;
-- either way the locked file must still be there, and the rule the delete policy uses must say "locked" only for it.
do $$ begin
  begin perform pg_temp.as_role('authenticated', 'b1b1b1b1-0000-0000-0000-000000000001', $q$delete from storage.objects where bucket_id = 'pets' and name = 'b1b1b1b1-0000-0000-0000-000000000001/p1.jpg'$q$);
  exception when others then null; end;
end $$;
select pg_temp.check(exists (select 1 from storage.objects where bucket_id = 'pets' and name = 'b1b1b1b1-0000-0000-0000-000000000001/p1.jpg'), 'a locked pet photo file was deleted');
select pg_temp.check(pg_temp.as_role('authenticated', 'b1b1b1b1-0000-0000-0000-000000000001', $$select public.photo_in_locked_pet('b1b1b1b1-0000-0000-0000-000000000001/p1.jpg')$$)::boolean, 'the delete rule does not see the locked pet photo as locked');
select pg_temp.check(not pg_temp.as_role('authenticated', 'b1b1b1b1-0000-0000-0000-000000000001', $$select public.photo_in_locked_pet('b1b1b1b1-0000-0000-0000-000000000001/free.jpg')$$)::boolean, 'a photo no locked pet uses was seen as locked');
select pg_temp.check((select count(*) = 1 from pg_policies where tablename = 'objects' and policyname = 'delete own files' and qual like '%photo_in_locked_pet%'), 'the storage delete rule does not check for locked pets');
select pg_temp.fails_as('anon', null, $$select public.get_pet_care(gen_random_uuid())$$, 'anon could reach get_pet_care');
select pg_temp.as_role('authenticated', 'b1b1b1b1-0000-0000-0000-000000000001', $$update public.pets set locked = false where id = 'b1b1b1b1-1111-0000-0000-000000000001'$$);
select pg_temp.check((select locked from public.pets where id = 'b1b1b1b1-1111-0000-0000-000000000001'), 'an owner unlocked their own pet');

\echo '--- P4 the profile card style is limited to the real choices'
select pg_temp.fails_as('authenticated', 'b1b1b1b1-0000-0000-0000-000000000001', $$update public.profiles set card_illustration = 'something-else' where id = 'b1b1b1b1-0000-0000-0000-000000000001'$$, 'a made-up illustration was accepted');
select pg_temp.fails_as('authenticated', 'b1b1b1b1-0000-0000-0000-000000000001', $$update public.profiles set card_background = 'rainbow' where id = 'b1b1b1b1-0000-0000-0000-000000000001'$$, 'a made-up background was accepted');
select pg_temp.as_role('authenticated', 'b1b1b1b1-0000-0000-0000-000000000001', $$update public.profiles set card_illustration = 'cat-mango', card_background = 'pattern' where id = 'b1b1b1b1-0000-0000-0000-000000000001'$$);
select pg_temp.check((select card_illustration = 'cat-mango' and card_background = 'pattern' from public.profiles where id = 'b1b1b1b1-0000-0000-0000-000000000001'), 'card style was not saved');
select pg_temp.check(pg_temp.count_as('b2b2b2b2-0000-0000-0000-000000000002', $$select count(*) from public.profile_cards where first_name = 'Owner' and card_illustration = 'cat-mango'$$) = 1, 'strangers do not see the chosen card');

\echo 'profile assertions OK'
