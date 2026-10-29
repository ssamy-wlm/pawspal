import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { StepScreen, ErrorText } from '../../src/components/StepScreen';
import { TextField } from '../../src/components/TextField';
import { Button } from '../../src/components/Button';
import { Chip } from '../../src/components/Chip';
import { errorKey, uploadPhoto } from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth';
import { getRoleHint, Role } from '../../src/lib/draft';
import { nextStep } from '../../src/lib/gate';
import { supabase } from '../../src/lib/supabase';
import { fontFamily, useTheme } from '../../src/theme';
import { isRTL, t as tr } from '../../src/i18n';

type PetType = 'dog' | 'cat' | 'other';
type PetSize = 'small' | 'medium' | 'large';

async function pickPhoto(): Promise<string | null> {
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, exif: false, allowsEditing: false });
  return r.canceled ? null : r.assets[0]?.uri ?? null;
}

function Heading({ children }: { children: string }) {
  const c = useTheme(true).color;
  return <Text accessibilityRole="header" style={{ color: c.text, fontSize: 19, fontFamily: fontFamily('bold', isRTL()) }}>{children}</Text>;
}

function PhotoButton({ done, label, doneLabel, busy, onPress }: { done: boolean; label: string; doneLabel: string; busy: boolean; onPress: () => void }) {
  const c = useTheme(true).color;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={done ? doneLabel : label} disabled={busy} onPress={onPress}
      style={{ minHeight: 56, borderRadius: 16, borderWidth: 2, borderStyle: done ? 'solid' : 'dashed', borderColor: done ? c.primary : c.border,
        alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 }}>
      <Text style={{ color: done ? c.primary : c.text, fontSize: 16, fontFamily: fontFamily('semibold', isRTL()) }}>{busy ? tr('signup.photo.checking') : done ? doneLabel : label}</Text>
    </Pressable>
  );
}

/** Step 4: name, role, the first pet (owners) and a photo of the home (sitters). */
export default function AboutStep() {
  const { state, refresh } = useAuth();
  const [name, setName] = React.useState(state?.first_name ?? '');
  const [role, setRole] = React.useState<Role>(state?.role && state.first_name ? state.role : getRoleHint());
  const [petName, setPetName] = React.useState('');
  const [petType, setPetType] = React.useState<PetType>('dog');
  const [petSize, setPetSize] = React.useState<PetSize>('medium');
  const [petPhoto, setPetPhoto] = React.useState<string | null>(null);
  const [homeDone, setHomeDone] = React.useState(!!state?.has_home_photo);
  const [busy, setBusy] = React.useState<'pet' | 'home' | 'save' | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const needsPet = role !== 'sitter' && !state?.has_pet;
  const needsHome = role !== 'owner';
  const ready = name.trim().length > 0 && (!needsPet || (petName.trim().length > 0 && !!petPhoto)) && (!needsHome || homeDone);

  const photo = async (kind: 'pet' | 'home') => {
    setError(null);
    try {
      const uri = await pickPhoto();
      if (!uri) return;
      setBusy(kind);
      const path = await uploadPhoto(kind, uri);
      if (kind === 'pet') setPetPhoto(path); else setHomeDone(true);
    } catch (e) { setError(tr(errorKey(e))); } finally { setBusy(null); }
  };

  const save = async () => {
    setBusy('save'); setError(null);
    try {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) throw new Error('no user');
      const p = await supabase.from('profiles').update({ first_name: name.trim(), role }).eq('id', uid);
      if (p.error) throw p.error;
      if (needsPet && petPhoto) {
        const pet = await supabase.from('pets').insert({ owner_id: uid, name: petName.trim(), type: petType, size: petSize, photo_paths: [petPhoto] });
        if (pet.error) throw pet.error;
      }
      const next = await refresh();
      router.replace(`/signup/${next ? nextStep(next.missing) : 'location'}` as never);
    } catch { setError(tr('err.generic')); } finally { setBusy(null); }
  };

  return (
    <StepScreen step={4} title={tr('signup.about.title')} sub={tr('signup.about.sub')}
      footer={<Button navy title={tr('common.continue')} disabled={!ready || busy !== null} onPress={() => { save().catch(() => {}); }} />}>
      <TextField label={tr('signup.about.name')} value={name} onChangeText={setName} maxLength={40} autoComplete="given-name" textContentType="givenName" />

      <View style={{ gap: 10 }}>
        <Heading>{tr('signup.role.title')}</Heading>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Chip label={tr('welcome.needSitter')} selected={role === 'owner'} onPress={() => setRole('owner')} />
          <Chip label={tr('welcome.wantSit')} selected={role === 'sitter'} onPress={() => setRole('sitter')} />
          <Chip label={tr('signup.role.both')} selected={role === 'both'} onPress={() => setRole('both')} />
        </View>
      </View>

      {needsPet ? (
        <View style={{ gap: 12 }}>
          <Heading>{tr('signup.pet.title')}</Heading>
          <TextField label={tr('signup.pet.name')} value={petName} onChangeText={setPetName} maxLength={30} />
          <Heading>{tr('signup.pet.type')}</Heading>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(['dog', 'cat', 'other'] as const).map((k) => <Chip key={k} label={tr(`pet.${k}`)} selected={petType === k} onPress={() => setPetType(k)} />)}
          </View>
          <Heading>{tr('signup.pet.size')}</Heading>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(['small', 'medium', 'large'] as const).map((k) => <Chip key={k} label={tr(`signup.size.${k}`)} selected={petSize === k} onPress={() => setPetSize(k)} />)}
          </View>
          <PhotoButton done={!!petPhoto} label={tr('signup.pet.photo')} doneLabel={tr('signup.pet.photoDone')} busy={busy === 'pet'} onPress={() => { photo('pet').catch(() => {}); }} />
        </View>
      ) : null}

      {needsHome ? (
        <View style={{ gap: 12 }}>
          <Heading>{tr('signup.home.title')}</Heading>
          <PhotoButton done={homeDone} label={tr('signup.home.photo')} doneLabel={tr('signup.home.photoDone')} busy={busy === 'home'} onPress={() => { photo('home').catch(() => {}); }} />
        </View>
      ) : null}
      <ErrorText>{error}</ErrorText>
    </StepScreen>
  );
}
