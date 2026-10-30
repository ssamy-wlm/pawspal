import { handleHandoverPhotoUrl } from '../_shared/handlers/handover-photo-url.ts';
import { adminClient, authUserOf, rpcOf, signedUrlsOf } from '../_shared/deno.ts';

declare const Deno: { serve(handler: (req: Request) => Response | Promise<Response>): unknown };

Deno.serve((req) => {
  const admin = adminClient();
  return handleHandoverPhotoUrl(req, { authUser: authUserOf(admin), rpc: rpcOf(admin), urls: signedUrlsOf(admin) });
});
