import { handleCreateFeePayment } from '../_shared/handlers/create-fee-payment.ts';
import { adminClient, authUserOf, env, rpcOf } from '../_shared/deno.ts';

declare const Deno: { serve(handler: (req: Request) => Response | Promise<Response>): unknown };

Deno.serve((req) => {
  const admin = adminClient();
  return handleCreateFeePayment(req, { env, fetch, rpc: rpcOf(admin), authUser: authUserOf(admin) });
});
