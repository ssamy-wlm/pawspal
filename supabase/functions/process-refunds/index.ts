import { handleProcessRefunds } from '../_shared/handlers/process-refunds.ts';
import { adminClient, env, rpcOf } from '../_shared/deno.ts';

declare const Deno: { serve(handler: (req: Request) => Response | Promise<Response>): unknown };

Deno.serve((req) => handleProcessRefunds(req, { env, fetch, rpc: rpcOf(adminClient()) }));
