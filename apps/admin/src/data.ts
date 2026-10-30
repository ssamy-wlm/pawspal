// Every read and write the dashboard does. Reads rely on the database's rules (an admin session that passed the
// authenticator code can read; anyone else gets nothing). Every change goes through an audited database function.
import type { ActionForm, AccountStatus } from './rules';
import { actionArgs } from './rules';
import { supabase } from './supabase';

function must<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error || r.data === null) throw new Error(r.error?.message ?? 'no data');
  return r.data;
}
/** The database's refusal as a sentence for the page. */
export const refusal = (e: unknown) => {
  const m = e instanceof Error ? e.message : '';
  return /not allowed for this status/.test(m) ? 'This action does not fit the account status.'
    : /cannot act on an admin/.test(m) ? 'Admins cannot be acted on here.'
    : /admins only/.test(m) ? 'Your session no longer has admin rights. Sign in again.'
    : /rule and a message/.test(m) ? 'A rule and a message are required.'
    : /pets_photo_paths_check/.test(m) ? 'This is the pet\'s only photo, and a pet needs one. Send the owner a warning from their page instead.'
    : /photo not found/.test(m) ? 'That photo is already gone.'
    : /no open appeal/.test(m) ? 'This appeal was already decided.'
    : 'That did not work. Try again.';
};

export interface Overview { active_users: number; new_this_week: number; open_reports: number; high_priority: number; suspended: number; pending_approvals: number; open_appeals: number; actions_this_month: number }
export const getOverview = async () => must(await supabase().rpc('admin_overview')) as Overview;

export interface Person { id: string; first_name: string | null }
export interface ReportRow {
  id: string; created_at: string; status: string; priority: string; emergency: boolean; reason: string; details: string | null;
  booking_id: string | null; conversation_id: string | null; reporter: Person | null; reported: Person | null;
}
const REPORT_COLS = 'id, created_at, status, priority, emergency, reason, details, booking_id, conversation_id, reporter:profiles!reporter_id(id, first_name), reported:profiles!reported_id(id, first_name)';
export async function getReports(open: boolean, limit = 100): Promise<ReportRow[]> {
  let q = supabase().from('reports').select(REPORT_COLS);
  q = open ? q.in('status', ['new', 'in_review']) : q.in('status', ['resolved', 'dismissed']);
  return must(await q.order('priority', { ascending: true }).order('created_at', { ascending: false }).limit(limit)) as unknown as ReportRow[];
}
export async function setReportStatus(id: string, status: 'in_review' | 'resolved' | 'dismissed', note: string) {
  const { error } = await supabase().rpc('admin_set_report_status', { p_report: id, p_status: status, p_note: note.trim() || null });
  if (error) throw error;
}
export interface ChatLine { id: number; sender_id: string; body: string; created_at: string }
export async function getReportChat(reportId: string): Promise<ChatLine[]> {
  return must(await supabase().rpc('admin_report_messages', { p_report: reportId })) as ChatLine[];
}

export interface Profile {
  id: string; first_name: string | null; role: string; bio: string | null; area: string | null; status: AccountStatus;
  phone_verified: boolean; face_verified: boolean; id_verified: boolean; is_adult: boolean; face_photo_path: string | null;
  home_photo_path: string | null; rating_avg: number | null; stays_count: number; created_at: string;
}
const PROFILE_COLS = 'id, first_name, role, bio, area, status, phone_verified, face_verified, id_verified, is_adult, face_photo_path, home_photo_path, rating_avg, stays_count, created_at';
export async function searchUsers(query: string, status: string): Promise<Profile[]> {
  let q = supabase().from('profiles').select(PROFILE_COLS);
  const text = query.trim();
  if (/^[0-9a-f-]{36}$/i.test(text)) q = q.eq('id', text);
  else if (text) q = q.ilike('first_name', `%${text.replace(/[%_\\]/g, '')}%`);
  if (status) q = q.eq('status', status);
  return must(await q.order('created_at', { ascending: false }).limit(50)) as unknown as Profile[];
}
export async function getProfile(id: string): Promise<Profile | null> {
  const { data, error } = await supabase().from('profiles').select(PROFILE_COLS).eq('id', id).maybeSingle();
  if (error) throw error;
  return data as unknown as Profile | null;
}
export const getPending = async () => must(await supabase().from('profiles').select(PROFILE_COLS).eq('status', 'pending_review').order('created_at').limit(50)) as unknown as Profile[];

export interface ActionRow { id: string; action: string; rule: string | null; duration_days: number | null; until_fixed: boolean; message: string | null; created_at: string; ends_at: string | null }
export interface AppealRow { id: string; body: string; status: string; created_at: string; user_id: string; action: { action: string; rule: string | null; message: string | null; created_at: string } | null; user: { first_name: string | null } | null }
export interface UserCase { reportsAbout: ReportRow[]; reportsBy: ReportRow[]; actions: ActionRow[]; appeals: AppealRow[] }
export async function getUserCase(id: string): Promise<UserCase> {
  const sb = supabase();
  const [about, by, actions, appeals] = await Promise.all([
    sb.from('reports').select(REPORT_COLS).eq('reported_id', id).order('created_at', { ascending: false }).limit(50),
    sb.from('reports').select(REPORT_COLS).eq('reporter_id', id).order('created_at', { ascending: false }).limit(50),
    sb.from('enforcement_actions').select('id, action, rule, duration_days, until_fixed, message, created_at, ends_at').eq('user_id', id).order('created_at', { ascending: false }).limit(50),
    sb.from('appeals').select(APPEAL_COLS).eq('user_id', id).order('created_at', { ascending: false }).limit(20),
  ]);
  return { reportsAbout: must(about) as unknown as ReportRow[], reportsBy: must(by) as unknown as ReportRow[], actions: must(actions) as unknown as ActionRow[], appeals: must(appeals) as unknown as AppealRow[] };
}
export async function takeAction(userId: string, form: ActionForm) {
  const { error } = await supabase().rpc('admin_take_action', actionArgs(userId, form));
  if (error) throw error;
}

const APPEAL_COLS = 'id, body, status, created_at, user_id, action:enforcement_actions!action_id(action, rule, message, created_at), user:profiles!user_id(first_name)';
export const getOpenAppeals = async () => must(await supabase().from('appeals').select(APPEAL_COLS).in('status', ['new', 'in_review']).order('created_at').limit(50)) as unknown as AppealRow[];
export async function decideAppeal(id: string, upheld: boolean, message: string) {
  const { error } = await supabase().rpc('admin_decide_appeal', { p_appeal: id, p_upheld: upheld, p_message: message.trim() || null });
  if (error) throw error;
}

export interface BookingRow { id: string; starts_on: string; ends_on: string; status: string; fee_status: string; cost_type: string; created_at: string; owner: Person | null; sitter: Person | null; pet: { name: string } | null }
export async function getBookings(status: string): Promise<BookingRow[]> {
  let q = supabase().from('bookings').select('id, starts_on, ends_on, status, fee_status, cost_type, created_at, owner:profiles!owner_id(id, first_name), sitter:profiles!sitter_id(id, first_name), pet:pets!pet_id(name)');
  if (status) q = q.eq('status', status);
  return must(await q.order('created_at', { ascending: false }).limit(100)) as unknown as BookingRow[];
}

export interface PetPhotos { id: string; owner_id: string; name: string; photo_paths: string[]; created_at: string }
export const getRecentPets = async () => must(await supabase().from('pets').select('id, owner_id, name, photo_paths, created_at').order('created_at', { ascending: false }).limit(30)) as unknown as PetPhotos[];
export const getRecentHomes = async () => must(await supabase().from('profiles').select('id, first_name, home_photo_path').not('home_photo_path', 'is', null).order('updated_at', { ascending: false }).limit(30)) as unknown as { id: string; first_name: string | null; home_photo_path: string }[];
export async function removePhoto(kind: 'pet' | 'home', owner: string, path: string, reason: string) {
  const { error } = await supabase().rpc('admin_remove_photo', { p_kind: kind, p_owner: owner, p_path: path, p_reason: reason });
  if (error) throw error;
}

export interface AuditRow { id: number; created_at: string; action: string; admin_email: string | null; target_user: string | null; target_name: string | null; details: Record<string, unknown> }
export async function getAudit(before?: number): Promise<AuditRow[]> {
  return must(await supabase().rpc('admin_audit_log', { p_limit: 50, p_before: before ?? null })) as AuditRow[];
}
