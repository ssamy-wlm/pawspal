-- Phase 6 assertions (booking fee, payments, refunds, exact pin). Run AFTER the other assertion files on the same database,
-- with ON_ERROR_STOP=1. Any failed assertion stops the run with "ASSERT FAILED".
\set ON_ERROR_STOP 1
\i supabase/tests/helpers.sql

insert into auth.users (id, phone, phone_confirmed_at) values
  ('e1e1e1e1-0000-0000-0000-000000000001', '201277900001', now()),   -- Owen, owns pets
  ('e2e2e2e2-0000-0000-0000-000000000002', '201277900002', now()),   -- Hana, hosts
  ('e3e3e3e3-0000-0000-0000-000000000003', '201277900003', now()),   -- Stan, a stranger
  ('e4e4e4e4-0000-0000-0000-000000000004', '201277900004', now()),   -- Bea, owns and hosts (for a swap)
  ('e5e5e5e5-0000-0000-0000-000000000005', '201277900005', now());   -- Ana, owns and hosts (for a swap)
update public.profiles set first_name = 'Owen', role = 'owner', status = 'active', face_verified = true, id_verified = true, is_adult = true where id = 'e1e1e1e1-0000-0000-0000-000000000001';
update public.profiles set first_name = 'Hana', role = 'sitter', status = 'active', face_verified = true, id_verified = true, is_adult = true where id = 'e2e2e2e2-0000-0000-0000-000000000002';
update public.profiles set first_name = 'Stan', role = 'both', status = 'active', face_verified = true, id_verified = true, is_adult = true where id = 'e3e3e3e3-0000-0000-0000-000000000003';
update public.profiles set first_name = 'Bea', role = 'both', status = 'active', face_verified = true, id_verified = true, is_adult = true where id = 'e4e4e4e4-0000-0000-0000-000000000004';
update public.profiles set first_name = 'Ana', role = 'both', status = 'active', face_verified = true, id_verified = true, is_adult = true where id = 'e5e5e5e5-0000-0000-0000-000000000005';
insert into storage.objects (bucket_id, name) values ('pets', 'e1e1e1e1-0000-0000-0000-000000000001/a.jpg'), ('pets', 'e4e4e4e4-0000-0000-0000-000000000004/b.jpg'), ('pets', 'e5e5e5e5-0000-0000-0000-000000000005/c.jpg');
insert into public.pets (id, owner_id, name, type, size, photo_paths) values
  ('e1e1e1e1-1111-0000-0000-000000000001', 'e1e1e1e1-0000-0000-0000-000000000001', 'Owenpet', 'dog', 'small', array['e1e1e1e1-0000-0000-0000-000000000001/a.jpg']),
  ('e4e4e4e4-1111-0000-0000-000000000004', 'e4e4e4e4-0000-0000-0000-000000000004', 'Beapet', 'cat', 'small', array['e4e4e4e4-0000-0000-0000-000000000004/b.jpg']),
  ('e5e5e5e5-1111-0000-0000-000000000005', 'e5e5e5e5-0000-0000-0000-000000000005', 'Anapet', 'dog', 'small', array['e5e5e5e5-0000-0000-0000-000000000005/c.jpg']);
insert into private.locations (user_id, lat, lng, address) values ('e2e2e2e2-0000-0000-0000-000000000002', 28.5095, 34.5135, 'Masbat Road, Building 14');
create temp table t_ids (k text primary key, v text);
-- A booking with both sides accepted at the current terms: helper.
create or replace function pg_temp.agree(p_key text, p_owner uuid, p_sitter uuid, p_pet uuid, p_start int) returns void language plpgsql as $$
declare v_id text; v_ver int;
begin
  v_id := pg_temp.as_role('authenticated', p_owner, format($q$select public.request_booking(%L, %L, current_date + %s, current_date + %s, 'sitter_home', 'paid', 200, false)$q$, p_sitter, p_pet, p_start, p_start + 3));
  insert into t_ids values (p_key, v_id);
  select terms_version into v_ver from public.bookings where id = v_id::uuid;
  perform pg_temp.as_role('authenticated', p_owner, format($q$select public.accept_terms(%L, %s)$q$, v_id, v_ver));
  perform pg_temp.as_role('authenticated', p_sitter, format($q$select public.accept_terms(%L, %s)$q$, v_id, v_ver));
end $$;

\echo '--- F1 the fee is a server setting'
select pg_temp.check(public.booking_fee_cents() = 7500, 'the fee is not 75 EGP');
select pg_temp.check(pg_temp.as_role('authenticated', 'e1e1e1e1-0000-0000-0000-000000000001', $$select public.booking_fee_cents()$$)::int = 7500, 'a signed-in person cannot read the fee');
select pg_temp.check(pg_temp.count_as('e1e1e1e1-0000-0000-0000-000000000001', $$select count(*) from public.app_settings where key = 'booking_fee_egp'$$) = 1, 'the fee setting is not readable');
select pg_temp.fails_as('authenticated', 'e1e1e1e1-0000-0000-0000-000000000001', $$update public.app_settings set value = '1' where key = 'booking_fee_egp'$$, 'a user changed the fee');
select pg_temp.fails_as('authenticated', 'e1e1e1e1-0000-0000-0000-000000000001', $$insert into public.app_settings (key, value) values ('x', 'y')$$, 'a user added a setting');
select pg_temp.fails_as('anon', null, $$select public.booking_fee_cents()$$, 'anon read the fee');
select pg_temp.fails($$update public.app_settings set value = '0' where key = 'booking_fee_egp'$$, 'a fee of zero was accepted');
select pg_temp.fails($$update public.app_settings set value = 'abc' where key = 'booking_fee_egp'$$, 'a fee that is not a number was accepted');
select pg_temp.fails($$update public.app_settings set value = '99999' where key = 'booking_fee_egp'$$, 'a huge fee was accepted');
select pg_temp.fails($$update public.app_settings set value = '200' where key = 'refund_processing_charge_egp'$$, 'a refund charge above the fee was accepted');
update public.app_settings set value = '90' where key = 'booking_fee_egp';
select pg_temp.check(public.booking_fee_cents() = 9000, 'changing the fee did not change it');
update public.app_settings set value = '75' where key = 'booking_fee_egp';

\echo '--- F2 starting a payment'
select pg_temp.agree('b1', 'e1e1e1e1-0000-0000-0000-000000000001', 'e2e2e2e2-0000-0000-0000-000000000002', 'e1e1e1e1-1111-0000-0000-000000000001', 10);
select pg_temp.fails_as('authenticated', 'e1e1e1e1-0000-0000-0000-000000000001', format($$select public.begin_fee_payment(%L, 'e1e1e1e1-0000-0000-0000-000000000001', 'paymob')$$, (select v from t_ids where k = 'b1')), 'a user started a payment themselves');
select pg_temp.fails_as('anon', null, format($$select public.begin_fee_payment(%L, 'e1e1e1e1-0000-0000-0000-000000000001', 'paymob')$$, (select v from t_ids where k = 'b1')), 'anon started a payment');
select pg_temp.fails(format($$select public.begin_fee_payment(%L, 'e2e2e2e2-0000-0000-0000-000000000002', 'paymob')$$, (select v from t_ids where k = 'b1')), 'the host was asked to pay the fee');
select pg_temp.fails(format($$select public.begin_fee_payment(%L, 'e3e3e3e3-0000-0000-0000-000000000003', 'paymob')$$, (select v from t_ids where k = 'b1')), 'a stranger started a payment');
insert into t_ids select 'p1', payment_id::text from public.begin_fee_payment((select v::uuid from t_ids where k = 'b1'), 'e1e1e1e1-0000-0000-0000-000000000001', 'paymob');
select public.set_payment_ref((select v::uuid from t_ids where k = 'p1'), 'ord-p1');
select pg_temp.check((select amount_cents = 7500 and status = 'created' and payer_id = 'e1e1e1e1-0000-0000-0000-000000000001' from public.booking_payments where id = (select v::uuid from t_ids where k = 'p1')), 'the payment row is wrong');
select pg_temp.check(pg_temp.count_as('e2e2e2e2-0000-0000-0000-000000000002', $$select count(*) from public.booking_payments$$) = 1, 'the host cannot see where payment stands');
select pg_temp.check(pg_temp.count_as('e3e3e3e3-0000-0000-0000-000000000003', $$select count(*) from public.booking_payments$$) = 0, 'a stranger saw a payment');
select pg_temp.fails_as('authenticated', 'e1e1e1e1-0000-0000-0000-000000000001', $$select provider_ref from public.booking_payments$$, 'a user read the provider reference');
select pg_temp.fails_as('authenticated', 'e1e1e1e1-0000-0000-0000-000000000001', $$update public.booking_payments set status = 'paid'$$, 'a user marked a payment paid');
select pg_temp.fails_as('authenticated', 'e1e1e1e1-0000-0000-0000-000000000001', $$insert into public.booking_payments (booking_id, payer_id, amount_cents, terms_version, provider, status) values (gen_random_uuid(), 'e1e1e1e1-0000-0000-0000-000000000001', 1, 1, 'x', 'paid')$$, 'a user wrote a payment row');
select pg_temp.check((select status = 'terms_agreed' and fee_status = 'unpaid' from public.bookings where id = (select v::uuid from t_ids where k = 'b1')), 'starting a payment changed the booking');

\echo '--- F3 a payment confirms the booking only when the amount is right'
select pg_temp.fails_as('authenticated', 'e1e1e1e1-0000-0000-0000-000000000001', format($$select public.complete_fee_payment(%L, 'txn-1', 7500, 'EGP', 'ord-1')$$, (select v from t_ids where k = 'p1')), 'a user completed a payment');
select pg_temp.fails_as('anon', null, format($$select public.complete_fee_payment(%L, 'txn-1', 7500, 'EGP', 'ord-1')$$, (select v from t_ids where k = 'p1')), 'anon completed a payment');
select pg_temp.check(public.complete_fee_payment((select v::uuid from t_ids where k = 'p1'), 'txn-1', 7500, 'EGP', 'an-order-that-is-not-this-payments') = 'reference_mismatch', 'a callback for another order confirmed this payment');
select pg_temp.fails($$select public.complete_fee_payment(gen_random_uuid(), 'txn-1', 7500, 'EGP', 'x')$$, 'an unknown payment was accepted');
select pg_temp.check((select status = 'terms_agreed' from public.bookings where id = (select v::uuid from t_ids where k = 'b1')), 'a refused payment changed the booking');
select pg_temp.check(public.complete_fee_payment((select v::uuid from t_ids where k = 'p1'), 'txn-1', 7500, 'EGP', 'ord-p1') = 'paid', 'the right payment did not pay');
select pg_temp.check((select status = 'confirmed' and fee_status = 'paid' from public.bookings where id = (select v::uuid from t_ids where k = 'b1')), 'the booking was not confirmed');
select pg_temp.check((select locked from public.pets where id = 'e1e1e1e1-1111-0000-0000-000000000001'), 'the pet was not locked');
select pg_temp.check(public.complete_fee_payment((select v::uuid from t_ids where k = 'p1'), 'txn-1', 7500, 'EGP', 'ord-p1') = 'already_done', 'a repeat of the same payment was not harmless');
select pg_temp.check((select count(*) = 1 from public.booking_payments where booking_id = (select v::uuid from t_ids where k = 'b1') and status = 'paid'), 'the booking has more than one paid payment');
select pg_temp.fails(format($$select public.begin_fee_payment(%L, 'e1e1e1e1-0000-0000-0000-000000000001', 'paymob')$$, (select v from t_ids where k = 'b1')), 'a second payment was started for a confirmed booking');

-- wrong amount or currency: nothing is confirmed, what was taken is marked for refund, and it is logged
select pg_temp.agree('b8', 'e1e1e1e1-0000-0000-0000-000000000001', 'e2e2e2e2-0000-0000-0000-000000000002', 'e1e1e1e1-1111-0000-0000-000000000001', 160);
insert into t_ids select 'p8', payment_id::text from public.begin_fee_payment((select v::uuid from t_ids where k = 'b8'), 'e1e1e1e1-0000-0000-0000-000000000001', 'paymob');
select public.set_payment_ref((select v::uuid from t_ids where k = 'p8'), 'ord-p8');
select pg_temp.check(public.complete_fee_payment((select v::uuid from t_ids where k = 'p8'), 'txn-8', 100, 'EGP', 'ord-p8') = 'amount_mismatch', 'a payment of the wrong amount was accepted');
select pg_temp.check((select status = 'terms_agreed' and fee_status = 'unpaid' from public.bookings where id = (select v::uuid from t_ids where k = 'b8')), 'a wrong-amount payment changed the booking');
select pg_temp.check((select status = 'refund_due' and refund_cents = 100 and refund_reason = 'wrong_amount' and provider_txn_id = 'txn-8' from public.booking_payments where id = (select v::uuid from t_ids where k = 'p8')), 'the money taken for the wrong amount was not marked for refund');
select pg_temp.check((select count(*) >= 1 from public.security_events where kind = 'payment_mismatch'), 'the mismatch was not logged');
insert into t_ids select 'p8b', payment_id::text from public.begin_fee_payment((select v::uuid from t_ids where k = 'b8'), 'e1e1e1e1-0000-0000-0000-000000000001', 'paymob');
select public.set_payment_ref((select v::uuid from t_ids where k = 'p8b'), 'ord-p8b');
select pg_temp.check(public.complete_fee_payment((select v::uuid from t_ids where k = 'p8b'), 'txn-8b', 7500, 'USD', 'ord-p8b') = 'amount_mismatch', 'a payment in the wrong currency was accepted');
select pg_temp.check(public.complete_fee_payment((select v::uuid from t_ids where k = 'p8b'), 'txn-8c', 7500, 'EGP', 'ord-p8b') = 'already_done', 'a refunded payment could be completed again');
-- after a refund-due payment the booking can still be paid properly
insert into t_ids select 'p8c', payment_id::text from public.begin_fee_payment((select v::uuid from t_ids where k = 'b8'), 'e1e1e1e1-0000-0000-0000-000000000001', 'paymob');
select public.set_payment_ref((select v::uuid from t_ids where k = 'p8c'), 'ord-p8c');
select pg_temp.check(public.complete_fee_payment((select v::uuid from t_ids where k = 'p8c'), 'txn-8d', 7500, 'EGP', 'ord-p8c') = 'paid', 'a booking could not be paid after a refund-due payment');
-- a second payment for an already paid booking is refunded, not lost
\echo '--- F4 the exact pin appears only after payment, and only for the two people'
select pg_temp.check(pg_temp.as_role('authenticated', 'e1e1e1e1-0000-0000-0000-000000000001', format($$select address from public.get_booking_location(%L)$$, (select v from t_ids where k = 'b1'))) = 'Masbat Road, Building 14', 'the owner cannot see the pin after payment');
select pg_temp.check(pg_temp.as_role('authenticated', 'e2e2e2e2-0000-0000-0000-000000000002', format($$select address from public.get_booking_location(%L)$$, (select v from t_ids where k = 'b1'))) = 'Masbat Road, Building 14', 'the host cannot see their own pin');
select pg_temp.fails_as('authenticated', 'e3e3e3e3-0000-0000-0000-000000000003', format($$select * from public.get_booking_location(%L)$$, (select v from t_ids where k = 'b1')), 'a stranger saw the exact pin');
select pg_temp.fails_as('anon', null, format($$select * from public.get_booking_location(%L)$$, (select v from t_ids where k = 'b1')), 'anon saw the exact pin');
select pg_temp.agree('b2', 'e1e1e1e1-0000-0000-0000-000000000001', 'e2e2e2e2-0000-0000-0000-000000000002', 'e1e1e1e1-1111-0000-0000-000000000001', 40);
select pg_temp.fails_as('authenticated', 'e1e1e1e1-0000-0000-0000-000000000001', format($$select * from public.get_booking_location(%L)$$, (select v from t_ids where k = 'b2')), 'the pin was released before payment');

\echo '--- F5 when the booking changed before the money arrived, the money is marked for refund'
insert into t_ids select 'p2', payment_id::text from public.begin_fee_payment((select v::uuid from t_ids where k = 'b2'), 'e1e1e1e1-0000-0000-0000-000000000001', 'paymob');
select public.set_payment_ref((select v::uuid from t_ids where k = 'p2'), 'ord-p2');
select pg_temp.as_role('authenticated', 'e2e2e2e2-0000-0000-0000-000000000002', format($$select public.propose_terms(%L, current_date + 40, current_date + 43, 'sitter_home', 'paid', 900, false)$$, (select v from t_ids where k = 'b2')));
select pg_temp.check(public.complete_fee_payment((select v::uuid from t_ids where k = 'p2'), 'txn-2', 7500, 'EGP', 'ord-p2') = 'refund_due', 'a payment for old terms confirmed the booking');
select pg_temp.check((select status = 'requested' and fee_status = 'unpaid' from public.bookings where id = (select v::uuid from t_ids where k = 'b2')), 'a payment for old terms changed the booking');
select pg_temp.check((select status = 'refund_due' and refund_cents = 7500 and refund_reason = 'booking_changed_before_payment' from public.booking_payments where id = (select v::uuid from t_ids where k = 'p2')), 'the money was not marked for a full refund');
select pg_temp.fails_as('authenticated', 'e1e1e1e1-0000-0000-0000-000000000001', $$select * from public.list_refunds_due()$$, 'a user listed refunds');
select pg_temp.check((select count(*) = 1 from public.list_refunds_due() where payment_id = (select v::uuid from t_ids where k = 'p2')), 'the refund job does not claim the refund');
select pg_temp.check((select count(*) = 0 from public.list_refunds_due() where payment_id = (select v::uuid from t_ids where k = 'p2')), 'a refund that is already being processed was handed out a second time');
select pg_temp.check(public.mark_refund_result((select v::uuid from t_ids where k = 'p2'), false) = 'retry', 'a failed refund was not kept for a retry');
select pg_temp.check((select status = 'refund_due' and refund_attempts = 1 and refund_started_at is null from public.booking_payments where id = (select v::uuid from t_ids where k = 'p2')), 'a failed refund was not retried');
select public.list_refunds_due();
select pg_temp.check(public.mark_refund_result((select v::uuid from t_ids where k = 'p2'), true) = 'refunded', 'a confirmed refund was not recorded');
select pg_temp.check((select status = 'refunded' and refunded_at is not null from public.booking_payments where id = (select v::uuid from t_ids where k = 'p2')), 'a refund was not recorded');
select pg_temp.check((select count(*) = 0 from public.list_refunds_due() where payment_id = (select v::uuid from t_ids where k = 'p2')), 'a refunded payment is still listed');
select pg_temp.check(public.mark_refund_result((select v::uuid from t_ids where k = 'p2'), true) = 'not_due', 'a refunded payment could be refunded again');
select pg_temp.as_role('authenticated', 'e1e1e1e1-0000-0000-0000-000000000001', format($$select public.cancel_booking(%L, 'x')$$, (select v from t_ids where k = 'b2')));

\echo '--- F6 refunds follow section 6 of the terms'
update public.app_settings set value = '10' where key = 'refund_processing_charge_egp';
select pg_temp.agree('b3', 'e1e1e1e1-0000-0000-0000-000000000001', 'e2e2e2e2-0000-0000-0000-000000000002', 'e1e1e1e1-1111-0000-0000-000000000001', 60);
insert into t_ids select 'p3', payment_id::text from public.begin_fee_payment((select v::uuid from t_ids where k = 'b3'), 'e1e1e1e1-0000-0000-0000-000000000001', 'paymob');
select public.set_payment_ref((select v::uuid from t_ids where k = 'p3'), 'ord-p3');
select public.complete_fee_payment((select v::uuid from t_ids where k = 'p3'), 'txn-3', 7500, 'EGP', 'ord-p3');
select pg_temp.check(pg_temp.as_role('authenticated', 'e1e1e1e1-0000-0000-0000-000000000001', format($$select refund_cents from public.refund_preview(%L)$$, (select v from t_ids where k = 'b3')))::int = 6500, 'the preview for an early owner cancel is not the fee minus the charge');
select pg_temp.check(pg_temp.as_role('authenticated', 'e2e2e2e2-0000-0000-0000-000000000002', format($$select refund_cents from public.refund_preview(%L)$$, (select v from t_ids where k = 'b3')))::int = 7500, 'the preview for a host cancel is not the full fee');
select pg_temp.fails_as('authenticated', 'e3e3e3e3-0000-0000-0000-000000000003', format($$select * from public.refund_preview(%L)$$, (select v from t_ids where k = 'b3')), 'a stranger previewed a refund');
select pg_temp.as_role('authenticated', 'e1e1e1e1-0000-0000-0000-000000000001', format($$select public.cancel_booking(%L, 'plans changed')$$, (select v from t_ids where k = 'b3')));
select pg_temp.check((select status = 'refund_due' and refund_cents = 6500 and refund_reason = 'cancelled_early' from public.booking_payments where id = (select v::uuid from t_ids where k = 'p3')), 'an early owner cancel was not refunded minus the charge');
select pg_temp.check((select locked from public.pets where id = 'e1e1e1e1-1111-0000-0000-000000000001'), 'cancelling one booking unlocked a pet that is still in another confirmed booking');
-- the host cancels: everything back
select pg_temp.agree('b4', 'e1e1e1e1-0000-0000-0000-000000000001', 'e2e2e2e2-0000-0000-0000-000000000002', 'e1e1e1e1-1111-0000-0000-000000000001', 70);
insert into t_ids select 'p4', payment_id::text from public.begin_fee_payment((select v::uuid from t_ids where k = 'b4'), 'e1e1e1e1-0000-0000-0000-000000000001', 'paymob');
select public.set_payment_ref((select v::uuid from t_ids where k = 'p4'), 'ord-p4');
select public.complete_fee_payment((select v::uuid from t_ids where k = 'p4'), 'txn-4', 7500, 'EGP', 'ord-p4');
select pg_temp.as_role('authenticated', 'e2e2e2e2-0000-0000-0000-000000000002', format($$select public.cancel_booking(%L, 'sick')$$, (select v from t_ids where k = 'b4')));
select pg_temp.check((select status = 'refund_due' and refund_cents = 7500 and refund_reason = 'cancelled_by_other_person' from public.booking_payments where id = (select v::uuid from t_ids where k = 'p4')), 'a host cancel was not refunded in full');
-- the owner cancels within 48 hours of the start: nothing back (the booking is made starting tomorrow by editing the dates directly)
select pg_temp.agree('b5', 'e1e1e1e1-0000-0000-0000-000000000001', 'e2e2e2e2-0000-0000-0000-000000000002', 'e1e1e1e1-1111-0000-0000-000000000001', 80);
insert into t_ids select 'p5', payment_id::text from public.begin_fee_payment((select v::uuid from t_ids where k = 'b5'), 'e1e1e1e1-0000-0000-0000-000000000001', 'paymob');
select public.set_payment_ref((select v::uuid from t_ids where k = 'p5'), 'ord-p5');
select public.complete_fee_payment((select v::uuid from t_ids where k = 'p5'), 'txn-5', 7500, 'EGP', 'ord-p5');
update public.bookings set starts_on = current_date + 1, ends_on = current_date + 3 where id = (select v::uuid from t_ids where k = 'b5');
select pg_temp.check(pg_temp.as_role('authenticated', 'e1e1e1e1-0000-0000-0000-000000000001', format($$select refund_cents from public.refund_preview(%L)$$, (select v from t_ids where k = 'b5')))::int = 0, 'the preview for a late cancel is not zero');
select pg_temp.as_role('authenticated', 'e1e1e1e1-0000-0000-0000-000000000001', format($$select public.cancel_booking(%L, 'late')$$, (select v from t_ids where k = 'b5')));
select pg_temp.check((select status = 'paid' and refund_cents = 0 and refund_reason = 'cancelled_late' from public.booking_payments where id = (select v::uuid from t_ids where k = 'p5')), 'a late owner cancel was refunded');
update public.app_settings set value = '0' where key = 'refund_processing_charge_egp';

\echo '--- F7 one fee for a swap, paid by whoever asked first, confirming both legs'
insert into t_ids select 'sw', pg_temp.as_role('authenticated', 'e4e4e4e4-0000-0000-0000-000000000004', $$select public.request_swap('e5e5e5e5-0000-0000-0000-000000000005', 'e4e4e4e4-1111-0000-0000-000000000004', 'e5e5e5e5-1111-0000-0000-000000000005', current_date + 100, current_date + 103, current_date + 110, current_date + 113, false)$$);
select pg_temp.as_role('authenticated', 'e4e4e4e4-0000-0000-0000-000000000004', format($$select public.accept_terms((select id from public.bookings where swap_group = %L and owner_id = 'e4e4e4e4-0000-0000-0000-000000000004'), (select terms_version from public.bookings where swap_group = %L limit 1))$$, (select v from t_ids where k = 'sw'), (select v from t_ids where k = 'sw')));
select pg_temp.as_role('authenticated', 'e5e5e5e5-0000-0000-0000-000000000005', format($$select public.accept_terms((select id from public.bookings where swap_group = %L and owner_id = 'e5e5e5e5-0000-0000-0000-000000000005'), (select terms_version from public.bookings where swap_group = %L limit 1))$$, (select v from t_ids where k = 'sw'), (select v from t_ids where k = 'sw')));
select pg_temp.check(public.fee_payer((select id from public.bookings where swap_group = (select v::uuid from t_ids where k = 'sw') limit 1)) = 'e4e4e4e4-0000-0000-0000-000000000004', 'the swap fee is not paid by whoever asked first');
select pg_temp.fails((select format($$select public.begin_fee_payment(%L, 'e5e5e5e5-0000-0000-0000-000000000005', 'paymob')$$, id) from public.bookings where swap_group = (select v::uuid from t_ids where k = 'sw') limit 1), 'the other person of a swap was asked to pay');
insert into t_ids select 'psw', payment_id::text from public.begin_fee_payment((select id from public.bookings where swap_group = (select v::uuid from t_ids where k = 'sw') order by created_at, id limit 1), 'e4e4e4e4-0000-0000-0000-000000000004', 'paymob');
select public.set_payment_ref((select v::uuid from t_ids where k = 'psw'), 'ord-psw');
select pg_temp.check(public.complete_fee_payment((select v::uuid from t_ids where k = 'psw'), 'txn-sw', 7500, 'EGP', 'ord-psw') = 'paid', 'the swap fee did not pay');
select pg_temp.check((select count(*) = 2 and bool_and(status = 'confirmed' and fee_status = 'paid') from public.bookings where swap_group = (select v::uuid from t_ids where k = 'sw')), 'one swap fee did not confirm both legs');
select pg_temp.check((select count(*) = 1 from public.booking_payments where booking_id in (select id from public.bookings where swap_group = (select v::uuid from t_ids where k = 'sw'))), 'a swap has more than one payment');

\echo '--- F8 attempts are limited'
select pg_temp.agree('b6', 'e1e1e1e1-0000-0000-0000-000000000001', 'e2e2e2e2-0000-0000-0000-000000000002', 'e1e1e1e1-1111-0000-0000-000000000001', 130);
do $$ begin for i in 1..5 loop perform public.begin_fee_payment((select v::uuid from t_ids where k = 'b6'), 'e1e1e1e1-0000-0000-0000-000000000001', 'paymob'); end loop; end $$;
select pg_temp.fails(format($$select public.begin_fee_payment(%L, 'e1e1e1e1-0000-0000-0000-000000000001', 'paymob')$$, (select v from t_ids where k = 'b6')), 'a sixth payment attempt in an hour was accepted');
select public.fail_fee_payment(id) from public.booking_payments where booking_id = (select v::uuid from t_ids where k = 'b6');

select pg_temp.check((select bool_and(status = 'failed') from public.booking_payments where booking_id = (select v::uuid from t_ids where k = 'b6')), 'failed payments were not marked failed');

\echo '--- F9 one provider transaction can pay only one payment'
select pg_temp.agree('b7', 'e1e1e1e1-0000-0000-0000-000000000001', 'e2e2e2e2-0000-0000-0000-000000000002', 'e1e1e1e1-1111-0000-0000-000000000001', 150);
insert into t_ids select 'p7', payment_id::text from public.begin_fee_payment((select v::uuid from t_ids where k = 'b7'), 'e1e1e1e1-0000-0000-0000-000000000001', 'paymob');
select public.set_payment_ref((select v::uuid from t_ids where k = 'p7'), 'ord-p7');
select pg_temp.fails($$select public.complete_fee_payment((select v::uuid from t_ids where k = 'p7'), 'txn-1', 7500, 'EGP', 'ord-p7')$$, 'a transaction that already paid one booking paid another');
select pg_temp.check((select status = 'terms_agreed' and fee_status = 'unpaid' from public.bookings where id = (select v::uuid from t_ids where k = 'b7')), 'a reused transaction changed the booking');

\echo '--- F10 a failure callback needs the right order id, and a second payment is refunded not lost'
select pg_temp.agree('b9', 'e1e1e1e1-0000-0000-0000-000000000001', 'e2e2e2e2-0000-0000-0000-000000000002', 'e1e1e1e1-1111-0000-0000-000000000001', 170);
insert into t_ids select 'p9', payment_id::text from public.begin_fee_payment((select v::uuid from t_ids where k = 'b9'), 'e1e1e1e1-0000-0000-0000-000000000001', 'paymob');
select public.set_payment_ref((select v::uuid from t_ids where k = 'p9'), 'ord-p9');
select public.fail_fee_payment((select v::uuid from t_ids where k = 'p9'), 'someone-elses-order');
select pg_temp.check((select status = 'created' from public.booking_payments where id = (select v::uuid from t_ids where k = 'p9')), 'a failure callback for another order failed this payment');
insert into t_ids select 'p9b', payment_id::text from public.begin_fee_payment((select v::uuid from t_ids where k = 'b9'), 'e1e1e1e1-0000-0000-0000-000000000001', 'paymob');
select public.set_payment_ref((select v::uuid from t_ids where k = 'p9b'), 'ord-p9b');
select pg_temp.check(public.complete_fee_payment((select v::uuid from t_ids where k = 'p9'), 'txn-9', 7500, 'EGP', 'ord-p9') = 'paid', 'the first payment did not pay');
select pg_temp.check(public.complete_fee_payment((select v::uuid from t_ids where k = 'p9b'), 'txn-9b', 7500, 'EGP', 'ord-p9b') = 'refund_due', 'a second payment for a paid booking was not marked for refund');
select pg_temp.check((select count(*) = 1 from public.booking_payments where booking_id = (select v::uuid from t_ids where k = 'b9') and status = 'paid'), 'a booking has two paid payments');
select pg_temp.check((select provider_txn_id = 'txn-9b' and refund_cents = 7500 from public.booking_payments where id = (select v::uuid from t_ids where k = 'p9b')), 'the second payment was not recorded for refund');
select pg_temp.fails_as('authenticated', 'e1e1e1e1-0000-0000-0000-000000000001', $$select public.fail_fee_payment(gen_random_uuid())$$, 'a user failed a payment');
-- five failed refund tries leave a record for a person
select public.mark_refund_result((select v::uuid from t_ids where k = 'p9b'), false);
update public.booking_payments set refund_attempts = 5 where id = (select v::uuid from t_ids where k = 'p9b');
select pg_temp.check(public.mark_refund_result((select v::uuid from t_ids where k = 'p9b'), false) = 'stuck', 'a stuck refund was not reported');
select pg_temp.check((select count(*) >= 1 from public.security_events where kind = 'refund_stuck'), 'a stuck refund left no event');

\echo 'payment assertions OK'
