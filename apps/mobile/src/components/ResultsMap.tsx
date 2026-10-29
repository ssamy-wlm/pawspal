import React from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';
import { BrowseCard } from './BrowseCard';
import { Button } from './Button';
import { fontFamily, lightTheme, useTheme } from '../theme';
import { isRTL, t as tr } from '../i18n';
import type { StayResult } from '../lib/search';

const SIZE = 320;
const PAD = 40;
const RADIUS = 26;

/**
 * Results as circles on a plain area map. Each circle marks a host's AREA (the server only ever gives approximate
 * positions), never a home. Real map tiles can replace the background later without changing this.
 */
export function ResultsMap({ results, onOpen }: { results: StayResult[]; onOpen: (r: StayResult) => void }) {
  const t = useTheme();
  const c = t.color;
  const rtl = isRTL();
  const [selected, setSelected] = React.useState<string | null>(null);
  const located = results.filter((r) => typeof r.approx_lat === 'number' && typeof r.approx_lng === 'number');
  if (located.length === 0) return <Text style={{ color: c.textMuted, fontFamily: fontFamily('regular', rtl) }}>{tr('map.empty')}</Text>;

  const lats = located.map((r) => r.approx_lat as number);
  const lngs = located.map((r) => r.approx_lng as number);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const span = Math.max(maxLat - minLat, maxLng - minLng, 0.01);                 // keeps a single host in the middle
  const place = (r: StayResult) => ({
    x: PAD + (((r.approx_lng as number) - minLng) / span) * (SIZE - 2 * PAD) + ((span - (maxLng - minLng)) / span) * ((SIZE - 2 * PAD) / 2),
    y: PAD + ((maxLat - (r.approx_lat as number)) / span) * (SIZE - 2 * PAD) + ((span - (maxLat - minLat)) / span) * ((SIZE - 2 * PAD) / 2),
  });
  const current = located.find((r) => r.availability_id === selected) ?? null;

  return (
    <View style={{ gap: 12 }}>
      <View style={{ width: SIZE, height: SIZE, alignSelf: 'center', borderRadius: 24, overflow: 'hidden', backgroundColor: t.tint.sea }}>
        <Svg width={SIZE} height={SIZE} accessible={false}>
          {[1, 2, 3].map((i) => <Line key={`h${i}`} x1={0} x2={SIZE} y1={(SIZE / 4) * i} y2={(SIZE / 4) * i} stroke={lightTheme.color.surface} strokeOpacity={0.6} strokeWidth={2} />)}
          {[1, 2, 3].map((i) => <Line key={`v${i}`} y1={0} y2={SIZE} x1={(SIZE / 4) * i} x2={(SIZE / 4) * i} stroke={lightTheme.color.surface} strokeOpacity={0.6} strokeWidth={2} />)}
          {located.map((r) => {
            const { x, y } = place(r);
            const on = r.availability_id === selected;
            return <Circle key={r.availability_id} cx={x} cy={y} r={RADIUS} fill={on ? t.brand.orange : t.tint.teal} fillOpacity={0.85} stroke={on ? t.brand.coral : t.brand.tealDeep} strokeWidth={on ? 5 : 3} />;
          })}
        </Svg>
        {located.map((r) => {
          const { x, y } = place(r);
          return (
            <Pressable key={r.availability_id} accessibilityRole="button" accessibilityLabel={`${r.first_name}${r.area ? `, ${r.area}` : ''}`}
              accessibilityState={{ selected: r.availability_id === selected }} onPress={() => setSelected(r.availability_id)}
              // A map does not mirror in right-to-left languages, so physical left/top are right here.
              style={{ position: 'absolute', left: x - 24, top: y - 24, width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: t.brand.navy, fontSize: 14, fontFamily: fontFamily('bold', rtl) }}>{(r.first_name ?? '?').slice(0, 1)}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={{ color: c.textMuted, fontSize: 14, textAlign: 'center', fontFamily: fontFamily('regular', rtl) }}>{tr('map.note')}</Text>
      {current ? (
        <View style={{ gap: 12 }}>
          <BrowseCard r={current} compact />
          <Button title={tr('explore.viewProfile')} onPress={() => onOpen(current)} />
        </View>
      ) : null}
    </View>
  );
}
