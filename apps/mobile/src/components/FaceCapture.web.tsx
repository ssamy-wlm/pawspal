import React from 'react';
import { Text, View } from 'react-native';
import Svg, { Ellipse } from 'react-native-svg';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { Button } from './Button';
import { fontFamily, useTheme } from '../theme';
import { isRTL, t as tr } from '../i18n';

/** True when this browser can open a camera on this page (it needs https, or localhost). */
export const canUseCamera = (): boolean =>
  typeof window !== 'undefined' && window.isSecureContext !== false && typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function';

/** Web: the selfie from the browser's camera when it allows it; otherwise (or by choice) a photo taken or chosen with the device. */
export function FaceCapture({ onCaptured, onError }: { onCaptured: (uri: string) => void; onError: () => void }) {
  const t = useTheme();
  const body = { color: t.color.text, fontSize: 16, lineHeight: 23, fontFamily: fontFamily('regular', isRTL()) } as const;
  const [permission, ask] = useCameraPermissions();
  const camera = React.useRef<CameraView>(null);
  const [busy, setBusy] = React.useState(false);
  const supported = canUseCamera();

  const fromDevice = async (takeNew: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      const opts = { mediaTypes: ['images' as const], quality: 0.8, exif: false };
      const r = takeNew ? await ImagePicker.launchCameraAsync({ ...opts, cameraType: ImagePicker.CameraType.front }) : await ImagePicker.launchImageLibraryAsync(opts);
      const uri = r.canceled ? null : r.assets[0]?.uri ?? null;
      if (uri) onCaptured(uri);
    } catch { onError(); } finally { setBusy(false); }
  };
  const choose = <Button navy variant="secondary" title={tr('signup.selfie.choose')} disabled={busy} onPress={() => { fromDevice(false).catch(() => {}); }} />;

  // No camera in this browser (or not on https): take a photo with the device or pick one.
  if (!supported) {
    return (
      <View style={{ gap: 16 }}>
        <Text style={body}>{tr('signup.selfie.webNoCamera')}</Text>
        <Button navy title={tr('signup.selfie.take')} disabled={busy} onPress={() => { fromDevice(true).catch(() => {}); }} />
        {choose}
      </View>
    );
  }
  if (!permission) return null;
  if (!permission.granted) {
    return (
      <View style={{ gap: 16 }}>
        <Text style={body}>{permission.canAskAgain ? tr('signup.camera.denied') : tr('signup.camera.deniedWeb')}</Text>
        {permission.canAskAgain ? <Button navy title={tr('signup.camera.allow')} onPress={() => { ask().catch(() => {}); }} /> : null}
        {choose}
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
      {choose}
    </View>
  );
}
