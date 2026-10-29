import React from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { EmptyState } from '../../src/components/EmptyState';
import { useTheme } from '../../src/theme';
import { t as tr } from '../../src/i18n';

/** My bookings and availability. Filled in by phases 4 and 5. */
export default function CalendarTab() {
  const c = useTheme().color;
  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <EmptyState message={tr('calendar.empty')} actionLabel={tr('empty.findHost')} onAction={() => router.navigate('/(tabs)/explore')} />
    </View>
  );
}
