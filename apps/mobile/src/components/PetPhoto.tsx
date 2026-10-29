import React from 'react';
import { Image, View } from 'react-native';
import { Illustration } from './Illustration';
import { useSignedUrl } from '../lib/profile';
import { useTheme } from '../theme';

/** A pet photo from the private bucket (through a short-lived link), or the paw icon while it loads. */
export function PetPhoto({ path, size, label }: { path: string | null | undefined; size: number; label?: string }) {
  const t = useTheme();
  const url = useSignedUrl('pets', path);
  return (
    <View accessible={!!label} accessibilityRole={label ? 'image' : undefined} accessibilityLabel={label}
      style={{ width: size, height: size, borderRadius: size / 5, overflow: 'hidden', backgroundColor: t.tint.teal, alignItems: 'center', justifyContent: 'center' }}>
      {url ? <Image source={{ uri: url }} style={{ width: size, height: size }} resizeMode="cover" /> : <Illustration name="pawspalIcon" width={size * 0.4} />}
    </View>
  );
}
