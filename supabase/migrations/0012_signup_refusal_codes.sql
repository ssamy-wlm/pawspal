-- 0012: say WHY a sign-up was refused, in the server log only. The person still sees the same generic error; the code
-- (never an email or phone number) lets whoever reads the Auth log tell an invite problem from a phone problem.
--   E1 an email account with no invite for that address      E2 the invite for that address was already used
--   E3 a phone that is not an Egyptian mobile                 E4 neither a usable phone nor an email
--   E5 a test number outside a local setup                    E6 a banned phone number
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, private, extensions as $$
declare v_blank_phone boolean := nullif(btrim(new.phone), '') is null;
begin
  if v_blank_phone and new.email is not null then
    if exists (select 1 from private.admin_invites where email = lower(btrim(new.email)) and user_id is null) then
      update private.admin_invites set user_id = new.id where email = lower(btrim(new.email));   -- one account per invite
      insert into public.profiles (id, phone_verified) values (new.id, false);
      return new;
    end if;
    if exists (select 1 from private.admin_invites where email = lower(btrim(new.email))) then
      raise exception 'sign-up not allowed [E2]';
    end if;
    raise exception 'sign-up not allowed [E1]';
  end if;
  if v_blank_phone then raise exception 'sign-up not allowed [E4]'; end if;
  if not private.is_egypt_mobile(new.phone) then raise exception 'sign-up not allowed [E3]'; end if;
  if private.is_test_number(new.phone)
     and not exists (select 1 from private.local_switches where name = 'allow_test_numbers') then
    raise exception 'sign-up not allowed [E5]';
  end if;
  if exists (
    select 1 from public.banned_identifiers
    where kind = 'phone' and hash in (
      encode(digest(new.phone, 'sha256'), 'hex'),
      private.phone_hash(new.phone),
      encode(digest('+' || private.phone_digits(new.phone), 'sha256'), 'hex'))
  ) then
    raise exception 'sign-up not allowed [E6]';
  end if;
  insert into public.profiles (id, phone_verified) values (new.id, new.phone_confirmed_at is not null);
  return new;
end $$;
