-- 0011: the Supabase dashboard's "Add user" form sends an EMPTY phone ('') instead of no phone. 0010 treated that as a
-- phone sign-up and refused the invited admin. An empty or blank phone now counts as "no phone", in both places that look.
-- Nothing else is loosened: an email account still needs an unused invite, and a phone sign-up still needs an Egyptian mobile.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, private, extensions as $$
begin
  if nullif(btrim(new.phone), '') is null and new.email is not null
     and exists (select 1 from private.admin_invites where email = lower(btrim(new.email)) and user_id is null) then
    update private.admin_invites set user_id = new.id where email = lower(btrim(new.email));   -- one account per invite
    insert into public.profiles (id, phone_verified) values (new.id, false);
    return new;
  end if;
  if nullif(btrim(new.phone), '') is null or not private.is_egypt_mobile(new.phone) then
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

create or replace function private.grant_admin(p_email text)
returns text language plpgsql security definer set search_path = public, private, auth as $$
declare v_id uuid; v_confirmed timestamptz;
begin
  select id, email_confirmed_at into v_id, v_confirmed from auth.users
   where lower(email) = lower(btrim(p_email)) and nullif(btrim(phone), '') is null;
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
revoke execute on function private.grant_admin(text) from public, anon, authenticated;
