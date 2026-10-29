import React from 'react';
import { Image, View } from 'react-native';
import { router } from 'expo-router';
import { StepScreen, ErrorText } from '../../src/components/StepScreen';
import { FaceCapture } from '../../src/components/FaceCapture';
import { Button } from '../../src/components/Button';
import { errorKey, uploadPhoto, verifyFace } from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth';
import { nextStep } from '../../src/lib/gate';
import { t as tr } from '../../src/i18n';

/** Step 2: selfie with a face guide. The photo is cleaned on the server, checked once, and kept private. */
export default function SelfieStep() {
  const { refresh } = useAuth();
  const [uri, setUri] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const submit = async () => {
    if (!uri) return;
    setBusy(true); setError(null);
    try {
      const path = await uploadPhoto('face', uri);
      if (!(await verifyFace(path))) { setError(tr('signup.selfie.failed')); setUri(null); return; }
      const state = await refresh();
      router.replace(`/signup/${state ? nextStep(state.missing) : 'id'}` as never);
    } catch (e) { setError(tr(errorKey(e))); } finally { setBusy(false); }
  };

  return (
    <StepScreen step={2} title={tr('signup.selfie.title')} sub={tr('signup.selfie.sub')}
      footer={uri ? (
        <>
          <Button navy title={busy ? tr('signup.photo.checking') : tr('signup.selfie.use')} disabled={busy} onPress={() => { submit().catch(() => {}); }} />
          <Button navy variant="secondary" title={tr('signup.selfie.retake')} disabled={busy} onPress={() => setUri(null)} />
        </>) : undefined}>
      {uri ? (
        <View style={{ aspectRatio: 3 / 4, borderRadius: 24, overflow: 'hidden' }}>
          <Image source={{ uri }} accessible accessibilityLabel={tr('signup.selfie.preview')} style={{ flex: 1 }} />
        </View>
      ) : <FaceCapture onCaptured={(u) => { setError(null); setUri(u); }} onError={() => setError(tr('err.generic'))} />}
      <ErrorText>{error}</ErrorText>
    </StepScreen>
  );
}
