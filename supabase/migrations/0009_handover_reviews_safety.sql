-- 0009 (phase 7): handover photos, reviews, reports, blocks and emergencies.
--   * handover photos are added only through add_handover_photo(): the file must be the person's own clean upload
--   * reviews: contact details are masked, and a suspended person cannot review
--   * reports are filed through file_report() (checks who and what they point at, limits how many); reports get a priority
--   * blocks: block_user / unblock_user / my_blocks
--   * emergency: raise_emergency() (service role, called by the emergency function) alerts the other person and opens a
--     high-priority report; people read their alerts with my_alerts()

-- ---------------------------------------------------------------- handover photos
drop policy "participants add handover photos" on public.handover_photos;
-- Rows (and so file paths) are read through list_handover_photos(); directly only your own uploads, and admins.
drop policy "participants read handover photos" on public.handover_photos;
create policy "read own handover photos" on public.handover_photos
  for select to authenticated using (uploaded_by = auth.uid() or public.is_admin());
revoke insert, update, delete on public.handover_photos from anon, authenticated;
create unique index handover_photos_path_key on public.handover_photos (photo_path);

create or replace function public.add_handover_photo(p_booking uuid, p_kind text, p_path text)
returns uuid language plpgsql security definer set search_path = public, storage as $$
declare b public.bookings; v_id uuid;
begin
  if auth.uid() is null or not public.is_active(auth.uid()) then raise exception 'not allowed'; end if;
  select * into b from public.bookings where id = p_booking for update;
  if b.id is null or auth.uid() not in (b.owner_id, b.sitter_id) then raise exception 'not allowed'; end if;
  if p_kind not in ('dropoff', 'pickup') then raise exception 'invalid kind'; end if;
  -- Drop-off: confirmed (starts the stay) or already started (the other side's photo). Pick-up: only once the stay started.
  if p_kind = 'dropoff' and (b.status not in ('confirmed', 'in_progress') or current_date < b.starts_on - 1) then
    raise exception 'not available yet';
  end if;
  if p_kind = 'pickup' and b.status <> 'in_progress' then raise exception 'not available yet'; end if;
  -- Only a clean copy made by process-upload, in this person's own folder.
  if p_path is null or p_path !~ ('^' || auth.uid()::text || '/[A-Za-z0-9._-]{1,100}$') or position('..' in p_path) > 0 then
    raise exception 'invalid photo';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'handovers' and o.name = p_path) then
    raise exception 'invalid photo';
  end if;
  if (select count(*) from public.handover_photos h
       where h.booking_id = p_booking and h.uploaded_by = auth.uid() and h.kind = p_kind) >= 3 then
    raise exception 'too many photos';
  end if;
  insert into public.handover_photos (booking_id, uploaded_by, kind, photo_path)
  values (p_booking, auth.uid(), p_kind, p_path) returning id into v_id;     -- a drop-off starts the stay (trigger from 0001)
  return v_id;
end $$;
revoke execute on function public.add_handover_photo(uuid, text, text) from public, anon;
grant execute on function public.add_handover_photo(uuid, text, text) to authenticated;

-- What the app lists: no file paths. The partner's photo itself is fetched through the handover-photo-url function.
create or replace function public.list_handover_photos(p_booking uuid)
returns table (id uuid, kind text, mine boolean, taken_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.bookings b where b.id = p_booking and auth.uid() in (b.owner_id, b.sitter_id)) then
    raise exception 'not allowed';
  end if;
  return query select h.id, h.kind, h.uploaded_by = auth.uid(), h.taken_at
    from public.handover_photos h where h.booking_id = p_booking order by h.taken_at;
end $$;
revoke execute on function public.list_handover_photos(uuid) from public, anon;
grant execute on function public.list_handover_photos(uuid) to authenticated;

-- Service role only: the file path of a handover photo, if the person is in that booking.
create or replace function public.handover_photo_for(p_user uuid, p_photo uuid)
returns text language sql stable security definer set search_path = public as $$
  select h.photo_path from public.handover_photos h join public.bookings b on b.id = h.booking_id
   where h.id = p_photo and p_user in (b.owner_id, b.sitter_id);
$$;
revoke execute on function public.handover_photo_for(uuid, uuid) from public, anon, authenticated;
grant execute on function public.handover_photo_for(uuid, uuid) to service_role;

-- ---------------------------------------------------------------- reviews
drop policy "review after a completed stay" on public.reviews;
create policy "review after a completed stay" on public.reviews
  for insert to authenticated with check (
    author_id = auth.uid() and public.is_active(auth.uid()) and not public.is_blocked_between(auth.uid(), subject_id) and exists (
      select 1 from public.bookings b
      where b.id = booking_id and b.status = 'completed'
        and current_date <= b.ends_on + 14
        and ((b.owner_id = auth.uid() and b.sitter_id = subject_id)
          or (b.sitter_id = auth.uid() and b.owner_id = subject_id))
    )
  );

-- Phone numbers and links never go into a public review.
create or replace function public.mask_review_body()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.body is not null then
    new.body := nullif(btrim(public.mask_contact_text(new.body)), '');
  end if;
  return new;
end $$;
create trigger mask_review_before_insert before insert on public.reviews
  for each row execute function public.mask_review_body();
revoke execute on function public.mask_review_body() from public, anon, authenticated;

-- ---------------------------------------------------------------- reports
alter table public.reports add column priority text not null default 'normal' check (priority in ('normal', 'high'));
alter table public.reports add column emergency boolean not null default false;
create index on public.reports (priority, created_at) where status = 'new';

drop policy "file a report" on public.reports;
revoke insert, update, delete on public.reports from anon, authenticated;

create or replace function public.file_report(
  p_reported uuid, p_reason text, p_details text default null, p_booking uuid default null, p_conversation uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_priority text;
begin
  if auth.uid() is null or not public.is_active(auth.uid()) then raise exception 'not allowed'; end if;
  if p_reported is null or p_reported = auth.uid() or not exists (select 1 from public.profiles where id = p_reported) then
    raise exception 'invalid report';
  end if;
  if p_reason not in ('off_app_payment', 'fake_photo', 'no_show', 'late_cancel', 'rude_or_harassment',
                      'animal_welfare', 'pet_mismatch', 'duplicate_account', 'safety', 'other') then
    raise exception 'invalid report';
  end if;
  if length(coalesce(p_details, '')) > 2000 then raise exception 'invalid report'; end if;
  -- What the report points at must be something both people are part of.
  if p_booking is not null and not exists (select 1 from public.bookings b where b.id = p_booking
       and auth.uid() in (b.owner_id, b.sitter_id) and p_reported in (b.owner_id, b.sitter_id)) then
    raise exception 'invalid report';
  end if;
  if p_conversation is not null and not exists (select 1 from public.conversations c where c.id = p_conversation
       and auth.uid() in (c.user_a, c.user_b) and p_reported in (c.user_a, c.user_b)) then
    raise exception 'invalid report';
  end if;
  perform pg_advisory_xact_lock(hashtext('report:' || auth.uid()::text));
  -- The same report twice in a day is the same report.
  select id into v_id from public.reports
   where reporter_id = auth.uid() and reported_id = p_reported and reason = p_reason and not emergency
     and created_at > now() - interval '1 day';
  if v_id is not null then return v_id; end if;
  if (select count(*) from public.reports where reporter_id = auth.uid() and created_at > now() - interval '1 day') >= 10 then
    raise exception 'too many reports';
  end if;
  -- Serious reasons are high priority, but at most three a day from one person (more are still read, as normal).
  v_priority := case when p_reason in ('animal_welfare', 'safety')
    and (select count(*) from public.reports where reporter_id = auth.uid() and priority = 'high' and not emergency
          and created_at > now() - interval '1 day') < 3 then 'high' else 'normal' end;
  insert into public.reports (reporter_id, reported_id, booking_id, conversation_id, reason, details, priority)
  values (auth.uid(), p_reported, p_booking, p_conversation, p_reason, nullif(btrim(p_details), ''), v_priority)
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.file_report(uuid, text, text, uuid, uuid) from public, anon;
grant execute on function public.file_report(uuid, text, text, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- blocks
create or replace function public.block_user(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or p_user is null or p_user = auth.uid() or not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'invalid';
  end if;
  insert into public.blocks (blocker_id, blocked_id) values (auth.uid(), p_user) on conflict do nothing;
end $$;
create or replace function public.unblock_user(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not allowed'; end if;
  delete from public.blocks where blocker_id = auth.uid() and blocked_id = p_user;
end $$;
-- The people you blocked, with a first name so you can recognise them (they are hidden from every other list).
create or replace function public.my_blocks()
returns table (user_id uuid, first_name text, blocked_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, case when p.status = 'active' then p.first_name end, k.created_at from public.blocks k join public.profiles p on p.id = k.blocked_id
   where k.blocker_id = auth.uid() order by k.created_at desc;
$$;
revoke execute on function public.block_user(uuid), public.unblock_user(uuid), public.my_blocks() from public, anon;
grant execute on function public.block_user(uuid), public.unblock_user(uuid), public.my_blocks() to authenticated;
-- Blocking goes through the functions only: a direct insert could name anyone.
drop policy "manage own blocks" on public.blocks;
revoke insert, update, delete on public.blocks from anon, authenticated;
create policy "read own blocks" on public.blocks for select to authenticated using (blocker_id = auth.uid());

-- ---------------------------------------------------------------- emergency
create table public.alerts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,     -- who is alerted
  from_id    uuid not null references public.profiles (id) on delete cascade,
  booking_id uuid not null references public.bookings (id) on delete cascade,
  report_id  uuid references public.reports (id) on delete set null,
  kind       text not null default 'emergency' check (kind in ('emergency')),
  created_at timestamptz not null default now(),
  read_at    timestamptz
);
alter table public.alerts enable row level security;
revoke insert, update, delete on public.alerts from anon, authenticated;
create policy "read own alerts" on public.alerts for select to authenticated using (user_id = auth.uid() or public.is_admin());
create index on public.alerts (user_id, created_at desc);

-- Called only by the emergency function. Either person in a running booking can raise it; the other person is alerted and a
-- high-priority report is opened for the team. The same person raising it again within ten minutes changes nothing.
create or replace function public.raise_emergency(p_user uuid, p_booking uuid, p_note text default null)
returns text language plpgsql security definer set search_path = public as $$
declare b public.bookings; v_other uuid; v_report uuid;
begin
  select * into b from public.bookings where id = p_booking;
  if b.id is null or p_user not in (b.owner_id, b.sitter_id) or b.status not in ('confirmed', 'in_progress') then
    return 'not_allowed';
  end if;
  if length(coalesce(p_note, '')) > 500 then return 'invalid'; end if;
  perform pg_advisory_xact_lock(hashtext('emergency:' || p_user::text));
  if exists (select 1 from public.alerts where from_id = p_user and booking_id = p_booking and created_at > now() - interval '10 minutes') then
    return 'already_sent';
  end if;
  if (select count(*) from public.alerts where from_id = p_user and created_at > now() - interval '1 day') >= 5 then
    return 'too_many';
  end if;
  v_other := case when p_user = b.owner_id then b.sitter_id else b.owner_id end;
  insert into public.reports (reporter_id, reported_id, booking_id, reason, details, priority, emergency)
  values (p_user, v_other, p_booking, 'safety', nullif(btrim(p_note), ''), 'high', true) returning id into v_report;
  insert into public.alerts (user_id, from_id, booking_id, report_id) values (v_other, p_user, p_booking, v_report);
  insert into public.security_events (user_id, kind, details)
  values (p_user, 'emergency_raised', jsonb_build_object('booking', p_booking));
  return 'sent';
end $$;
revoke execute on function public.raise_emergency(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.raise_emergency(uuid, uuid, text) to service_role;

create or replace function public.my_alerts()
returns table (id uuid, booking_id uuid, from_name text, pet_name text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select a.id, a.booking_id, p.first_name, pt.name, a.created_at
    from public.alerts a
    join public.profiles p on p.id = a.from_id
    join public.bookings b on b.id = a.booking_id
    join public.pets pt on pt.id = b.pet_id
   where a.user_id = auth.uid() and a.read_at is null and a.created_at > now() - interval '3 days'
   order by a.created_at desc;
$$;
create or replace function public.dismiss_alert(p_alert uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.alerts set read_at = now() where id = p_alert and user_id = auth.uid() and read_at is null;
end $$;
revoke execute on function public.my_alerts(), public.dismiss_alert(uuid) from public, anon;
grant execute on function public.my_alerts(), public.dismiss_alert(uuid) to authenticated;

-- ---------------------------------------------------------------- clean-up list: handover photos that were never saved
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
  union all
  select o.bucket_id, o.name from storage.objects o
   where o.bucket_id = 'handovers' and o.created_at < now() - p_older_than
     and not exists (select 1 from public.handover_photos h where h.photo_path = o.name)
$$;
revoke execute on function public.list_unused_uploads(interval) from public, anon, authenticated;
grant execute on function public.list_unused_uploads(interval) to service_role;
