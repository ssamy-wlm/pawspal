// Admin sign-in step two: passkeys (WebAuthn). See docs/ARCHITECTURE.md, "Admin sign-in: password then passkey".
// Settings: ADMIN_RP_ID (the admin site's domain), ADMIN_ORIGIN (its exact https address), ADMIN_RP_NAME (shown in the passkey prompt).
import * as webauthn from 'npm:@simplewebauthn/server@14.1.0';
import { handleAdminPasskey } from '../_shared/handlers/admin-passkey.ts';
import { adminAuthUserOf, adminClient, env, rpcOf } from '../_shared/deno.ts';

declare const Deno: { serve(handler: (req: Request) => Response | Promise<Response>): unknown };

Deno.serve((req) => {
  const admin = adminClient();
  return handleAdminPasskey(req, {
    authUser: adminAuthUserOf(admin),
    rpc: rpcOf(admin),
    webauthn,
    env,
    random: (n) => crypto.getRandomValues(new Uint8Array(n)),
    now: () => Date.now(),
  });
});
