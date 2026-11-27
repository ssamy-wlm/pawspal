import assert from 'node:assert/strict';
import { test } from 'node:test';
import { confirmLabel, nice, actionArgs, actionsFor, IDLE_LIMIT_MS, isIdle, looksLikeId, validateAction, type ActionForm } from './rules.ts';

const form = (over: Partial<ActionForm> = {}): ActionForm => ({ action: 'warning', rule: 'Real photos only', message: 'Please use real photos', length: '3', checklist: '', ...over });

test('only the actions that fit the status are offered', () => {
  assert.deepEqual(actionsFor('pending_review'), ['approval', 'removal']);
  assert.ok(actionsFor('active').includes('suspension'));
  assert.ok(!actionsFor('active').includes('reinstatement'));
  assert.deepEqual(actionsFor('removed'), ['reinstatement']);
  assert.deepEqual(actionsFor('pending_verification'), []);
});

test('a sanction needs a rule and a message, an approval needs neither', () => {
  assert.equal(validateAction('active', form()), null);
  assert.match(validateAction('active', form({ rule: '' }))!, /rule/);
  assert.match(validateAction('active', form({ message: '  ' }))!, /message/);
  assert.equal(validateAction('pending_review', form({ action: 'approval', rule: '', message: '' })), null);
  assert.match(validateAction('active', form({ action: 'approval' }))!, /status/);
  assert.match(validateAction('active', form({ message: 'x'.repeat(1001) }))!, /too long/);
});

test('a suspension is 3 days, 7 days or until fixed, never two of them', () => {
  const a = actionArgs('u', form({ action: 'suspension', length: '7' }));
  assert.equal(a.p_duration_days, 7); assert.equal(a.p_until_fixed, false); assert.deepEqual(a.p_checklist, []);
  const f = actionArgs('u', form({ action: 'suspension', length: 'fixed', checklist: ' Remove the phone number \n\n Use a real photo ' }));
  assert.equal(f.p_duration_days, null); assert.equal(f.p_until_fixed, true); assert.deepEqual(f.p_checklist, ['Remove the phone number', 'Use a real photo']);
});

test('only a suspension carries a length, and an approval sends no rule', () => {
  const w = actionArgs('u', form({ action: 'warning', length: '7' }));
  assert.equal(w.p_duration_days, null); assert.equal(w.p_until_fixed, false);
  const ap = actionArgs('u', form({ action: 'approval', rule: 'ignored', message: '' }));
  assert.equal(ap.p_rule, null); assert.equal(ap.p_message, null);
});

test('idle sign-out and ids', () => {
  assert.equal(isIdle(0, IDLE_LIMIT_MS - 1), false);
  assert.equal(isIdle(0, IDLE_LIMIT_MS), true);
  assert.equal(looksLikeId('6f1c2a40-1111-4222-8333-444455556666'), true);
  assert.equal(looksLikeId('Mona'), false);
});

test('a suspension needs a length, and the confirm button names it', () => {
  assert.match(validateAction('active', form({ action: 'suspension', length: '' }))!, /how long/);
  assert.equal(validateAction('active', form({ action: 'suspension', length: '7' })), null);
  assert.equal(confirmLabel({ action: 'suspension', length: '7' }), 'Yes, suspend for 7 days');
  assert.equal(confirmLabel({ action: 'suspension', length: 'fixed' }), 'Yes, suspend until fixed');
  assert.equal(confirmLabel({ action: 'removal', length: '' }), 'Yes, remove and ban this person');
  assert.equal(nice('terms_agreed_now'), 'terms agreed now');
});

import tokens from './tokens.json' with { type: 'json' };
test('the accent button is brand orange with navy text (docs/design-system.md)', () => {
  assert.equal(tokens.color.light.accent.toLowerCase(), '#ff9f43');
  assert.equal(tokens.color.light.onAccent.toLowerCase(), '#1f2d3d');
  const lum = (hex: string) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const [a, b] = [lum(tokens.color.light.accent), lum(tokens.color.light.onAccent)];
  assert.ok((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5, 'navy on orange must pass AA');
});

import { DELETED_NAME, hoursWaiting, isClosedAccount, matchesAccount, matchesMembership, membershipState, personName, purgeState, validateSetting, waitingText } from './rules.ts';

test('membership state from the paid-until date', () => {
  assert.equal(membershipState(null, '2026-11-01'), 'unpaid');
  assert.equal(membershipState('2026-10-31', '2026-11-01'), 'paused');
  assert.equal(membershipState('2026-11-01', '2026-11-01'), 'due_soon');
  assert.equal(membershipState('2026-11-08', '2026-11-01'), 'due_soon');
  assert.equal(membershipState('2026-11-09', '2026-11-01'), 'active');
  assert.equal(membershipState('2026-11-09', '2026-11-01', 10), 'due_soon');
  assert.equal(membershipState('2026-11-01', new Date('2026-11-01T22:00:00Z')), 'due_soon');
});

test('waiting time in hours and words', () => {
  const now = Date.parse('2026-11-01T12:00:00Z');
  assert.equal(hoursWaiting('2026-11-01T09:30:00Z', now), 2);
  assert.equal(hoursWaiting('2026-11-01T13:00:00Z', now), 0);
  assert.equal(waitingText(3), 'waiting 3 hours');
  assert.equal(waitingText(1), 'waiting 1 hour');
  assert.equal(waitingText(0), 'waiting less than an hour');
  assert.equal(waitingText(72), 'waiting 3 days');
});

test('settings are checked before they are sent', () => {
  assert.equal(validateSetting('registration_fee_egp', '75'), null);
  assert.match(validateSetting('registration_fee_egp', '0')!, /1 to 100000/);
  assert.match(validateSetting('renewal_fee_egp', '100001')!, /1 to 100000/);
  assert.match(validateSetting('membership_months', '61')!, /1 to 60/);
  assert.match(validateSetting('reminder_days', '-3')!, /whole number/);
  assert.match(validateSetting('reminder_days', '2.5')!, /whole number/);
  assert.match(validateSetting('reminder_days', '')!, /whole number/);
  assert.equal(validateSetting('membership_months', ' 12 '), null);
  assert.equal(validateSetting('instapay_link', ''), null);
  assert.equal(validateSetting('instapay_link', 'https://ipn.eg/S/pawspal'), null);
  assert.match(validateSetting('instapay_link', 'javascript:alert(1)')!, /https/);
  assert.match(validateSetting('payment_note', 'x'.repeat(501))!, /too long/);
  assert.equal(validateSetting('bank_iban', 'EG00 0000'), 'Unknown setting.');
  assert.equal(validateSetting('bank_name', 'x'), 'Unknown setting.');
  assert.equal(validateSetting('something_else', '1'), 'Unknown setting.');
});

test('the users filter for membership', () => {
  assert.equal(matchesMembership('', null, '2026-11-01'), true);
  assert.equal(matchesMembership('unpaid', null, '2026-11-01'), true);
  assert.equal(matchesMembership('expiring', '2026-11-05', '2026-11-01'), true);
  assert.equal(matchesMembership('expiring', '2026-12-05', '2026-11-01'), false);
  assert.equal(matchesMembership('paused', '2026-10-01', '2026-11-01'), true);
});

test('the three phase 9 settings mirror admin_set_setting exactly', () => {
  assert.equal(validateSetting('push_enabled', 'true'), null);
  assert.equal(validateSetting('push_enabled', ' false '), null);
  assert.match(validateSetting('push_enabled', 'yes')!, /on or off/);
  assert.match(validateSetting('push_enabled', '')!, /on or off/);
  assert.match(validateSetting('push_enabled', 'TRUE')!, /on or off/);
  assert.equal(validateSetting('deletion_grace_days', '30'), null);
  assert.equal(validateSetting('deletion_grace_days', '1'), null);
  assert.equal(validateSetting('deletion_grace_days', '365'), null);
  assert.match(validateSetting('deletion_grace_days', '0')!, /1 to 365/);
  assert.match(validateSetting('deletion_grace_days', '366')!, /1 to 365/);
  assert.match(validateSetting('deletion_grace_days', '1000')!, /whole number/);   // four digits: the database pattern allows three
  assert.match(validateSetting('deletion_grace_days', '3.5')!, /whole number/);
  assert.match(validateSetting('deletion_grace_days', '-1')!, /whole number/);
  assert.match(validateSetting('deletion_grace_days', '')!, /whole number/);
  assert.equal(validateSetting('shared_history_months', '24'), null);
  assert.equal(validateSetting('shared_history_months', '120'), null);
  assert.match(validateSetting('shared_history_months', '121')!, /1 to 120/);
  assert.match(validateSetting('shared_history_months', '0')!, /1 to 120/);
  assert.match(validateSetting('shared_history_months', 'two years')!, /whole number/);
  assert.match(validateSetting('reminder_days', '007')!, /whole number/);           // three digits: the database allows two
  assert.equal(validateSetting('registration_fee_egp', '100000'), null);
  assert.match(validateSetting('registration_fee_egp', '1000000')!, /whole number/);
});

test('a closed account shows as Deleted user and offers no actions', () => {
  const stub = { status: 'removed', first_name: DELETED_NAME, deleted_at: '2026-11-01T10:00:00Z' };
  assert.equal(isClosedAccount(stub), true);
  assert.equal(isClosedAccount({ status: 'removed', first_name: 'Mona', deleted_at: null }), false);   // removed by a moderator
  assert.equal(isClosedAccount({ status: 'removed', first_name: DELETED_NAME, deleted_at: null }), true);
  assert.equal(isClosedAccount(null), false);
  assert.equal(personName(stub), 'Deleted user');
  assert.equal(personName(null), 'Deleted user');
  assert.equal(personName({ status: 'active', first_name: 'Mona' }), 'Mona');
  assert.deepEqual(actionsFor('removed', true), []);
  assert.deepEqual(actionsFor('removed'), ['reinstatement']);                    // a person removed by a moderator can still be reinstated
  assert.match(validateAction('removed', form({ action: 'reinstatement', rule: '', message: '' }), true)!, /closed/);
  assert.equal(validateAction('removed', form({ action: 'reinstatement', rule: '', message: '' })), null);
});

test('when a closed account is purged', () => {
  const now = Date.parse('2026-11-10T00:00:00Z');
  assert.equal(purgeState({ deleted_at: null }, now), 'open');
  assert.equal(purgeState(null, now), 'open');
  assert.equal(purgeState({ deleted_at: '2026-11-01T00:00:00Z', purge_after: '2026-12-01T00:00:00Z', purged_at: null }, now), 'waiting');
  assert.equal(purgeState({ deleted_at: '2026-10-01T00:00:00Z', purge_after: '2026-11-01T00:00:00Z', purged_at: null }, now), 'due');
  assert.equal(purgeState({ deleted_at: '2026-10-01T00:00:00Z', purge_after: '2026-11-01T00:00:00Z', purged_at: '2026-11-02T00:00:00Z' }, now), 'purged');
  assert.equal(purgeState({ deleted_at: '2026-10-01T00:00:00Z', purge_after: null, purged_at: null }, now), 'due');
});

test('the users filter for closed accounts', () => {
  const closed = { status: 'removed', first_name: DELETED_NAME, deleted_at: '2026-11-01T00:00:00Z' };
  const open = { status: 'active', first_name: 'Mona', deleted_at: null };
  assert.equal(matchesAccount('', closed), true);
  assert.equal(matchesAccount('closed', closed), true);
  assert.equal(matchesAccount('closed', open), false);
  assert.equal(matchesAccount('open', closed), false);
  assert.equal(matchesAccount('open', open), true);
});

test('the InstaPay and Vodafone Cash settings mirror admin_set_setting exactly', () => {
  for (const k of ['instapay_address', 'vodafone_cash_number', 'vodafone_cash_name', 'vodafone_cash_link']) assert.equal(validateSetting(k, ''), null, k);
  assert.equal(validateSetting('instapay_address', '  your.name-1_x@instapay '), null);
  assert.equal(validateSetting('instapay_address', 'ab@cd'), null);
  assert.equal(validateSetting('instapay_address', `${'a'.repeat(40)}@${'b'.repeat(30)}`), null);
  for (const bad of ['noatsign', 'a@instapay', 'name@i', 'na me@instapay', 'name@insta pay', 'name@@instapay', 'na+me@instapay', 'name@insta_pay', '<b>x</b>@instapay', `${'a'.repeat(41)}@instapay`, `name@${'a'.repeat(31)}`, 'name@instapay\nx']) {
    assert.match(validateSetting('instapay_address', bad)!, /yourname@instapay/, bad);
  }
  for (const good of ['01012345678', '+201012345678', '01512345678']) assert.equal(validateSetting('vodafone_cash_number', good), null, good);
  for (const bad of ['1012345678', '0101234567', '010123456789', '02012345678', '+2001012345678', '+20101234567', '0101 234 5678', '010-1234-5678', '0101234567a', '+1 01012345678', '0020101234567']) {
    assert.match(validateSetting('vodafone_cash_number', bad)!, /01012345678/, bad);
  }
  assert.equal(validateSetting('vodafone_cash_name', 'Sara Ali'), null);
  assert.equal(validateSetting('vodafone_cash_name', 'سارة علي'), null);
  assert.equal(validateSetting('vodafone_cash_name', 'x'.repeat(60)), null);
  assert.match(validateSetting('vodafone_cash_name', 'x'.repeat(61))!, /60 characters/);
  assert.match(validateSetting('vodafone_cash_name', 'Sara\nAli')!, /one line/);
  assert.match(validateSetting('vodafone_cash_name', 'Sara\tAli')!, /one line/);
  assert.match(validateSetting('vodafone_cash_name', 'Sara\u0001Ali')!, /one line/);
  for (const k of ['instapay_link', 'instapay_qr_url', 'vodafone_cash_link']) {
    assert.equal(validateSetting(k, 'https://vf.example/pay'), null, k);
    for (const bad of ['http://vf.example', 'javascript:alert(1)', 'data:text/html;base64,AAAA', 'https://', 'https://a b.example', 'HTTPS://vf.example/pay', '//vf.example', `https://${'a'.repeat(500)}`]) {
      assert.match(validateSetting(k, bad)!, /https/, `${k} ${bad}`);
    }
  }
});
