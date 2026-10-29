-- 0005 (phase 3): profiles, pets and private vet details.
--   * contact details cannot be hidden in a bio, name, area or pet note (same masking as chat, always on)
--   * the owner can read back their own vet details; nobody else can
--   * vet details of a pet in a confirmed booking cannot be changed

-- ---------------------------------------------------------------- masking contact details in public text
-- Public text is read by everyone, so phone numbers, emails, links, handles and payment apps are always hidden.
-- (In chat they unlock once a booking is paid; here there is no such moment.)
create or replace function public.mask_contact_text(p_text text)
returns text language plpgsql immutable set search_path = public as $$
declare
  v_body  text := p_text;
  v_match text;
begin
  if v_body is null then return null; end if;
  for v_match in
    select m[1] from regexp_matches(v_body, '(\+?[0-9٠-٩][0-9٠-٩ ().-]{6,}[0-9٠-٩])', 'g') as m
  loop
    if length(regexp_replace(v_match, '[^0-9٠-٩]', '', 'g')) >= 9 then
      v_body := replace(v_body, v_match, '•••');
    end if;
  end loop;
  v_body := regexp_replace(v_body, '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '•••', 'g');
  v_body := regexp_replace(v_body, '(https?://[^ ]+|www\.[^ ]+|[A-Za-z0-9-]+\.(com|net|org|me|io|eg|ly|link|app)(/[^ ]*)?)', '•••', 'gi');
  v_body := regexp_replace(v_body, '@[A-Za-z0-9_.]{3,}', '•••', 'g');
  v_body := regexp_replace(v_body,
    '(insta ?pay|whats ?app|wa\.me|telegram|vodafone ?cash|etisalat ?cash|orange ?cash|we ?pay|paypal|انستا ?باي|واتس ?اب|واتساب|تليجرام|فودافون ?كاش)',
    '•••', 'gi');
  return v_body;
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
