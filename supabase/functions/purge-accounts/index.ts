import { handlePurgeAccounts } from '../_shared/handlers/purge-accounts.ts';
import { accountOpsOf, adminClient, env, rpcOf } from '../_shared/deno.ts';

declare const Deno: { serve(handler: (req: Request) => Response | Promise<Response>): unknown };

Deno.serve((req) => {
  const admin = adminClient();
  return handlePurgeAccounts(req, { env, rpc: rpcOf(admin), removeMany: accountOpsOf(admin).removeMany });
});
