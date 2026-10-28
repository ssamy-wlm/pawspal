import React from 'react';
import { Text, View } from 'react-native';
import { Illustration } from './Illustration';
import { useTheme } from '../theme';
import type { StayResult } from '../lib/search';
import type { SvgName } from '../illustrations';

const ART: Record<StayResult['card_illustration'], SvgName> = {
  'dog-biscuit': 'dogBiscuit', 'cat-mango': 'catMango', 'cat-midnight': 'catMidnight', 'husky-storm': 'huskyStorm',
};
const BG: Record<string, string> = {
  circles_teal: '#D6EFEF', circles_orange: '#FFE5C8', circles_sand: '#F6E7CB', pattern: '#FFFFFF', navy: '#1F2D3D',
};

export const priceLabel = (r: StayResult) =>
  r.offers.includes('paid') && r.price_per_night != null ? `${r.price_per_night} EGP` : r.offers.includes('swap') ? 'Swap' : 'Free';

/** The browse card from the mockups and Instagram posts. `compact` is the list-row version for search results. */
export function BrowseCard({ r, compact }: { r: StayResult; compact?: boolean }) {
  const t = useTheme();
  const c = t.color;
  const bg = BG[r.card_background] ?? BG.circles_teal;
  const isNew = !r.stays_count;
  const art = (
    <View style={{ backgroundColor: bg, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
      ...(compact ? { width: 96, height: 96, borderRadius: 20 } : { height: 300 }) }}>
      {!compact && <View style={{ position: 'absolute', right: -60, top: -60, width: 200, height: 200, borderRadius: 100,
        backgroundColor: r.card_background === 'navy' ? '#26394C' : 'rgba(255,255,255,0.55)' }} />}
      {/* Real pet photos replace the illustration once uploaded (phase 2). */}
      <Illustration name={ART[r.card_illustration] ?? 'dogBiscuit'} width={compact ? 80 : 240} height={compact ? 68 : 204} />
    </View>
  );
  const badge = r.match_label && (
    <View style={{ alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999,
      backgroundColor: r.match_label === 'Exact match' ? c.primary : t.tint.orange }}>
      <Text style={{ fontSize: 12, fontFamily: 'Poppins_600', color: r.match_label === 'Exact match' ? c.onPrimary : '#1F2D3D' }}>{r.match_label}</Text>
    </View>
  );
  const info = (
    <View style={{ flex: 1, gap: 4, padding: compact ? 0 : 20 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flexShrink: 1 }}>
          <Text style={{ fontFamily: 'Poppins_700', fontSize: compact ? 18 : 24, color: c.text }}>{r.first_name}</Text>
          <Text style={{ color: c.textMuted, fontSize: 13 }}>
            {isNew ? 'New on PawsPal' : `${r.rating_avg ?? '–'} rating · ${r.stays_count} stays`}{r.area ? ` · ${r.area}` : ''}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ fontFamily: 'Poppins_700', fontSize: compact ? 17 : 22, color: c.primary }}>{priceLabel(r)}</Text>
          {r.offers.includes('paid') && <Text style={{ color: c.textMuted, fontSize: 12 }}>per night{r.negotiable ? ', negotiable' : ''}</Text>}
        </View>
      </View>
      <Text style={{ color: c.textMuted, fontSize: 13 }}>
        Available {r.starts_on.slice(5)} to {r.ends_on.slice(5)}{r.distance_km != null ? ` · ${r.distance_km} km` : ''}
      </Text>
      {badge}
    </View>
  );
  return compact ? (
    <View style={{ flexDirection: 'row', gap: 14, padding: 14, borderRadius: 24, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border }}>
      {art}{info}
    </View>
  ) : (
    <View style={{ flex: 1, borderRadius: 28, backgroundColor: c.surface, overflow: 'hidden' }}>{art}{info}</View>
  );
}
