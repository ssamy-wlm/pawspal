// Shortlist, posted dates and the lists that go with them. The database decides who may post, see or save what.
import { supabase } from './supabase';
import type { CardBackground, CardIllustration } from '../components/CardArt';
import type { Offer, PetType } from './search';

export interface ShortlistCard {
  id: string; first_name: string | null; area: string | null; card_illustration: CardIllustration; card_background: CardBackground;
  rating_avg: number | null; stays_count: number; home_tags: string[]; saved_at: string;
}

/** Saves a host. Saving someone twice is fine. Throws 'full' when the shortlist is full. */
export async function saveToShortlist(userId: string, hostId: string): Promise<void> {
  const { error } = await supabase.from('shortlist').insert({ user_id: userId, host_id: hostId });
  if (!error || error.code === '23505') return;
  throw new Error(/full/i.test(error.message) ? 'full' : 'failed');
}

export async function removeFromShortlist(hostId: string): Promise<void> {
  const { error } = await supabase.from('shortlist').delete().eq('host_id', hostId);
  if (error) throw error;
}

export async function fetchShortlist(): Promise<ShortlistCard[]> {
  const { data, error } = await supabase.rpc('my_shortlist');
  if (error) throw error;
  return (data ?? []) as ShortlistCard[];
}

export interface Availability {
  id: string; starts_on: string; ends_on: string; pets_accepted: PetType[]; offers: Offer[]; price_per_night: number | null; negotiable: boolean;
}
export interface TravelPost {
  id: string; pet_type: PetType; starts_on: string; ends_on: string; budget_per_night: number | null; note: string | null;
}
export interface Traveller {
  post_id: string; user_id: string; first_name: string | null; area: string | null; card_illustration: CardIllustration; card_background: CardBackground;
  pet_type: PetType; starts_on: string; ends_on: string; budget_per_night: number | null; note: string | null;
}

const AVAILABILITY = 'id, starts_on, ends_on, pets_accepted, offers, price_per_night, negotiable';

export async function fetchAvailability(userId: string): Promise<Availability[]> {
  const { data, error } = await supabase.from('availability').select(AVAILABILITY).eq('user_id', userId)
    .gte('ends_on', new Date().toISOString().slice(0, 10)).order('starts_on');
  if (error) throw error;
  return (data ?? []) as Availability[];
}

export async function fetchTravelPosts(userId: string): Promise<TravelPost[]> {
  const { data, error } = await supabase.from('travel_posts').select('id, pet_type, starts_on, ends_on, budget_per_night, note').eq('user_id', userId)
    .gte('ends_on', new Date().toISOString().slice(0, 10)).order('starts_on');
  if (error) throw error;
  return (data ?? []) as TravelPost[];
}

export interface AvailabilityInput { starts_on: string; ends_on: string; pets_accepted: PetType[]; offers: Offer[]; price_per_night: number | null; negotiable: boolean }
export async function postAvailability(userId: string, v: AvailabilityInput): Promise<void> {
  const { error } = await supabase.from('availability').insert({ user_id: userId, ...v });
  if (error) throw new Error(/too many/i.test(error.message) ? 'too_many' : 'failed');
}

export interface TravelInput { pet_type: PetType; starts_on: string; ends_on: string; budget_per_night: number | null; note: string }
export async function postTravel(userId: string, v: TravelInput): Promise<void> {
  const { error } = await supabase.from('travel_posts').insert({ user_id: userId, ...v, note: v.note.trim() || null });
  if (error) throw new Error(/too many/i.test(error.message) ? 'too_many' : 'failed');
}

export async function deleteAvailability(id: string) {
  const { error } = await supabase.from('availability').delete().eq('id', id);
  if (error) throw error;
}
export async function deleteTravelPost(id: string) {
  const { error } = await supabase.from('travel_posts').delete().eq('id', id);
  if (error) throw error;
}

export async function browseTravellers(petType: PetType | null): Promise<Traveller[]> {
  const { data, error } = await supabase.rpc('browse_travellers', { p_pet_type: petType });
  if (error) throw error;
  return (data ?? []) as Traveller[];
}
