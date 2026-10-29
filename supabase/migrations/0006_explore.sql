-- 0006 (phase 4): Explore.
--   * shortlist (the swipe "like")
--   * owners post travel dates, hosts find them
--   * only the right role can post each kind of dates, and each person has a limit
--   * home tags on a host profile (garden, pet first aid, ...)

-- ---------------------------------------------------------------- home tags
alter table public.profiles add column home_tags text[] not null default '{}'
  check (cardinality(home_tags) <= 8
         and home_tags <@ array['garden', 'fenced_yard', 'pet_first_aid', 'experienced', 'has_own_pets', 'quiet_home',
                                'near_beach', 'air_conditioning', 'works_from_home', 'medication_ok']);
grant update (home_tags) on public.profiles to authenticated;

-- The public card gains the tags (a new column at the end keeps every existing grant and caller working).
create or replace view public.profile_cards as
  select p.id, p.first_name, p.role, p.bio, p.area, p.approx_lat, p.approx_lng,
         p.face_photo_path, p.home_photo_path, p.card_illustration, p.card_background,
         p.rating_avg, p.stays_count, p.created_at, p.home_tags
  from public.profiles p
  where p.status = 'active'
    and auth.uid() is not null
    and public.is_active(auth.uid())                 -- only active people see other people (migration 0003)
    and not public.is_blocked_between(auth.uid(), p.id);

-- ---------------------------------------------------------------- who may post which dates, and how many
create or replace function public.check_availability_post()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id = new.user_id and role in ('sitter', 'both')) then
    raise exception 'only hosts can post availability';
  end if;
  perform pg_advisory_xact_lock(hashtext('post:' || new.user_id::text));      -- parallel posts cannot both slip under the limit
  if tg_op = 'INSERT' and (select count(*) from public.availability where user_id = new.user_id and ends_on >= current_date) >= 10 then
    raise exception 'too many open posts';
  end if;
  return new;
end $$;
create trigger check_availability_post_before_insert before insert on public.availability
  for each row execute function public.check_availability_post();

-- ---------------------------------------------------------------- owners post their travel dates
create table public.travel_posts (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles (id) on delete cascade,
  pet_type         public.pet_type not null,
  starts_on        date not null,
  ends_on          date not null,
  budget_per_night integer check (budget_per_night between 0 and 100000),   -- null = flexible
  note             text check (char_length(note) <= 200),
  created_at       timestamptz not null default now(),
  check (ends_on >= starts_on),
  check (ends_on - starts_on <= 60)
);
alter table public.travel_posts enable row level security;
create policy "read active travel posts" on public.travel_posts
  for select to authenticated using (
    user_id = auth.uid()
    or (public.is_active(user_id) and public.is_active(auth.uid()) and not public.is_blocked_between(auth.uid(), user_id))
  );
create policy "write own travel posts when active" on public.travel_posts
  for insert to authenticated with check (user_id = auth.uid() and public.is_active(auth.uid()) and starts_on >= current_date);
create policy "update own travel posts" on public.travel_posts
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_active(auth.uid()));
create policy "delete own travel posts" on public.travel_posts
  for delete to authenticated using (user_id = auth.uid());

create or replace function public.check_travel_post()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id = new.user_id and role in ('owner', 'both')) then
    raise exception 'only pet owners can post travel dates';
  end if;
  perform pg_advisory_xact_lock(hashtext('post:' || new.user_id::text));
  if tg_op = 'UPDATE' and new.starts_on < current_date and new.starts_on is distinct from old.starts_on then
    raise exception 'dates cannot be moved into the past';
  end if;
  if tg_op = 'INSERT' and (select count(*) from public.travel_posts where user_id = new.user_id and ends_on >= current_date) >= 5 then
    raise exception 'too many open posts';
  end if;
  new.note := public.mask_contact_text(new.note);      -- public text: no phone numbers or links
  return new;
end $$;
create trigger check_travel_post_before_write before insert or update on public.travel_posts
  for each row execute function public.check_travel_post();

-- Hosts browse owners who are travelling. Only active, unblocked owners; never yourself.
create or replace function public.browse_travellers(p_pet_type public.pet_type default null, p_limit integer default 30)
returns table (
  post_id uuid, user_id uuid, first_name text, area text, card_illustration text, card_background public.card_background,
  pet_type public.pet_type, starts_on date, ends_on date, budget_per_night integer, note text
)
language sql stable set search_path = public as $$
  select t.id, t.user_id, c.first_name, c.area, c.card_illustration, c.card_background,
         t.pet_type, t.starts_on, t.ends_on, t.budget_per_night, t.note
  from public.travel_posts t
  join public.profile_cards c on c.id = t.user_id
  where t.user_id <> auth.uid()
    and public.is_active(auth.uid())
    and t.ends_on >= current_date
    and (p_pet_type is null or t.pet_type = p_pet_type)
  order by t.starts_on
  limit least(greatest(p_limit, 1), 60);
$$;
revoke execute on function public.browse_travellers(public.pet_type, integer) from public, anon;
grant execute on function public.browse_travellers(public.pet_type, integer) to authenticated;

-- ---------------------------------------------------------------- shortlist (the swipe "like")
create table public.shortlist (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  host_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, host_id),
  check (user_id <> host_id)
);
alter table public.shortlist enable row level security;
create policy "read own shortlist" on public.shortlist for select to authenticated using (user_id = auth.uid());
create policy "shortlist active hosts" on public.shortlist
  for insert to authenticated with check (
    user_id = auth.uid() and public.is_active(auth.uid()) and public.is_active(host_id)
    and not public.is_blocked_between(auth.uid(), host_id)
  );
create policy "remove from own shortlist" on public.shortlist for delete to authenticated using (user_id = auth.uid());
revoke update on public.shortlist from anon, authenticated;

create or replace function public.limit_shortlist()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext('shortlist:' || new.user_id::text));
  if (select count(*) from public.shortlist where user_id = new.user_id) >= 100 then
    raise exception 'shortlist is full';
  end if;
  return new;
end $$;
create trigger limit_shortlist_before_insert before insert on public.shortlist
  for each row execute function public.limit_shortlist();

-- Your shortlist as cards. Hosts who are no longer active, or who blocked you or whom you blocked, drop out of it.
create or replace function public.my_shortlist()
returns table (
  id uuid, first_name text, area text, card_illustration text, card_background public.card_background,
  rating_avg numeric, stays_count integer, home_tags text[], saved_at timestamptz
)
language sql stable set search_path = public as $$
  select c.id, c.first_name, c.area, c.card_illustration, c.card_background, c.rating_avg, c.stays_count, c.home_tags, s.created_at
  from public.shortlist s
  join public.profile_cards c on c.id = s.host_id
  where s.user_id = auth.uid()
  order by s.created_at desc;
$$;
revoke execute on function public.my_shortlist() from public, anon;
grant execute on function public.my_shortlist() to authenticated;

-- Trigger functions are never called directly; keep them out of the API anyway.
revoke execute on function public.check_availability_post() from public, anon, authenticated;
revoke execute on function public.check_travel_post() from public, anon, authenticated;
revoke execute on function public.limit_shortlist() from public, anon, authenticated;
