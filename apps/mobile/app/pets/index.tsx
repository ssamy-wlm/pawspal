import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Button } from '../../src/components/Button';
import { EmptyState } from '../../src/components/EmptyState';
import { PetPhoto } from '../../src/components/PetPhoto';
import { useAuth } from '../../src/lib/auth';
import { fetchPets, Pet } from '../../src/lib/profile';
import { fontFamily, useTheme } from '../../src/theme';
import { isRTL, t as tr, tn } from '../../src/i18n';

/** Your pets. Tap one to see or change it. */
export default function Pets() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const c = useTheme().color;
  const rtl = isRTL();
  const [pets, setPets] = React.useState<Pet[] | null>(null);

  useFocusEffect(React.useCallback(() => {
    if (!userId) return;
    let live = true;
    fetchPets(userId).then((p) => { if (live) setPets(p); }, () => { if (live) setPets([]); });
    return () => { live = false; };
  }, [userId]));

  if (pets === null) return null;
  if (pets.length === 0) return <EmptyState message={tr('pets.empty')} actionLabel={tr('pets.add')} onAction={() => router.push('/pets/new')} art="catMango" />;
  return (
    <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={{ padding: 24, gap: 12 }}>
      {pets.map((p) => {
        const subtitle = [tr(`pet.${p.type}`), tr(`signup.size.${p.size}`), p.age_years != null ? tn('count.year', p.age_years) : null].filter(Boolean).join(' · ');
        return (
        <Pressable key={p.id} accessibilityRole="button" accessibilityLabel={`${p.name}. ${subtitle}${p.locked ? `. ${tr('pets.locked')}` : ''}`}
          onPress={() => router.push(`/pets/${p.id}` as never)}
          style={{ minHeight: 88, flexDirection: 'row', alignItems: 'center', gap: 14, padding: 12, borderRadius: 24, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border }}>
          <PetPhoto path={p.photo_paths[0]} size={64} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.text, fontSize: 18, fontFamily: fontFamily('bold', rtl) }}>{p.name}</Text>
            <Text style={{ color: c.textMuted, fontSize: 14, fontFamily: fontFamily('regular', rtl) }}>
              {subtitle}
            </Text>
            {p.locked ? <Text style={{ color: c.primary, fontSize: 13, fontFamily: fontFamily('semibold', rtl) }}>{tr('pets.locked')}</Text> : null}
          </View>
        </Pressable>
        );
      })}
      <Button title={tr('pets.add')} onPress={() => router.push('/pets/new')} />
    </ScrollView>
  );
}
