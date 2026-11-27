import { handleSendNotifications } from '../_shared/handlers/send-notifications.ts';
import { expoSender } from '../_shared/push/expo.ts';
import { adminClient, env, rpcOf } from '../_shared/deno.ts';

declare const Deno: { serve(handler: (req: Request) => Response | Promise<Response>): unknown };

// EXPO_ACCESS_TOKEN is optional (only needed if "enhanced push security" is turned on in the Expo account).
Deno.serve((req) => handleSendNotifications(req, { env, rpc: rpcOf(adminClient()), sender: expoSender(fetch, env.get('EXPO_ACCESS_TOKEN')) }));
