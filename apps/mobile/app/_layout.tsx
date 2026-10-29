import { GestureHandlerRootView } from 'react-native-gesture-handler';
import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts, Poppins_400Regular, Poppins_500Medium, Poppins_600SemiBold, Poppins_700Bold, Poppins_800ExtraBold } from '@expo-google-fonts/poppins';
import { Cairo_400Regular, Cairo_600SemiBold, Cairo_700Bold } from '@expo-google-fonts/cairo';
import * as SplashScreen from 'expo-splash-screen';
import { fontFamily, ThemeProvider, useTheme } from '../src/theme';
import { initI18n, isRTL, t as tr } from '../src/i18n';
import { ToastProvider } from '../src/components/Toast';
import { AuthProvider } from '../src/lib/auth';

SplashScreen.preventAutoHideAsync().catch(() => {});

function Nav() {
  const t = useTheme();
  return (
    <>
      <StatusBar style={t.name === 'navy' ? 'light' : 'dark'} />
      <Stack screenOptions={{
        headerStyle: { backgroundColor: t.color.background },
        headerTintColor: t.color.text,
        headerTitleStyle: { fontFamily: fontFamily('semibold', isRTL()) },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: t.color.background },
      }}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="signup" options={{ headerShown: false }} />
        <Stack.Screen name="pending" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="settings" options={{ title: tr('settings.title') }} />
        <Stack.Screen name="legal/[doc]" options={{ title: '' }} />
        <Stack.Screen name="showcase" options={{ title: tr('dev.title') }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  // Font names are registered as Poppins_400 ... so styles can use one short name everywhere.
  const [fontsLoaded] = useFonts({
    Poppins_400: Poppins_400Regular, Poppins_500: Poppins_500Medium, Poppins_600: Poppins_600SemiBold,
    Poppins_700: Poppins_700Bold, Poppins_800: Poppins_800ExtraBold,
    Cairo_400: Cairo_400Regular, Cairo_600: Cairo_600SemiBold, Cairo_700: Cairo_700Bold,
  });
  const [i18nReady, setI18nReady] = React.useState(false);
  React.useEffect(() => { initI18n().finally(() => setI18nReady(true)); }, []);
  const ready = fontsLoaded && i18nReady;
  React.useEffect(() => { if (ready) SplashScreen.hideAsync().catch(() => {}); }, [ready]);
  if (!ready) return null;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <Nav />
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
