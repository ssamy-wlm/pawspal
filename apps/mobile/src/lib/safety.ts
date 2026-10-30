// Handover photos, reviews, reports, blocks and emergencies. The database decides who may do each of these and when
// (a review only after a completed stay, an emergency only in a running booking); this file asks and reports plainly.
// Message text, notes and photos are never logged.
import { supabase } from './supabase';
import { ApiError, handoverPhotoUrl, sendEmergency, uploadPhoto } from './api';

export type HandoverKind = 'dropoff' | 'pickup';
export interface HandoverPhoto { id: string; kind: HandoverKind; mine: boolean; taken_at: string }

export type SafetyFailure = 'not_yet' | 'too_many' | 'not_allowed' | 'network' | 'failed';
const failure = (code: SafetyFailure) => new Error(code);

/** Uploads a handover photo (the server cleans it) and saves it on the booking. Throws a SafetyFailure code. */
export async function addHandoverPhoto(bookingId: string, kind: HandoverKind, uri: string): Promise<void> {
  let path: string;
  try { path = await uploadPhoto('handover', uri); } catch (e) { throw failure(e instanceof ApiError && e.code === 'network' ? 'network' : 'failed'); }
  const { error } = await supabase.rpc('add_handover_photo', { p_booking: bookingId, p_kind: kind, p_path: path });
  if (error) throw failure(/not available/i.test(error.message) ? 'not_yet' : /too many/i.test(error.message) ? 'too_many' : /not allowed/i.test(error.message) ? 'not_allowed' : 'failed');
}

export async function listHandoverPhotos(bookingId: string): Promise<HandoverPhoto[]> {
  const { data, error } = await supabase.rpc('list_handover_photos', { p_booking: bookingId });
  if (error) throw error;
  return (data ?? []) as HandoverPhoto[];
}

export { handoverPhotoUrl };

/** The owner finishes the stay (after the end date). Reviews open once this is done. */
export async function completeBooking(bookingId: string): Promise<void> {
  const { error } = await supabase.rpc('complete_booking', { p_booking: bookingId });
  if (error) throw failure(/not finished/i.test(error.message) ? 'not_yet' : 'failed');
}

/** The window the database enforces: 14 days after the stay ends. Used only to decide whether to offer the button. */
export const REVIEW_DAYS = 14;
export const reviewOpen = (endsOn: string, today = new Date()) => {
  const end = new Date(`${endsOn}T00:00:00Z`).getTime();
  return today.getTime() <= end + (REVIEW_DAYS + 1) * 86400000;
};

export async function hasReviewed(bookingId: string, me: string): Promise<boolean> {
  const { data, error } = await supabase.from('reviews').select('id').eq('booking_id', bookingId).eq('author_id', me).limit(1);
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

export async function submitReview(bookingId: string, me: string, subjectId: string, rating: number, body: string): Promise<void> {
  const { error } = await supabase.from('reviews').insert({ booking_id: bookingId, author_id: me, subject_id: subjectId, rating, body: body.trim() || null });
  if (error) throw failure(error.code === '23505' ? 'too_many' : 'not_allowed');       // 23505: this stay is already reviewed
}

export interface ReviewRow { id: string; rating: number; body: string | null; created_at: string }
/** The latest reviews written about someone (the database only returns them for active people you have not blocked). */
export async function fetchReviewsAbout(subjectId: string, limit = 5): Promise<ReviewRow[]> {
  const { data, error } = await supabase.from('reviews').select('id, rating, body, created_at').eq('subject_id', subjectId).order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []) as ReviewRow[];
}

export type ReportReason = 'off_app_payment' | 'fake_photo' | 'no_show' | 'late_cancel' | 'rude_or_harassment' | 'animal_welfare' | 'pet_mismatch' | 'duplicate_account' | 'safety' | 'other';
export const REPORT_REASONS: ReportReason[] = ['off_app_payment', 'fake_photo', 'no_show', 'late_cancel', 'rude_or_harassment', 'animal_welfare', 'pet_mismatch', 'duplicate_account', 'safety', 'other'];

export async function fileReport(v: { reportedId: string; reason: ReportReason; details: string; bookingId?: string; conversationId?: string }): Promise<void> {
  const { error } = await supabase.rpc('file_report', { p_reported: v.reportedId, p_reason: v.reason, p_details: v.details.trim() || null, p_booking: v.bookingId ?? null, p_conversation: v.conversationId ?? null });
  if (error) throw failure(/too many/i.test(error.message) ? 'too_many' : 'failed');
}

export interface BlockedPerson { user_id: string; first_name: string | null; blocked_at: string }
export async function fetchBlocks(): Promise<BlockedPerson[]> {
  const { data, error } = await supabase.rpc('my_blocks');
  if (error) throw error;
  return (data ?? []) as BlockedPerson[];
}
export async function blockUser(userId: string): Promise<void> {
  const { error } = await supabase.rpc('block_user', { p_user: userId });
  if (error) throw failure('failed');
}
export async function unblockUser(userId: string): Promise<void> {
  const { error } = await supabase.rpc('unblock_user', { p_user: userId });
  if (error) throw failure('failed');
}

export interface Alert { id: string; booking_id: string; from_name: string | null; pet_name: string | null; created_at: string }
export async function fetchAlerts(): Promise<Alert[]> {
  const { data, error } = await supabase.rpc('my_alerts');
  if (error) throw error;
  return (data ?? []) as Alert[];
}
export async function dismissAlert(id: string): Promise<void> {
  await supabase.rpc('dismiss_alert', { p_alert: id });
}

/** Throws a SafetyFailure code: 'not_allowed' (no running booking), 'too_many', 'network' or 'failed'. */
export async function raiseEmergency(bookingId: string, note: string): Promise<'sent' | 'already_sent'> {
  try { return await sendEmergency(bookingId, note.trim() || null); } catch (e) {
    if (e instanceof ApiError) throw failure(e.code === 'not_allowed' ? 'not_allowed' : e.code === 'too_many_attempts' ? 'too_many' : e.code === 'network' ? 'network' : 'failed');
    throw failure('failed');
  }
}

export interface PetCare { vet_name: string | null; vet_phone: string | null; care_notes: string | null }
/** The pet's vet details, for either person in a running booking (the database says no to anyone else). */
export async function fetchPetCare(bookingId: string): Promise<PetCare | null> {
  const { data, error } = await supabase.rpc('get_pet_care', { p_booking: bookingId });
  const row = (data as PetCare[] | null)?.[0];
  return error || !row ? null : row;
}

/** My stays that are booked or running: the only ones an emergency can be raised for. */
export async function fetchRunningStays(me: string): Promise<{ id: string; pet_id: string }[]> {
  const { data, error } = await supabase.from('bookings').select('id, pet_id').in('status', ['confirmed', 'in_progress']).or(`owner_id.eq.${me},sitter_id.eq.${me}`).limit(10);
  if (error) throw error;
  return (data ?? []) as { id: string; pet_id: string }[];
}
