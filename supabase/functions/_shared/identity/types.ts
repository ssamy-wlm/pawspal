// The contract every ID and face checking provider follows. PawsPal never stores the ID image: the provider looks at
// it, and PawsPal keeps only the result and a one-way hash of the document.
//
// To add a real provider: write a file here that exports (env) => IdentityProvider, register it in index.ts and set
// IDENTITY_PROVIDER to its name. Providers that work through a hosted page (the person is sent to the provider's own
// screens) can keep the same interface: checkId() starts the session and the provider's webhook completes it.

export interface FaceCheckInput {
  userId: string;
  /** The cleaned selfie. */
  image: Uint8Array;
  /** Only the fake provider reads this (to test failures). */
  testOutcome?: string;
}

export interface FaceCheckResult {
  ok: boolean;
}

export interface IdCheckInput {
  userId: string;
  testOutcome?: string;
}

export interface IdCheckResult {
  ok: boolean;
  /** 18 or older, as read from the document by the provider. */
  isAdult: boolean;
  /** A stable fingerprint of the document (not the number itself), used to stop one ID opening two accounts. */
  documentHash: string | null;
}

export interface IdentityProvider {
  readonly name: string;
  checkFace(input: FaceCheckInput): Promise<FaceCheckResult>;
  checkId(input: IdCheckInput): Promise<IdCheckResult>;
}
