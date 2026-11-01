import assert from 'node:assert/strict';
import { test } from 'node:test';
import { confirmLabel, nice, actionArgs, actionsFor, cleanCode, gateFor, IDLE_LIMIT_MS, isIdle, looksLikeId, validateAction, type ActionForm } from './rules.ts';

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

test('sign-in decisions follow the database answer', () => {
  assert.equal(gateFor('admin'), 'show');
  assert.equal(gateFor('needs_mfa'), 'ask_code');
  assert.equal(gateFor('not_admin'), 'deny');
  assert.equal(gateFor(null), 'deny');
  assert.equal(gateFor('anything else'), 'deny');
});

test('idle sign-out and code cleaning', () => {
  assert.equal(isIdle(0, IDLE_LIMIT_MS - 1), false);
  assert.equal(isIdle(0, IDLE_LIMIT_MS), true);
  assert.equal(cleanCode('123 456'), '123456');
  assert.equal(cleanCode('12345'), null);
  assert.equal(cleanCode('12345a'), null);
  assert.equal(cleanCode('1234567'), null);
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

import { hoursWaiting, matchesMembership, membershipState, validateSetting, waitingText } from './rules.ts';

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
  assert.equal(validateSetting('bank_iban', 'EG00 0000'), null);
  assert.equal(validateSetting('something_else', '1'), 'Unknown setting.');
});

test('the users filter for membership', () => {
  assert.equal(matchesMembership('', null, '2026-11-01'), true);
  assert.equal(matchesMembership('unpaid', null, '2026-11-01'), true);
  assert.equal(matchesMembership('expiring', '2026-11-05', '2026-11-01'), true);
  assert.equal(matchesMembership('expiring', '2026-12-05', '2026-11-01'), false);
  assert.equal(matchesMembership('paused', '2026-10-01', '2026-11-01'), true);
});
