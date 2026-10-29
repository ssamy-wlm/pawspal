import { handleCleanupPhotos } from '../_shared/handlers/cleanup-photos.ts';
import { adminClient, env, rpcOf } from '../_shared/deno.ts';

declare const Deno: { serve(handler: (req: Request) => Response | Promise<Response>): unknown };

Deno.serve((req) => {
  const admin = adminClient();
  return handleCleanupPhotos(req, {
    env,
    rpc: rpcOf(admin),
    removeMany: async (bucket, names) => !(await admin.storage.from(bucket).remove(names)).error,
  });
});
