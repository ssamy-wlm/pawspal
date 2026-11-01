// An email company. To add one: write its file next to this one and register it in index.ts.
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailProvider {
  name: string;
  /** Sends one plain text email. Throws when the provider refuses it. The error never carries the address or the text. */
  send(msg: EmailMessage): Promise<void>;
}
