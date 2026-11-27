import { handleExportMyData } from '../_shared/handlers/export-my-data.ts';
import { adminClient, authUserWithEmailOf, passwordVerifier, rpcOf, signedUrlsOf } from '../_shared/deno.ts';

declare const Deno: { serve(handler: (req: Request) => Response | Promise<Response>): unknown };

Deno.serve((req) => {
  const admin = adminClient();
  return handleExportMyData(req, { authUser: authUserWithEmailOf(admin), rpc: rpcOf(admin), verifyPassword: passwordVerifier(admin), urls: signedUrlsOf(admin) });
});
