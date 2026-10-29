import { handleRequestOtp } from '../_shared/handlers/request-otp.ts';
import { adminClient, env, rpcOf } from '../_shared/deno.ts';

declare const Deno: { serve(handler: (req: Request) => Response | Promise<Response>): unknown };

Deno.serve((req) => handleRequestOtp(req, { env, fetch, rpc: rpcOf(adminClient()) }));
