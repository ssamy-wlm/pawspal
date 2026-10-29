import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Link, router } from 'expo-router';
import { StepScreen, ErrorText } from '../../src/components/StepScreen';
import { Button } from '../../src/components/Button';
import { Icon } from '../../src/components/Icon';
import { useAuth } from '../../src/lib/auth';
import { supabase } from '../../src/lib/supabase';
import { fontFamily, useTheme } from '../../src/theme';
import { isRTL, Key, t as tr } from '../../src/i18n';

const DOCS: { doc: 'terms' | 'privacy' | 'guidelines'; slug: string; label: Key }[] = [
  { doc: 'terms', slug: 'termsOfService', label: 'legal.terms' },
  { doc: 'privacy', slug: 'privacyPolicy', label: 'legal.privacy' },
  { doc: 'guidelines', slug: 'communityGuidelines', label: 'legal.guidelines' },
];

/** Step 6: accept Terms, Privacy and Community Guidelines (the version current today), then send for review. */
export default function RulesStep() {
  const { refresh } = useAuth();
  const c = useTheme(true).color;
  const rtl = isRTL();
  const [ticked, setTicked] = React.useState<Record<string, boolean>>({});
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const all = DOCS.every((d) => ticked[d.doc]);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      const versions = await supabase.from('legal_documents').select('doc, current_version');
      if (!uid || versions.error) throw new Error('not ready');
      for (const v of versions.data) {
        const r = await supabase.from('legal_acceptances').insert({ user_id: uid, doc: v.doc, version: v.current_version });
        if (r.error && r.error.code !== '23505') throw r.error;     // already accepted this version: fine
      }
      const s = await supabase.rpc('submit_profile');
      if (s.error) throw s.error;
      await refresh();
      router.replace('/pending');
    } catch { setError(tr('err.generic')); } finally { setBusy(false); }
  };

  return (
    <StepScreen step={6} title={tr('signup.rules.title')} sub={tr('signup.rules.sub')}
      footer={<Button navy title={tr('signup.rules.submit')} disabled={!all || busy} onPress={() => { submit().catch(() => {}); }} />}>
      {DOCS.map((d) => {
        const on = !!ticked[d.doc];
        return (
          <View key={d.doc} style={{ gap: 4 }}>
            <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={tr('signup.rules.accept', { doc: tr(d.label) })}
              onPress={() => setTicked((s) => ({ ...s, [d.doc]: !on }))}
              style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <View style={{ width: 32, height: 32, borderRadius: 10, borderWidth: 2, borderColor: on ? c.primary : c.textMuted, backgroundColor: on ? c.primary : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                {on ? <Icon name="check" color={c.onPrimary} size={18} /> : null}
              </View>
              <Text style={{ flex: 1, color: c.text, fontSize: 16, fontFamily: fontFamily('medium', rtl) }}>{tr('signup.rules.accept', { doc: tr(d.label) })}</Text>
            </Pressable>
            <Link href={`/legal/${d.slug}` as never} asChild>
              <Pressable accessibilityRole="link" style={{ minHeight: 44, justifyContent: 'center', paddingStart: 46 }}>
                <Text style={{ color: c.link, fontSize: 14, fontFamily: fontFamily('medium', rtl) }}>{tr(d.label)}</Text>
              </Pressable>
            </Link>
          </View>
        );
      })}
      <ErrorText>{error}</ErrorText>
    </StepScreen>
  );
}
