// The contract every payment provider follows. To add one (Fawry, for example): write a file here that exports
// (env) => PaymentProvider, register it in index.ts, and set PAYMENT_PROVIDER to its name.

export interface CheckoutInput {
  /** Our reference for this payment. The provider hands it back in its callback. */
  paymentId: string;
  amountCents: number;
  currency: 'EGP';
}

export interface Checkout {
  /** Where to send the person's browser. */
  url: string;
  /** The provider's own id for this checkout. */
  providerRef: string;
}

/** What a provider's callback tells us, after its signature has been checked. */
export interface PaymentEvent {
  paymentId: string;
  /** The provider's order id (part of the signed data): it must be the order we made for this payment. */
  orderRef: string;
  txnId: string;
  amountCents: number;
  currency: string;
  success: boolean;
  pending: boolean;
  refunded: boolean;
  voided: boolean;
  /** A refund or void of an earlier transaction, not a payment. */
  hasParent: boolean;
  /** Money only held (not yet captured). */
  authOnly: boolean;
}

export interface PaymentProvider {
  readonly name: string;
  createCheckout(input: CheckoutInput, fetchFn: typeof fetch): Promise<Checkout>;
  /** 'invalid' when the signature does not match (forged or damaged). null for callbacks we do not act on. */
  parseCallback(rawBody: string, query: URLSearchParams): Promise<PaymentEvent | 'invalid' | null>;
  /** Asks the provider to give money back. True only when it confirms. */
  refund(txnId: string, amountCents: number, fetchFn: typeof fetch): Promise<boolean>;
}

export class PaymentError extends Error {
  readonly provider: string;
  readonly status: number | null;
  constructor(provider: string, status: number | null) {
    super(`${provider} refused (${status ?? 'no answer'})`);
    this.name = 'PaymentError';
    this.provider = provider;
    this.status = status;
  }
}
