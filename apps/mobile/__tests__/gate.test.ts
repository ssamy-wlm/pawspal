import { nextStep, routeFor, SignupState } from '../src/lib/gate';

const state = (over: Partial<SignupState> = {}): SignupState => ({
  status: 'pending_verification', role: 'both', first_name: null, missing: ['face', 'id', 'name', 'pet', 'home', 'location', 'legal'],
  has_pet: false, has_home_photo: false, ...over,
});

describe('who may see which screen', () => {
  it('keeps a signed-out person on Welcome, sign-up and the legal texts', () => {
    expect(routeFor(false, null, ['index'])).toBeNull();
    expect(routeFor(false, null, ['signup', 'phone'])).toBeNull();
    expect(routeFor(false, null, ['legal', '[doc]'])).toBeNull();
  });

  it('sends a signed-out person away from Explore and the other tabs', () => {
    expect(routeFor(false, null, ['(tabs)', 'explore'])).toBe('/');
    expect(routeFor(false, null, ['pending'])).toBe('/');
  });

  it('never lets a new user reach Explore until the account is active', () => {
    for (const status of ['pending_verification', 'pending_review', 'suspended', 'removed'] as const) {
      expect(routeFor(true, state({ status }), ['(tabs)', 'explore'])).not.toBeNull();
      expect(routeFor(true, state({ status }), ['(tabs)', 'chat'])).not.toBeNull();
    }
  });

  it('sends someone who is still signing up to the first step with something missing', () => {
    expect(routeFor(true, state(), ['(tabs)', 'explore'])).toBe('/signup/selfie');
    expect(routeFor(true, state({ missing: ['location', 'legal'] }), ['index'])).toBe('/signup/location');
    expect(routeFor(true, state({ missing: ['legal'] }), ['(tabs)'])).toBe('/signup/rules');
  });

  it('lets a person in sign-up stay on any sign-up step', () => {
    expect(routeFor(true, state(), ['signup', 'about'])).toBeNull();
  });

  it('sends people waiting for review, suspended or removed to the pending screen', () => {
    for (const status of ['pending_review', 'suspended', 'removed'] as const) {
      expect(routeFor(true, state({ status, missing: [] }), ['(tabs)', 'explore'])).toBe('/pending');
      expect(routeFor(true, state({ status, missing: [] }), ['signup', 'rules'])).toBe('/pending');
      expect(routeFor(true, state({ status, missing: [] }), ['pending'])).toBeNull();
    }
  });

  it('lets an active person in and moves them off Welcome, sign-up and the pending screen', () => {
    const active = state({ status: 'active', missing: [] });
    expect(routeFor(true, active, ['(tabs)', 'explore'])).toBeNull();
    expect(routeFor(true, active, ['index'])).toBe('/(tabs)/explore');
    expect(routeFor(true, active, ['pending'])).toBe('/(tabs)/explore');
  });

  it('waits while the state is still loading', () => {
    expect(routeFor(true, null, ['(tabs)', 'explore'])).toBeNull();
  });
});

describe('nextStep', () => {
  it('maps what is missing to the step that fixes it', () => {
    expect(nextStep(['phone'])).toBe('phone');
    expect(nextStep(['id', 'adult'])).toBe('id');
    expect(nextStep(['pet', 'name'])).toBe('about');
    expect(nextStep(['home'])).toBe('about');
    expect(nextStep(['legal', 'location'])).toBe('location');
  });
  it('ends on the last step when nothing is missing', () => {
    expect(nextStep([])).toBe('rules');
  });
});
