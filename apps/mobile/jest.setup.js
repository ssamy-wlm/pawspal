// Shared test setup: fake native modules and the Supabase settings the app reads at start-up.
process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

require('react-native-gesture-handler/jestSetup');
// The native UI runtime does not exist inside Jest: give the gesture library a stand-in handle for it.
jest.mock('react-native-worklets', () => ({ ...jest.requireActual('react-native-worklets'), getUIRuntimeHolder: () => ({}) }));

jest.mock('expo-secure-store', () => {
  const store = new Map();
  return {
    getItemAsync: jest.fn(async (k) => store.get(k) ?? null),
    setItemAsync: jest.fn(async (k, v) => { store.set(k, v); }),
    deleteItemAsync: jest.fn(async (k) => { store.delete(k); }),
  };
});
jest.mock('expo-updates', () => ({ reloadAsync: jest.fn(async () => {}) }));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-router', () => {
  const React = require('react');
  const { Text } = require('react-native');
  const Screen = () => null;
  return {
    router: { push: jest.fn(), navigate: jest.fn(), replace: jest.fn() },
    Link: ({ children }) => children,
    Stack: Object.assign(({ children }) => children ?? null, { Screen }),
    useLocalSearchParams: jest.fn(() => ({ doc: 'termsOfService' })),
    __Text: Text, __React: React,
  };
});
