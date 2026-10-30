-- 0010 (phase 8): the admin dashboard.
--   * admin rights need a second factor: is_admin() is true only for a session that passed the authenticator-app code (aal2)
--   * how the first admin is added: private.invite_admin(email) then, after the account exists, private.grant_admin(email)
--     (both run only in the Supabase SQL editor; no app or website can call them)
--   * admin_take_action is stricter: who it may act on, which action fits which status, bans on removal, un-bans on reinstatement
--   * reports, appeals, photos, reading a reported chat and the audit log all go through functions that write the audit log
--   * a timer lifts fixed-length suspensions when they end, with an audit entry
-- Nothing here is readable or callable by anon. Every admin function checks is_admin() itself.

alter table public.enforcement_actions alter column admin_id drop not null;       -- NULL = the system (a suspension ended by itself)

-- ---------------------------------------------------------------- admin rights need the second factor
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid())
     and coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal', '') = 'aal2';
$$;

-- What the dashboard needs to decide what to show after sign-in: 'admin', 'needs_mfa' (an admin who has not entered the
-- authenticator code in this session) or 'not_admin'. It reveals nothing about anyone else.
create or replace function public.admin_status()
returns text language sql stable security definer set search_path = public as $$
  select case
    when not exists (select 1 from public.admins where user_id = auth.uid()) then 'not_admin'
    when public.is_admin() then 'admin'
    else 'needs_mfa' end;
$$;
revoke execute on function public.admin_status() from public, anon;
grant execute on function public.admin_status() to authenticated;

-- ---------------------------------------------------------------- adding and removing admins (SQL editor only)
create table private.admin_invites (
  email      text primary key check (email = lower(btrim(email)) and email like '%_@_%'),
  user_id    uuid,                                   -- the account made for this invite (an invite is used once)
  created_at timestamptz not null default now()
);

-- Step 1: name the email address that may become an admin.
create or replace function private.invite_admin(p_email text)
returns text language plpgsql security definer set search_path = public, private as $$
begin
  insert into private.admin_invites (email) values (lower(btrim(p_email))) on conflict do nothing;
  return 'invited: now add this email as a user in Authentication > Users (with a password, "Auto Confirm User" ticked), then run private.grant_admin';
end $$;

-- Step 2: after that account exists and its email is confirmed, make it an admin. Refuses any email that was not invited.
create or replace function private.grant_admin(p_email text)
returns text language plpgsql security definer set search_path = public, private, auth as $$
declare v_id uuid; v_confirmed timestamptz;
begin
  select id, email_confirmed_at into v_id, v_confirmed from auth.users where lower(email) = lower(btrim(p_email)) and phone is null;
  if v_id is null then return 'no_user'; end if;
  -- The account must be the one made for this invite, made after it, with a confirmed email.
  if not exists (select 1 from private.admin_invites i join auth.users u on u.id = v_id
                  where i.email = lower(btrim(p_email)) and i.user_id = v_id and u.created_at >= i.created_at) then return 'no_invite'; end if;
  if v_confirmed is null then return 'not_confirmed'; end if;
  insert into public.admins (user_id) values (v_id) on conflict do nothing;
  insert into public.audit_log (admin_id, action, target_user, details)
  values ('00000000-0000-0000-0000-000000000000', 'admin_granted', v_id, '{}');
  return 'granted';
end $$;

create or replace function private.revoke_admin(p_email text)
returns text language plpgsql security definer set search_path = public, private, auth as $$
declare v_id uuid;
begin
  select id into v_id from auth.users where lower(email) = lower(btrim(p_email));
  delete from public.admins where user_id = v_id;
  delete from private.admin_invites where email = lower(btrim(p_email));
  if v_id is not null then
    insert into public.audit_log (admin_id, action, target_user, details)
    values ('00000000-0000-0000-0000-000000000000', 'admin_revoked', v_id, '{}');
  end if;
  return 'revoked';
end $$;
revoke execute on function private.invite_admin(text), private.grant_admin(text), private.revoke_admin(text) from public, anon, authenticated;

-- An invited email may exist without a phone (the admin signs in with email, password and the authenticator code). Anyone
-- else still needs an Egyptian mobile number.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, private, extensions as $$
begin
  if new.phone is null and new.email is not null
     and exists (select 1 from private.admin_invites where email = lower(btrim(new.email)) and user_id is null) then
    update private.admin_invites set user_id = new.id where email = lower(btrim(new.email));   -- one account per invite
    insert into public.profiles (id, phone_verified) values (new.id, false);
    return new;
  end if;
  if new.phone is null or not private.is_egypt_mobile(new.phone) then
    raise exception 'sign-up not allowed';
  end if;
  if private.is_test_number(new.phone)
     and not exists (select 1 from private.local_switches where name = 'allow_test_numbers') then
    raise exception 'sign-up not allowed';
  end if;
  if exists (
    select 1 from public.banned_identifiers
    where kind = 'phone' and hash in (
      encode(digest(new.phone, 'sha256'), 'hex'),
      private.phone_hash(new.phone),
      encode(digest('+' || private.phone_digits(new.phone), 'sha256'), 'hex'))
  ) then
    raise exception 'sign-up not allowed';
  end if;
  insert into public.profiles (id, phone_verified) values (new.id, new.phone_confirmed_at is not null);
  return new;
end $$;

-- ---------------------------------------------------------------- bans (used by removal and reinstatement)
create or replace function private.identity_hashes(p_user uuid)
returns table (kind text, hash text) language sql stable security definer set search_path = public, private, extensions, auth as $$
  select 'phone', h from auth.users u,
    lateral (values (encode(digest(u.phone, 'sha256'), 'hex')), (private.phone_hash(u.phone)),
                    (encode(digest('+' || private.phone_digits(u.phone), 'sha256'), 'hex'))) v(h)
   where u.id = p_user and u.phone is not null
  union
  select f.kind, f.hash from private.identity_fingerprints f where f.user_id = p_user;
$$;
revoke execute on function private.identity_hashes(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- admin_take_action: the one way to act on a person
create or replace function public.admin_take_action(
  p_user uuid, p_action public.action_type, p_rule text, p_duration_days integer,
  p_until_fixed boolean, p_checklist jsonb, p_message text
) returns uuid language plpgsql security definer set search_path = public, private as $$
declare
  v_id uuid; v_from public.account_status; v_to public.account_status;
  v_until boolean := coalesce(p_until_fixed, false);
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  select status into v_from from public.profiles where id = p_user for update;
  if v_from is null then raise exception 'no such user'; end if;
  if p_user = auth.uid() or exists (select 1 from public.admins where user_id = p_user) then raise exception 'cannot act on an admin'; end if;
  if p_checklist is not null and jsonb_typeof(p_checklist) <> 'array' then raise exception 'invalid checklist'; end if;
  if length(coalesce(p_message, '')) > 1000 or length(coalesce(p_rule, '')) > 120 then raise exception 'too long'; end if;

  -- Which action fits which status.
  if p_action in ('reminder', 'warning') and v_from not in ('active', 'suspended') then raise exception 'not allowed for this status'; end if;
  if p_action = 'suspension' and v_from <> 'active' then raise exception 'not allowed for this status'; end if;
  if p_action = 'removal' and v_from = 'removed' then raise exception 'not allowed for this status'; end if;
  if p_action = 'reinstatement' and v_from not in ('suspended', 'removed') then raise exception 'not allowed for this status'; end if;
  if p_action = 'approval' and v_from <> 'pending_review' then raise exception 'not allowed for this status'; end if;
  -- A reason the person can read, and a rule, for everything that is a sanction.
  if p_action in ('reminder', 'warning', 'suspension', 'removal')
     and (btrim(coalesce(p_message, '')) = '' or btrim(coalesce(p_rule, '')) = '') then
    raise exception 'a rule and a message are required';
  end if;
  -- A suspension is 3 days, 7 days or until fixed: exactly one of them. Nothing else has a length.
  if p_action = 'suspension' and ((p_duration_days is null) = (not v_until)) then raise exception 'choose 3 days, 7 days or until fixed'; end if;
  if p_action <> 'suspension' and (p_duration_days is not null or v_until) then raise exception 'only a suspension has a length'; end if;
  if p_duration_days is not null and p_duration_days not in (3, 7) then raise exception 'choose 3 days, 7 days or until fixed'; end if;

  v_to := case p_action
    when 'suspension'    then 'suspended'
    when 'removal'       then 'removed'
    when 'reinstatement' then 'active'
    when 'approval'      then 'active'
    else null end;
  if v_to is not null then
    update public.profiles set status = v_to, updated_at = now() where id = p_user;
  end if;
  if p_action = 'removal' then
    insert into public.banned_identifiers (kind, hash) select kind, hash from private.identity_hashes(p_user) on conflict do nothing;
  elsif p_action = 'reinstatement' and v_from = 'removed' then
    delete from public.banned_identifiers b using private.identity_hashes(p_user) h
     where b.kind = h.kind and b.hash = h.hash
       and not exists (select 1 from public.profiles p2 cross join lateral private.identity_hashes(p2.id) h2
                        where p2.status = 'removed' and p2.id <> p_user and h2.kind = b.kind and h2.hash = b.hash);
  end if;

  insert into public.enforcement_actions (user_id, action, rule, duration_days, until_fixed, checklist, message, admin_id, ends_at)
  values (p_user, p_action, nullif(btrim(p_rule), ''), p_duration_days, v_until, coalesce(p_checklist, '[]'),
          nullif(btrim(p_message), ''), auth.uid(),
          case when p_duration_days is not null then now() + make_interval(days => p_duration_days) end)
  returning id into v_id;
  insert into public.audit_log (admin_id, action, target_user, details)
  values (auth.uid(), p_action::text, p_user,
          jsonb_build_object('rule', p_rule, 'duration_days', p_duration_days, 'until_fixed', v_until,
                             'checklist', p_checklist, 'action_id', v_id, 'from_status', v_from));
  return v_id;
end $$;
revoke execute on function public.admin_take_action(uuid, public.action_type, text, integer, boolean, jsonb, text) from public, anon;
grant execute on function public.admin_take_action(uuid, public.action_type, text, integer, boolean, jsonb, text) to authenticated;

-- ---------------------------------------------------------------- chats are read through the audited function only
-- (admin_report_messages is security definer, so it still works). Before, an admin could read any chat straight from the table.
drop policy "participants read messages" on public.messages;
create policy "participants read messages" on public.messages
  for select to authenticated using (
    exists (select 1 from public.conversations c where c.id = conversation_id and auth.uid() in (c.user_a, c.user_b))
  );

-- ---------------------------------------------------------------- reports
create or replace function public.admin_set_report_status(p_report uuid, p_status public.report_status, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_reported uuid;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  if p_status = 'new' or length(coalesce(p_note, '')) > 1000 then raise exception 'invalid'; end if;
  update public.reports set status = p_status where id = p_report returning reported_id into v_reported;
  if v_reported is null then raise exception 'no such report'; end if;
  insert into public.audit_log (admin_id, action, target_user, details)
  values (auth.uid(), 'report_' || p_status::text, v_reported, jsonb_build_object('report_id', p_report, 'note', nullif(btrim(p_note), '')));
end $$;

-- The messages of the conversation a report points at. Reading them is itself written to the audit log.
create or replace function public.admin_report_messages(p_report uuid)
returns table (id bigint, sender_id uuid, body text, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare v_conv uuid; v_reported uuid;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  select conversation_id, reported_id into v_conv, v_reported from public.reports where reports.id = p_report;
  if v_conv is null then raise exception 'no conversation on this report'; end if;
  insert into public.audit_log (admin_id, action, target_user, details)
  values (auth.uid(), 'read_conversation', v_reported, jsonb_build_object('report_id', p_report));
  return query select * from (select m.id, m.sender_id, m.body, m.created_at from public.messages m
                               where m.conversation_id = v_conv order by m.id desc limit 100) x order by x.id;
end $$;

-- ---------------------------------------------------------------- appeals
create or replace function public.admin_decide_appeal(p_appeal uuid, p_upheld boolean, p_message text default null)
returns void language plpgsql security definer set search_path = public as $$
declare a public.appeals; v_status public.account_status;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  select * into a from public.appeals where id = p_appeal for update;
  if a.id is null or a.status not in ('new', 'in_review') then raise exception 'no open appeal'; end if;
  if p_upheld then
    select status into v_status from public.profiles where id = a.user_id;
    if v_status in ('suspended', 'removed') then
      perform public.admin_take_action(a.user_id, 'reinstatement', null, null, false, '[]', p_message);
    end if;
  end if;
  update public.appeals set status = case when p_upheld then 'resolved' else 'dismissed' end::public.report_status where id = p_appeal;
  insert into public.audit_log (admin_id, action, target_user, details)
  values (auth.uid(), case when p_upheld then 'appeal_upheld' else 'appeal_declined' end, a.user_id,
          jsonb_build_object('appeal_id', p_appeal, 'action_id', a.action_id));
end $$;

-- ---------------------------------------------------------------- photos
-- Takes a pet or home photo off a profile. The file itself is deleted by the nightly clean-up once nothing uses it.
create or replace function public.admin_remove_photo(p_kind text, p_owner uuid, p_path text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  if btrim(coalesce(p_reason, '')) = '' or length(p_reason) > 500 then raise exception 'a reason is required'; end if;
  if p_kind = 'home' then
    update public.profiles set home_photo_path = null, updated_at = now() where id = p_owner and home_photo_path = p_path;
  elsif p_kind = 'pet' then
    update public.pets set photo_paths = array_remove(photo_paths, p_path) where owner_id = p_owner and p_path = any (photo_paths);
  else
    raise exception 'invalid kind';
  end if;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'photo not found'; end if;
  insert into public.audit_log (admin_id, action, target_user, details)
  values (auth.uid(), 'photo_removed', p_owner, jsonb_build_object('kind', p_kind, 'reason', btrim(p_reason)));
end $$;

-- ---------------------------------------------------------------- overview and audit log
create or replace function public.admin_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  return jsonb_build_object(
    'active_users',     (select count(*) from public.profiles where status = 'active'),
    'new_this_week',    (select count(*) from public.profiles where created_at > now() - interval '7 days'
                           and not exists (select 1 from public.admins a where a.user_id = profiles.id)),
    'open_reports',     (select count(*) from public.reports where status in ('new', 'in_review')),
    'high_priority',    (select count(*) from public.reports where status in ('new', 'in_review') and priority = 'high'),
    'suspended',        (select count(*) from public.profiles where status = 'suspended'),
    'pending_approvals',(select count(*) from public.profiles where status = 'pending_review'),
    'open_appeals',     (select count(*) from public.appeals where status in ('new', 'in_review')),
    'actions_this_month',(select count(*) from public.enforcement_actions where created_at >= date_trunc('month', now()))
  );
end $$;

create or replace function public.admin_audit_log(p_limit integer default 50, p_before bigint default null)
returns table (id bigint, created_at timestamptz, action text, admin_email text, target_user uuid, target_name text, details jsonb)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  return query
    select l.id, l.created_at, l.action, u.email::text, l.target_user, p.first_name, l.details
      from public.audit_log l
      left join auth.users u on u.id = l.admin_id
      left join public.profiles p on p.id = l.target_user
     where p_before is null or l.id < p_before
     order by l.id desc limit least(greatest(coalesce(p_limit, 50), 1), 200);
end $$;

revoke execute on function public.admin_set_report_status(uuid, public.report_status, text), public.admin_report_messages(uuid),
  public.admin_decide_appeal(uuid, boolean, text), public.admin_remove_photo(text, uuid, text, text), public.admin_overview(),
  public.admin_audit_log(integer, bigint) from public, anon;
grant execute on function public.admin_set_report_status(uuid, public.report_status, text), public.admin_report_messages(uuid),
  public.admin_decide_appeal(uuid, boolean, text), public.admin_remove_photo(text, uuid, text, text), public.admin_overview(),
  public.admin_audit_log(integer, bigint) to authenticated;

-- ---------------------------------------------------------------- suspensions end by themselves
-- A fixed-length suspension (3 or 7 days) is lifted once ends_at has passed, unless something newer happened since.
-- Runs from pg_cron as the database owner; nobody else can call it.
create or replace function private.lift_expired_suspensions()
returns integer language plpgsql security definer set search_path = public, private as $$
declare r record; n integer := 0;
begin
  for r in
    select l.user_id from (
      select distinct on (user_id) user_id, action, ends_at from public.enforcement_actions
       where action in ('suspension', 'reinstatement', 'removal', 'approval')
       order by user_id, created_at desc) l
      join public.profiles p on p.id = l.user_id
     where l.action = 'suspension' and l.ends_at is not null and l.ends_at <= now() and p.status = 'suspended'
  loop
    update public.profiles set status = 'active', updated_at = now() where id = r.user_id;
    insert into public.enforcement_actions (user_id, action, rule, admin_id) values (r.user_id, 'reinstatement', 'suspension ended', null);
    insert into public.audit_log (admin_id, action, target_user, details)
    values ('00000000-0000-0000-0000-000000000000', 'auto_reinstatement', r.user_id, '{}');
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function private.lift_expired_suspensions() from public, anon, authenticated;

-- Every 15 minutes, where pg_cron exists (Supabase has it; a plain test database does not).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('lift-expired-suspensions', '*/15 * * * *', 'select private.lift_expired_suspensions()');
  end if;
exception when others then
  raise notice 'pg_cron job not scheduled: %', sqlerrm;
end $$;
