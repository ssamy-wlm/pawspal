import { handleExportMyData } from '../_shared/handlers/export-my-data.ts';
import { adminClient, authUserOf, rpcOf, signedUrlsOf } from '../_shared/deno.ts';

declare const Deno: { serve(handler: (req: Request) => Response | Promise<Response>): unknown };

Deno.serve((req) => {
  const admin = adminClient();
  return handleExportMyData(req, { authUser: authUserOf(admin), rpc: rpcOf(admin), urls: signedUrlsOf(admin) });
});
