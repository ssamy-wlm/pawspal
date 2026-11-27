-- 0019: the founder is paid by InstaPay and Vodafone Cash, not by bank transfer.
--   * the four bank settings are removed (deleted by key list, with a WHERE);
--   * new settings: instapay_address, vodafone_cash_number, vodafone_cash_name, vodafone_cash_link (all default empty);
--   * admin_set_setting validates the new keys with exact patterns; the other rules are unchanged;
--   * get_payment_settings() and the read policy on app_settings give a signed-in person exactly the 11 keys the
--     membership screen needs. The three phase 9 keys stay hidden from the app (admins with a passkey still read all).

delete from public.app_settings where key in ('bank_name', 'bank_account_name', 'bank_account_number', 'bank_iban');

insert into public.app_settings (key, value) values
  ('instapay_address', ''), ('vodafone_cash_number', ''), ('vodafone_cash_name', ''), ('vodafone_cash_link', '')
on conflict (key) do nothing;

create or replace function public.get_payment_settings()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when auth.uid() is null then '{}'::jsonb
    else coalesce((select jsonb_object_agg(key, value) from public.app_settings
                    where key in ('registration_fee_egp', 'renewal_fee_egp', 'membership_months', 'reminder_days',
                                  'instapay_link', 'instapay_qr_url', 'instapay_address',
                                  'vodafone_cash_number', 'vodafone_cash_name', 'vodafone_cash_link', 'payment_note')), '{}'::jsonb) end
$$;

drop policy "signed-in people read the payment settings" on public.app_settings;
-- (an admin session that passed the passkey step reads every setting, so the admin site can show them)
create policy "signed-in people read the payment settings" on public.app_settings for select to authenticated
  using (key in ('registration_fee_egp', 'renewal_fee_egp', 'membership_months', 'reminder_days',
                 'instapay_link', 'instapay_qr_url', 'instapay_address', 'vodafone_cash_number', 'vodafone_cash_name', 'vodafone_cash_link', 'payment_note')
         or public.is_admin());

create or replace function public.admin_set_setting(p_key text, p_value text)
returns void language plpgsql security definer set search_path = public as $$
declare v_value text := btrim(coalesce(p_value, '')); v_old text;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  if p_key in ('registration_fee_egp', 'renewal_fee_egp') then
    if v_value !~ '^[0-9]{1,6}$' or v_value::integer < 1 or v_value::integer > 100000 then raise exception 'invalid value'; end if;
  elsif p_key = 'membership_months' then
    if v_value !~ '^[0-9]{1,2}$' or v_value::integer < 1 or v_value::integer > 60 then raise exception 'invalid value'; end if;
  elsif p_key = 'reminder_days' then
    if v_value !~ '^[0-9]{1,2}$' or v_value::integer < 1 or v_value::integer > 60 then raise exception 'invalid value'; end if;
  elsif p_key = 'deletion_grace_days' then
    if v_value !~ '^[0-9]{1,3}$' or v_value::integer < 1 or v_value::integer > 365 then raise exception 'invalid value'; end if;
  elsif p_key = 'shared_history_months' then
    if v_value !~ '^[0-9]{1,3}$' or v_value::integer < 1 or v_value::integer > 120 then raise exception 'invalid value'; end if;
  elsif p_key = 'push_enabled' then
    if v_value not in ('true', 'false') then raise exception 'invalid value'; end if;
  elsif p_key in ('instapay_link', 'instapay_qr_url', 'vodafone_cash_link') then
    if v_value <> '' and v_value !~ '^https://[^[:space:]]{3,255}$' then raise exception 'invalid value'; end if;
  elsif p_key = 'instapay_address' then
    if v_value <> '' and v_value !~ '^[A-Za-z0-9._-]{2,40}@[A-Za-z0-9.-]{2,30}$' then raise exception 'invalid value'; end if;
  elsif p_key = 'vodafone_cash_number' then
    if v_value <> '' and v_value !~ '^(\+20|0)1[0-9]{9}$' then raise exception 'invalid value'; end if;
  elsif p_key = 'vodafone_cash_name' then
    if v_value <> '' and (char_length(v_value) > 60 or v_value ~ '[[:cntrl:]]') then raise exception 'invalid value'; end if;
  elsif p_key = 'payment_note' then
    if length(v_value) > 500 then raise exception 'invalid value'; end if;
  else
    raise exception 'unknown setting';
  end if;
  select value into v_old from public.app_settings where key = p_key;
  update public.app_settings set value = v_value, updated_at = now() where key = p_key;
  insert into public.audit_log (admin_id, action, target_user, details)
  values (auth.uid(), 'setting_changed', null, jsonb_build_object('key', p_key, 'old', v_old, 'new', v_value));
end $$;
