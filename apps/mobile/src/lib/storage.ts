// Small things the app remembers on this device: the sign-in session, language, theme, the device id.
// On a phone they sit in the secure keychain. On the web they sit in storage.web.ts instead (Metro picks that file).
import * as SecureStore from 'expo-secure-store';

export const getItem = (key: string): Promise<string | null> => SecureStore.getItemAsync(key);
export const setItem = (key: string, value: string): Promise<void> => SecureStore.setItemAsync(key, value);
export const removeItem = (key: string): Promise<void> => SecureStore.deleteItemAsync(key);
