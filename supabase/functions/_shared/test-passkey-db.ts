// A small in-memory stand-in for the pk_* database helpers (migration 0014), used only by the tests. It follows the same rules
// as the SQL (single-use challenges, the counter rule, ten passkeys, recovery lock-out ...); the real SQL is tested in
// supabase/tests/passkey_assertions.sql. Not imported by any function.
import type { Rpc } from './http.ts';

export interface Cred { id: string; user: string; credential_id: string; public_key: string; counter: number; transports: string[]; name: string; device_type: string; backed_up: boolean; last_used_at: string | null; created_at: string }

export class FakePasskeyDb {
  admins = new Set<string>();
  creds: Cred[] = [];
  challenges = new Map<string, string>();               // "user|session|purpose" -> challenge
  sessions = new Map<string, { user: string; via: 'passkey' | 'recovery'; minutes: number; stepUp: boolean }>();
  setupCodes = new Map<string, { code: string; used: boolean }>();   // user -> code (normalised)
  recovery = new Map<string, { hash: string; used: boolean }[]>();
  failures = new Map<string, { kind: string; session: string | null }[]>();      // user -> events (all "within the hour")
  notes: { user: string; kind: string; details: unknown }[] = [];
  calls: { name: string; args: Record<string, unknown> }[] = [];
  failNext: string | null = null;                         // an rpc name that answers with an error once
  private seq = 0;

  constructor(admins: string[] = []) { admins.forEach((a) => this.admins.add(a)); }

  private addFailure(user: string, kind: string, session: string | null) { this.failures.set(user, [...(this.failures.get(user) ?? []), { kind, session }]); }
  /** 5 failures for one session; 100 wrong recovery/setup codes for the user (a verified session only counts its own). */
  private locked(user: string, session: string | null) {
    const all = this.failures.get(user) ?? [];
    if (session && all.filter((e) => e.session === session).length >= 5) return true;
    const s = session ? this.sessions.get(session) : undefined;
    if (s && s.user === user) return false;
    return all.filter((e) => e.kind !== 'login_failed').length >= 100;     // passkey failures never count per user
  }
  private norm = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, '');
  private mine(user: string) { return this.creds.filter((c) => c.user === user); }

  rpc: Rpc = async (name, args) => {
    this.calls.push({ name, args });
    if (this.failNext === name) { this.failNext = null; return { data: null, error: { message: 'boom' } }; }
    try {
      return { data: this.run(name, args), error: null };
    } catch (e) {
      return { data: null, error: { message: (e as Error).message } };
    }
  };

  private run(name: string, a: Record<string, unknown>): unknown {
    const user = a.p_user as string;
    const session = a.p_session as string;
    switch (name) {
      case 'pk_state': {
        const s = this.sessions.get(session);
        const ok = s && s.user === user;
        return {
          is_admin_row: this.admins.has(user),
          passkeys: this.mine(user).map((c) => ({ id: c.id, name: c.name, created_at: c.created_at, last_used_at: c.last_used_at, device_type: c.device_type, backed_up: c.backed_up })),
          verified: !!ok, via: ok ? s.via : null,
          recovery_codes_left: (this.recovery.get(user) ?? []).filter((r) => !r.used).length,
          expires_at: ok ? new Date(Date.UTC(2030, 0, 1)).toISOString() : null, step_up: !!ok && s.via === 'passkey' && s.stepUp,
          locked: this.locked(user, session),
        };
      }
      case 'pk_new_challenge': this.challenges.set(`${user}|${session}|${a.p_purpose}`, a.p_challenge as string); return 'challenge-id';
      case 'pk_take_challenge': {
        const k = `${user}|${session}|${a.p_purpose}`;
        const c = this.challenges.get(k) ?? null;
        this.challenges.delete(k);
        return c;
      }
      case 'pk_check_setup_code': {
        if (this.locked(user, session)) return 'locked';
        const s = this.setupCodes.get(user);
        if (s && !s.used && s.code === this.norm(a.p_code as string)) return 'ok';
        this.addFailure(user, 'setup_failed', session);
        return 'bad';
      }
      case 'pk_credentials': return this.mine(user).map((c) => ({ id: c.credential_id, transports: c.transports }));
      case 'pk_credential': {
        const c = this.mine(user).find((x) => x.credential_id === a.p_credential_id);
        return c ? { id: c.id, credential_id: c.credential_id, public_key: c.public_key, counter: c.counter, transports: c.transports } : null;
      }
      case 'pk_add_credential': {
        if (!this.admins.has(user)) return { status: 'not_allowed' };
        if (this.mine(user).length >= 10) return { status: 'limit' };
        if (this.creds.some((c) => c.credential_id === a.p_credential_id)) return { status: 'duplicate' };
        if (a.p_setup_code != null) {
          const s = this.setupCodes.get(user);
          if (!s || s.used || s.code !== this.norm(a.p_setup_code as string)) { this.addFailure(user, 'setup_failed', (a.p_session as string) ?? null); return { status: 'bad_setup_code' }; }
          s.used = true;
        }
        const id = `00000000-0000-4000-8000-${String(++this.seq).padStart(12, '0')}`;
        this.creds.push({ id, user, credential_id: a.p_credential_id as string, public_key: a.p_public_key as string, counter: a.p_counter as number,
          transports: (a.p_transports as string[] | null) ?? [], name: a.p_name as string, device_type: a.p_device_type as string, backed_up: a.p_backed_up as boolean,
          last_used_at: null, created_at: new Date(0).toISOString() });
        return { status: 'ok', id };
      }
      case 'pk_use_counter': {
        const c = this.creds.find((x) => x.id === a.p_id);
        const n = a.p_new as number;
        if (!c || n < 0 || ((n !== 0 || c.counter !== 0) && n <= c.counter)) return false;
        c.counter = n; c.last_used_at = new Date(0).toISOString();
        return true;
      }
      case 'pk_start_session': {
        const via = a.p_via as 'passkey' | 'recovery';
        const prev = this.sessions.get(session);
        if (prev && prev.via === 'passkey' && via === 'recovery') return new Date(0).toISOString();
        this.sessions.set(session, { user, via, minutes: Math.min(a.p_minutes as number, via === 'recovery' ? 30 : 480), stepUp: via === 'passkey' });
        return new Date(Date.UTC(2030, 0, 1)).toISOString();
      }
      case 'pk_set_step_up': {
        const s = this.sessions.get(session);
        if (!s || s.user !== user || s.via !== 'passkey') return null;
        s.stepUp = true;
        return new Date(Date.UTC(2030, 0, 1)).toISOString();
      }
      case 'pk_end_session': this.sessions.delete(a.p_session as string); return null;
      case 'pk_replace_recovery_codes': {
        const hs = a.p_hashes as string[];
        if (hs.length !== 10) throw new Error('invalid');
        this.recovery.set(user, hs.map((hash) => ({ hash, used: false })));
        return 10;
      }
      case 'pk_use_recovery_code': {
        const cur = this.sessions.get(session);
        if (cur && cur.user === user && cur.via === 'passkey') return { status: 'already', expires_at: new Date(Date.UTC(2030, 0, 1)).toISOString() };
        if (this.locked(user, session)) return { status: 'locked' };
        const r = (this.recovery.get(user) ?? []).find((x) => !x.used && x.hash === a.p_hash);
        if (!r) { this.addFailure(user, 'recovery_failed', session); return { status: 'bad' }; }
        r.used = true;
        this.sessions.set(session, { user, via: 'recovery', minutes: 30, stepUp: false });
        return { status: 'ok', expires_at: new Date(Date.UTC(2030, 0, 1)).toISOString() };
      }
      case 'pk_rename': {
        const c = this.mine(user).find((x) => x.id === a.p_id);
        if (!c) return false;
        c.name = a.p_name as string;
        return true;
      }
      case 'pk_remove': {
        const mine = this.mine(user);
        if (!mine.some((x) => x.id === a.p_id)) return 'not_found';
        if (mine.length <= 1) return 'last';
        this.creds = this.creds.filter((x) => x.id !== a.p_id);
        return 'ok';
      }
      case 'pk_note': {
        const kind = a.p_kind as string;
        this.notes.push({ user, kind, details: a.p_details });
        if (kind === 'login_failed') this.addFailure(user, 'login_failed', (a.p_session as string) ?? null);
        return null;
      }
      default: throw new Error('unknown rpc ' + name);
    }
  }
}
