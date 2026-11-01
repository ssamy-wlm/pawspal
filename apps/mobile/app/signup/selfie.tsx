import React from 'react';
import { Image, View } from 'react-native';
import { router } from 'expo-router';
import { StepScreen, ErrorText } from '../../src/components/StepScreen';
import { FaceCapture } from '../../src/components/FaceCapture';
import { Button } from '../../src/components/Button';
import { CheckRow } from '../../src/components/CheckRow';
import { errorKey, uploadPhoto } from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth';
import { setFacePath } from '../../src/lib/draft';
import { t as tr } from '../../src/i18n';

/** Step 1: selfie with a face guide. The photo is cleaned on the server and kept private; the team checks it by hand. */
export default function SelfieStep() {
  const { state } = useAuth();
  const [uri, setUri] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const rejected = state?.verification?.status === 'rejected';

  const submit = async () => {
    if (!uri) return;
    setBusy(true); setError(null);
    try {
      const path = await uploadPhoto('face', uri);
      setFacePath(path);
      router.replace('/signup/id');
    } catch (e) { setError(tr(errorKey(e))); } finally { setBusy(false); }
  };

  return (
    <StepScreen step={1} total={5} title={tr('signup.selfie.title')} sub={tr('signup.selfie.sub')}
      footer={uri ? (
        <>
          <Button navy title={busy ? tr('signup.photo.checking') : tr('signup.selfie.use')} disabled={busy} onPress={() => { submit().catch(() => {}); }} />
          <Button navy variant="secondary" title={tr('signup.selfie.retake')} disabled={busy} onPress={() => setUri(null)} />
        </>) : undefined}>
      {rejected ? <CheckRow done={false} title={tr('verify.rejected')} description={state?.verification.note ?? undefined} /> : null}
      {uri ? (
        <View style={{ aspectRatio: 3 / 4, borderRadius: 24, overflow: 'hidden' }}>
          <Image source={{ uri }} accessible accessibilityLabel={tr('signup.selfie.preview')} style={{ flex: 1 }} />
        </View>
      ) : <FaceCapture onCaptured={(u) => { setError(null); setUri(u); }} onError={() => setError(tr('err.generic'))} />}
      <ErrorText>{error}</ErrorText>
    </StepScreen>
  );
}
