-- Fix: the Supabase dashboard "Add user" form (with Auto Confirm User) failed with "Database error creating new user" because
-- 0013 required the email to be confirmed at the moment of saving; Supabase Auth confirms it a moment after saving.
-- The invite path now accepts an unconfirmed account made within one hour of the invite; grant_admin still needs a confirmed
-- email and the account made for the invite, and is_admin() still needs a passkey session.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, private, extensions as $$
declare
  v_email  text := lower(btrim(coalesce(new.email, '')));
  v_role   text := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'role', '')), '');
  v_terms  text := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'terms_version', '')), '');
  v_device text := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'device_id', '')), '');
  v_privacy text;
begin
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'sign-up not allowed [E1]'; end if;
  if exists (select 1 from public.banned_identifiers where kind = 'email' and hash = private.email_hash(v_email)) then
    raise exception 'sign-up not allowed [E5]';
  end if;
  if v_device is not null and exists (select 1 from public.banned_identifiers where kind = 'device' and hash = private.device_hash(v_device)) then
    raise exception 'sign-up not allowed [E6]';
  end if;
  if v_role is null then
    -- Accounts made in the Supabase dashboard (the admins) carry no role: they must have been invited first.
    -- An invite works once: the first account made for it is tied to it, and nobody else can use it afterwards.
    if not exists (select 1 from private.admin_invites where email = v_email and user_id is null) then raise exception 'sign-up not allowed [E2]'; end if;
    -- The dashboard's "Add user" form saves the user first and marks the email confirmed a moment later, so the address is
    -- often still unconfirmed here. grant_admin is the real gate (it needs a confirmed email and this very account). To limit
    -- invite squatting through the public sign-up, an unconfirmed account may only use an invite made in the last hour.
    if new.email_confirmed_at is null
       and not exists (select 1 from private.admin_invites where email = v_email and user_id is null and created_at > now() - interval '1 hour') then
      raise exception 'sign-up not allowed [E2]';
    end if;
    update private.admin_invites set user_id = new.id where email = v_email;
    insert into public.profiles (id) values (new.id);
    insert into public.memberships (user_id) values (new.id);
    return new;
  end if;
  if v_role not in ('owner', 'sitter') then raise exception 'sign-up not allowed [E3]'; end if;
  -- The sign-up screen shows the disclaimer and the Terms; the version it sends is the proof the person agreed to those words.
  if v_terms is null or not exists (select 1 from public.legal_documents where doc = 'terms' and current_version = v_terms) then
    raise exception 'sign-up not allowed [E4]';
  end if;
  insert into public.profiles (id, role) values (new.id, v_role::public.user_role);
  insert into public.memberships (user_id) values (new.id);
  insert into public.legal_acceptances (user_id, doc, version) values (new.id, 'terms', v_terms);
  select current_version into v_privacy from public.legal_documents where doc = 'privacy';
  insert into public.legal_acceptances (user_id, doc, version) values (new.id, 'privacy', v_privacy);
  if v_device is not null then
    insert into private.identity_fingerprints (kind, hash, user_id) values ('device', private.device_hash(v_device), new.id) on conflict do nothing;
  end if;
  return new;
end $$;
