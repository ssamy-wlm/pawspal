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
    router: { push: jest.fn(), navigate: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) },
    Link: ({ children }) => children,
    Stack: Object.assign(({ children }) => children ?? null, { Screen }),
    useLocalSearchParams: jest.fn(() => ({ doc: 'termsOfService' })),
    __Text: Text, __React: React,
  };
});

// Native modules used by the sign-up steps. Tests that need other behaviour override these.
jest.mock('expo-crypto', () => {
  let n = 0;
  return { randomUUID: jest.fn(() => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`) };
});
jest.mock('expo-camera', () => {
  const React = require('react');
  const { View } = require('react-native');
  const CameraView = React.forwardRef((props, ref) => {
    React.useImperativeHandle(ref, () => ({ takePictureAsync: jest.fn(async () => ({ uri: 'file:///selfie.jpg' })) }));
    return React.createElement(View, { testID: 'camera' });
  });
  return { CameraView, useCameraPermissions: jest.fn(() => [{ granted: true, canAskAgain: true }, jest.fn(async () => ({ granted: true }))]) };
});
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: false, assets: [{ uri: 'file:///photo.jpg' }] })),
}));
jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  requestForegroundPermissionsAsync: jest.fn(async () => ({ granted: true })),
  getCurrentPositionAsync: jest.fn(async () => ({ coords: { latitude: 28.5, longitude: 34.5 } })),
}));
