// Reading and saving profiles and pets. Every rule (who may see or change what) is enforced by the database; this
// file only asks. Vet details never come from a table: they have their own private functions.
import React from 'react';
import { supabase } from './supabase';
import type { CardBackground, CardIllustration } from '../components/CardArt';

export type Role = 'owner' | 'sitter' | 'both';
export type PetType = 'dog' | 'cat' | 'other';
export type PetSize = 'small' | 'medium' | 'large';

export interface PublicProfile {
  id: string; first_name: string | null; role: Role; bio: string | null; area: string | null;
  card_illustration: CardIllustration; card_background: CardBackground;
  rating_avg: number | null; stays_count: number; home_photo_path: string | null; home_tags: HomeTag[];
}

export const HOME_TAGS = ['garden', 'fenced_yard', 'pet_first_aid', 'experienced', 'has_own_pets', 'quiet_home', 'near_beach', 'air_conditioning', 'works_from_home', 'medication_ok'] as const;
export type HomeTag = (typeof HOME_TAGS)[number];
export const MAX_HOME_TAGS = 8;

export interface Pet {
  id: string; owner_id: string; name: string; type: PetType; size: PetSize; age_years: number | null;
  vaccinated: boolean; notes: string | null; photo_paths: string[]; locked: boolean;
}

export interface PetCare { vet_name: string; vet_phone: string; care_notes: string }

const CARD_COLUMNS = 'id, first_name, role, bio, area, card_illustration, card_background, rating_avg, stays_count, home_photo_path, home_tags';

/** Your own profile. */
export async function fetchMyProfile(userId: string): Promise<PublicProfile | null> {
  const { data, error } = await supabase.from('profiles').select(CARD_COLUMNS).eq('id', userId).maybeSingle();
  if (error) throw error;
  return (data as PublicProfile | null) ?? null;
}

/** Someone else's public card. The view returns nothing for people who are blocked, not active, or not yet reviewed. */
export async function fetchCard(id: string): Promise<PublicProfile | null> {
  const { data, error } = await supabase.from('profile_cards').select(CARD_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw error;
  return (data as PublicProfile | null) ?? null;
}

export async function saveMyProfile(userId: string, v: { first_name: string; bio: string; area: string; card_illustration: CardIllustration; card_background: CardBackground; home_tags: HomeTag[] }) {
  const { error } = await supabase.from('profiles').update({
    first_name: v.first_name.trim(), bio: v.bio.trim() || null, area: v.area.trim() || null,
    card_illustration: v.card_illustration, card_background: v.card_background, home_tags: v.home_tags,
  }).eq('id', userId);
  if (error) throw error;
}

const PET_COLUMNS = 'id, owner_id, name, type, size, age_years, vaccinated, notes, photo_paths, locked';

export async function fetchPets(ownerId: string): Promise<Pet[]> {
  const { data, error } = await supabase.from('pets').select(PET_COLUMNS).eq('owner_id', ownerId).order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Pet[];
}

export async function fetchPet(id: string): Promise<Pet | null> {
  const { data, error } = await supabase.from('pets').select(PET_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw error;
  return (data as Pet | null) ?? null;
}

export interface PetInput { name: string; type: PetType; size: PetSize; age_years: number | null; vaccinated: boolean; notes: string; photo_paths: string[] }

/** Adds a pet, or changes one (the database refuses a pet that is in a confirmed booking). Returns the pet's id. */
export async function savePet(ownerId: string, id: string | null, v: PetInput): Promise<string> {
  const row = { name: v.name.trim(), type: v.type, size: v.size, age_years: v.age_years, vaccinated: v.vaccinated, notes: v.notes.trim() || null, photo_paths: v.photo_paths };
  if (id) {
    const { data, error } = await supabase.from('pets').update(row).eq('id', id).select('id');
    if (error) throw error;
    if (!data || data.length === 0) throw new Error('pet is locked or missing');   // an update the database filtered out
    return id;
  }
  const { data, error } = await supabase.from('pets').insert({ ...row, owner_id: ownerId }).select('id').single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export async function deletePet(id: string) {
  const { data, error } = await supabase.from('pets').delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data || data.length === 0) throw new Error('pet is locked or missing');
}

export async function fetchMyPetCare(petId: string): Promise<PetCare> {
  const { data, error } = await supabase.rpc('get_my_pet_care', { p_pet: petId });
  if (error) throw error;
  const row = (data as { vet_name: string | null; vet_phone: string | null; care_notes: string | null }[] | null)?.[0];
  return { vet_name: row?.vet_name ?? '', vet_phone: row?.vet_phone ?? '', care_notes: row?.care_notes ?? '' };
}

export async function saveMyPetCare(petId: string, v: PetCare) {
  const { error } = await supabase.rpc('set_pet_care', { p_pet: petId, p_vet_name: v.vet_name, p_vet_phone: v.vet_phone, p_care_notes: v.care_notes });
  if (error) throw error;
}

/** A short-lived link to a private photo. Photos are never public: each link works for an hour and only for people the database lets in. */
export function useSignedUrl(bucket: 'pets' | 'homes', path: string | null | undefined): string | null {
  const [url, setUrl] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!path) return;
    let live = true;
    supabase.storage.from(bucket).createSignedUrl(path, 3600).then(({ data }) => { if (live) setUrl(data?.signedUrl ?? null); }, () => {});
    return () => { live = false; };
  }, [bucket, path]);
  return path ? url : null;
}

/**
 * Deletes photo files nobody uses any more (a removed photo, a deleted pet). Best effort and silent: the database says no
 * to a file that a pet in a confirmed booking still uses, and a file that could not be deleted is only clutter.
 */
export async function removePhotoFiles(bucket: 'pets' | 'homes', paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  try { await supabase.storage.from(bucket).remove(paths); } catch { /* clutter at worst */ }
}
