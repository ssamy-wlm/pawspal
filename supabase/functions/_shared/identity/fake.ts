// A stand-in for the real ID and face provider, for building and testing before one is chosen.
// It approves everyone. That makes it unsafe for real users, so it only works when it is switched on on purpose:
//   IDENTITY_PROVIDER=fake                      to use it
//   ALLOW_FAKE_IDENTITY=true  as well, when PAWSPAL_ENV=production (a second switch, so it cannot happen by accident)
// Test outcomes (only honoured here): reject_face, reject_id, underage, duplicate.
import { sha256Hex } from '../crypto.ts';
import { ConfigError, type Env } from '../config.ts';
import type { FaceCheckInput, FaceCheckResult, IdCheckInput, IdCheckResult, IdentityProvider } from './types.ts';

export function fakeIdentityProvider(env: Env): IdentityProvider {
  if (env.get('PAWSPAL_ENV') === 'production' && env.get('ALLOW_FAKE_IDENTITY') !== 'true') {
    throw new ConfigError('The fake identity provider is not allowed in production. Choose a real provider.');
  }
  return {
    name: 'fake',
    async checkFace(input: FaceCheckInput): Promise<FaceCheckResult> {
      return { ok: input.testOutcome !== 'reject_face' && input.image.length > 0 };
    },
    async checkId(input: IdCheckInput): Promise<IdCheckResult> {
      if (input.testOutcome === 'reject_id') return { ok: false, isAdult: false, documentHash: null };
      const documentHash = await sha256Hex(
        input.testOutcome === 'duplicate' ? 'fake-document:shared' : `fake-document:${input.userId}`);
      return { ok: true, isAdult: input.testOutcome !== 'underage', documentHash };
    },
  };
}
