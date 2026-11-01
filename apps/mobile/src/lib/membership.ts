// Membership: reading the payment details the founder set up, and telling the team "I paid". PawsPal confirms every
// payment by hand; the amount and the dates always come from the server (see my_account_state()).
import { supabase } from './supabase';
import { uploadPhoto } from './api';
import type { MembershipInfo, MembershipState } from './gate';
import { locale } from '../i18n';

export type { MembershipInfo, MembershipState };

/** The payment settings the server lets every signed-in person read. An empty string means "not filled in yet". */
export interface PaymentSettings {
  instapay_link: string; instapay_qr_url: string; bank_name: string; bank_account_name: string;
  bank_account_number: string; bank_iban: string; payment_note: string;
  registration_fee_egp: string; renewal_fee_egp: string;
}

const KEYS: (keyof PaymentSettings)[] = ['instapay_link', 'instapay_qr_url', 'bank_name', 'bank_account_name', 'bank_account_number', 'bank_iban', 'payment_note', 'registration_fee_egp', 'renewal_fee_egp'];

export async function fetchPaymentSettings(): Promise<PaymentSettings> {
  const { data, error } = await supabase.rpc('get_payment_settings');
  if (error) throw error;
  const raw = (data ?? {}) as Record<string, unknown>;
  const out = {} as PaymentSettings;
  for (const k of KEYS) out[k] = typeof raw[k] === 'string' ? (raw[k] as string).trim() : raw[k] == null ? '' : String(raw[k]);
  return out;
}

/** Only an https address is ever opened or shown as an image. */
export const isHttps = (u: string | null | undefined): u is string => !!u && /^https:\/\/\S+$/i.test(u);

/** True once the founder has filled in at least one way to pay. */
export const hasPaymentDetails = (s: PaymentSettings) =>
  isHttps(s.instapay_link) || isHttps(s.instapay_qr_url) || !!(s.bank_name || s.bank_account_name || s.bank_account_number || s.bank_iban);

/** "I paid": a reference number, a screenshot, or both. The screenshot goes through the same clean-up as every other photo. */
export async function submitPaymentClaim(reference: string, screenshotUri?: string | null): Promise<string> {
  const ref = reference.trim();
  if (!ref && !screenshotUri) throw new Error('reference or screenshot needed');
  const shot = screenshotUri ? await uploadPhoto('payment', screenshotUri) : null;
  const { data, error } = await supabase.rpc('submit_payment_claim', { p_reference: ref || null, p_screenshot_path: shot });
  if (error) throw error;
  return data as string;
}

/** A date such as "12 March 2027" in the app's language. Falls back to the plain date when the phone cannot format it. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  try { return d.toLocaleDateString(locale() === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }); } catch { return iso.slice(0, 10); }
}
