import React from 'react';
import { Stack } from 'expo-router';
import { navyTheme } from '../../src/theme';

export default function SignupLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: navyTheme.color.background } }} />;
}
