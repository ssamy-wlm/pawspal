// Conversations and messages. The database hides contact details in every message and decides who may read or send;
// this file asks, and listens for new messages. Message text is never logged.
import { supabase } from './supabase';
import type { CardBackground, CardIllustration } from '../components/CardArt';

export interface Conversation {
  id: string; other_id: string; first_name: string | null; card_illustration: CardIllustration; card_background: CardBackground;
  last_body: string | null; last_at: string; last_mine: boolean; unread: number;
}
export interface Message { id: number; conversation_id: string; sender_id: string; body: string; masked: boolean; created_at: string }

export async function fetchConversations(): Promise<Conversation[]> {
  const { data, error } = await supabase.rpc('my_conversations');
  if (error) throw error;
  return (data ?? []) as Conversation[];
}

/** Opens (or finds) the conversation with someone. Returns its id. */
export async function startConversation(otherId: string): Promise<string> {
  const { data, error } = await supabase.rpc('start_conversation', { p_other: otherId });
  if (error) throw error;
  return data as string;
}

const PAGE = 40;
/** Newest first. Pass the oldest id you have to get the page before it. */
export async function fetchMessages(conversationId: string, before?: number): Promise<Message[]> {
  let q = supabase.from('messages').select('id, conversation_id, sender_id, body, masked, created_at').eq('conversation_id', conversationId).order('id', { ascending: false }).limit(PAGE);
  if (before) q = q.lt('id', before);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Message[];
}

export const PAGE_SIZE = PAGE;

/** Sends a message. The sent row comes back already masked, so what you see is what they see. Throws 'slow_down' when too fast. */
export async function sendMessage(conversationId: string, senderId: string, body: string): Promise<Message> {
  const { data, error } = await supabase.from('messages').insert({ conversation_id: conversationId, sender_id: senderId, body: body.trim() })
    .select('id, conversation_id, sender_id, body, masked, created_at').single();
  if (error) throw new Error(/slow down/i.test(error.message) ? 'slow_down' : 'failed');
  return data as Message;
}

export async function markRead(conversationId: string): Promise<void> {
  await supabase.rpc('mark_conversation_read', { p_conversation: conversationId });
}

/** Calls `onMessage` for each new message in the conversation. Returns a function that stops listening. */
export function listenToMessages(conversationId: string, onMessage: (m: Message) => void): () => void {
  const channel = supabase.channel(`chat:${conversationId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
      (payload) => onMessage(payload.new as Message))
    .subscribe();
  return () => { supabase.removeChannel(channel).catch(() => {}); };
}

/** Calls `onChange` whenever any message or booking that concerns me changes (row security limits what arrives). */
export function listenToActivity(onChange: () => void): () => void {
  const channel = supabase.channel('activity')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, onChange)
    .subscribe();
  return () => { supabase.removeChannel(channel).catch(() => {}); };
}
