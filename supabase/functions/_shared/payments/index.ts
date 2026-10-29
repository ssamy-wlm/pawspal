// Picks the payment provider from settings.
//   PAYMENT_PROVIDER  paymob. Unset means "no provider yet": paying says "not available yet" and nothing is charged.
import { ConfigError, type Env } from '../config.ts';
import { paymobProvider } from './paymob.ts';
import type { PaymentProvider } from './types.ts';

// To add a provider: write its file, then add one line here.
const REGISTRY: Record<string, (env: Env) => PaymentProvider> = {
  paymob: paymobProvider,
};

export function paymentProviderFromEnv(env: Env): PaymentProvider | null {
  const name = (env.get('PAYMENT_PROVIDER') ?? '').trim();
  if (!name) return null;
  const make = REGISTRY[name];
  if (!make) throw new ConfigError(`Unknown payment provider "${name}". Known: ${Object.keys(REGISTRY).join(', ')}`);
  return make(env);
}
