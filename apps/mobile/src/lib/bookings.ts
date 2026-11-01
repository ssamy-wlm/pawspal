// Booking requests and terms. Every rule (who may request, who may change, what clears acceptance, when a booking is
// confirmed) lives in the database; this file asks and turns the answers into sentences.
import { supabase } from './supabase';
import { formatDay, Key, t as tr } from '../i18n';

export type StayLocation = 'sitter_home' | 'owner_home';
export type CostType = 'paid' | 'volunteer';
export type BookingStatus = 'requested' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled' | 'disputed';

export interface Booking {
  id: string; owner_id: string; sitter_id: string; pet_id: string; starts_on: string; ends_on: string;
  stay_location: StayLocation; cost_type: CostType; price_per_night: number | null; food_provided: boolean;
  status: BookingStatus; owner_accepted_at: string | null; sitter_accepted_at: string | null; terms_version: number;
}

const COLUMNS = 'id, owner_id, sitter_id, pet_id, starts_on, ends_on, stay_location, cost_type, price_per_night, food_provided, status, owner_accepted_at, sitter_accepted_at, terms_version';

/** Bookings between me and one other person, newest first. Only the two of us can read them. */
export async function fetchBookingsBetween(me: string, other: string): Promise<Booking[]> {
  const { data, error } = await supabase.from('bookings').select(COLUMNS)
    .or(`and(owner_id.eq.${me},sitter_id.eq.${other}),and(owner_id.eq.${other},sitter_id.eq.${me})`)
    .order('created_at', { ascending: false }).limit(20);
  if (error) throw error;
  return (data ?? []) as Booking[];
}

export async function fetchBooking(id: string): Promise<Booking | null> {
  const { data, error } = await supabase.from('bookings').select(COLUMNS).eq('id', id).maybeSingle();
  if (error) throw error;
  return (data as Booking | null) ?? null;
}

const open = (b: Booking) => b.status === 'requested' || b.status === 'confirmed' || b.status === 'in_progress';

/** The booking the two of us are working on now (newest open one), if any. */
export const currentBooking = (all: Booking[]): Booking | null => all.find(open) ?? null;

const failure = (e: { message: string }): Error => {
  const m = e.message;
  return new Error(/already a request/i.test(m) ? 'duplicate' : /too many/i.test(m) ? 'too_many' : /terms changed/i.test(m) ? 'terms_changed' : /already booked/i.test(m) ? 'pet_booked' : 'failed');
};

export interface StayInput { sitterId: string; petId: string; starts_on: string; ends_on: string; location: StayLocation; cost: CostType; price: number | null; food: boolean }
export async function requestBooking(v: StayInput): Promise<string> {
  const { data, error } = await supabase.rpc('request_booking', { p_sitter: v.sitterId, p_pet: v.petId, p_starts: v.starts_on, p_ends: v.ends_on, p_location: v.location, p_cost: v.cost, p_price: v.price, p_food: v.food });
  if (error) throw failure(error);
  return data as string;
}

export interface TermsInput { starts_on: string; ends_on: string; location: StayLocation; cost: CostType; price: number | null; food: boolean }
export async function proposeTerms(bookingId: string, v: TermsInput): Promise<void> {
  const { error } = await supabase.rpc('propose_terms', { p_booking: bookingId, p_starts: v.starts_on, p_ends: v.ends_on, p_location: v.location, p_cost: v.cost, p_price: v.price, p_food: v.food });
  if (error) throw failure(error);
}

/** Accepts the terms as they were when you looked at them (`version`). If they changed meanwhile it throws 'terms_changed'. */
export async function acceptTerms(bookingId: string, version: number): Promise<BookingStatus> {
  const { data, error } = await supabase.rpc('accept_terms', { p_booking: bookingId, p_version: version });
  if (error) throw failure(error);
  return data as BookingStatus;
}

export async function cancelBooking(bookingId: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_booking', { p_booking: bookingId, p_reason: '' });
  if (error) throw failure(error);
}

/** Have I accepted these terms? */
export const acceptedByMe = (b: Booking | null, me: string) => !!b && (b.owner_id === me ? b.owner_accepted_at : b.sitter_accepted_at) !== null;
export const acceptedByOther = (b: Booking | null, me: string) => !!b && (b.owner_id === me ? b.sitter_accepted_at : b.owner_accepted_at) !== null;

/** The four lines of a terms card, in words. */
export function termsText(b: Booking, petName: string): { dates: string; pet: string; location: string; cost: string } {
  const cost = b.cost_type === 'paid' && b.price_per_night != null
    ? tr('terms.cost.paid', { amount: b.price_per_night })
    : tr('terms.cost.volunteer');
  return {
    dates: `${formatDay(b.starts_on)} – ${formatDay(b.ends_on)}`,
    pet: petName,
    location: tr(`terms.loc.${b.stay_location}` as Key),
    cost: b.food_provided ? `${cost}, ${tr('terms.food')}` : cost,
  };
}

export interface BookingLocation { lat: number; lng: number; address: string | null }
/** The exact place of a confirmed booking. Only the two people in it can get this; the server says no to anyone else. Null when the host chose not to share a pin. */
export async function fetchBookingLocation(bookingId: string): Promise<BookingLocation | null> {
  const { data, error } = await supabase.rpc('get_booking_location', { p_booking: bookingId });
  const row = (data as BookingLocation[] | null)?.[0];
  if (error || !row) return null;
  return row;
}
