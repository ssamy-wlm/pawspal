import { handleVerifyIdentity } from '../_shared/handlers/verify-identity.ts';
import { adminClient, authUserOf, env, rpcOf, storageOf } from '../_shared/deno.ts';

declare const Deno: { serve(handler: (req: Request) => Response | Promise<Response>): unknown };

Deno.serve((req) => {
  const admin = adminClient();
  const storage = storageOf(admin);
  return handleVerifyIdentity(req, { env, authUser: authUserOf(admin), download: storage.download, rpc: rpcOf(admin) });
});
