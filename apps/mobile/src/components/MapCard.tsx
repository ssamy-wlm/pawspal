import React from 'react';
import { Linking, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { Button } from './Button';
import { PinDrop } from './PinDrop';
import { fontFamily, useTheme } from '../theme';
import { isRTL, t as tr } from '../i18n';
import { useEntrance } from '../motion';
import { useToast } from './Toast';

const validCoords = (lat?: number, lng?: number): lat is number =>
  typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

/**
 * The "Exact pin unlocked" chip: slides down 20 px and fades in at 1700 ms, after the pin has landed (docs/motion.md
 * section 6, item 5). With Reduce Motion it only fades in over 200 ms.
 */
function ExactChip() {
  const t = useTheme();
  const rtl = isRTL();
  const slide = useEntrance({ delay: 1700, rise: -20, duration: 400, scale: false });
  return (
    <Animated.View style={[{ alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, backgroundColor: t.color.primary }, slide]}>
      <Text style={{ fontSize: 14, color: t.color.onPrimary, fontFamily: fontFamily('semibold', rtl) }}>{tr('map.exact')}</Text>
    </Animated.View>
  );
}

/**
 * Approximate area (shaded circle) for everyone, or the exact pin once a booking is confirmed and paid.
 * Exact coordinates only ever come from get_booking_location(); this card never fetches them itself.
 */
export function MapCard({ exact, lat, lng, address }: { exact?: boolean; lat?: number; lng?: number; address?: string | null }) {
  const t = useTheme();
  const c = t.color;
  const rtl = isRTL();
  const rise = useEntrance({ rise: 60, duration: 550, scale: false });
  const toast = useToast();
  const canNavigate = exact && validCoords(lat, lng);
  return (
    <Animated.View style={[{ borderRadius: 24, overflow: 'hidden', backgroundColor: c.surface, borderWidth: 1, borderColor: c.border }, rise]}>
      <View style={{ height: 200, backgroundColor: t.tint.sea, alignItems: 'center', justifyContent: 'center' }}>
        {exact ? <PinDrop /> : (
          <View accessible accessibilityLabel={tr('map.approx')} style={{ width: 150, height: 150, borderRadius: 75, backgroundColor: t.tint.teal, borderWidth: 3, borderColor: t.brand.teal, opacity: 0.9 }} />
        )}
      </View>
      <View style={{ padding: 16, gap: 10 }}>
        {exact ? <ExactChip /> : (
          <View style={{ alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, backgroundColor: t.tint.orange }}>
            <Text style={{ fontSize: 14, color: t.brand.navy, fontFamily: fontFamily('semibold', rtl) }}>{tr('map.approx')}</Text>
          </View>
        )}
        {exact && address ? <Text style={{ color: c.text, fontSize: 16, fontFamily: fontFamily('regular', rtl) }}>{address}</Text> : null}
        {canNavigate ? (
          <Button title={tr('map.directions')} onPress={() => { Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`).catch(() => toast.show(tr('map.openFailed'), 'error')); }} />
        ) : null}
      </View>
    </Animated.View>
  );
}
