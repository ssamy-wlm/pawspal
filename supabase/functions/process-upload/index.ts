import { handleProcessUpload } from '../_shared/handlers/process-upload.ts';
import { adminClient, authUserOf, rpcOf, storageOf } from '../_shared/deno.ts';

declare const Deno: { serve(handler: (req: Request) => Response | Promise<Response>): unknown };

Deno.serve((req) => {
  const admin = adminClient();
  return handleProcessUpload(req, { authUser: authUserOf(admin), storage: storageOf(admin), rpc: rpcOf(admin), randomId: () => crypto.randomUUID() });
});
