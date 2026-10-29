// Decides which screen a person may be on. The server enforces the same rule (a person who is not active sees
// nobody else's data); this only keeps the app from showing screens that would be empty.

export type AccountStatus = 'pending_verification' | 'pending_review' | 'active' | 'suspended' | 'removed';

export interface SignupState {
  status: AccountStatus;
  role: 'owner' | 'sitter' | 'both';
  first_name: string | null;
  missing: string[];
  has_pet: boolean;
  has_home_photo: boolean;
}

export type StepName = 'phone' | 'selfie' | 'id' | 'about' | 'location' | 'rules';
export const STEPS: StepName[] = ['phone', 'selfie', 'id', 'about', 'location', 'rules'];

const STEP_FOR: Record<string, StepName> = {
  phone: 'phone', face: 'selfie', id: 'id', adult: 'id', name: 'about', pet: 'about', home: 'about', location: 'location', legal: 'rules',
};

/** The first step that still has something missing. */
export function nextStep(missing: string[]): StepName {
  const needed = new Set(missing.map((m) => STEP_FOR[m]).filter(Boolean));
  return STEPS.find((s) => needed.has(s)) ?? 'rules';
}

/** Where to send someone, or null when they are already in the right place. */
export function routeFor(hasSession: boolean, state: SignupState | null, segments: string[]): string | null {
  const top = segments[0] ?? 'index';
  const free = top === 'legal' || top === 'settings' || top === 'showcase';
  if (!hasSession) return top === 'index' || top === 'signup' || free ? null : '/';
  if (!state) return null;                                       // still loading
  if (state.status === 'active') return top === 'index' || top === 'signup' || top === 'pending' ? '/(tabs)/explore' : null;
  if (state.status === 'pending_verification') {
    if (top === 'signup' || free) return null;
    return `/signup/${nextStep(state.missing)}`;
  }
  return top === 'pending' || free ? null : '/pending';          // pending_review, suspended, removed
}
