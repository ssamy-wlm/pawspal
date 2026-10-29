// Dependency audit gate for apps/mobile. Run from apps/mobile:  node ../../scripts/audit-gate.mjs
//
// Fails (exit 1) when an advisory rated HIGH or CRITICAL affects:
//   1. a package that ships inside the app bundle: always a failure, never allowed; or
//   2. a build-tool-only package, unless apps/mobile/audit-allowlist.json lists that advisory with a reason
//      and an expiry date that has not passed. New advisories fail until someone has looked at them.
// An allowlist entry that no longer matches any advisory is reported so it can be removed.
// "Ships in the app" is measured, not guessed: the production bundles are built and their source maps read.
//
// Options:  --audit <file>      use a saved `npm audit --json` result instead of running npm
//           --shipped <file>    JSON array of shipped package names instead of building the bundles
//           --allowlist <file>  default: audit-allowlist.json
//           --today YYYY-MM-DD  override today's date (tests)
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const BLOCKING = new Set(['high', 'critical']);

/** "…/node_modules/@scope/name/lib/x.js" -> "@scope/name" (last node_modules segment wins, so nested copies count). */
export function packageOf(source) {
  const i = source.lastIndexOf('node_modules/');
  if (i < 0) return null;
  const parts = source.slice(i + 'node_modules/'.length).split('/');
  return parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/** Metro writes "indexed" maps (sources inside `sections`); plain maps list `sources` at the top. Handle both. */
export function shippedFromSourceMaps(maps) {
  const out = new Set();
  const read = (m) => {
    for (const s of m.sources ?? []) { const p = packageOf(s); if (p) out.add(p); }
    for (const sec of m.sections ?? []) read(sec.map ?? {});
  };
  maps.forEach(read);
  // Sanity check: if this list were wrong or empty, "this package does not ship" would be meaningless.
  for (const must of ['react', 'react-native', 'expo-router']) {
    if (!out.has(must)) throw new Error(`Cannot tell what ships in the app: "${must}" is missing from the bundle's source maps.`);
  }
  return out;
}

/** Unique HIGH/CRITICAL advisories (not the propagated "via" strings npm adds up the dependency chain). */
export function blockingAdvisories(audit) {
  const found = new Map();
  for (const v of Object.values(audit.vulnerabilities ?? {})) {
    for (const via of v.via ?? []) {
      if (typeof via === 'object' && BLOCKING.has(via.severity)) {
        found.set(via.url, { id: via.url.split('/').pop(), url: via.url, pkg: via.name, severity: via.severity, title: via.title });
      }
    }
  }
  return [...found.values()];
}

export function evaluate({ audit, shipped, allowlist, today }) {
  const problems = [];
  const notes = [];
  const advisories = blockingAdvisories(audit);
  for (const a of advisories) {
    const label = `${a.severity.toUpperCase()} ${a.id} in ${a.pkg}: ${a.title}`;
    if (shipped.has(a.pkg)) {
      problems.push(`${label}\n    This package SHIPS in the app. Update or replace it; it cannot be allowlisted.`);
      continue;
    }
    const entry = allowlist.find((e) => e.advisory === a.id);
    if (!entry) problems.push(`${label}\n    Build tooling only, but not on the allowlist. Review it, then fix it or add it to audit-allowlist.json with a reason.`);
    else if (!entry.reason || !/^\d{4}-\d{2}-\d{2}$/.test(entry.expires ?? '')) problems.push(`${label}\n    Allowlist entry needs a reason and an expires date (YYYY-MM-DD).`);
    else if (entry.expires < today) problems.push(`${label}\n    Allowlist entry expired on ${entry.expires}. Check for a patched version and renew deliberately.`);
    else notes.push(`allowed until ${entry.expires}: ${label} (build tooling only, not in the app)`);
  }
  const live = new Set(advisories.map((a) => a.id));
  for (const e of allowlist) if (!live.has(e.advisory)) notes.push(`allowlist entry ${e.advisory} no longer matches any advisory: remove it`);
  return { problems, notes };
}

function arg(name) { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : undefined; }

function buildShipped() {
  const out = mkdtempSync(join(tmpdir(), 'bundle-'));
  execFileSync('npx', ['expo', 'export', '--platform', 'ios', '--platform', 'android', '--no-bytecode', '--dump-sourcemap', '--output-dir', out], {
    stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, EXPO_PUBLIC_SUPABASE_URL: 'http://localhost', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'audit-only' },
  });
  const maps = [];
  const walk = (d) => readdirSync(d, { withFileTypes: true }).forEach((e) => {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p); else if (e.name.endsWith('.map')) maps.push(JSON.parse(readFileSync(p, 'utf8')));
  });
  walk(out);
  if (!maps.length) throw new Error('No source maps were produced: cannot tell what ships in the app.');
  return shippedFromSourceMaps(maps);
}

function main() {
  const auditFile = arg('--audit');
  let auditText;
  if (auditFile) auditText = readFileSync(auditFile, 'utf8');
  else {
    try { auditText = execFileSync('npm', ['audit', '--omit=dev', '--json'], { encoding: 'utf8', maxBuffer: 1 << 26 }); }
    catch (e) { auditText = e.stdout; } // npm audit exits non-zero when it finds anything
  }
  const audit = JSON.parse(auditText);
  if (audit.error) throw new Error(`npm audit failed: ${audit.error.summary ?? JSON.stringify(audit.error)}`);

  const listFile = arg('--allowlist') ?? 'audit-allowlist.json';
  const allowlist = existsSync(listFile) ? JSON.parse(readFileSync(listFile, 'utf8')).allowed ?? [] : [];
  const advisories = blockingAdvisories(audit);
  const shipped = arg('--shipped') ? new Set(JSON.parse(readFileSync(arg('--shipped'), 'utf8')))
    : advisories.length ? buildShipped() : new Set();   // nothing to classify: skip the slow bundle build
  const today = arg('--today') ?? new Date().toISOString().slice(0, 10);

  const { problems, notes } = evaluate({ audit, shipped, allowlist, today });
  console.log(`audit gate: ${advisories.length} high/critical advisor${advisories.length === 1 ? 'y' : 'ies'}, ${shipped.size} packages ship in the app`);
  for (const n of notes) console.log('  note: ' + n);
  if (problems.length) {
    console.log('\nAUDIT GATE FAILED');
    for (const p of problems) console.log('  - ' + p);
    process.exit(1);
  }
  console.log('audit gate OK');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
