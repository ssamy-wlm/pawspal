import React from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from './Button';
import { fontFamily, useTheme } from '../theme';
import { isRTL, t as tr } from '../i18n';
import { useEntrance } from '../motion';
import {
  captureInstallPrompt, hasDeferredPrompt, installMode, InstallMode, isIos, isIosSafari, isStandalone,
  onInstallChange, rememberDismissed, runInstallPrompt, wasDismissed,
} from '../lib/installPrompt';

function useInstallMode(): { mode: InstallMode; safari: boolean } {
  const [, bump] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => { captureInstallPrompt(); return onInstallChange(bump); }, []);
  if (typeof window === 'undefined') return { mode: 'hidden', safari: false };
  const nav = window.navigator;
  const ios = isIos(nav.userAgent, nav.maxTouchPoints, nav.platform);
  return {
    mode: installMode({ standalone: isStandalone(window as never), deferred: hasDeferredPrompt(), ios }),
    safari: isIosSafari(nav.userAgent, nav.maxTouchPoints, nav.platform),
  };
}

function Steps({ safari, onClose }: { safari: boolean; onClose: () => void }) {
  const t = useTheme();
  const c = t.color;
  const rtl = isRTL();
  const enter = useEntrance({ rise: 60, scale: false, duration: 350 });
  const insets = useSafeAreaInsets();
  const text = { color: c.text, fontSize: 16, lineHeight: 23, fontFamily: fontFamily('regular', rtl), flexShrink: 1 } as const;
  const steps = ['install.step1', 'install.step2', 'install.step3'] as const;
  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} accessibilityViewIsModal>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: t.brand.navy + '99' }}>
        <Pressable accessibilityRole="button" accessibilityLabel={tr('install.close')} style={{ flex: 1 }} onPress={onClose} />
        <Animated.View style={[{ backgroundColor: c.surface, padding: 24, paddingBottom: 24 + insets.bottom, gap: 16, borderTopStartRadius: 28, borderTopEndRadius: 28 }, enter]}>
          <Text accessibilityRole="header" style={{ color: c.text, fontSize: 20, fontFamily: fontFamily('bold', rtl) }}>{tr('install.howTitle')}</Text>
          {steps.map((k, i) => (
            <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: c.primary }}>
                <Text style={{ color: c.onPrimary, fontFamily: fontFamily('bold', false) }}>{i + 1}</Text>
              </View>
              <Text style={text}>{tr(k)}</Text>
            </View>
          ))}
          {safari ? null : <Text style={[text, { color: c.textMuted, fontSize: 14 }]}>{tr('install.openSafari')}</Text>}
          <Button title={tr('install.close')} onPress={onClose} />
        </Animated.View>
      </View>
    </Modal>
  );
}

/**
 * Web only. Chrome, Edge and Android: a short card with "Install" that opens the browser's own install dialog.
 * iPhone and iPad: the same card opens three plain steps (Share, Add to Home Screen, Add). Hidden once PawsPal is on the
 * home screen. The banner can be dismissed and stays away; the Settings row is always there until it is installed.
 * It never blocks anything: it sits beside the buttons, never in front of them.
 */
export function InstallPrompt({ variant = 'banner', delay = 0 }: { variant?: 'banner' | 'settings'; delay?: number }) {
  const t = useTheme();
  const c = t.color;
  const rtl = isRTL();
  const { mode, safari } = useInstallMode();
  const [dismissed, setDismissed] = React.useState(true); // stay hidden until we know the saved choice
  const [sheet, setSheet] = React.useState(false);
  const enter = useEntrance({ delay, rise: 20, scale: false, duration: 400 });
  React.useEffect(() => {
    let live = true;
    wasDismissed().then((d) => { if (live) setDismissed(d); }, () => {});
    return () => { live = false; };
  }, []);

  if (mode === 'hidden' || (variant === 'banner' && dismissed)) return null;

  const go = () => { if (mode === 'ios') setSheet(true); else runInstallPrompt().catch(() => {}); };
  const dismiss = () => { setDismissed(true); rememberDismissed().catch(() => {}); };
  const muted = { color: c.textMuted, fontSize: 14, fontFamily: fontFamily('regular', rtl) } as const;

  if (variant === 'settings') {
    return (
      <View style={{ gap: 12 }}>
        <Text accessibilityRole="header" style={{ color: c.text, fontSize: 18, fontFamily: fontFamily('bold', rtl) }}>{tr('install.title')}</Text>
        <Button variant="secondary" title={mode === 'ios' ? tr('install.how') : tr('install.button')} onPress={go} />
        <Text style={muted}>{tr('install.sub')}</Text>
        {sheet ? <Steps safari={safari} onClose={() => setSheet(false)} /> : null}
      </View>
    );
  }

  return (
    <Animated.View style={enter}>
      <View accessibilityRole="summary" style={{ gap: 10, padding: 16, borderRadius: 24, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
          <View style={{ flexShrink: 1, gap: 2 }}>
            <Text style={{ color: c.text, fontSize: 16, fontFamily: fontFamily('bold', rtl) }}>{tr('install.title')}</Text>
            <Text style={muted}>{tr('install.sub')}</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <Button title={mode === 'ios' ? tr('install.how') : tr('install.button')} onPress={go} style={{ minHeight: 44, paddingHorizontal: 20 }} />
          <Pressable accessibilityRole="button" accessibilityLabel={tr('install.dismissLabel')} onPress={dismiss}
            style={{ minHeight: 44, minWidth: 44, justifyContent: 'center', paddingHorizontal: 12 }}>
            <Text style={{ color: c.link, fontSize: 15, fontFamily: fontFamily('medium', rtl) }}>{tr('install.dismiss')}</Text>
          </Pressable>
        </View>
        {sheet ? <Steps safari={safari} onClose={() => setSheet(false)} /> : null}
      </View>
    </Animated.View>
  );
}
