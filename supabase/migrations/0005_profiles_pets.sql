-- 0005 (phase 3): profiles, pets and private vet details.
--   * contact details cannot be hidden in a bio, name, area or pet note (same masking as chat, always on)
--   * the owner can read back their own vet details; nobody else can
--   * vet details of a pet in a confirmed booking cannot be changed

-- ---------------------------------------------------------------- masking contact details in public text
-- Public text is read by everyone, so phone numbers, emails, links, handles and payment apps are always hidden.
-- (In chat they unlock once a booking is paid; here there is no such moment.)
create or replace function public.mask_contact_text(p_text text)
returns text language plpgsql immutable set search_path = public as $$
declare v text := p_text;
begin
  if v is null then return null; end if;
  -- Arabic-Indic digits become ordinary digits first, so one rule covers both.
  v := translate(v, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789');
  -- Nine or more digits in a row, even when split by a few spaces or symbols (010/1234/5678, 010_1234_5678, 010,1234,5678).
  v := regexp_replace(v, '[0-9]([^[:alpha:][:digit:]]{0,2}[0-9]){8,}', '•••', 'g');
  v := regexp_replace(v, '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '•••', 'g');
  v := regexp_replace(v, '(https?://[^ ]+|www\.[^ ]+|[A-Za-z0-9-]+\.(com|net|org|me|io|eg|ly|link|app|co|info|xyz|ee|ws|to|gl|be)(/[^ ]*)?)', '•••', 'gi');
  v := regexp_replace(v, '@[A-Za-z0-9_.]{3,}', '•••', 'g');
  v := regexp_replace(v,
    '(insta ?pay|whats ?app|wa\.me|telegram|vodafone ?cash|etisalat ?cash|orange ?cash|we ?pay|paypal|\m(instagram|insta|signal|viber|snapchat|facebook|messenger|tiktok|gmail|yahoo|hotmail|outlook|icloud)\M|انستا ?باي|واتس ?اب|واتساب|واتس|تليجرام|تيليجرام|تلجرام|تيليغرام|فودافون ?كاش|انستجرام|انستغرام|فايبر|سناب|فيسبوك|ماسنجر)',
    '•••', 'gi');
  return v;
end $$;

create or replace function public.mask_profile_text()
returns trigger language plpgsql as $$
begin
  new.first_name := public.mask_contact_text(new.first_name);
  new.bio := public.mask_contact_text(new.bio);
  new.area := public.mask_contact_text(new.area);
  return new;
end $$;
create trigger mask_profile_text_before_write before insert or update of first_name, bio, area on public.profiles
  for each row execute function public.mask_profile_text();

create or replace function public.mask_pet_text()
returns trigger language plpgsql as $$
begin
  new.name := public.mask_contact_text(new.name);
  new.notes := public.mask_contact_text(new.notes);
  return new;
end $$;
create trigger mask_pet_text_before_write before insert or update of name, notes on public.pets
  for each row execute function public.mask_pet_text();

-- ---------------------------------------------------------------- photos of a locked pet cannot be deleted
-- The pet's rows are locked while it is in a confirmed booking, but its photo FILES could still be deleted through the
-- storage API. Now a file that a locked pet uses cannot be deleted.
create or replace function public.photo_in_locked_pet(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.pets p where p.locked and p_name = any (p.photo_paths))
$$;
revoke execute on function public.photo_in_locked_pet(text) from public, anon;
grant execute on function public.photo_in_locked_pet(text) to authenticated;
drop policy "delete own files" on storage.objects;
create policy "delete own files" on storage.objects
  for delete to authenticated using (
    bucket_id in ('pets', 'homes') and (storage.foldername(name))[1] = auth.uid()::text
    and not public.photo_in_locked_pet(name)
  );

-- get_pet_care (phase 0) was callable by anyone signed out too (it refused, but should not be reachable at all).
revoke execute on function public.get_pet_care(uuid) from public, anon;
grant execute on function public.get_pet_care(uuid) to authenticated;

-- ---------------------------------------------------------------- private vet details
-- Owners cannot change a pet that is in a confirmed booking, and that includes its vet details.
create or replace function public.set_pet_care(p_pet uuid, p_vet_name text, p_vet_phone text, p_care_notes text)
returns void language plpgsql security definer set search_path = public, private as $$
declare v_pet public.pets;
begin
  select * into v_pet from public.pets where id = p_pet and owner_id = auth.uid();
  if v_pet.id is null then raise exception 'not your pet'; end if;
  if v_pet.locked then raise exception 'this pet is in a confirmed booking and cannot be changed'; end if;
  insert into private.pet_care (pet_id, vet_name, vet_phone, care_notes)
  values (p_pet, nullif(btrim(p_vet_name), ''), nullif(btrim(p_vet_phone), ''), nullif(btrim(p_care_notes), ''))
  on conflict (pet_id) do update set vet_name = excluded.vet_name,
    vet_phone = excluded.vet_phone, care_notes = excluded.care_notes;
end $$;

-- The owner reads their own pet's vet details back (to edit them). Nobody else can: partners get them through
-- get_pet_care(booking), and only while the booking is confirmed.
create or replace function public.get_my_pet_care(p_pet uuid)
returns table (vet_name text, vet_phone text, care_notes text)
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not exists (select 1 from public.pets where id = p_pet and owner_id = auth.uid()) then
    raise exception 'not your pet';
  end if;
  return query select c.vet_name, c.vet_phone, c.care_notes from private.pet_care c where c.pet_id = p_pet;
end $$;
revoke execute on function public.get_my_pet_care(uuid) from public, anon;
grant execute on function public.get_my_pet_care(uuid) to authenticated;
revoke execute on function public.set_pet_care(uuid, text, text, text) from public, anon;
grant execute on function public.set_pet_care(uuid, text, text, text) to authenticated;
