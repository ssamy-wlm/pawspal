import { supabase } from './supabase';

export type PetType = 'dog' | 'cat' | 'other';
export type Offer = 'volunteer' | 'swap' | 'paid' | 'food_provided' | 'stay_at_my_place';

export interface SearchFilters {
  start: string;            // YYYY-MM-DD
  end: string;              // YYYY-MM-DD
  petType: PetType;
  budgetMin: number;        // EGP per night
  budgetMax: number | null; // null = any
  offers: Offer[];          // soft preferences: matching ones rank higher
  freeOnly: boolean;        // volunteer or swap stays only
  near?: { lat: number; lng: number };
  maxKm: number;
}

export interface StayResult {
  availability_id: string; user_id: string; first_name: string; area: string | null;
  card_illustration: 'dog-biscuit' | 'cat-mango' | 'cat-midnight' | 'husky-storm';
  card_background: string; face_photo_path: string | null;
  rating_avg: number | null; stays_count: number;
  starts_on: string; ends_on: string; price_per_night: number | null; negotiable?: boolean;
  offers: Offer[]; pets_accepted: PetType[];
  covers_dates?: boolean; in_budget?: boolean; distance_km?: number | null;
  match_score?: number; match_label?: 'Exact match' | 'Close match';
}

/** "Book like Airbnb": dates, budget and filters. Exact matches first, then close matches. */
export async function searchStays(f: SearchFilters): Promise<StayResult[]> {
  const { data, error } = await supabase.rpc('search_stays', {
    p_start: f.start, p_end: f.end, p_pet_type: f.petType,
    p_budget_min: f.budgetMin, p_budget_max: f.budgetMax, p_offers: f.offers, p_free_only: f.freeOnly,
    p_near_lat: f.near?.lat ?? null, p_near_lng: f.near?.lng ?? null, p_max_km: f.maxKm,
  });
  if (error) throw error;
  return (data ?? []) as StayResult[];
}

/** Swipe mode: shuffled hosts with upcoming availability. */
export async function browseRandom(petType: PetType | null): Promise<StayResult[]> {
  const { data, error } = await supabase.rpc('browse_random', { p_pet_type: petType });
  if (error) throw error;
  return (data ?? []) as StayResult[];
}

export const isoDate = (d: Date) => d.toISOString().slice(0, 10);
export const nights = (start: string, end: string) =>
  Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 86400000));
