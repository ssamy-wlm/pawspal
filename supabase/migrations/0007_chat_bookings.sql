-- 0007 (phase 5): chat and bookings.
--   * swaps are two linked bookings ("I host yours, you host mine"); terms, acceptance and cancellation work on the pair
--   * safer booking requests (roles, no duplicates, limits)
--   * chat: the conversation list with unread counts, a message rate limit, stronger masking of contact details, realtime
--   * search results carry the home tags and the name of a pet that lives there (for the browse card chips)
--   * a service-only list of photo files nobody uses, for the clean-up job

-- ---------------------------------------------------------------- swaps are two linked bookings
alter table public.bookings add column swap_group uuid;
-- Bumped every time the terms change. Accepting names the version the person saw, so a last-second change by the other
-- side can never be accepted by mistake.
alter table public.bookings add column terms_version integer not null default 1;
create index on public.bookings (swap_group) where swap_group is not null;

-- Everything below runs on one booking or on both legs of a swap.
create or replace function public.booking_legs(p_booking uuid)
returns setof public.bookings language sql stable security definer set search_path = public as $$
  select b.* from public.bookings b
   where b.id = p_booking
      or (b.swap_group is not null and b.swap_group = (select x.swap_group from public.bookings x where x.id = p_booking));
$$;
revoke execute on function public.booking_legs(uuid) from public, anon, authenticated;


-- Locks every leg of a booking, always in the same order, so two people acting at once cannot deadlock.
create or replace function public.lock_booking_legs(p_booking uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform 1 from public.bookings where id in (select id from public.booking_legs(p_booking)) order by id for update;
end $$;
revoke execute on function public.lock_booking_legs(uuid) from public, anon, authenticated;

-- Is this pet free for these dates? A pet in another confirmed (or running) booking is not.
create or replace function public.pet_is_free(p_pet uuid, p_starts date, p_ends date, p_ignore uuid[] default '{}')
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (
    select 1 from public.bookings x
     where x.pet_id = p_pet and x.status in ('confirmed', 'in_progress') and not (x.id = any (p_ignore))
       and daterange(x.starts_on, x.ends_on, '[]') && daterange(p_starts, p_ends, '[]'));
$$;
revoke execute on function public.pet_is_free(uuid, date, date, uuid[]) from public, anon, authenticated;

create or replace function public.request_booking(
  p_sitter uuid, p_pet uuid, p_starts date, p_ends date,
  p_location public.stay_location, p_cost public.cost_type, p_price integer, p_food boolean
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_cost = 'swap' then raise exception 'use request_swap for a swap'; end if;
  if not public.is_active(auth.uid()) or not public.is_active(p_sitter) then
    raise exception 'both accounts must be active';
  end if;
  if p_sitter = auth.uid() or public.is_blocked_between(auth.uid(), p_sitter) then raise exception 'not allowed'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and role in ('owner', 'both'))
     or not exists (select 1 from public.profiles where id = p_sitter and role in ('sitter', 'both')) then
    raise exception 'the roles do not fit a booking';
  end if;
  if not exists (select 1 from public.pets where id = p_pet and owner_id = auth.uid()) then
    raise exception 'not your pet';
  end if;
  if p_starts < current_date or p_ends < p_starts or p_ends - p_starts > 60 then
    raise exception 'invalid dates';
  end if;
  if p_cost = 'paid' and (p_price is null or p_price < 0 or p_price > 100000) then raise exception 'invalid price'; end if;
  perform pg_advisory_xact_lock(hashtext('booking:' || auth.uid()::text));
  if not public.pet_is_free(p_pet, p_starts, p_ends) then raise exception 'that pet is already booked for these dates'; end if;
  if (select count(*) from public.bookings where (owner_id = auth.uid() or sitter_id = auth.uid()) and status in ('requested', 'terms_agreed')) >= 10 then
    raise exception 'too many open requests';
  end if;
  if exists (select 1 from public.bookings where owner_id = auth.uid() and sitter_id = p_sitter and pet_id = p_pet
              and status in ('requested', 'terms_agreed') and daterange(starts_on, ends_on, '[]') && daterange(p_starts, p_ends, '[]')) then
    raise exception 'there is already a request for these dates';
  end if;
  insert into public.bookings (owner_id, sitter_id, pet_id, starts_on, ends_on, stay_location, cost_type, price_per_night, food_provided)
  values (auth.uid(), p_sitter, p_pet, p_starts, p_ends, p_location, p_cost,
          case when p_cost = 'paid' then p_price else null end, coalesce(p_food, false))
  returning id into v_id;
  return v_id;
end $$;

-- A swap: my pet stays with them on my dates, their pet stays with me on theirs. Both people must be owners and hosts.
create or replace function public.request_swap(
  p_other uuid, p_my_pet uuid, p_their_pet uuid,
  p_my_starts date, p_my_ends date, p_their_starts date, p_their_ends date, p_food boolean
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_group uuid := gen_random_uuid();
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not public.is_active(auth.uid()) or not public.is_active(p_other) then raise exception 'both accounts must be active'; end if;
  if p_other = auth.uid() or public.is_blocked_between(auth.uid(), p_other) then raise exception 'not allowed'; end if;
  if (select count(*) from public.profiles where id in (auth.uid(), p_other) and role = 'both') <> 2 then
    raise exception 'a swap needs two people who both host and own pets';
  end if;
  if not exists (select 1 from public.pets where id = p_my_pet and owner_id = auth.uid())
     or not exists (select 1 from public.pets where id = p_their_pet and owner_id = p_other) then
    raise exception 'pets do not match';
  end if;
  if p_my_starts < current_date or p_my_ends < p_my_starts or p_my_ends - p_my_starts > 60
     or p_their_starts < current_date or p_their_ends < p_their_starts or p_their_ends - p_their_starts > 60 then
    raise exception 'invalid dates';
  end if;
  perform pg_advisory_xact_lock(hashtext('booking:' || auth.uid()::text));
  if not public.pet_is_free(p_my_pet, p_my_starts, p_my_ends) or not public.pet_is_free(p_their_pet, p_their_starts, p_their_ends) then
    raise exception 'that pet is already booked for these dates';
  end if;
  if (select count(*) from public.bookings where (owner_id = auth.uid() or sitter_id = auth.uid()) and status in ('requested', 'terms_agreed')) >= 10 then
    raise exception 'too many open requests';
  end if;
  insert into public.bookings (owner_id, sitter_id, pet_id, starts_on, ends_on, stay_location, cost_type, food_provided, swap_group)
  values (auth.uid(), p_other, p_my_pet, p_my_starts, p_my_ends, 'sitter_home', 'swap', coalesce(p_food, false), v_group),
         (p_other, auth.uid(), p_their_pet, p_their_starts, p_their_ends, 'sitter_home', 'swap', coalesce(p_food, false), v_group);
  return v_group;
end $$;

-- Either side may change the terms of one leg while nothing is confirmed. Any change clears BOTH acceptances, on both legs,
-- and starts a new version of the terms.
create or replace function public.propose_terms(
  p_booking uuid, p_starts date, p_ends date, p_location public.stay_location,
  p_cost public.cost_type, p_price integer, p_food boolean
) returns void language plpgsql security definer set search_path = public as $$
declare b public.bookings; v_other uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  perform public.lock_booking_legs(p_booking);
  select * into b from public.bookings where id = p_booking;
  if b.id is null or auth.uid() not in (b.owner_id, b.sitter_id) then raise exception 'booking cannot be changed'; end if;
  if b.status not in ('requested', 'terms_agreed') or b.fee_status <> 'unpaid' then raise exception 'booking cannot be changed'; end if;
  v_other := case when auth.uid() = b.owner_id then b.sitter_id else b.owner_id end;
  if not public.is_active(auth.uid()) or not public.is_active(v_other) or public.is_blocked_between(auth.uid(), v_other) then
    raise exception 'not allowed';
  end if;
  if p_starts < current_date or p_ends < p_starts or p_ends - p_starts > 60 then raise exception 'invalid dates'; end if;
  if p_cost = 'paid' and (p_price is null or p_price < 0 or p_price > 100000) then raise exception 'invalid price'; end if;
  if (b.swap_group is not null) <> (p_cost = 'swap') then raise exception 'a swap stays a swap, and nothing else becomes one'; end if;
  if b.swap_group is not null and p_location <> 'sitter_home' then raise exception 'in a swap each pet stays at the other person''s home'; end if;
  if not public.pet_is_free(b.pet_id, p_starts, p_ends, array[b.id]) then raise exception 'that pet is already booked for these dates'; end if;
  update public.bookings
     set starts_on = p_starts, ends_on = p_ends, stay_location = p_location,
         price_per_night = case when p_cost = 'paid' then p_price else null end,
         cost_type = p_cost, food_provided = coalesce(p_food, false)
   where id = p_booking;
  update public.bookings
     set owner_accepted_at = null, sitter_accepted_at = null, status = 'requested', terms_version = terms_version + 1
   where id in (select id from public.booking_legs(p_booking));
end $$;

-- Accepting names the version of the terms the person was looking at. If the terms changed in the meantime, it is refused.
drop function public.accept_terms(uuid);
create or replace function public.accept_terms(p_booking uuid, p_version integer)
returns public.booking_status language plpgsql security definer set search_path = public as $$
declare b public.bookings; v_status public.booking_status; v_other uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  perform public.lock_booking_legs(p_booking);
  select * into b from public.bookings where id = p_booking;
  if b.id is null or auth.uid() not in (b.owner_id, b.sitter_id) then raise exception 'not found'; end if;
  if b.status not in ('requested', 'terms_agreed') then raise exception 'booking is not open'; end if;
  v_other := case when auth.uid() = b.owner_id then b.sitter_id else b.owner_id end;
  if not public.is_active(auth.uid()) or not public.is_active(v_other) or public.is_blocked_between(auth.uid(), v_other) then
    raise exception 'not allowed';
  end if;
  if b.terms_version <> p_version then raise exception 'the terms changed'; end if;
  -- My acceptance counts on every leg I am part of (a swap has two).
  update public.bookings set owner_accepted_at = coalesce(owner_accepted_at, now())
   where id in (select id from public.booking_legs(p_booking)) and owner_id = auth.uid();
  update public.bookings set sitter_accepted_at = coalesce(sitter_accepted_at, now())
   where id in (select id from public.booking_legs(p_booking)) and sitter_id = auth.uid();
  update public.bookings set status = 'terms_agreed'
   where id in (select id from public.booking_legs(p_booking)) and owner_accepted_at is not null and sitter_accepted_at is not null;
  select status into v_status from public.bookings where id = p_booking;
  return v_status;
end $$;

-- Called ONLY by the payment webhook (service role). A swap is confirmed (and paid) as one. A pet that has meanwhile been
-- confirmed for the same dates somewhere else blocks it.
create or replace function public.confirm_booking_payment(p_booking uuid)
returns void language plpgsql security definer set search_path = public as $$
declare l record;
begin
  perform public.lock_booking_legs(p_booking);
  for l in select * from public.booking_legs(p_booking) loop
    if not public.pet_is_free(l.pet_id, l.starts_on, l.ends_on, array[l.id]) then raise exception 'that pet is already booked for these dates'; end if;
  end loop;
  update public.bookings
     set fee_status = 'paid', status = 'confirmed', confirmed_at = now()
   where id in (select id from public.booking_legs(p_booking)) and status = 'terms_agreed' and fee_status = 'unpaid';
  if not found then raise exception 'booking not payable'; end if;
  update public.pets set locked = true
   where id in (select pet_id from public.booking_legs(p_booking));
end $$;
revoke execute on function public.confirm_booking_payment(uuid) from public, anon, authenticated;
grant execute on function public.confirm_booking_payment(uuid) to service_role;

create or replace function public.cancel_booking(p_booking uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_pets uuid[];
begin
  perform public.lock_booking_legs(p_booking);
  select array_agg(pet_id) into v_pets from public.booking_legs(p_booking);
  update public.bookings set status = 'cancelled', cancelled_by = auth.uid()
   where id in (select id from public.booking_legs(p_booking)) and auth.uid() in (owner_id, sitter_id)
     and status in ('requested', 'terms_agreed', 'confirmed');
  if not found then raise exception 'booking cannot be cancelled'; end if;
  update public.pets p set locked = false
   where p.id = any (v_pets)
     and not exists (select 1 from public.bookings x where x.pet_id = p.id and x.status in ('confirmed', 'in_progress'));
  insert into public.security_events (user_id, kind, details)
  values (auth.uid(), 'booking_cancelled', jsonb_build_object('booking', p_booking, 'reason', left(p_reason, 300)));
end $$;

revoke execute on function public.request_booking(uuid, uuid, date, date, public.stay_location, public.cost_type, integer, boolean) from public, anon;
grant execute on function public.request_booking(uuid, uuid, date, date, public.stay_location, public.cost_type, integer, boolean) to authenticated;
revoke execute on function public.request_swap(uuid, uuid, uuid, date, date, date, date, boolean) from public, anon;
grant execute on function public.request_swap(uuid, uuid, uuid, date, date, date, date, boolean) to authenticated;
revoke execute on function public.propose_terms(uuid, date, date, public.stay_location, public.cost_type, integer, boolean) from public, anon;
grant execute on function public.propose_terms(uuid, date, date, public.stay_location, public.cost_type, integer, boolean) to authenticated;
revoke execute on function public.accept_terms(uuid, integer) from public, anon;
grant execute on function public.accept_terms(uuid, integer) to authenticated;
revoke execute on function public.cancel_booking(uuid, text) from public, anon;
grant execute on function public.cancel_booking(uuid, text) to authenticated;
revoke execute on function public.start_conversation(uuid) from public, anon;
grant execute on function public.start_conversation(uuid) to authenticated;

-- ---------------------------------------------------------------- better masking of phone numbers
-- Only things that look like PHONE NUMBERS are hidden, so dates, prices and lists of numbers in a negotiation survive
-- ("10/11/2026 12/11/2026", "1500 2000 2500", "10,11,12"). A run of digits counts as a phone number when it starts with a
-- group of three or more digits and is an Egyptian mobile (01x...), a landline-style number starting with 0, or has a +.
-- Arabic and Persian digits are read as ordinary digits. A message with no phone number in it is left exactly as written.
create or replace function public.mask_contact_text(p_text text)
returns text language plpgsql immutable set search_path = public as $$
declare
  v text := p_text;
  t text;
  m text;
  d text;
  fg text;
  hit boolean := false;
begin
  if v is null then return null; end if;
  t := translate(v, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789');
  for m in select x[1] from regexp_matches(t, '(\+?[0-9](?:[^[:alpha:][:digit:]]{0,2}[0-9]){8,})', 'g') as x loop
    d := regexp_replace(m, '[^0-9]', '', 'g');
    fg := (regexp_match(m, '^\+?([0-9]+)'))[1];
    if left(m, 1) = '+'
       or (length(fg) >= 3 and (d ~ '^01[0125][0-9]{8}' or d ~ '^201[0125][0-9]{8}$' or d ~ '^0[0-9]{8,11}$')) then
      t := replace(t, m, '•••');
      hit := true;
    end if;
  end loop;
  if hit then v := t; end if;
  v := regexp_replace(v, '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '•••', 'g');
  v := regexp_replace(v, '(https?://[^ ]+|www\.[^ ]+|[A-Za-z0-9-]+\.(com|net|org|me|io|eg|ly|link|app|co|info|xyz|ee|ws|to|gl|be)(/[^ ]*)?)', '•••', 'gi');
  v := regexp_replace(v, '@[A-Za-z0-9_.]{3,}', '•••', 'g');
  v := regexp_replace(v,
    '(insta ?pay|whats ?app|wa\.me|telegram|vodafone ?cash|etisalat ?cash|orange ?cash|we ?pay|paypal|\m(instagram|insta|signal|viber|snapchat|facebook|messenger|tiktok|gmail|yahoo|hotmail|outlook|icloud)\M|انستا ?باي|واتس ?اب|واتساب|واتس|تليجرام|تيليجرام|تلجرام|تيليغرام|فودافون ?كاش|انستجرام|انستغرام|فايبر|سناب|فيسبوك|ماسنجر)',
    '•••', 'gi');
  return v;
end $$;

-- ---------------------------------------------------------------- chat
-- Chat text is masked with the same, stronger rule as profiles (split numbers, Arabic digits, app names), until the two
-- people have a paid booking together.
create or replace function public.mask_contact_info()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_other uuid;
  v_body  text;
begin
  new.masked := false;  -- only this trigger may set it
  select case when c.user_a = new.sender_id then c.user_b else c.user_a end
    into v_other from public.conversations c where c.id = new.conversation_id;
  if public.has_paid_booking(new.sender_id, v_other) then return new; end if;
  v_body := public.mask_contact_text(new.body);
  if v_body <> new.body then
    new.body := v_body;
    new.masked := true;
    insert into public.security_events (user_id, kind, details)
    values (new.sender_id, 'contact_info_masked', jsonb_build_object('conversation', new.conversation_id));
  end if;
  return new;
end $$;

-- At most 20 messages a minute from one person.
create or replace function public.limit_message_rate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.created_at := now();      -- the server decides when a message was sent, never the app
  perform pg_advisory_xact_lock(hashtext('msg:' || new.sender_id::text));
  if (select count(*) from public.messages where sender_id = new.sender_id and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'slow down';
  end if;
  if btrim(new.body) = '' then raise exception 'empty message'; end if;
  return new;
end $$;
create trigger limit_message_rate_before_insert before insert on public.messages
  for each row execute function public.limit_message_rate();
revoke execute on function public.limit_message_rate() from public, anon, authenticated;

-- Where each person has read up to in each conversation.
create table public.conversation_reads (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  last_read_id    bigint not null default 0,
  primary key (conversation_id, user_id)
);
alter table public.conversation_reads enable row level security;
revoke insert, update, delete on public.conversation_reads from anon, authenticated;
create policy "read own read marks" on public.conversation_reads for select to authenticated using (user_id = auth.uid());

create or replace function public.mark_conversation_read(p_conversation uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.conversations c where c.id = p_conversation and auth.uid() in (c.user_a, c.user_b)) then
    raise exception 'not found';
  end if;
  insert into public.conversation_reads (conversation_id, user_id, last_read_id)
  values (p_conversation, auth.uid(), coalesce((select max(id) from public.messages where conversation_id = p_conversation), 0))
  on conflict (conversation_id, user_id) do update set last_read_id = excluded.last_read_id;
end $$;
revoke execute on function public.mark_conversation_read(uuid) from public, anon;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

-- My conversations, newest first, with the other person's card and how many messages I have not read.
-- People who are not active, or who are blocked either way, drop out of the list.
create or replace function public.my_conversations()
returns table (
  id uuid, other_id uuid, first_name text, card_illustration text, card_background public.card_background,
  last_body text, last_at timestamptz, last_mine boolean, unread integer
)
language sql stable security definer set search_path = public as $$
  select c.id, o.id, o.first_name, o.card_illustration, o.card_background,
         m.body, coalesce(m.created_at, c.created_at), coalesce(m.sender_id = auth.uid(), false),
         (select count(*)::int from public.messages x
           where x.conversation_id = c.id and x.sender_id <> auth.uid()
             and x.id > coalesce((select r.last_read_id from public.conversation_reads r where r.conversation_id = c.id and r.user_id = auth.uid()), 0))
  from public.conversations c
  join public.profile_cards o on o.id = case when c.user_a = auth.uid() then c.user_b else c.user_a end
  left join lateral (select x.body, x.created_at, x.sender_id from public.messages x where x.conversation_id = c.id order by x.id desc limit 1) m on true
  where auth.uid() in (c.user_a, c.user_b)
  order by coalesce(m.created_at, c.created_at) desc;
$$;
revoke execute on function public.my_conversations() from public, anon;
grant execute on function public.my_conversations() to authenticated;

-- Live updates: new messages and booking changes reach the people they belong to (row security still applies).
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.messages;
    alter publication supabase_realtime add table public.bookings;
  end if;
end $$;

-- ---------------------------------------------------------------- search results carry home tags and a resident pet
drop function public.search_stays(date, date, public.pet_type, integer, integer, text[], boolean, double precision, double precision, double precision, integer);
drop function public.browse_random(public.pet_type, integer);

create function public.search_stays(
  p_start         date,
  p_end           date,
  p_pet_type      public.pet_type,
  p_budget_min    integer default 0,
  p_budget_max    integer default null,      -- per night, EGP; null = any
  p_offers        text[] default '{}',       -- e.g. {'food_provided','swap'}; soft preference
  p_free_only     boolean default false,     -- only volunteer or swap stays
  p_near_lat      double precision default null,
  p_near_lng      double precision default null,
  p_max_km        double precision default 25,
  p_limit         integer default 50
)
returns table (
  availability_id uuid, user_id uuid, first_name text, area text,
  approx_lat double precision, approx_lng double precision,
  card_illustration text, card_background public.card_background,
  face_photo_path text, rating_avg numeric, stays_count integer,
  starts_on date, ends_on date, price_per_night integer, negotiable boolean,
  offers text[], pets_accepted public.pet_type[],
  home_tags text[], pet_name text,
  covers_dates boolean, in_budget boolean, distance_km double precision,
  match_score integer, match_label text
)
language sql stable set search_path = public as $$
  with params as (
    select greatest(p_start, current_date) as s, p_end as e,
           coalesce(p_budget_max, 1000000) as bmax, coalesce(p_budget_min, 0) as bmin
  ),
  base as (
    select a.*, c.first_name, c.area, c.approx_lat, c.approx_lng, c.card_illustration, c.card_background,
           c.face_photo_path, c.rating_avg, c.stays_count, c.home_tags,
           (select p2.name from public.pets p2 where p2.owner_id = a.user_id order by p2.created_at limit 1) as pet_name,
           (a.starts_on <= p.s and a.ends_on >= p.e)                                   as covers_dates,
           (least(a.ends_on, p.e) - greatest(a.starts_on, p.s))                         as overlap_days,
           (p.e - p.s)                                                                   as wanted_days,
           case
             when 'paid' = any (a.offers) and a.price_per_night is not null
               then a.price_per_night between p.bmin and p.bmax
             else true                                       -- volunteer / swap: always within budget
           end                                                                           as in_budget,
           case
             when p_near_lat is null or c.approx_lat is null then null
             else 6371 * 2 * asin(sqrt(
                    power(sin(radians(c.approx_lat - p_near_lat) / 2), 2)
                  + cos(radians(p_near_lat)) * cos(radians(c.approx_lat))
                  * power(sin(radians(c.approx_lng - p_near_lng) / 2), 2)))
           end                                                                           as distance_km,
           p.bmax
    from public.availability a
    join public.profile_cards c on c.id = a.user_id      -- active, not blocked, public columns only
    cross join params p
    where a.user_id <> auth.uid()
      and p_pet_type = any (a.pets_accepted)
      and a.ends_on >= p.s and a.starts_on <= p.e        -- at least some overlap
      and p.e >= p.s
      and (not p_free_only or a.offers && array['volunteer', 'swap'])
  )
  select b.id, b.user_id, b.first_name, b.area, b.approx_lat, b.approx_lng, b.card_illustration, b.card_background,
         b.face_photo_path, b.rating_avg, b.stays_count, b.starts_on, b.ends_on, b.price_per_night, b.negotiable,
         b.offers, b.pets_accepted, b.home_tags, b.pet_name, b.covers_dates, b.in_budget, round(b.distance_km::numeric, 1)::double precision,
         score.v,
         case when b.covers_dates and b.in_budget then 'Exact match' else 'Close match' end
  from base b
  cross join lateral (
    select (
        case when b.covers_dates then 50
             else (40 * greatest(b.overlap_days, 0) / greatest(b.wanted_days, 1)) end
      + case when b.in_budget then 25
             when b.negotiable then 15
             else 5 end
      + 5 * coalesce((select count(*) from unnest(p_offers) o where o = any (b.offers)), 0)
      + case when b.distance_km is null then 0
             else greatest(0, 10 - b.distance_km)::int end
      + coalesce(b.rating_avg, 0)::int
    )::int as v
  ) score
  where
    -- Close matches: slightly over budget (up to 20%) only if the host says "negotiable".
    (b.in_budget or (b.negotiable and b.price_per_night <= b.bmax * 1.2))
    and (b.distance_km is null or b.distance_km <= p_max_km)
  order by score.v desc, b.rating_avg desc nulls last, b.created_at desc
  limit least(greatest(p_limit, 1), 100);
$$;


create function public.browse_random(p_pet_type public.pet_type default null, p_limit integer default 30)
returns table (
  availability_id uuid, user_id uuid, first_name text, area text, card_illustration text,
  card_background public.card_background, face_photo_path text, rating_avg numeric, stays_count integer,
  starts_on date, ends_on date, price_per_night integer, offers text[], pets_accepted public.pet_type[],
  home_tags text[], pet_name text
)
language sql volatile set search_path = public as $$
  select a.id, a.user_id, c.first_name, c.area, c.card_illustration, c.card_background, c.face_photo_path,
         c.rating_avg, c.stays_count, a.starts_on, a.ends_on, a.price_per_night, a.offers, a.pets_accepted, c.home_tags,
         (select p2.name from public.pets p2 where p2.owner_id = a.user_id order by p2.created_at limit 1)
  from public.availability a
  join public.profile_cards c on c.id = a.user_id
  where a.user_id <> auth.uid()
    and a.ends_on >= current_date
    and (p_pet_type is null or p_pet_type = any (a.pets_accepted))
  order by random()
  limit least(greatest(p_limit, 1), 60);
$$;


revoke execute on function public.search_stays(date, date, public.pet_type, integer, integer, text[], boolean, double precision, double precision, double precision, integer) from public, anon;
grant execute on function public.search_stays(date, date, public.pet_type, integer, integer, text[], boolean, double precision, double precision, double precision, integer) to authenticated;
revoke execute on function public.browse_random(public.pet_type, integer) from public, anon;
grant execute on function public.browse_random(public.pet_type, integer) to authenticated;

-- ---------------------------------------------------------------- photo files nobody uses (for the clean-up job)
-- Uploads that were never saved: a raw file still in "incoming" after an hour, or a clean file in pets, homes or faces that
-- no pet or profile points to after a day. Service role only; the job deletes them through the Storage API.
create or replace function public.list_unused_uploads(p_older_than interval default interval '1 day')
returns table (bucket_id text, name text)
language sql stable security definer set search_path = public, storage as $$
  select o.bucket_id, o.name from storage.objects o
   where o.bucket_id = 'incoming' and o.created_at < now() - interval '1 hour'
  union all
  select o.bucket_id, o.name from storage.objects o
   where o.bucket_id = 'pets' and o.created_at < now() - p_older_than
     and not exists (select 1 from public.pets p where o.name = any (p.photo_paths))
  union all
  select o.bucket_id, o.name from storage.objects o
   where o.bucket_id = 'homes' and o.created_at < now() - p_older_than
     and not exists (select 1 from public.profiles p where p.home_photo_path = o.name)
  union all
  select o.bucket_id, o.name from storage.objects o
   where o.bucket_id = 'faces' and o.created_at < now() - p_older_than * 7      -- a selfie waits for identity review, so it gets a week
     and not exists (select 1 from public.profiles p where p.face_photo_path = o.name)
$$;
revoke execute on function public.list_unused_uploads(interval) from public, anon, authenticated;
grant execute on function public.list_unused_uploads(interval) to service_role;
