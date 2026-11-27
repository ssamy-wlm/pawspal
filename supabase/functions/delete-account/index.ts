import { handleDeleteAccount } from '../_shared/handlers/delete-account.ts';
import { accountOpsOf, adminClient, authUserWithEmailOf, passwordVerifier, rpcOf } from '../_shared/deno.ts';

declare const Deno: { serve(handler: (req: Request) => Response | Promise<Response>): unknown };

Deno.serve((req) => {
  const admin = adminClient();
  const ops = accountOpsOf(admin);
  return handleDeleteAccount(req, {
    authUser: authUserWithEmailOf(admin), rpc: rpcOf(admin), verifyPassword: passwordVerifier(),
    signOutEverywhere: ops.signOutEverywhere, banUser: ops.banUser, removeFiles: ops.removeMany,
  });
});
