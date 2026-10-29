import React from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { EmptyState } from '../../src/components/EmptyState';
import { useTheme } from '../../src/theme';
import { t as tr } from '../../src/i18n';

/** Conversations. Filled in by phase 5. */
export default function ChatTab() {
  const c = useTheme().color;
  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <EmptyState message={tr('chat.empty')} actionLabel={tr('empty.findHost')} onAction={() => router.navigate('/(tabs)/explore')} />
    </View>
  );
}
