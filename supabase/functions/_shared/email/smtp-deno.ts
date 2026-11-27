// Deno only (excluded from tsc and from the node tests, like ../deno.ts). The one place that imports the SMTP client.
// Implicit TLS on port 465 (secure: true). requireTLS/ignoreTLS are irrelevant then: there is no plain-text phase to upgrade.
import nodemailer from 'npm:nodemailer@10.5.0';
import type { SmtpTransportFactory } from './smtp.ts';

export const nodemailerTransport: SmtpTransportFactory = (s) => {
  const t = nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure: true,
    auth: { user: s.user, pass: s.password },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
    logger: false,
    debug: false,
  });
  return {
    sendMail: (msg) => t.sendMail({ from: msg.from, to: msg.to, subject: msg.subject, text: msg.text }),
  };
};
