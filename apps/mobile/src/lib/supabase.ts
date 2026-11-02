import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import { getItem, removeItem, setItem } from './storage';

// Only the PUBLIC anon key belongs in the app. Never put the service-role key here.
const url = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

// Session tokens are kept in the device's secure keychain, not plain storage. On the web they go in localStorage
// (see storage.web.ts and docs/security.md). Email links are read by authLinks.ts, so Supabase must not read the address.
const secureStorage = { getItem, setItem, removeItem };

export const supabase = createClient(url, anonKey, {
  auth: { storage: secureStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
});
