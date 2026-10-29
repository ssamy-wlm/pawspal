import { handleSendSms } from '../_shared/handlers/send-sms.ts';
import { adminClient, env, rpcOf } from '../_shared/deno.ts';

declare const Deno: { serve(handler: (req: Request) => Response | Promise<Response>): unknown };

Deno.serve((req) => handleSendSms(req, { env, fetch, rpc: rpcOf(adminClient()), nowSeconds: () => Math.floor(Date.now() / 1000) }));
