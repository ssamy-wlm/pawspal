import React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Button } from '../../src/components/Button';
import { BACKGROUNDS, CardArt, CardBackground, CardIllustration, ILLUSTRATIONS } from '../../src/components/CardArt';
import { Chip } from '../../src/components/Chip';
import { EmptyState } from '../../src/components/EmptyState';
import { Heading } from '../../src/components/Heading';
import { TextField } from '../../src/components/TextField';
import { useToast } from '../../src/components/Toast';
import { ErrorText } from '../../src/components/StepScreen';
import { useAuth } from '../../src/lib/auth';
import { fetchMyProfile, PublicProfile, saveMyProfile } from '../../src/lib/profile';
import { fontFamily, useTheme } from '../../src/theme';
import { isRTL, Key, t as tr } from '../../src/i18n';

const ROLE_LABEL: Record<PublicProfile['role'], Key> = { owner: 'profile.role.owner', sitter: 'profile.role.sitter', both: 'profile.role.both' };

/** Edit your name, about text, area and the look of your card (picture and background, with a live preview). */
export default function EditProfile() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const c = useTheme().color;
  const toast = useToast();
  const [loaded, setLoaded] = React.useState<'loading' | 'ready' | 'failed'>('loading');
  const [role, setRole] = React.useState<PublicProfile['role']>('both');
  const [name, setName] = React.useState('');
  const [bio, setBio] = React.useState('');
  const [area, setArea] = React.useState('');
  const [art, setArt] = React.useState<CardIllustration>('dog-biscuit');
  const [bg, setBg] = React.useState<CardBackground>('circles_teal');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!userId) return;
    let live = true;
    fetchMyProfile(userId).then((p) => {
      if (!live) return;
      if (!p) { setLoaded('failed'); return; }
      setRole(p.role); setName(p.first_name ?? ''); setBio(p.bio ?? ''); setArea(p.area ?? '');
      setArt(p.card_illustration); setBg(p.card_background); setLoaded('ready');
    }, () => { if (live) setLoaded('failed'); });
    return () => { live = false; };
  }, [userId]);

  const save = async () => {
    if (!userId) return;
    setBusy(true); setError(null);
    try {
      await saveMyProfile(userId, { first_name: name, bio, area, card_illustration: art, card_background: bg });
      toast.show(tr('edit.saved'));
      router.back();
    } catch { setError(tr('err.generic')); } finally { setBusy(false); }
  };

  if (loaded === 'loading') return null;
  if (loaded === 'failed') return <EmptyState message={tr('err.generic')} />;
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={{ gap: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <CardArt illustration={art} background={bg} height={200} label={tr(`art.${art}`)} />
      <View style={{ paddingHorizontal: 24, gap: 16 }}>
        <Heading>{tr('edit.style')}</Heading>
        <Text style={{ color: c.textMuted, fontSize: 14, fontFamily: fontFamily('medium', isRTL()) }}>{tr('edit.picture')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {ILLUSTRATIONS.map((k) => <Chip key={k} label={tr(`art.${k}`)} selected={art === k} onPress={() => setArt(k)} />)}
        </View>
        <Text style={{ color: c.textMuted, fontSize: 14, fontFamily: fontFamily('medium', isRTL()) }}>{tr('edit.background')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {BACKGROUNDS.map((k) => <Chip key={k} label={tr(`bg.${k}`)} selected={bg === k} onPress={() => setBg(k)} />)}
        </View>

        <TextField label={tr('edit.name')} value={name} onChangeText={setName} maxLength={40} autoCapitalize="words" />
        <TextField label={tr('edit.bio')} hint={tr('edit.bioHint')} value={bio} onChangeText={setBio} maxLength={600} multiline
          style={{ minHeight: 120, textAlignVertical: 'top', paddingTop: 14 }} />
        <TextField label={tr('edit.area')} value={area} onChangeText={setArea} maxLength={60} />
        <View accessible style={{ gap: 4 }}>
          <Text style={{ color: c.text, fontSize: 16, fontFamily: fontFamily('semibold', isRTL()) }}>{tr(ROLE_LABEL[role])}</Text>
          <Text style={{ color: c.textMuted, fontSize: 14, fontFamily: fontFamily('regular', isRTL()) }}>{tr('edit.roleFixed')}</Text>
        </View>
        <ErrorText>{error}</ErrorText>
        <Button title={tr('edit.save')} disabled={busy || name.trim().length === 0} onPress={() => { save().catch(() => {}); }} />
      </View>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
