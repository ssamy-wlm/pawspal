import { GestureHandlerRootView } from 'react-native-gesture-handler';
import React from 'react';
import { Stack } from 'expo-router';
import { useFonts, Poppins_400Regular, Poppins_500Medium, Poppins_600SemiBold, Poppins_700Bold, Poppins_800ExtraBold } from '@expo-google-fonts/poppins';
import { Cairo_400Regular, Cairo_600SemiBold, Cairo_700Bold } from '@expo-google-fonts/cairo';
import * as SplashScreen from 'expo-splash-screen';
import { ThemeProvider, useTheme } from '../src/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

function Nav() {
  const t = useTheme();
  return (
    <Stack screenOptions={{
      headerStyle: { backgroundColor: t.color.background },
      headerTintColor: t.color.text,
      headerTitleStyle: { fontFamily: 'Poppins_600' },
      contentStyle: { backgroundColor: t.color.background },
    }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="legal/[doc]" options={{ title: '' }} />
      <Stack.Screen name="explore" options={{ title: 'Find a host' }} />
      <Stack.Screen name="showcase" options={{ title: 'Motion showcase' }} />
    </Stack>
  );
}

export default function RootLayout() {
  // Font names are registered as Poppins_400 ... so styles can use one short name everywhere.
  const [loaded] = useFonts({
    Poppins_400: Poppins_400Regular, Poppins_500: Poppins_500Medium, Poppins_600: Poppins_600SemiBold,
    Poppins_700: Poppins_700Bold, Poppins_800: Poppins_800ExtraBold,
    Cairo_400: Cairo_400Regular, Cairo_600: Cairo_600SemiBold, Cairo_700: Cairo_700Bold,
  });
  React.useEffect(() => { if (loaded) SplashScreen.hideAsync().catch(() => {}); }, [loaded]);
  if (!loaded) return null;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <Nav />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
