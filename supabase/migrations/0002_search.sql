-- PawsPal Dahab: search ("book like Airbnb") and random browse.
-- Anyone with an availability post appears: dedicated sitters AND pet owners
-- who are happy to host. Exact matches rank first, close matches follow.

create or replace function public.search_stays(
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
           c.face_photo_path, c.rating_avg, c.stays_count,
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
         b.offers, b.pets_accepted, b.covers_dates, b.in_budget, round(b.distance_km::numeric, 1)::double precision,
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

-- Random browse ("swipe mode"): active hosts with current or upcoming availability, shuffled.
-- Optionally filtered by pet type. Combined mode = the app passes search results into the swipe deck.
create or replace function public.browse_random(p_pet_type public.pet_type default null, p_limit integer default 30)
returns table (
  availability_id uuid, user_id uuid, first_name text, area text, card_illustration text,
  card_background public.card_background, face_photo_path text, rating_avg numeric, stays_count integer,
  starts_on date, ends_on date, price_per_night integer, offers text[], pets_accepted public.pet_type[]
)
language sql volatile set search_path = public as $$
  select a.id, a.user_id, c.first_name, c.area, c.card_illustration, c.card_background, c.face_photo_path,
         c.rating_avg, c.stays_count, a.starts_on, a.ends_on, a.price_per_night, a.offers, a.pets_accepted
  from public.availability a
  join public.profile_cards c on c.id = a.user_id
  where a.user_id <> auth.uid()
    and a.ends_on >= current_date
    and (p_pet_type is null or p_pet_type = any (a.pets_accepted))
  order by random()
  limit least(greatest(p_limit, 1), 60);
$$;

revoke execute on function public.search_stays(date, date, public.pet_type, integer, integer, text[], boolean, double precision, double precision, double precision, integer) from anon;
revoke execute on function public.browse_random(public.pet_type, integer) from anon;
