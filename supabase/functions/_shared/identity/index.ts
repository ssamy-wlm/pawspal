// Picks the identity provider from settings. Unset means "not configured": the verify-identity function then refuses
// (it never approves anyone by default).
import { ConfigError, type Env } from '../config.ts';
import { fakeIdentityProvider } from './fake.ts';
import type { IdentityProvider } from './types.ts';

// To add a provider: write its file, then add one line here.
const REGISTRY: Record<string, (env: Env) => IdentityProvider> = {
  fake: fakeIdentityProvider,
};

export function identityProviderFromEnv(env: Env): IdentityProvider | null {
  const name = (env.get('IDENTITY_PROVIDER') ?? '').trim();
  if (!name) return null;
  const make = REGISTRY[name];
  if (!make) throw new ConfigError(`Unknown identity provider "${name}". Known: ${Object.keys(REGISTRY).join(', ')}`);
  return make(env);
}
