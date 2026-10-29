import { handleVerifyOtp } from '../_shared/handlers/verify-otp.ts';
import { adminClient, env, rpcOf } from '../_shared/deno.ts';

declare const Deno: { serve(handler: (req: Request) => Response | Promise<Response>): unknown };

Deno.serve((req) => handleVerifyOtp(req, { env, fetch, rpc: rpcOf(adminClient()) }));
