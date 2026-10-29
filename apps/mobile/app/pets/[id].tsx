import React from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Button } from '../../src/components/Button';
import { Chip } from '../../src/components/Chip';
import { EmptyState } from '../../src/components/EmptyState';
import { Heading } from '../../src/components/Heading';
import { PetPhoto } from '../../src/components/PetPhoto';
import { ErrorText } from '../../src/components/StepScreen';
import { TextField } from '../../src/components/TextField';
import { useToast } from '../../src/components/Toast';
import { errorKey, uploadPhoto } from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth';
import { deletePet, fetchMyPetCare, fetchPet, Pet, PetSize, PetType, removePhotoFiles, saveMyPetCare, savePet } from '../../src/lib/profile';
import { fontFamily, useTheme } from '../../src/theme';
import { isRTL, t as tr, tn } from '../../src/i18n';

const MAX_PHOTOS = 8;

/**
 * One pet. Yours: a form (add, change, delete, private vet details). Someone else's: a read-only profile.
 * A pet in a confirmed booking is read-only for its owner too; the database enforces that, this only explains it.
 */
export default function PetScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const { session } = useAuth();
  const userId = session?.user.id ?? '';
  const c = useTheme().color;
  const rtl = isRTL();
  const toast = useToast();
  const [state, setState] = React.useState<'loading' | 'ready' | 'missing'>(isNew ? 'ready' : 'loading');
  const [pet, setPet] = React.useState<Pet | null>(null);
  const [name, setName] = React.useState('');
  const [type, setType] = React.useState<PetType>('dog');
  const [size, setSize] = React.useState<PetSize>('medium');
  const [age, setAge] = React.useState('');
  const [vaccinated, setVaccinated] = React.useState(false);
  const [notes, setNotes] = React.useState('');
  const [photos, setPhotos] = React.useState<string[]>([]);
  const savedPhotos = React.useRef<string[]>([]);     // the photos the pet had when this screen loaded
  const uploaded = React.useRef<string[]>([]);        // photos added on this screen (they are clutter if never saved)
  const finished = React.useRef(false);               // true once the pet was saved or deleted
  const [vetName, setVetName] = React.useState('');
  const [vetPhone, setVetPhone] = React.useState('');
  const [careNotes, setCareNotes] = React.useState('');
  const [careLoaded, setCareLoaded] = React.useState(isNew);   // vet details are only saved back if they were read first
  const [busy, setBusy] = React.useState(false);
  const [sure, setSure] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (isNew || !id) return;
    let live = true;
    (async () => {
      const p = await fetchPet(id);
      if (!live) return;
      if (!p) { setState('missing'); return; }
      setPet(p); setName(p.name); setType(p.type); setSize(p.size); setAge(p.age_years != null ? String(p.age_years) : '');
      setVaccinated(p.vaccinated); setNotes(p.notes ?? ''); setPhotos(p.photo_paths); savedPhotos.current = p.photo_paths;
      if (p.owner_id === userId) {
        const care = await fetchMyPetCare(p.id).catch(() => null);
        if (live && care) { setVetName(care.vet_name); setVetPhone(care.vet_phone); setCareNotes(care.care_notes); setCareLoaded(true); }
      }
      if (live) setState('ready');
    })().catch(() => { if (live) setState('missing'); });
    return () => { live = false; };
  }, [id, isNew, userId]);

  // Leaving the screen without saving: the photos added here are never used, so they are deleted.
  React.useEffect(() => () => {
    if (!finished.current && uploaded.current.length > 0) void removePhotoFiles('pets', uploaded.current);   // never throws
  }, []);

  const mine = isNew || pet?.owner_id === userId;
  const locked = !!pet?.locked;
  const editable = mine && !locked;

  const addPhoto = async () => {
    setError(null);
    try {
      const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, exif: false });
      const uri = r.canceled ? null : r.assets[0]?.uri;
      if (!uri) return;
      setBusy(true);
      const path = await uploadPhoto('pet', uri);
      uploaded.current.push(path);
      setPhotos((p) => [...p, path]);
    } catch (e) { setError(tr(errorKey(e))); } finally { setBusy(false); }
  };

  const save = async () => {
    setBusy(true); setError(null);
    try {
      const years = age.trim() === '' ? null : Math.max(0, Math.min(40, parseInt(age, 10) || 0));
      const savedId = await savePet(userId, isNew ? null : id!, { name, type, size, age_years: years, vaccinated, notes, photo_paths: photos });
      if (careLoaded || vetName || vetPhone || careNotes) await saveMyPetCare(savedId, { vet_name: vetName, vet_phone: vetPhone, care_notes: careNotes });
      // Photos taken off the pet (or added and then removed again) are deleted from storage once the pet is saved.
      finished.current = true;
      await removePhotoFiles('pets', [...savedPhotos.current, ...uploaded.current].filter((p) => !photos.includes(p)));
      toast.show(tr('edit.saved'));
      router.back();
    } catch { setError(tr('err.generic')); } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!sure) { setSure(true); return; }
    setBusy(true); setError(null);
    try { await deletePet(id!); finished.current = true; await removePhotoFiles('pets', [...new Set([...savedPhotos.current, ...uploaded.current])]); router.back(); } catch { setError(tr('err.generic')); setSure(false); } finally { setBusy(false); }
  };

  if (state === 'loading') return null;
  if (state === 'missing') return <EmptyState message={tr('pet.notFound')} />;

  const label = (text: string) => <Text style={{ color: c.textMuted, fontSize: 14, fontFamily: fontFamily('medium', rtl) }}>{text}</Text>;
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <Stack.Screen options={{ title: isNew ? tr('pet.new') : name }} />
    <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={{ padding: 24, gap: 14, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
      {mine && locked ? (
        <View accessible accessibilityRole="alert" style={{ padding: 14, borderRadius: 16, backgroundColor: c.surface, borderWidth: 2, borderColor: c.primary }}>
          <Text style={{ color: c.text, fontSize: 15, lineHeight: 22, fontFamily: fontFamily('medium', rtl) }}>{tr('pet.lockedBanner')}</Text>
        </View>
      ) : null}

      <Heading>{tr('pet.photos')}</Heading>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
        {photos.map((path, i) => (
          <View key={path}>
            <PetPhoto path={path} size={120} label={tr('pet.photo', { n: i + 1 })} />
            {editable && photos.length > 1 ? (
              <Pressable accessibilityRole="button" accessibilityLabel={tr('pet.removePhoto', { n: i + 1 })} onPress={() => setPhotos((p) => p.filter((x) => x !== path))}
                style={{ position: 'absolute', top: 4, end: 4, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
                <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: c.danger, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: c.onDanger, fontSize: 18, fontFamily: fontFamily('bold', false) }}>×</Text>
                </View>
              </Pressable>
            ) : null}
          </View>
        ))}
      </ScrollView>
      {editable && photos.length < MAX_PHOTOS ? <Button variant="secondary" title={tr('pet.addPhoto')} disabled={busy} onPress={() => { addPhoto().catch(() => {}); }} /> : null}
      {editable ? label(tr('pet.photoLimit', { n: MAX_PHOTOS })) : null}

      {editable ? (
        <>
          <TextField label={tr('pet.name')} value={name} onChangeText={setName} maxLength={30} autoCapitalize="words" />
          {label(tr('pet.typeTitle'))}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(['dog', 'cat', 'other'] as const).map((k) => <Chip key={k} label={tr(`pet.${k}`)} selected={type === k} onPress={() => setType(k)} />)}
          </View>
          {label(tr('pet.sizeTitle'))}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(['small', 'medium', 'large'] as const).map((k) => <Chip key={k} label={tr(`signup.size.${k}`)} selected={size === k} onPress={() => setSize(k)} />)}
          </View>
          <TextField label={tr('pet.age')} value={age} onChangeText={(v) => setAge(v.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/\D/g, '').slice(0, 2))} keyboardType="number-pad" />
          <View style={{ flexDirection: 'row' }}><Chip label={tr('pet.vaccinated')} selected={vaccinated} onPress={() => setVaccinated((v) => !v)} /></View>
          <TextField label={tr('pet.notes')} hint={tr('pet.notesHint')} value={notes} onChangeText={setNotes} maxLength={600} multiline
            style={{ minHeight: 100, textAlignVertical: 'top', paddingTop: 14 }} />

          <Heading>{tr('pet.care')}</Heading>
          {label(tr('pet.careSub'))}
          <TextField label={tr('pet.vetName')} value={vetName} onChangeText={setVetName} maxLength={80} />
          <TextField label={tr('pet.vetPhone')} value={vetPhone} onChangeText={setVetPhone} maxLength={30} keyboardType="phone-pad" />
          <TextField label={tr('pet.careNotes')} value={careNotes} onChangeText={setCareNotes} maxLength={1500} multiline style={{ minHeight: 100, textAlignVertical: 'top', paddingTop: 14 }} />
          <ErrorText>{error}</ErrorText>
          <Button title={tr('pet.save')} disabled={busy || name.trim().length === 0 || photos.length === 0} onPress={() => { save().catch(() => {}); }} />
          {!isNew ? <Button variant="danger" title={sure ? tr('pet.deleteSure') : tr('pet.delete')} disabled={busy} onPress={() => { remove().catch(() => {}); }} /> : null}
        </>
      ) : pet ? (
        <View style={{ gap: 8 }}>
          <Text accessibilityRole="header" style={{ color: c.text, fontSize: 28, fontFamily: fontFamily('extrabold', rtl) }}>{pet.name}</Text>
          <Text style={{ color: c.textMuted, fontSize: 16, fontFamily: fontFamily('regular', rtl) }}>
            {[tr(`pet.${pet.type}`), tr(`signup.size.${pet.size}`), pet.age_years != null ? tn('count.year', pet.age_years) : null, pet.vaccinated ? tr('pet.vaccinatedYes') : null].filter(Boolean).join(' · ')}
          </Text>
          {pet.notes ? <Text style={{ color: c.text, fontSize: 16, lineHeight: 23, fontFamily: fontFamily('regular', rtl) }}>{pet.notes}</Text> : null}
        </View>
      ) : null}
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
