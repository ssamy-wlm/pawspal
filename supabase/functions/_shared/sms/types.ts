// The contract every SMS (or WhatsApp) provider follows, so any provider can plug in later.
// To add one: write a file in this folder that exports a factory (env) => SmsProvider, register it in index.ts,
// and list its name in the SMS_PROVIDERS setting. Nothing else in the app changes.

export interface SmsMessage {
  /** Phone number in E.164 form, with a leading plus: +201012345678 */
  to: string;
  /** The one-time code. It is a secret: never log it. */
  code: string;
  /** The full text to send, already filled in. */
  text: string;
}

export interface SmsDeps {
  fetch: typeof fetch;
}

export interface SmsProvider {
  readonly name: string;
  /** Resolves when the provider accepted the message. Throws SmsError otherwise. */
  send(message: SmsMessage, deps: SmsDeps): Promise<void>;
}

export class SmsError extends Error {
  provider: string;
  status: number | null;
  constructor(provider: string, status: number | null) {
    // The message never contains the number, the code or the provider's reply.
    super(`SMS provider "${provider}" failed` + (status ? ` (HTTP ${status})` : ''));
    this.name = 'SmsError';
    this.provider = provider;
    this.status = status;
  }
}
