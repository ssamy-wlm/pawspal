-- PawsPal Dahab: initial schema
-- Every rule that matters is enforced here, not in the app.
-- Read docs/security.md before changing anything in this file.

create extension if not exists pgcrypto with schema extensions;

-- Private schema: never exposed through the API.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------- enums
create type public.user_role       as enum ('owner', 'sitter', 'both');
create type public.account_status  as enum ('pending_verification', 'pending_review', 'active', 'suspended', 'removed');
create type public.pet_type        as enum ('dog', 'cat', 'other');
create type public.pet_size        as enum ('small', 'medium', 'large');
create type public.stay_location   as enum ('sitter_home', 'owner_home');
create type public.cost_type       as enum ('paid', 'volunteer', 'swap');
create type public.booking_status  as enum ('requested', 'terms_agreed', 'confirmed', 'in_progress', 'completed', 'cancelled', 'disputed');
create type public.fee_status      as enum ('unpaid', 'paid', 'refunded', 'waived');
create type public.report_status   as enum ('new', 'in_review', 'resolved', 'dismissed');
create type public.action_type     as enum ('reminder', 'warning', 'suspension', 'removal', 'reinstatement', 'approval');
create type public.card_background as enum ('circles_teal', 'circles_orange', 'circles_sand', 'pattern', 'navy');
create type public.theme_pref      as enum ('system', 'light', 'navy');

-- ---------------------------------------------------------------- admins
create table public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;
-- No policies: only the service role and security-definer functions read it.

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- ---------------------------------------------------------------- profiles
create table public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  first_name        text check (char_length(first_name) between 1 and 40),
  role              public.user_role not null default 'both',
  bio               text check (char_length(bio) <= 600),
  area              text check (char_length(area) <= 60),
  approx_lat        double precision,
  approx_lng        double precision,
  face_photo_path   text,
  home_photo_path   text,
  card_illustration text not null default 'dog-biscuit'
                    check (card_illustration in ('dog-biscuit', 'cat-mango', 'cat-midnight', 'husky-storm')),
  card_background   public.card_background not null default 'circles_teal',
  theme             public.theme_pref not null default 'system',
  locale            text not null default 'en' check (locale in ('en', 'ar')),
  share_exact_pin   boolean not null default true,
  status            public.account_status not null default 'pending_verification',
  phone_verified    boolean not null default false,
  face_verified     boolean not null default false,
  id_verified       boolean not null default false,
  is_adult          boolean not null default false,
  rating_avg        numeric(2, 1),
  stays_count       integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
alter table public.profiles enable row level security;

create policy "read own profile" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_admin());

-- Users may only edit harmless columns. Status, verification flags, photos
-- and location change only through the functions below.
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (first_name, role, bio, area, card_illustration, card_background, theme, locale, share_exact_pin)
  on public.profiles to authenticated;
create policy "update own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create or replace function public.is_active(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = p_user and status = 'active');
$$;

-- ---------------------------------------------------------------- blocks
create table public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
alter table public.blocks enable row level security;
create policy "manage own blocks" on public.blocks
  for all to authenticated using (blocker_id = auth.uid()) with check (blocker_id = auth.uid());

create or replace function public.is_blocked_between(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.blocks
    where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a)
  );
$$;

-- Public card data: only active, unblocked people, only safe columns.
-- This view runs with its owner's rights on purpose, so it can show other
-- people's public columns while the table itself stays locked.
create view public.profile_cards as
  select p.id, p.first_name, p.role, p.bio, p.area, p.approx_lat, p.approx_lng,
         p.face_photo_path, p.home_photo_path, p.card_illustration, p.card_background,
         p.rating_avg, p.stays_count, p.created_at
  from public.profiles p
  where p.status = 'active'
    and auth.uid() is not null
    and not public.is_blocked_between(auth.uid(), p.id);
revoke all on public.profile_cards from anon;
grant select on public.profile_cards to authenticated;

-- ---------------------------------------------------------------- exact location (private)
create table private.locations (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  lat        double precision not null,
  lng        double precision not null,
  address    text check (char_length(address) <= 120),
  -- Secret per-user offset, random and stored only here. Kept when the pin moves,
  -- so averaging many updates can't reveal the exact point either.
  off_lat    double precision not null default (random() - 0.5),
  off_lng    double precision not null default (random() - 0.5),
  updated_at timestamptz not null default now()
);

create or replace function public.set_my_location(p_lat double precision, p_lng double precision, p_address text default null)
returns void language plpgsql security definer set search_path = public, private as $$
declare
  v_uid uuid := auth.uid();
  v_loc private.locations;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  -- Egypt bounding box. Launch area is Dahab; widen when new towns open.
  if p_lat not between 22 and 32 or p_lng not between 24 and 37 then
    raise exception 'location outside the service area';
  end if;

  insert into private.locations (user_id, lat, lng, address, updated_at)
  values (v_uid, p_lat, p_lng, p_address, now())
  on conflict (user_id) do update set lat = excluded.lat, lng = excluded.lng,
    address = excluded.address, updated_at = now()      -- offsets deliberately unchanged
  returning * into v_loc;

  -- Public point = exact point + secret offset (about +/-300 m), rounded to ~100 m.
  update public.profiles
     set approx_lat = round((p_lat + v_loc.off_lat * 0.0054)::numeric, 3),
         approx_lng = round((p_lng + v_loc.off_lng * 0.0062)::numeric, 3),
         updated_at = now()
   where id = v_uid;
end $$;

-- ---------------------------------------------------------------- pets
create table public.pets (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 30),
  type        public.pet_type not null,
  size        public.pet_size not null,
  age_years   smallint check (age_years between 0 and 40),
  vaccinated  boolean not null default false,
  notes       text check (char_length(notes) <= 600),
  photo_paths text[] not null check (cardinality(photo_paths) between 1 and 8),
  locked      boolean not null default false,
  created_at  timestamptz not null default now()
);
alter table public.pets enable row level security;
create policy "read pets of active users" on public.pets
  for select to authenticated using (
    owner_id = auth.uid() or public.is_admin()
    or (public.is_active(owner_id) and not public.is_blocked_between(auth.uid(), owner_id))
  );
create policy "insert own pets" on public.pets
  for insert to authenticated with check (owner_id = auth.uid() and locked = false);
create policy "update own unlocked pets" on public.pets
  for update to authenticated using (owner_id = auth.uid() and locked = false)
  with check (owner_id = auth.uid() and locked = false);
create policy "delete own unlocked pets" on public.pets
  for delete to authenticated using (owner_id = auth.uid() and locked = false);

-- Vet and care details: private, shown only to a confirmed booking partner.
create table private.pet_care (
  pet_id     uuid primary key references public.pets (id) on delete cascade,
  vet_name   text check (char_length(vet_name) <= 80),
  vet_phone  text check (char_length(vet_phone) <= 30),
  care_notes text check (char_length(care_notes) <= 1500)
);

create or replace function public.set_pet_care(p_pet uuid, p_vet_name text, p_vet_phone text, p_care_notes text)
returns void language plpgsql security definer set search_path = public, private as $$
begin
  if not exists (select 1 from public.pets where id = p_pet and owner_id = auth.uid()) then
    raise exception 'not your pet';
  end if;
  insert into private.pet_care (pet_id, vet_name, vet_phone, care_notes)
  values (p_pet, p_vet_name, p_vet_phone, p_care_notes)
  on conflict (pet_id) do update set vet_name = excluded.vet_name,
    vet_phone = excluded.vet_phone, care_notes = excluded.care_notes;
end $$;

-- ---------------------------------------------------------------- availability
create table public.availability (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  starts_on       date not null,
  ends_on         date not null,
  pets_accepted   public.pet_type[] not null check (cardinality(pets_accepted) >= 1),
  offers          text[] not null default '{}'
                  check (offers <@ array['volunteer', 'swap', 'paid', 'food_provided', 'stay_at_my_place']),
  price_per_night integer check (price_per_night between 0 and 100000),
  negotiable      boolean not null default false,
  created_at      timestamptz not null default now(),
  check (ends_on >= starts_on),
  check (ends_on - starts_on <= 60)
);
alter table public.availability enable row level security;
create policy "read active listings" on public.availability
  for select to authenticated using (
    user_id = auth.uid()
    or (public.is_active(user_id) and not public.is_blocked_between(auth.uid(), user_id))
  );
create policy "write own listings when active" on public.availability
  for insert to authenticated with check (user_id = auth.uid() and public.is_active(auth.uid()) and starts_on >= current_date);
create policy "update own listings" on public.availability
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_active(auth.uid()));
create policy "delete own listings" on public.availability
  for delete to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------- bookings
create table public.bookings (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null references public.profiles (id),
  sitter_id          uuid not null references public.profiles (id),
  pet_id             uuid not null references public.pets (id),
  starts_on          date not null,
  ends_on            date not null,
  stay_location      public.stay_location not null default 'sitter_home',
  cost_type          public.cost_type not null default 'paid',
  price_per_night    integer check (price_per_night between 0 and 100000),
  food_provided      boolean not null default false,
  status             public.booking_status not null default 'requested',
  fee_status         public.fee_status not null default 'unpaid',
  owner_accepted_at  timestamptz,
  sitter_accepted_at timestamptz,
  confirmed_at       timestamptz,
  cancelled_by       uuid,
  created_at         timestamptz not null default now(),
  check (owner_id <> sitter_id),
  check (ends_on >= starts_on),
  check (ends_on - starts_on <= 60)
);
alter table public.bookings enable row level security;
revoke insert, update, delete on public.bookings from anon, authenticated;

create policy "participants read bookings" on public.bookings
  for select to authenticated using (auth.uid() in (owner_id, sitter_id) or public.is_admin());

create or replace function public.request_booking(
  p_sitter uuid, p_pet uuid, p_starts date, p_ends date,
  p_location public.stay_location, p_cost public.cost_type, p_price integer, p_food boolean
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_active(auth.uid()) or not public.is_active(p_sitter) then
    raise exception 'both accounts must be active';
  end if;
  if public.is_blocked_between(auth.uid(), p_sitter) then raise exception 'not allowed'; end if;
  if not exists (select 1 from public.pets where id = p_pet and owner_id = auth.uid()) then
    raise exception 'not your pet';
  end if;
  if p_starts < current_date or p_ends < p_starts or p_ends - p_starts > 60 then
    raise exception 'invalid dates';
  end if;
  insert into public.bookings (owner_id, sitter_id, pet_id, starts_on, ends_on, stay_location, cost_type, price_per_night, food_provided)
  values (auth.uid(), p_sitter, p_pet, p_starts, p_ends, p_location, p_cost,
          case when p_cost = 'paid' then p_price else null end, coalesce(p_food, false))
  returning id into v_id;
  return v_id;
end $$;

-- Either side may change the terms while not confirmed; any change clears both acceptances.
create or replace function public.propose_terms(
  p_booking uuid, p_starts date, p_ends date, p_location public.stay_location,
  p_cost public.cost_type, p_price integer, p_food boolean
) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_starts < current_date or p_ends < p_starts or p_ends - p_starts > 60 then
    raise exception 'invalid dates';
  end if;
  update public.bookings
     set starts_on = p_starts, ends_on = p_ends, stay_location = p_location, cost_type = p_cost,
         price_per_night = case when p_cost = 'paid' then p_price else null end,
         food_provided = coalesce(p_food, false),
         owner_accepted_at = null, sitter_accepted_at = null, status = 'requested'
   where id = p_booking and auth.uid() in (owner_id, sitter_id) and status in ('requested', 'terms_agreed');
  if not found then raise exception 'booking cannot be changed'; end if;
end $$;

create or replace function public.accept_terms(p_booking uuid)
returns public.booking_status language plpgsql security definer set search_path = public as $$
declare b public.bookings;
begin
  select * into b from public.bookings where id = p_booking for update;
  if b.id is null or auth.uid() not in (b.owner_id, b.sitter_id) then raise exception 'not found'; end if;
  if b.status not in ('requested', 'terms_agreed') then raise exception 'booking is not open'; end if;
  if auth.uid() = b.owner_id then
    update public.bookings set owner_accepted_at = now() where id = p_booking;
  else
    update public.bookings set sitter_accepted_at = now() where id = p_booking;
  end if;
  update public.bookings set status = 'terms_agreed'
   where id = p_booking and owner_accepted_at is not null and sitter_accepted_at is not null;
  select status into b.status from public.bookings where id = p_booking;
  return b.status;   -- the app now starts the booking-fee payment
end $$;

-- Called ONLY by the payment webhook (service role). Never callable from the app.
create or replace function public.confirm_booking_payment(p_booking uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.bookings
     set fee_status = 'paid', status = 'confirmed', confirmed_at = now()
   where id = p_booking and status = 'terms_agreed' and fee_status = 'unpaid';
  if not found then raise exception 'booking not payable'; end if;
  update public.pets set locked = true
   where id = (select pet_id from public.bookings where id = p_booking);
end $$;
revoke execute on function public.confirm_booking_payment(uuid) from public, anon, authenticated;
grant execute on function public.confirm_booking_payment(uuid) to service_role;

create or replace function public.cancel_booking(p_booking uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.bookings set status = 'cancelled', cancelled_by = auth.uid()
   where id = p_booking and auth.uid() in (owner_id, sitter_id)
     and status in ('requested', 'terms_agreed', 'confirmed');
  if not found then raise exception 'booking cannot be cancelled'; end if;
  update public.pets set locked = false
   where id = (select pet_id from public.bookings where id = p_booking)
     and not exists (select 1 from public.bookings x
                     where x.pet_id = pets.id and x.id <> p_booking and x.status in ('confirmed', 'in_progress'));
  -- Refund rules (docs/legal/terms-of-service.md section 6) are applied by the
  -- payments edge function, which reads cancelled_by and the dates.
  insert into public.security_events (user_id, kind, details)
  values (auth.uid(), 'booking_cancelled', jsonb_build_object('booking', p_booking, 'reason', left(p_reason, 300)));
end $$;

-- Exact location of the place where the pet stays, for a confirmed, paid booking only.
create or replace function public.get_booking_location(p_booking uuid)
returns table (lat double precision, lng double precision, address text)
language plpgsql stable security definer set search_path = public, private as $$
declare b public.bookings; v_host uuid;
begin
  select * into b from public.bookings where id = p_booking;
  if b.id is null or auth.uid() not in (b.owner_id, b.sitter_id) then raise exception 'not found'; end if;
  if b.status not in ('confirmed', 'in_progress') or b.fee_status <> 'paid' then
    raise exception 'location is released after the booking is confirmed and paid';
  end if;
  v_host := case when b.stay_location = 'sitter_home' then b.sitter_id else b.owner_id end;
  if not (select share_exact_pin from public.profiles where id = v_host) then
    raise exception 'the host chose not to share an exact pin';
  end if;
  return query select l.lat, l.lng, l.address from private.locations l where l.user_id = v_host;
end $$;

create or replace function public.get_pet_care(p_booking uuid)
returns table (vet_name text, vet_phone text, care_notes text)
language plpgsql stable security definer set search_path = public, private as $$
declare b public.bookings;
begin
  select * into b from public.bookings where id = p_booking;
  if b.id is null or auth.uid() not in (b.owner_id, b.sitter_id) or b.status not in ('confirmed', 'in_progress') then
    raise exception 'not available';
  end if;
  return query select c.vet_name, c.vet_phone, c.care_notes from private.pet_care c where c.pet_id = b.pet_id;
end $$;

create or replace function public.has_paid_booking(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.bookings
    where fee_status = 'paid' and status in ('confirmed', 'in_progress', 'completed')
      and ((owner_id = a and sitter_id = b) or (owner_id = b and sitter_id = a))
  );
$$;

-- ---------------------------------------------------------------- security events
create table public.security_events (
  id         bigint generated always as identity primary key,
  user_id    uuid references public.profiles (id) on delete set null,
  kind       text not null,
  details    jsonb not null default '{}',
  created_at timestamptz not null default now()
);
alter table public.security_events enable row level security;
revoke insert, update, delete on public.security_events from anon, authenticated;
create policy "admins read security events" on public.security_events
  for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------- chat
create table public.conversations (
  id         uuid primary key default gen_random_uuid(),
  user_a     uuid not null references public.profiles (id) on delete cascade,
  user_b     uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  check (user_a < user_b),
  unique (user_a, user_b)
);
alter table public.conversations enable row level security;
revoke insert, update, delete on public.conversations from anon, authenticated;
create policy "participants read conversations" on public.conversations
  for select to authenticated using (auth.uid() in (user_a, user_b) or public.is_admin());

create or replace function public.start_conversation(p_other uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_a uuid; v_b uuid; v_id uuid; v_new_today int;
begin
  if p_other = auth.uid() then raise exception 'invalid'; end if;
  if not public.is_active(auth.uid()) or not public.is_active(p_other) then raise exception 'both accounts must be active'; end if;
  if public.is_blocked_between(auth.uid(), p_other) then raise exception 'not allowed'; end if;
  v_a := least(auth.uid(), p_other); v_b := greatest(auth.uid(), p_other);
  select id into v_id from public.conversations where user_a = v_a and user_b = v_b;
  if v_id is not null then return v_id; end if;
  select count(*) into v_new_today from public.conversations
   where auth.uid() in (user_a, user_b) and created_at > now() - interval '1 day';
  if v_new_today >= 20 then raise exception 'daily limit for new conversations reached'; end if;
  insert into public.conversations (user_a, user_b) values (v_a, v_b) returning id into v_id;
  return v_id;
end $$;

create table public.messages (
  id              bigint generated always as identity primary key,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id       uuid not null references public.profiles (id) on delete cascade,
  body            text not null check (char_length(body) between 1 and 2000),
  masked          boolean not null default false,
  created_at      timestamptz not null default now()
);
create index on public.messages (conversation_id, created_at);
alter table public.messages enable row level security;
revoke update, delete on public.messages from anon, authenticated;
create policy "participants read messages" on public.messages
  for select to authenticated using (
    exists (select 1 from public.conversations c
            where c.id = conversation_id and (auth.uid() in (c.user_a, c.user_b) or public.is_admin()))
  );
create policy "participants send messages" on public.messages
  for insert to authenticated with check (
    sender_id = auth.uid() and public.is_active(auth.uid())
    and exists (select 1 from public.conversations c
                where c.id = conversation_id and auth.uid() in (c.user_a, c.user_b)
                  and not public.is_blocked_between(c.user_a, c.user_b))
  );

-- Hides phone numbers, emails, links, handles and payment apps until the pair
-- has a confirmed, paid booking. Dates and prices are left alone.
create or replace function public.mask_contact_info()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_other uuid;
  v_body  text := new.body;
  v_match text;
begin
  new.masked := false;  -- only this trigger may set it
  select case when c.user_a = new.sender_id then c.user_b else c.user_a end
    into v_other from public.conversations c where c.id = new.conversation_id;

  if public.has_paid_booking(new.sender_id, v_other) then
    return new;
  end if;

  -- Number runs (Latin or Arabic-Indic digits) with 9 or more digits.
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

  if v_body <> new.body then
    new.body := v_body;
    new.masked := true;
    insert into public.security_events (user_id, kind, details)
    values (new.sender_id, 'contact_info_masked', jsonb_build_object('conversation', new.conversation_id));
  end if;
  return new;
end $$;

create trigger mask_contact_before_insert
  before insert on public.messages
  for each row execute function public.mask_contact_info();

-- ---------------------------------------------------------------- handover photos
create table public.handover_photos (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid not null references public.bookings (id) on delete cascade,
  uploaded_by uuid not null references public.profiles (id),
  kind        text not null check (kind in ('dropoff', 'pickup')),
  photo_path  text not null,
  taken_at    timestamptz not null default now()
);
alter table public.handover_photos enable row level security;
create policy "participants read handover photos" on public.handover_photos
  for select to authenticated using (
    public.is_admin() or exists (select 1 from public.bookings b
      where b.id = booking_id and auth.uid() in (b.owner_id, b.sitter_id))
  );
create policy "participants add handover photos" on public.handover_photos
  for insert to authenticated with check (
    uploaded_by = auth.uid() and exists (select 1 from public.bookings b
      where b.id = booking_id and auth.uid() in (b.owner_id, b.sitter_id)
        and b.status in ('confirmed', 'in_progress'))
  );


-- Drop-off photo starts the stay; the owner completes it after the end date.
create or replace function public.start_stay_on_dropoff()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'dropoff' then
    update public.bookings set status = 'in_progress'
     where id = new.booking_id and status = 'confirmed';
  end if;
  return new;
end $$;
create trigger start_stay_after_dropoff after insert on public.handover_photos
  for each row execute function public.start_stay_on_dropoff();

create or replace function public.complete_booking(p_booking uuid)
returns void language plpgsql security definer set search_path = public as $$
declare b public.bookings;
begin
  select * into b from public.bookings where id = p_booking for update;
  if b.id is null or auth.uid() <> b.owner_id then raise exception 'only the owner can complete a stay'; end if;
  if b.status <> 'in_progress' or current_date < b.ends_on then raise exception 'stay is not finished'; end if;
  update public.bookings set status = 'completed' where id = p_booking;
  update public.pets set locked = false where id = b.pet_id
    and not exists (select 1 from public.bookings x where x.pet_id = b.pet_id and x.id <> b.id
                    and x.status in ('confirmed', 'in_progress'));
  update public.profiles p set stays_count = (select count(*) from public.bookings
         where status = 'completed' and p.id in (owner_id, sitter_id))
   where p.id in (b.owner_id, b.sitter_id);
end $$;

-- ---------------------------------------------------------------- reviews
create table public.reviews (
  id         uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  author_id  uuid not null references public.profiles (id) on delete cascade,
  subject_id uuid not null references public.profiles (id) on delete cascade,
  rating     smallint not null check (rating between 1 and 5),
  body       text check (char_length(body) <= 1000),
  created_at timestamptz not null default now(),
  unique (booking_id, author_id)
);
alter table public.reviews enable row level security;
revoke update, delete on public.reviews from anon, authenticated;
create policy "read reviews of active people" on public.reviews
  for select to authenticated using (
    public.is_admin() or auth.uid() in (author_id, subject_id)
    or (public.is_active(subject_id) and not public.is_blocked_between(auth.uid(), subject_id))
  );
create policy "review after a completed stay" on public.reviews
  for insert to authenticated with check (
    author_id = auth.uid() and exists (
      select 1 from public.bookings b
      where b.id = booking_id and b.status = 'completed'
        and current_date <= b.ends_on + 14
        and ((b.owner_id = auth.uid() and b.sitter_id = subject_id)
          or (b.sitter_id = auth.uid() and b.owner_id = subject_id))
    )
  );

create or replace function public.refresh_rating()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.profiles p
     set rating_avg = (select round(avg(rating)::numeric, 1) from public.reviews where subject_id = new.subject_id),
         stays_count = (select count(*) from public.bookings
                         where status = 'completed' and new.subject_id in (owner_id, sitter_id))
   where p.id = new.subject_id;
  return new;
end $$;
create trigger refresh_rating_after_review after insert on public.reviews
  for each row execute function public.refresh_rating();

-- ---------------------------------------------------------------- reports, actions, appeals, audit
create table public.reports (
  id              uuid primary key default gen_random_uuid(),
  reporter_id     uuid not null references public.profiles (id) on delete cascade,
  reported_id     uuid not null references public.profiles (id) on delete cascade,
  booking_id      uuid references public.bookings (id) on delete set null,
  conversation_id uuid references public.conversations (id) on delete set null,
  reason          text not null check (reason in ('off_app_payment', 'fake_photo', 'no_show', 'late_cancel',
                    'rude_or_harassment', 'animal_welfare', 'pet_mismatch', 'duplicate_account', 'safety', 'other')),
  details         text check (char_length(details) <= 2000),
  status          public.report_status not null default 'new',
  created_at      timestamptz not null default now(),
  check (reporter_id <> reported_id)
);
alter table public.reports enable row level security;
create policy "file a report" on public.reports
  for insert to authenticated with check (reporter_id = auth.uid() and status = 'new');
create policy "read own or admin" on public.reports
  for select to authenticated using (reporter_id = auth.uid() or public.is_admin());

create table public.enforcement_actions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  action        public.action_type not null,
  rule          text,
  duration_days integer check (duration_days in (3, 7)),
  until_fixed   boolean not null default false,
  checklist     jsonb not null default '[]',
  message       text check (char_length(message) <= 1000),
  admin_id      uuid not null references auth.users (id),
  created_at    timestamptz not null default now(),
  ends_at       timestamptz
);
alter table public.enforcement_actions enable row level security;
revoke insert, update, delete on public.enforcement_actions from anon, authenticated;
create policy "read own actions or admin" on public.enforcement_actions
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

create table public.appeals (
  id         uuid primary key default gen_random_uuid(),
  action_id  uuid not null references public.enforcement_actions (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 2000),
  status     public.report_status not null default 'new',
  created_at timestamptz not null default now()
);
alter table public.appeals enable row level security;
create policy "appeal own actions" on public.appeals
  for insert to authenticated with check (
    user_id = auth.uid() and status = 'new'
    and exists (select 1 from public.enforcement_actions a where a.id = action_id and a.user_id = auth.uid())
  );
create policy "read own appeals or admin" on public.appeals
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

create table public.audit_log (
  id          bigint generated always as identity primary key,
  admin_id    uuid not null,
  action      text not null,
  target_user uuid,
  details     jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
alter table public.audit_log enable row level security;
revoke insert, update, delete on public.audit_log from anon, authenticated;
create policy "admins read audit log" on public.audit_log
  for select to authenticated using (public.is_admin());

create or replace function public.admin_take_action(
  p_user uuid, p_action public.action_type, p_rule text, p_duration_days integer,
  p_until_fixed boolean, p_checklist jsonb, p_message text
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_status public.account_status;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  v_status := case p_action
    when 'suspension'    then 'suspended'
    when 'removal'       then 'removed'
    when 'reinstatement' then 'active'
    when 'approval'      then 'active'
    else null end;
  if v_status is not null then
    update public.profiles set status = v_status, updated_at = now() where id = p_user;
  end if;
  insert into public.enforcement_actions (user_id, action, rule, duration_days, until_fixed, checklist, message, admin_id, ends_at)
  values (p_user, p_action, p_rule, p_duration_days, coalesce(p_until_fixed, false), coalesce(p_checklist, '[]'),
          p_message, auth.uid(),
          case when p_duration_days is not null then now() + make_interval(days => p_duration_days) end)
  returning id into v_id;
  insert into public.audit_log (admin_id, action, target_user, details)
  values (auth.uid(), p_action::text, p_user,
          jsonb_build_object('rule', p_rule, 'duration_days', p_duration_days, 'until_fixed', p_until_fixed,
                             'checklist', p_checklist, 'action_id', v_id));
  return v_id;
end $$;

-- ---------------------------------------------------------------- verification (service role only)
create table public.banned_identifiers (
  kind       text not null check (kind in ('phone', 'id_document', 'device')),
  hash       text not null,
  created_at timestamptz not null default now(),
  primary key (kind, hash)
);
alter table public.banned_identifiers enable row level security;  -- no policies: service role only

create or replace function public.set_verification(p_user uuid, p_face boolean, p_id boolean, p_adult boolean, p_face_path text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.profiles
     set face_verified = coalesce(p_face, face_verified),
         id_verified   = coalesce(p_id, id_verified),
         is_adult      = coalesce(p_adult, is_adult),
         face_photo_path = coalesce(p_face_path, face_photo_path),
         updated_at = now()
   where id = p_user;
  -- When every check passes, the profile waits for a human review.
  update public.profiles set status = 'pending_review'
   where id = p_user and status = 'pending_verification'
     and phone_verified and face_verified and id_verified and is_adult;
end $$;
revoke execute on function public.set_verification(uuid, boolean, boolean, boolean, text) from public, anon, authenticated;
grant execute on function public.set_verification(uuid, boolean, boolean, boolean, text) to service_role;

-- New auth user -> profile row. Blocks banned phone numbers.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.phone is not null and exists (
    select 1 from public.banned_identifiers
    where kind = 'phone' and hash = encode(extensions.digest(new.phone, 'sha256'), 'hex')
  ) then
    raise exception 'sign-up not allowed';
  end if;
  insert into public.profiles (id, phone_verified) values (new.id, new.phone_confirmed_at is not null);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.handle_phone_confirmed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.phone_confirmed_at is not null and old.phone_confirmed_at is null then
    update public.profiles set phone_verified = true where id = new.id;
  end if;
  return new;
end $$;
create trigger on_auth_phone_confirmed after update on auth.users
  for each row execute function public.handle_phone_confirmed();

-- ---------------------------------------------------------------- legal acceptances
create table public.legal_acceptances (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  doc         text not null check (doc in ('privacy', 'terms', 'guidelines')),
  version     text not null,
  accepted_at timestamptz not null default now(),
  primary key (user_id, doc, version)
);
alter table public.legal_acceptances enable row level security;
revoke update, delete on public.legal_acceptances from anon, authenticated;
create policy "accept for yourself" on public.legal_acceptances
  for insert to authenticated with check (user_id = auth.uid());
create policy "read own acceptances" on public.legal_acceptances
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------- storage
insert into storage.buckets (id, name, public) values
  ('faces', 'faces', false), ('pets', 'pets', false), ('homes', 'homes', false), ('handovers', 'handovers', false)
on conflict (id) do nothing;

-- Upload only into your own folder: <bucket>/<user id>/<file>
create policy "upload to own folder" on storage.objects
  for insert to authenticated with check (
    bucket_id in ('faces', 'pets', 'homes', 'handovers')
    and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "delete own files" on storage.objects
  for delete to authenticated using (
    bucket_id in ('pets', 'homes') and (storage.foldername(name))[1] = auth.uid()::text
  );
-- Profile, pet and home photos: the owner and admins always; everyone else only once the
-- owner is approved (active) and not blocked. Served by signed URL.
create or replace function public.can_view_media_of(p_folder text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid;
begin
  begin
    v_owner := p_folder::uuid;
  exception when others then
    return false;
  end;
  return v_owner = auth.uid() or public.is_admin()
      or (public.is_active(v_owner) and not public.is_blocked_between(auth.uid(), v_owner));
end $$;
create policy "read media of approved people" on storage.objects
  for select to authenticated using (
    bucket_id in ('faces', 'pets', 'homes') and public.can_view_media_of((storage.foldername(name))[1])
  );
-- Handover photos: only the uploader here; the booking partner gets them through an edge function.
create policy "read own handover uploads" on storage.objects
  for select to authenticated using (
    bucket_id = 'handovers' and (storage.foldername(name))[1] = auth.uid()::text
  );
