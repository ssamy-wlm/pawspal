import { handlePaymentWebhook } from '../_shared/handlers/paymob-webhook.ts';
import { adminClient, env, rpcOf } from '../_shared/deno.ts';

declare const Deno: { serve(handler: (req: Request) => Response | Promise<Response>): unknown };

Deno.serve((req) => handlePaymentWebhook(req, { env, rpc: rpcOf(adminClient()) }));
