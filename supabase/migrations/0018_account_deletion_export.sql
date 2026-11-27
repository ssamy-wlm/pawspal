-- 0018 (phase 9): account deletion, the nightly purge, shared-history retention, and the data export.
--
-- DESIGN (docs/ARCHITECTURE.md section 11): a deleted person becomes an ANONYMISED STUB. The profiles row stays (same opaque id,
-- first_name 'Deleted user', no bio, area, location or photo) so the OTHER person's bookings, conversations and reviews keep
-- working without a null participant anywhere. Only the sign-in account (auth.users) is deleted, at the final purge.
--   close (immediately, edge function delete-account):  status 'removed' + deleted_at, purge_after = now + deletion_grace_days;
--       open posts, pets without shared bookings, shortlist, blocks, push data, verification requests and exact location are
--       deleted, photo files are deleted by the function, the sign-in account is banned.
--   purge (nightly, edge function purge-accounts):      what is still personal is deleted (membership, legal acceptances,
--       security events, device fingerprints), payment records are detached (user_id null), the auth user is deleted.
--       Kept: ban hashes (banned_identifiers), payment records (amount, date, reference), audit_log, and shared history
--       (conversations, messages, bookings, reviews, reports) for the other person until shared_history_months.
--   retention (same nightly job): messages and bookings older than shared_history_months are deleted for EVERYONE; an empty
--       stub (nothing left that points to it) is then deleted too.
-- The legal numbers (30 days, 24 months) are placeholders from the privacy policy; the founder and the lawyer confirm them.

-- ---------------------------------------------------------------- profile columns and guards
alter table public.profiles add column deleted_at  timestamptz;       -- set when the person closed the account
alter table public.profiles add column purge_after timestamptz;       -- the final purge runs from this moment
alter table public.profiles add column purged_at   timestamptz;       -- the sign-in account and the personal data are gone
create index on public.profiles (purge_after) where deleted_at is not null and purged_at is null;

-- A closed account is final. Nobody can change its status, deleted_at or purge_after (not an admin tool either), and a signed-in
-- session (an old access token of the closed person) cannot change ANY column of the stub: only the service role and the definer
-- functions of this migration can.
create or replace function public.guard_deleted_profile()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.deleted_at is not null and (new.status is distinct from old.status or new.deleted_at is distinct from old.deleted_at
                                     or new.purge_after is distinct from old.purge_after
                                     or current_user in ('authenticated', 'anon')) then
    raise exception 'account deleted';
  end if;
  return new;
end $$;
revoke execute on function public.guard_deleted_profile() from public, anon, authenticated;
create trigger guard_deleted_profile_before_update before update on public.profiles
  for each row execute function public.guard_deleted_profile();

-- The person cannot edit their own stub through the API either (row level security says no rows, the trigger above says error).
drop policy "update own profile" on public.profiles;
create policy "update own profile" on public.profiles
  for update to authenticated using (id = auth.uid() and deleted_at is null) with check (id = auth.uid() and deleted_at is null);

-- Writes that go through definer functions or policies without an "is active" rule must not work for a closed account either
-- (an access token stays valid for up to an hour after the account was closed). One trigger function, applied to each table.
create or replace function public.is_closed_account(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = p_user and deleted_at is not null)
$$;
revoke execute on function public.is_closed_account(uuid) from public, anon;
grant execute on function public.is_closed_account(uuid) to authenticated;

-- tg_argv[0] = the column that holds the owner. INSERT is always refused for a closed owner; UPDATE only when a signed-in
-- role does it (the closing and the purge run as the definer and may update their own rows).
create or replace function public.refuse_closed_account_write()
returns trigger language plpgsql set search_path = public as $$       -- not a definer function: current_user must be the caller
declare v_owner uuid := nullif(to_jsonb(new) ->> tg_argv[0], '')::uuid;
begin
  if v_owner is not null and public.is_closed_account(v_owner) and (tg_op = 'INSERT' or current_user in ('authenticated', 'anon')) then
    raise exception 'account deleted';
  end if;
  return new;
end $$;
revoke execute on function public.refuse_closed_account_write() from public, anon, authenticated;
create trigger refuse_closed_before_write before insert or update on private.locations for each row execute function public.refuse_closed_account_write('user_id');
create trigger refuse_closed_before_write before insert or update on public.pets for each row execute function public.refuse_closed_account_write('owner_id');
create trigger refuse_closed_before_write before insert or update on public.legal_acceptances for each row execute function public.refuse_closed_account_write('user_id');
create trigger refuse_closed_before_write before insert or update on public.appeals for each row execute function public.refuse_closed_account_write('user_id');
create trigger refuse_closed_before_write before insert or update on public.blocks for each row execute function public.refuse_closed_account_write('blocker_id');
create trigger refuse_closed_before_write before insert or update on public.conversation_reads for each row execute function public.refuse_closed_account_write('user_id');

create or replace function public.refuse_closed_pet_care()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.pets p join public.profiles o on o.id = p.owner_id where p.id = new.pet_id and o.deleted_at is not null) then
    raise exception 'account deleted';
  end if;
  return new;
end $$;
revoke execute on function public.refuse_closed_pet_care() from public, anon, authenticated;
create trigger refuse_closed_before_write before insert or update on private.pet_care for each row execute function public.refuse_closed_pet_care();

-- A closed account cannot upload raw photos either.
drop policy "upload raw photo to own incoming folder" on storage.objects;
create policy "upload raw photo to own incoming folder" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'incoming' and (storage.foldername(name))[1] = auth.uid()::text and not public.is_closed_account(auth.uid())
  );

-- The profile row no longer depends on the auth row (the stub outlives its sign-in account). Deleting an auth user still removes
-- the profile of an ordinary account, as before (and still fails while the person has bookings, as before). A closed account's
-- stub stays.
alter table public.profiles drop constraint if exists profiles_id_fkey;
create or replace function public.handle_auth_user_deleted()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.profiles where id = old.id and deleted_at is null;
  return old;
end $$;
revoke execute on function public.handle_auth_user_deleted() from public, anon, authenticated;
create trigger on_auth_user_deleted after delete on auth.users
  for each row execute function public.handle_auth_user_deleted();

-- Payment records outlive the person (amount, date, reference are kept for accounting), detached from them.
alter table public.payment_claims alter column user_id drop not null;
alter table public.payment_claims drop constraint if exists payment_claims_user_id_fkey;
alter table public.payment_claims add constraint payment_claims_user_id_fkey
  foreign key (user_id) references public.profiles (id) on delete set null;

-- A review outlives the booking it was written for (bookings are deleted after shared_history_months).
alter table public.reviews alter column booking_id drop not null;
alter table public.reviews drop constraint if exists reviews_booking_id_fkey;
alter table public.reviews add constraint reviews_booking_id_fkey
  foreign key (booking_id) references public.bookings (id) on delete set null;

-- The empty shell of a pet of a closed account points at the placeholder path 'deleted' (no file); everything else is checked as before.
create or replace function public.validate_pet_photos()
returns trigger language plpgsql security definer set search_path = public, storage as $$
declare p text;
begin
  foreach p in array new.photo_paths loop
    if p = 'deleted' and exists (select 1 from public.profiles where id = new.owner_id and deleted_at is not null) then
      continue;
    end if;
    if split_part(p, '/', 1) <> new.owner_id::text
       or not exists (select 1 from storage.objects o where o.bucket_id = 'pets' and o.name = p) then
      raise exception 'invalid photo';
    end if;
  end loop;
  if tg_op = 'INSERT' and (select count(*) from public.pets where owner_id = new.owner_id) >= 10 then
    raise exception 'too many pets';
  end if;
  return new;
end $$;

-- Nobody can send a message to a closed account.
create or replace function public.refuse_message_to_deleted()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.conversations c
               join public.profiles o on o.id = case when c.user_a = new.sender_id then c.user_b else c.user_a end
              where c.id = new.conversation_id and o.deleted_at is not null) then
    raise exception 'not allowed';
  end if;
  return new;
end $$;
revoke execute on function public.refuse_message_to_deleted() from public, anon, authenticated;
create trigger refuse_message_to_deleted_before_insert before insert on public.messages
  for each row execute function public.refuse_message_to_deleted();

-- The other person still sees the conversation with a closed account (read only, the name is "Deleted user"). Every other rule
-- is as in 0007: people who are not active, or who are blocked either way, drop out of the list.
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
  join public.profiles o on o.id = case when c.user_a = auth.uid() then c.user_b else c.user_a end
  left join lateral (select x.body, x.created_at, x.sender_id from public.messages x where x.conversation_id = c.id order by x.id desc limit 1) m on true
  where auth.uid() in (c.user_a, c.user_b)
    and (o.deleted_at is not null or exists (select 1 from public.profile_cards pc where pc.id = o.id))
  order by coalesce(m.created_at, c.created_at) desc;
$$;
revoke execute on function public.my_conversations() from public, anon;
grant execute on function public.my_conversations() to authenticated;

-- ---------------------------------------------------------------- rate limits (service role: the edge functions)
-- 5 password tries an hour per person and kind ('delete_attempt', 'export_attempt'). ATOMIC: under a lock per person and kind it counts
-- and RECORDS the try before the password is looked at, so a burst of parallel requests cannot beat the limit. A right password
-- gives its try back (release_password_attempt); a wrong one keeps it. Only counts, never the password.
create or replace function public.reserve_password_attempt(p_user uuid, p_kind text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if p_kind not in ('delete_attempt', 'export_attempt') or not exists (select 1 from public.profiles where id = p_user) then return false; end if;
  perform pg_advisory_xact_lock(hashtext(p_kind || ':' || p_user::text));
  if (select count(*) from public.security_events where user_id = p_user and kind = p_kind and created_at > now() - interval '1 hour') >= 5 then
    return false;
  end if;
  insert into public.security_events (user_id, kind) values (p_user, p_kind);
  return true;
end $$;
create or replace function public.release_password_attempt(p_user uuid, p_kind text)
returns void language sql security definer set search_path = public as $$
  delete from public.security_events where id = (
    select id from public.security_events where user_id = p_user and kind = p_kind and p_kind in ('delete_attempt', 'export_attempt')
       and created_at > now() - interval '1 hour' order by id desc limit 1)
$$;
-- 3 exports a day per person. Counts and records in one step, so two requests at once cannot both pass.
create or replace function public.note_data_export(p_user uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id = p_user) then return false; end if;
  perform pg_advisory_xact_lock(hashtext('export:' || p_user::text));
  if (select count(*) from public.security_events where user_id = p_user and kind = 'data_export' and created_at > now() - interval '1 day') >= 3 then
    return false;
  end if;
  insert into public.security_events (user_id, kind) values (p_user, 'data_export');
  return true;
end $$;

-- ---------------------------------------------------------------- closing an account
-- Photo files of one person, in every bucket (the folder is the person's id). Service role: the function deletes them through the Storage API.
create or replace function public.list_user_files(p_user uuid)
returns table (bucket_id text, name text)
language sql stable security definer set search_path = public, storage as $$
  select o.bucket_id, o.name from storage.objects o
   where o.bucket_id in ('faces', 'pets', 'homes', 'handovers', 'ids', 'payments', 'incoming')
     and split_part(o.name, '/', 1) = p_user::text
$$;

-- Step one of deleting an account, called by delete-account AFTER the password was checked. Returns
-- {status: 'closed' | 'already_closed' | 'admin' | 'active_booking' | 'open_case' | 'not_found', purge_after}. 'admin', 'active_booking' and 'open_case' change nothing.
create or replace function public.close_account(p_user uuid)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare p public.profiles; v_days integer := private.setting_int('deletion_grace_days', 30);
begin
  perform pg_advisory_xact_lock(hashtext('delete:' || p_user::text));
  select * into p from public.profiles where id = p_user for update;
  if p.id is null then return jsonb_build_object('status', 'not_found'); end if;
  if exists (select 1 from public.admins where user_id = p_user) then return jsonb_build_object('status', 'admin'); end if;
  if p.deleted_at is not null then
    return jsonb_build_object('status', 'already_closed', 'purge_after', p.purge_after);
  end if;
  -- An open or disputed booking: cancel or resolve it first.
  if exists (select 1 from public.bookings b where p_user in (b.owner_id, b.sitter_id) and b.status in ('requested', 'confirmed', 'in_progress', 'disputed')) then
    return jsonb_build_object('status', 'active_booking');
  end if;
  -- Evidence must not be wiped by deleting: an unresolved report against the person, or an unresolved appeal by them, blocks it
  -- until the founder has resolved the case.
  if exists (select 1 from public.reports r where r.reported_id = p_user and r.status in ('new', 'in_review'))
     or exists (select 1 from public.appeals a where a.user_id = p_user and a.status in ('new', 'in_review')) then
    return jsonb_build_object('status', 'open_case');
  end if;

  -- Anyone who was sanctioned (removed, suspended now, any warning or action, an open report) stays banned: the email and device
  -- hashes go into the ban list (idempotent). Others keep nothing.
  if p.status in ('removed', 'suspended')
     or exists (select 1 from public.enforcement_actions e where e.user_id = p_user)
     or exists (select 1 from public.reports r where r.reported_id = p_user and r.status in ('new', 'in_review')) then
    insert into public.banned_identifiers (kind, hash) select kind, hash from private.identity_hashes(p_user) on conflict do nothing;
  end if;

  -- The stub: the same id, nothing personal.
  update public.profiles
     set deleted_at = now(), purge_after = now() + make_interval(days => v_days), status = 'removed',
         first_name = 'Deleted user', bio = null, area = null, approx_lat = null, approx_lng = null,
         face_photo_path = null, home_photo_path = null, home_tags = '{}', share_exact_pin = false, updated_at = now()
   where id = p_user;

  -- Open posts and everything that points at the person from the discovery side.
  delete from public.availability where user_id = p_user;
  delete from public.travel_posts where user_id = p_user;
  delete from public.shortlist where user_id = p_user or host_id = p_user;
  delete from public.blocks where blocker_id = p_user or blocked_id = p_user;
  delete from public.conversation_reads where user_id = p_user;
  delete from public.alerts where user_id = p_user;
  delete from public.handover_photos where uploaded_by = p_user;                    -- the files go with the other photo files
  delete from private.locations where user_id = p_user;
  delete from public.push_tokens where user_id = p_user;
  delete from public.notification_prefs where user_id = p_user;
  delete from public.notification_outbox where user_id = p_user;
  delete from public.verification_requests where user_id = p_user;                  -- holds the selfie and ID file paths
  update public.payment_claims
     set screenshot_path = null,
         status = case when status = 'pending' then 'rejected' else status end,
         note = case when status = 'pending' then 'Account deleted' else note end,
         decided_at = case when status = 'pending' then now() else decided_at end
   where user_id = p_user;

  -- Pets: the ones in a kept booking stay as empty shells ("Pet", no photo, no notes) so the other person's history still
  -- resolves; the rest are deleted (their vet details go with them).
  delete from private.pet_care where pet_id in (select id from public.pets where owner_id = p_user);
  delete from public.pets pt where pt.owner_id = p_user and not exists (select 1 from public.bookings b where b.pet_id = pt.id);
  update public.pets set name = 'Pet', notes = null, photo_paths = array['deleted'], vaccinated = false, age_years = null, locked = false
   where owner_id = p_user;

  insert into public.audit_log (admin_id, action, target_user, details)
  values ('00000000-0000-0000-0000-000000000000', 'account_deleted', p_user, jsonb_build_object('grace_days', v_days));
  return jsonb_build_object('status', 'closed', 'purge_after', (select purge_after from public.profiles where id = p_user));
end $$;

-- Is this conversation or booking (or the pair of people) part of a case that is not resolved yet?
create or replace function private.case_protected(p_conversation uuid, p_booking uuid, p_a uuid, p_b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.reports r where r.status in ('new', 'in_review')
                   and (r.conversation_id = p_conversation or r.booking_id = p_booking
                        or (r.reporter_id in (p_a, p_b) and r.reported_id in (p_a, p_b))))
      or exists (select 1 from public.appeals ap where ap.status in ('new', 'in_review') and ap.user_id in (p_a, p_b))
$$;
revoke execute on function private.case_protected(uuid, uuid, uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- the nightly purge
-- Service role. Returns counts and the leftover photo files of the purged people (the function deletes them through the Storage
-- API). Safe to run twice. At most 50 accounts per run.
create or replace function public.purge_deleted_accounts()
returns jsonb language plpgsql security definer set search_path = public, private, auth as $$
declare
  r record;
  v_months integer := private.setting_int('shared_history_months', 24);
  v_cutoff timestamptz := now() - make_interval(months => v_months);
  v_files jsonb := '[]'::jsonb; v_old_bookings uuid[]; v_purged integer := 0; v_msgs integer; v_convs integer; v_bookings integer; v_stubs integer;
begin
  for r in select id from public.profiles
            where deleted_at is not null and purged_at is null and purge_after <= now()
            order by purge_after limit 50 for update skip locked
  loop
    v_files := v_files || coalesce((select jsonb_agg(jsonb_build_object('bucket', f.bucket_id, 'name', f.name)) from public.list_user_files(r.id) f), '[]'::jsonb);
    delete from private.locations where user_id = r.id;                              -- (again: nothing can re-create it, but be sure)
    delete from public.legal_acceptances where user_id = r.id;
    delete from public.memberships where user_id = r.id;
    delete from public.security_events where user_id = r.id;
    delete from private.identity_fingerprints where user_id = r.id;
    delete from public.verification_requests where user_id = r.id;
    delete from public.push_tokens where user_id = r.id;
    delete from public.notification_prefs where user_id = r.id;
    delete from public.notification_outbox where user_id = r.id;
    update public.payment_claims set user_id = null where user_id = r.id;            -- the record stays, the person does not
    update public.profiles set purged_at = now() where id = r.id;
    delete from auth.users where id = r.id;                                          -- sessions, identities and tokens cascade
    insert into public.audit_log (admin_id, action, target_user, details)
    values ('00000000-0000-0000-0000-000000000000', 'account_purged', r.id, '{}');
    v_purged := v_purged + 1;
  end loop;

  -- Shared history older than shared_history_months, for everyone, EXCEPT what an unresolved report, an unresolved appeal or a disputed
  -- booking still needs as evidence: a conversation or booking named by an open report, or between the two people of an open
  -- report, or of a person with an open appeal, is kept until the case is resolved.
  delete from public.messages m where m.created_at < v_cutoff and not exists (
    select 1 from public.conversations c where c.id = m.conversation_id and private.case_protected(c.id, null, c.user_a, c.user_b));
  get diagnostics v_msgs = row_count;
  delete from public.conversations c where c.created_at < v_cutoff and not exists (select 1 from public.messages m where m.conversation_id = c.id)
    and not private.case_protected(c.id, null, c.user_a, c.user_b);
  get diagnostics v_convs = row_count;
  select coalesce(array_agg(b.id), '{}') into v_old_bookings from public.bookings b
   where b.ends_on < (private.today() - make_interval(months => v_months)) and b.status <> 'disputed'
     and not private.case_protected(null, b.id, b.owner_id, b.sitter_id);
  v_files := v_files || coalesce((select jsonb_agg(jsonb_build_object('bucket', 'handovers', 'name', h.photo_path))
                                    from public.handover_photos h where h.booking_id = any (v_old_bookings)), '[]'::jsonb);
  delete from public.bookings where id = any (v_old_bookings);
  get diagnostics v_bookings = row_count;
  update public.pets p set locked = false
   where p.locked and not exists (select 1 from public.bookings x where x.pet_id = p.id and x.status in ('confirmed', 'in_progress'));

  -- Shells of closed accounts that nothing needs any more.
  delete from public.pets pt
   where pt.owner_id in (select id from public.profiles where deleted_at is not null)
     and not exists (select 1 from public.bookings b where b.pet_id = pt.id);
  delete from public.profiles p
   where p.purged_at is not null
     and not exists (select 1 from public.bookings b where p.id in (b.owner_id, b.sitter_id))
     and not exists (select 1 from public.conversations c where p.id in (c.user_a, c.user_b))
     and not exists (select 1 from public.reviews rv where p.id in (rv.author_id, rv.subject_id))
     and not exists (select 1 from public.reports rp where p.id in (rp.reporter_id, rp.reported_id))
     and not exists (select 1 from public.enforcement_actions e where e.user_id = p.id)
     and not exists (select 1 from public.appeals a where a.user_id = p.id);
  get diagnostics v_stubs = row_count;

  return jsonb_build_object('purged', v_purged, 'files', v_files, 'messages_deleted', v_msgs, 'conversations_deleted', v_convs,
                            'bookings_deleted', v_bookings, 'stubs_deleted', v_stubs);
end $$;

revoke execute on function public.reserve_password_attempt(uuid, text), public.release_password_attempt(uuid, text), public.note_data_export(uuid),
  public.list_user_files(uuid), public.close_account(uuid), public.purge_deleted_accounts() from public, anon, authenticated;
grant execute on function public.reserve_password_attempt(uuid, text), public.release_password_attempt(uuid, text), public.note_data_export(uuid),
  public.list_user_files(uuid), public.close_account(uuid), public.purge_deleted_accounts() to service_role;

-- ---------------------------------------------------------------- the data export
-- Everything about p_user that p_user may see, as one json document. Service role (the export-my-data function passes the user id
-- from the verified token). It holds NOTHING of other people beyond what the app shows (an opaque id, and the first name of a person
-- who is visible to this person), no admin notes (a decision note only when the person was refused: the app shows it too), no
-- hashes, no security events and no tokens. The key "files" lists the person's own photo files (bucket and path) for signed links.
create or replace function public.export_user_data(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare p public.profiles; v jsonb; v_files jsonb;
begin
  select * into p from public.profiles where id = p_user and deleted_at is null;
  if p.id is null then return null; end if;

  v_files := coalesce((
    select jsonb_agg(f) from (
      select 'face' as kind, 'faces' as bucket, p.face_photo_path as path where p.face_photo_path like p_user::text || '/%'
      union all select 'home', 'homes', p.home_photo_path where p.home_photo_path like p_user::text || '/%'
      union all select 'pet', 'pets', x from public.pets pt cross join lateral unnest(pt.photo_paths) x where pt.owner_id = p_user and x like p_user::text || '/%'
      union all select 'handover', 'handovers', h.photo_path from public.handover_photos h where h.uploaded_by = p_user and h.photo_path like p_user::text || '/%'
    ) f), '[]'::jsonb);

  v := jsonb_build_object(
    'profile', jsonb_build_object(
      'id', p.id, 'first_name', p.first_name, 'role', p.role, 'bio', p.bio, 'area', p.area, 'approx_lat', p.approx_lat, 'approx_lng', p.approx_lng,
      'card_illustration', p.card_illustration, 'card_background', p.card_background, 'theme', p.theme, 'locale', p.locale,
      'share_exact_pin', p.share_exact_pin, 'home_tags', p.home_tags, 'status', p.status, 'face_verified', p.face_verified,
      'id_verified', p.id_verified, 'is_adult', p.is_adult, 'rating_avg', p.rating_avg, 'stays_count', p.stays_count, 'created_at', p.created_at),
    'exact_location', (select jsonb_build_object('lat', l.lat, 'lng', l.lng, 'address', l.address, 'updated_at', l.updated_at)
                         from private.locations l where l.user_id = p_user),
    'pets', coalesce((select jsonb_agg(jsonb_build_object('id', pt.id, 'name', pt.name, 'type', pt.type, 'size', pt.size, 'age_years', pt.age_years,
                        'vaccinated', pt.vaccinated, 'notes', pt.notes, 'locked', pt.locked, 'created_at', pt.created_at,
                        'vet_name', c.vet_name, 'vet_phone', c.vet_phone, 'care_notes', c.care_notes) order by pt.created_at)
                        from public.pets pt left join private.pet_care c on c.pet_id = pt.id where pt.owner_id = p_user), '[]'::jsonb),
    'availability', coalesce((select jsonb_agg(to_jsonb(a) - 'user_id' order by a.created_at) from public.availability a where a.user_id = p_user), '[]'::jsonb),
    'travel_posts', coalesce((select jsonb_agg(to_jsonb(t) - 'user_id' order by t.created_at) from public.travel_posts t where t.user_id = p_user), '[]'::jsonb),
    'shortlist', coalesce((select jsonb_agg(jsonb_build_object('host_id', s.host_id, 'created_at', s.created_at) order by s.created_at)
                             from public.shortlist s where s.user_id = p_user), '[]'::jsonb),
    'bookings', coalesce((select jsonb_agg(jsonb_build_object(
                  'id', b.id, 'my_role', case when b.owner_id = p_user then 'owner' else 'host' end,
                  'other_id', case when b.owner_id = p_user then b.sitter_id else b.owner_id end, 'pet_id', b.pet_id,
                  'starts_on', b.starts_on, 'ends_on', b.ends_on, 'stay_location', b.stay_location, 'cost_type', b.cost_type,
                  'price_per_night', b.price_per_night, 'food_provided', b.food_provided, 'status', b.status, 'terms_version', b.terms_version,
                  'my_accepted_at', case when b.owner_id = p_user then b.owner_accepted_at else b.sitter_accepted_at end,
                  'other_accepted_at', case when b.owner_id = p_user then b.sitter_accepted_at else b.owner_accepted_at end,
                  'confirmed_at', b.confirmed_at, 'cancelled_by_me', b.cancelled_by = p_user, 'created_at', b.created_at) order by b.created_at)
                  from public.bookings b where p_user in (b.owner_id, b.sitter_id)), '[]'::jsonb),
    'conversations', coalesce((select jsonb_agg(jsonb_build_object(
                  'id', c.id, 'other_id', o.id,
                  'other_first_name', case when o.deleted_at is not null or (public.is_active(o.id) and not public.is_blocked_between(p_user, o.id)) then o.first_name end,
                  'created_at', c.created_at,
                  'messages', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'sent_by_me', m.sender_id = p_user, 'body', m.body,
                                'masked', m.masked, 'created_at', m.created_at) order by m.id)
                                from public.messages m where m.conversation_id = c.id), '[]'::jsonb)) order by c.created_at)
                  from public.conversations c
                  join public.profiles o on o.id = case when c.user_a = p_user then c.user_b else c.user_a end
                  where p_user in (c.user_a, c.user_b)), '[]'::jsonb),
    'reviews_written', coalesce((select jsonb_agg(jsonb_build_object('booking_id', r.booking_id, 'about_id', r.subject_id, 'rating', r.rating,
                  'body', r.body, 'created_at', r.created_at) order by r.created_at) from public.reviews r where r.author_id = p_user), '[]'::jsonb),
    'reviews_received', coalesce((select jsonb_agg(jsonb_build_object('booking_id', r.booking_id, 'rating', r.rating, 'body', r.body,
                  'created_at', r.created_at) order by r.created_at) from public.reviews r where r.subject_id = p_user), '[]'::jsonb),
    'reports_made', coalesce((select jsonb_agg(jsonb_build_object('id', rp.id, 'about_id', rp.reported_id, 'booking_id', rp.booking_id,
                  'conversation_id', rp.conversation_id, 'reason', rp.reason, 'details', rp.details, 'status', rp.status,
                  'created_at', rp.created_at) order by rp.created_at) from public.reports rp where rp.reporter_id = p_user), '[]'::jsonb),
    'blocks_made', coalesce((select jsonb_agg(jsonb_build_object('blocked_id', k.blocked_id, 'created_at', k.created_at) order by k.created_at)
                  from public.blocks k where k.blocker_id = p_user), '[]'::jsonb),
    'alerts_received', coalesce((select jsonb_agg(jsonb_build_object('kind', al.kind, 'booking_id', al.booking_id, 'created_at', al.created_at,
                  'read_at', al.read_at) order by al.created_at) from public.alerts al where al.user_id = p_user), '[]'::jsonb),
    'handover_photos', coalesce((select jsonb_agg(jsonb_build_object('booking_id', h.booking_id, 'kind', h.kind, 'taken_at', h.taken_at) order by h.taken_at)
                  from public.handover_photos h where h.uploaded_by = p_user), '[]'::jsonb),
    'legal_acceptances', coalesce((select jsonb_agg(jsonb_build_object('doc', la.doc, 'version', la.version, 'accepted_at', la.accepted_at) order by la.accepted_at)
                  from public.legal_acceptances la where la.user_id = p_user), '[]'::jsonb),
    'membership', (select jsonb_build_object('paid_until', m.paid_until, 'created_at', m.created_at) from public.memberships m where m.user_id = p_user),
    'payment_claims', coalesce((select jsonb_agg(jsonb_build_object('kind', pc.kind, 'amount_egp', pc.amount_egp, 'reference', pc.reference,
                  'status', pc.status, 'note', case when pc.status = 'rejected' then pc.note end, 'created_at', pc.created_at,
                  'decided_at', pc.decided_at) order by pc.created_at) from public.payment_claims pc where pc.user_id = p_user), '[]'::jsonb),
    'verification_requests', coalesce((select jsonb_agg(jsonb_build_object('status', vr.status, 'note', case when vr.status = 'rejected' then vr.note end,
                  'submitted_at', vr.submitted_at, 'decided_at', vr.decided_at) order by vr.submitted_at)
                  from public.verification_requests vr where vr.user_id = p_user), '[]'::jsonb),
    'enforcement_actions', coalesce((select jsonb_agg(jsonb_build_object('action', ea.action, 'rule', ea.rule, 'message', ea.message,
                  'duration_days', ea.duration_days, 'until_fixed', ea.until_fixed, 'created_at', ea.created_at, 'ends_at', ea.ends_at) order by ea.created_at)
                  from public.enforcement_actions ea where ea.user_id = p_user), '[]'::jsonb),
    'appeals', coalesce((select jsonb_agg(jsonb_build_object('body', ap.body, 'status', ap.status, 'created_at', ap.created_at) order by ap.created_at)
                  from public.appeals ap where ap.user_id = p_user), '[]'::jsonb),
    'notification_prefs', (select jsonb_build_object('messages', coalesce(n.messages, true), 'bookings', coalesce(n.bookings, true),
                  'membership', coalesce(n.membership, true), 'verification', coalesce(n.verification, true))
                  from (select 1) one left join public.notification_prefs n on n.user_id = p_user),
    'push_devices', coalesce((select jsonb_agg(jsonb_build_object('platform', t.platform, 'created_at', t.created_at, 'last_seen_at', t.last_seen_at) order by t.created_at)
                  from public.push_tokens t where t.user_id = p_user), '[]'::jsonb),
    'files', v_files);
  return v;
end $$;
revoke execute on function public.export_user_data(uuid) from public, anon, authenticated;
grant execute on function public.export_user_data(uuid) to service_role;
