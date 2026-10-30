import { handleEmergency } from '../_shared/handlers/emergency.ts';
import { adminClient, authUserOf, rpcOf } from '../_shared/deno.ts';

declare const Deno: { serve(handler: (req: Request) => Response | Promise<Response>): unknown };

Deno.serve((req) => {
  const admin = adminClient();
  return handleEmergency(req, { authUser: authUserOf(admin), rpc: rpcOf(admin) });
});
