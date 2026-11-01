import { AccountState, nextStep, routeFor, STEPS } from '../src/lib/gate';

const membership = (over: Partial<AccountState['membership']> = {}): AccountState['membership'] => ({
  state: 'unpaid', kind: 'registration', paid_until: null, days_left: null, amount_egp: 75, claim_status: 'none', claim_note: null, ...over,
});
const state = (over: Partial<AccountState> = {}): AccountState => ({
  status: 'pending_verification', role: 'owner', first_name: null, missing: ['verification', 'name', 'pet', 'location', 'legal'],
  has_pet: false, has_home_photo: false, has_location: false, legal_accepted: false,
  verification: { status: 'none', note: null }, membership: membership(), ...over,
});
const active = (m: Partial<AccountState['membership']> = {}) => state({ status: 'active', missing: [], membership: membership(m) });
const paid = { state: 'active' as const, kind: 'renewal' as const, paid_until: '2027-05-01', days_left: 100 };

describe('signed-out people', () => {
  it('may see Welcome, sign-up, sign-in, forgot, reset, the email-link screens and the legal texts', () => {
    for (const seg of [['index'], ['signup', 'account'], ['signup', 'check-email'], ['signin'], ['forgot'], ['reset-password'], ['auth', 'callback'], ['auth', 'reset'], ['legal', '[doc]'], ['settings']]) {
      expect(routeFor(false, null, seg)).toBeNull();
    }
  });
  it('are sent to Welcome from everything else', () => {
    for (const seg of [['(tabs)', 'explore'], ['pending'], ['membership'], ['chat', '[id]'], ['booking', '[id]']]) {
      expect(routeFor(false, null, seg)).toBe('/');
    }
  });
});

describe('while the account state is loading', () => {
  it('waits', () => { expect(routeFor(true, null, ['(tabs)', 'explore'])).toBeNull(); });
});

describe('signing up (pending_verification)', () => {
  it('never reaches the tabs, bookings or chat', () => {
    for (const seg of [['(tabs)', 'explore'], ['(tabs)', 'chat'], ['chat', '[id]'], ['booking', '[id]'], ['membership'], ['pending']]) {
      expect(routeFor(true, state(), seg)).toBe('/signup/selfie');
    }
  });
  it('is sent to the first step with something missing', () => {
    expect(routeFor(true, state(), ['index'])).toBe('/signup/selfie');
    expect(routeFor(true, state({ missing: ['name', 'pet', 'location', 'legal'] }), ['signin'])).toBe('/signup/about');
    expect(routeFor(true, state({ missing: ['location', 'legal'] }), ['index'])).toBe('/signup/location');
    expect(routeFor(true, state({ missing: ['legal'] }), ['(tabs)'])).toBe('/signup/rules');
  });
  it('after a rejection starts again at the selfie', () => {
    expect(routeFor(true, state({ verification: { status: 'rejected', note: 'Blurry' } }), ['index'])).toBe('/signup/selfie');
  });
  it('may stay on any sign-up step, the legal texts, settings and reset-password', () => {
    for (const seg of [['signup', 'about'], ['signup', 'id'], ['legal', '[doc]'], ['settings'], ['reset-password']]) expect(routeFor(true, state(), seg)).toBeNull();
  });
});

describe('waiting for review, suspended or removed', () => {
  it('are sent to the status screen', () => {
    for (const status of ['pending_review', 'suspended', 'removed'] as const) {
      const s = state({ status, missing: [] });
      expect(routeFor(true, s, ['(tabs)', 'explore'])).toBe('/pending');
      expect(routeFor(true, s, ['signup', 'rules'])).toBe('/pending');
      expect(routeFor(true, s, ['index'])).toBe('/pending');
      expect(routeFor(true, s, ['pending'])).toBeNull();
      expect(routeFor(true, s, ['legal', '[doc]'])).toBeNull();
      expect(routeFor(true, s, ['settings'])).toBeNull();
    }
  });
  it('lets only people waiting for review open Membership, to pay the registration fee', () => {
    expect(routeFor(true, state({ status: 'pending_review', missing: [] }), ['membership'])).toBeNull();
    expect(routeFor(true, state({ status: 'suspended', missing: [] }), ['membership'])).toBe('/pending');
    expect(routeFor(true, state({ status: 'removed', missing: [] }), ['membership'])).toBe('/pending');
  });
});

describe('active accounts that have not paid, or whose membership is paused', () => {
  it.each([['unpaid', {}], ['paused', { state: 'paused' as const, kind: 'renewal' as const, paid_until: '2026-10-01', days_left: -30 }]] as const)(
    'with membership %s go to Membership instead of searching, messaging or booking', (_n, m) => {
      const s = active(m);
      expect(routeFor(true, s, ['(tabs)', 'explore'])).toBe('/membership');
      expect(routeFor(true, s, ['index'])).toBe('/membership');
      expect(routeFor(true, s, ['pending'])).toBe('/membership');
      expect(routeFor(true, s, ['travellers'])).toBe('/membership');
      expect(routeFor(true, s, ['host', '[id]'])).toBe('/membership');
      expect(routeFor(true, s, ['post-dates'])).toBe('/membership');
    });
  it('can still reach Membership, legal texts, settings, safety, chat history, bookings and their own profile', () => {
    const s = active();
    for (const seg of [['membership'], ['legal', '[doc]'], ['settings'], ['safety', 'index'], ['chat', '[id]'], ['booking', '[id]'], ['(tabs)', 'chat'], ['(tabs)', 'calendar'], ['(tabs)', 'profile'], ['profile', 'edit'], ['reset-password']]) {
      expect(routeFor(true, s, seg)).toBeNull();
    }
  });
});

describe('active accounts with a paid membership', () => {
  it.each([['active', paid], ['due_soon', { ...paid, state: 'due_soon' as const, days_left: 5 }]] as const)('with membership %s get the tabs', (_n, m) => {
    const s = active(m);
    expect(routeFor(true, s, ['(tabs)', 'explore'])).toBeNull();
    expect(routeFor(true, s, ['membership'])).toBeNull();          // a renewal is open to everyone
    expect(routeFor(true, s, ['index'])).toBe('/(tabs)/explore');
    expect(routeFor(true, s, ['signin'])).toBe('/(tabs)/explore');
    expect(routeFor(true, s, ['signup', 'account'])).toBe('/(tabs)/explore');
    expect(routeFor(true, s, ['pending'])).toBe('/(tabs)/explore');
    expect(routeFor(true, s, ['auth', 'callback'])).toBe('/(tabs)/explore');
    expect(routeFor(true, s, ['reset-password'])).toBeNull();
  });
});

describe('nextStep', () => {
  it('has five profile steps, in order', () => { expect(STEPS).toEqual(['selfie', 'id', 'about', 'location', 'rules']); });
  it('maps what is missing to the step that fixes it', () => {
    expect(nextStep(['verification'])).toBe('selfie');
    expect(nextStep(['pet', 'name'])).toBe('about');
    expect(nextStep(['home'])).toBe('about');
    expect(nextStep(['legal', 'location'])).toBe('location');
    expect(nextStep(['legal'])).toBe('rules');
  });
  it('ends on the last step when nothing is missing', () => { expect(nextStep([])).toBe('rules'); });
});
