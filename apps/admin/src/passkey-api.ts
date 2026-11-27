'use client';
// Talks to the `admin-passkey` edge function and to the browser's passkey prompt. The function checks everything again:
// nothing here decides who may come in.
import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { browserErrorKind, functionErrorKind, withStepUp, type ErrorKind, type PasskeyStatus } from './passkey-rules';
import { supabase } from './supabase';

/** An error with only its kind: the screen shows one calm sentence for it. */
export class PasskeyError extends Error {
  kind: ErrorKind;
  constructor(kind: ErrorKind) { super(kind); this.kind = kind; }
}

/** One call to the function. Throws a PasskeyError; never anything that carries server detail. */
export async function callFn<T = Record<string, unknown>>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  let token: string | undefined;
  try { token = (await supabase().auth.getSession()).data.session?.access_token; } catch { token = undefined; }
  if (!token) throw new PasskeyError('not_allowed');
  let res: Response;
  try {
    res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/admin-passkey`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '', 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...body }),
    });
  } catch { throw new PasskeyError('try_again_later'); }
  let json: unknown = null;
  try { json = await res.json(); } catch { json = null; }
  if (!res.ok || (json && typeof json === 'object' && 'error' in json)) throw new PasskeyError(functionErrorKind(json));
  return json as T;
}

/** The browser prompt, with its errors turned into kinds. */
async function prompt<T>(run: () => Promise<T>): Promise<T> {
  if (!browserSupportsWebAuthn()) throw new PasskeyError('unsupported');
  try { return await run(); } catch (e) { throw new PasskeyError(browserErrorKind(e)); }
}

export const getStatus = () => callFn<PasskeyStatus>('status');

// ---- Step-up: sensitive actions need a passkey touch from the last 5 minutes ----

/** The prompt that asks for the touch (a small dialog). It receives the ceremony to run and settles when it worked or was cancelled. */
type StepUpPrompter = (run: () => Promise<void>) => Promise<void>;
let prompter: StepUpPrompter | null = null;
export const setStepUpPrompter = (p: StepUpPrompter | null) => { prompter = p; };

/** step_up_options, the prompt (Face ID, fingerprint, Windows Hello), then step_up_verify. */
export async function performStepUp(): Promise<void> {
  if (!browserSupportsWebAuthn()) throw new PasskeyError('unsupported');
  const { options } = await callFn<{ options: Parameters<typeof startAuthentication>[0]['optionsJSON'] }>('step_up_options');
  const response = await prompt(() => startAuthentication({ optionsJSON: options }));
  await callFn('step_up_verify', { response });
}
const askStepUp = () => (prompter ? prompter(performStepUp) : performStepUp());

/** Every sensitive call goes through here: on "step_up_required" the person is asked to touch the passkey, then the call is retried once. */
export const guarded = <T>(call: () => Promise<T>) => withStepUp(call, askStepUp);

/** Sign in with a passkey: options, the prompt (Face ID, fingerprint, Windows Hello), then the check. */
export async function loginWithPasskey(): Promise<void> {
  if (!browserSupportsWebAuthn()) throw new PasskeyError('unsupported');
  const { options } = await callFn<{ options: Parameters<typeof startAuthentication>[0]['optionsJSON'] }>('login_options');
  const response = await prompt(() => startAuthentication({ optionsJSON: options }));
  await callFn('login_verify', { response });
}

/** Make a passkey on this device. `setupCode` is only for the first one (or a lost-device reset); later ones need the signed-in session and a fresh touch. */
export async function createPasskey(name: string, setupCode?: string): Promise<void> {
  if (!browserSupportsWebAuthn()) throw new PasskeyError('unsupported');
  const extra = setupCode ? { setup_code: setupCode } : {};
  const run = <T,>(call: () => Promise<T>) => (setupCode ? call() : guarded(call));       // a setup code needs no step-up
  const { options } = await run(() => callFn<{ options: Parameters<typeof startRegistration>[0]['optionsJSON'] }>('register_options', { name, ...extra }));
  const response = await prompt(() => startRegistration({ optionsJSON: options }));
  await run(() => callFn('register_verify', { response, name, ...extra }));
}

export const recoveryLogin = (code: string) => callFn('recovery_login', { code });
export const makeRecoveryCodes = async () => (await guarded(() => callFn<{ codes: string[] }>('recovery_generate'))).codes;
export const renamePasskey = (id: string, name: string) => guarded(() => callFn('rename', { id, name }));
export const removePasskey = (id: string) => guarded(() => callFn('remove', { id }));
export const endPasskeySession = () => callFn('sign_out');
