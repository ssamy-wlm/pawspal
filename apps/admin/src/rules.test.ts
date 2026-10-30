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
