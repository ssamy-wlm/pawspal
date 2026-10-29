// Run: node --test scripts/audit-gate.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { blockingAdvisories, evaluate, packageOf, shippedFromSourceMaps } from './audit-gate.mjs';

const adv = (pkg, id, severity = 'high') => ({ vulnerabilities: { [pkg]: { via: [{ name: pkg, severity, url: `https://github.com/advisories/${id}`, title: 'bad thing' }] },
  expo: { via: [pkg] } } });
const entry = (id, expires = '2027-01-27') => ({ advisory: id, reason: 'tooling only', expires });
const run = (audit, shipped, allowlist, today = '2026-11-01') => evaluate({ audit, shipped: new Set(shipped), allowlist, today });

test('package names are read from bundle paths', () => {
  assert.equal(packageOf('../../node_modules/react-native/index.js'), 'react-native');
  assert.equal(packageOf('/a/node_modules/@expo/vector-icons/x.js'), '@expo/vector-icons');
  assert.equal(packageOf('/a/node_modules/x/node_modules/@s/inner/y.js'), '@s/inner');
  assert.equal(packageOf('app/index.tsx'), null);
  const core = ['react/i.js', 'react-native/i.js', 'expo-router/i.js'].map((p) => `/n/node_modules/${p}`);
  assert.ok(shippedFromSourceMaps([{ sources: [...core, '/n/node_modules/a/i.js', 'app/x.tsx'] }]).has('a'));
});

test('indexed (sectioned) source maps are read, and an empty list is refused', () => {
  const core = ['react/i.js', 'react-native/i.js', 'expo-router/i.js'].map((p) => `/n/node_modules/${p}`);
  const shipped = shippedFromSourceMaps([{ sections: [{ map: { sources: [...core, '/n/node_modules/@s/deep/y.js'] } }] }]);
  assert.ok(shipped.has('@s/deep') && shipped.has('react-native'));
  assert.throws(() => shippedFromSourceMaps([{ sections: [] }]), /Cannot tell what ships/);
});

test('only high and critical advisories count, and propagated "via" strings are ignored', () => {
  assert.equal(blockingAdvisories(adv('zod', 'GHSA-1', 'high')).length, 1);
  assert.equal(blockingAdvisories(adv('deepmerge', 'GHSA-2', 'low')).length, 0);
});

test('a high advisory in a package that ships FAILS, even if allowlisted', () => {
  const r = run(adv('markdown-it', 'GHSA-3'), ['markdown-it'], [entry('GHSA-3')]);
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0], /SHIPS in the app/);
});

test('build-tool advisory: passes only when allowlisted and not expired', () => {
  assert.equal(run(adv('zod', 'GHSA-4'), [], [entry('GHSA-4')]).problems.length, 0);
  assert.equal(run(adv('zod', 'GHSA-4'), [], []).problems.length, 1);
  assert.match(run(adv('zod', 'GHSA-4'), [], [entry('GHSA-4', '2026-10-31')]).problems[0], /expired/);
  assert.match(run(adv('zod', 'GHSA-4'), [], [{ advisory: 'GHSA-4', expires: '2027-01-01' }]).problems[0], /reason/);
});

test('a brand-new advisory fails until reviewed; stale allowlist entries are reported', () => {
  const r = run(adv('zod', 'GHSA-NEW'), [], [entry('GHSA-OLD')]);
  assert.equal(r.problems.length, 1);
  assert.ok(r.notes.some((n) => n.includes('GHSA-OLD') && n.includes('remove it')));
});
