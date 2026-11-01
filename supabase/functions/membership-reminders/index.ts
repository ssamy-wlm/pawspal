import { handleMembershipReminders } from '../_shared/handlers/membership-reminders.ts';
import { emailProviderFromEnv } from '../_shared/email/index.ts';
import { adminClient, env, rpcOf } from '../_shared/deno.ts';

declare const Deno: { serve(handler: (req: Request) => Response | Promise<Response>): unknown };

Deno.serve((req) => handleMembershipReminders(req, { env, rpc: rpcOf(adminClient()), provider: emailProviderFromEnv }));
