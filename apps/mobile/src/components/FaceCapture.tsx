import React from 'react';
import { Linking, Text, View } from 'react-native';
import Svg, { Ellipse } from 'react-native-svg';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Button } from './Button';
import { fontFamily, useTheme } from '../theme';
import { isRTL, t as tr } from '../i18n';

/** Front camera with an oval guide. Hands back the photo's address when the person taps the shutter. */
export function FaceCapture({ onCaptured, onError }: { onCaptured: (uri: string) => void; onError: () => void }) {
  const t = useTheme();
  const [permission, ask] = useCameraPermissions();
  const camera = React.useRef<CameraView>(null);
  const [busy, setBusy] = React.useState(false);

  if (!permission) return null;
  if (!permission.granted) {
    return (
      <View style={{ gap: 16 }}>
        <Text style={{ color: t.color.text, fontSize: 16, lineHeight: 23, fontFamily: fontFamily('regular', isRTL()) }}>{tr('signup.camera.denied')}</Text>
        <Button navy title={permission.canAskAgain ? tr('signup.camera.allow') : tr('signup.camera.settings')}
          onPress={() => { (permission.canAskAgain ? ask() : Linking.openSettings()).catch(() => {}); }} />
      </View>
    );
  }

  const shoot = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const photo = await camera.current?.takePictureAsync({ quality: 0.8, exif: false, skipProcessing: false });
      if (photo?.uri) onCaptured(photo.uri); else onError();
    } catch { onError(); } finally { setBusy(false); }
  };

  return (
    <View style={{ gap: 16 }}>
      <View accessible accessibilityLabel={tr('signup.selfie.guide')} style={{ aspectRatio: 3 / 4, borderRadius: 24, overflow: 'hidden', backgroundColor: t.brand.navy }}>
        <CameraView ref={camera} facing="front" style={{ flex: 1 }} mirror />
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0 }}>
          <Svg width="100%" height="100%" viewBox="0 0 300 400">
            <Ellipse cx={150} cy={190} rx={105} ry={140} fill="none" stroke={t.brand.teal} strokeWidth={5} strokeDasharray="14 10" />
          </Svg>
        </View>
      </View>
      <Button navy title={tr('signup.selfie.take')} disabled={busy} onPress={() => { shoot().catch(() => {}); }} />
    </View>
  );
}
