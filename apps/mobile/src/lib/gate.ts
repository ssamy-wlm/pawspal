// Decides which screen a person may be on. The server enforces the same rules (a person who is not active, or whose
// membership has run out, cannot search, message or book); this only keeps the app from showing screens that would be empty.

export type AccountStatus = 'pending_verification' | 'pending_review' | 'active' | 'suspended' | 'removed';
export type MembershipState = 'unpaid' | 'active' | 'due_soon' | 'paused';

export interface MembershipInfo {
  state: MembershipState;
  kind: 'registration' | 'renewal';
  paid_until: string | null;
  days_left: number | null;
  amount_egp: number;
  claim_status: 'none' | 'pending' | 'rejected';
  claim_note: string | null;
}

/** What `my_account_state()` returns (ARCHITECTURE section 9). */
export interface AccountState {
  status: AccountStatus;
  role: 'owner' | 'sitter';
  first_name: string | null;
  missing: string[];
  has_pet: boolean;
  has_home_photo: boolean;
  has_location: boolean;
  legal_accepted: boolean;
  verification: { status: 'none' | 'pending' | 'approved' | 'rejected'; note: string | null };
  membership: MembershipInfo;
}
/** The older name, still used by some screens. */
export type SignupState = AccountState;

export type StepName = 'selfie' | 'id' | 'about' | 'location' | 'rules';
export const STEPS: StepName[] = ['selfie', 'id', 'about', 'location', 'rules'];

const STEP_FOR: Record<string, StepName> = {
  verification: 'selfie', name: 'about', pet: 'about', home: 'about', location: 'location', legal: 'rules',
};

/** The first step that still has something missing. */
export function nextStep(missing: string[]): StepName {
  const needed = new Set(missing.map((m) => STEP_FOR[m]).filter(Boolean));
  return STEPS.find((s) => needed.has(s)) ?? 'rules';
}

// Screens anyone may open, signed in or not.
const FREE = ['legal', 'settings', 'showcase', 'reset-password'];
// Screens only for people who are not signed in yet (or are being moved on from).
const ENTRY = ['index', 'signup', 'signin', 'forgot', 'pending'];
// A person whose membership is unpaid or paused can still read and pay, but cannot search, message or book.
const WHILE_UNPAID = ['membership', 'safety', 'chat', 'booking', 'handover', 'review', 'profile', 'pets'];
const WHILE_UNPAID_TABS = ['chat', 'calendar', 'profile'];

/** Where to send someone, or null when they are already in the right place. */
export function routeFor(hasSession: boolean, state: AccountState | null, segments: string[]): string | null {
  const top = segments[0] ?? 'index';
  const free = FREE.includes(top);
  if (!hasSession) return free || top === 'auth' || (ENTRY.includes(top) && top !== 'pending') ? null : '/';
  if (!state) return null;                                       // still loading
  if (state.status === 'active') {
    const m = state.membership?.state;
    if (m === 'unpaid' || m === 'paused') {
      const ok = free || WHILE_UNPAID.includes(top) || (top === '(tabs)' && WHILE_UNPAID_TABS.includes(segments[1] ?? ''));
      return ok ? null : '/membership';
    }
    return ENTRY.includes(top) || top === 'auth' ? '/(tabs)/explore' : null;
  }
  if (state.status === 'pending_verification') {
    if (top === 'signup' || free) return null;
    return `/signup/${nextStep(state.missing)}`;
  }
  // pending_review, suspended, removed. A person waiting for review may pay the registration fee meanwhile.
  if (top === 'pending' || free || (top === 'membership' && state.status === 'pending_review')) return null;
  return '/pending';
}
