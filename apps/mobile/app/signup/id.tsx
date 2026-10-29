import React from 'react';
import { router } from 'expo-router';
import { StepScreen, ErrorText } from '../../src/components/StepScreen';
import { CheckRow } from '../../src/components/CheckRow';
import { Button } from '../../src/components/Button';
import { errorKey, verifyId } from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth';
import { nextStep } from '../../src/lib/gate';
import { t as tr } from '../../src/i18n';

/** Step 3: ID check. The ID provider (a setting on the server) looks at the document; PawsPal keeps only the result. */
export default function IdStep() {
  const { refresh } = useAuth();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const start = async () => {
    setBusy(true); setError(null);
    try {
      const r = await verifyId();
      if (!r.ok) { setError(tr('signup.id.failed')); return; }
      if (!r.adult) { setError(tr('signup.id.underage')); return; }
      const state = await refresh();
      router.replace(`/signup/${state ? nextStep(state.missing) : 'about'}` as never);
    } catch (e) { setError(tr(errorKey(e))); } finally { setBusy(false); }
  };

  return (
    <StepScreen step={3} title={tr('signup.id.title')} sub={tr('signup.id.sub')}
      footer={<Button navy title={busy ? tr('common.loading') : tr('signup.id.start')} disabled={busy} onPress={() => { start().catch(() => {}); }} />}>
      <CheckRow title={tr('trust.noIdPhoto')} description={tr('trust.noIdPhotoSub')} />
      <ErrorText>{error}</ErrorText>
    </StepScreen>
  );
}
