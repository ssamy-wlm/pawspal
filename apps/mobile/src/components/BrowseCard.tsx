import React from 'react';
import { Text, View } from 'react-native';
import { Illustration } from './Illustration';
import { fontFamily, lightTheme, navyTheme, Theme, useTheme } from '../theme';
import { formatDay, isRTL, t as tr, tn } from '../i18n';
import type { StayResult } from '../lib/search';
import type { SvgName } from '../illustrations';

const ART: Record<StayResult['card_illustration'], SvgName> = {
  'dog-biscuit': 'dogBiscuit', 'cat-mango': 'catMango', 'cat-midnight': 'catMidnight', 'husky-storm': 'huskyStorm',
};

/** The sitter's chosen card background. It looks the same in every app theme, like the printed card in the posts. */
function cardBackground(kind: string, t: Theme) {
  switch (kind) {
    case 'circles_orange': return { fill: t.tint.orange, circle: lightTheme.color.surface, circleOpacity: 0.55 };
    case 'circles_sand': return { fill: t.brand.sand, circle: lightTheme.color.surface, circleOpacity: 0.55 };
    case 'pattern': return { fill: lightTheme.color.surface, circle: t.tint.orange, circleOpacity: 0.5 };
    case 'navy': return { fill: t.brand.navy, circle: navyTheme.color.surface!, circleOpacity: 1 };
    default: return { fill: t.tint.teal, circle: lightTheme.color.surface, circleOpacity: 0.55 };
  }
}

export const priceLabel = (r: StayResult) =>
  r.offers.includes('paid') && r.price_per_night != null
    ? tr('price.egp', { amount: r.price_per_night })
    : r.offers.includes('swap') ? tr('price.swap') : tr('price.free');

/** The browse card from the mockups and Instagram posts. `compact` is the list-row version for search results. */
export function BrowseCard({ r, compact }: { r: StayResult; compact?: boolean }) {
  const t = useTheme();
  const c = t.color;
  const rtl = isRTL();
  const bg = cardBackground(r.card_background, t);
  const isNew = !r.stays_count;
  const exact = r.match_label === 'Exact match';
  const art = (
    <View style={{ backgroundColor: bg.fill, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
      ...(compact ? { width: 96, height: 96, borderRadius: 20 } : { height: 300 }) }}>
      {!compact && <View style={{ position: 'absolute', end: -60, top: -60, width: 200, height: 200, borderRadius: 100,
        backgroundColor: bg.circle, opacity: bg.circleOpacity }} />}
      {/* Real pet photos replace the illustration once uploaded (phase 2). */}
      <Illustration name={ART[r.card_illustration] ?? 'dogBiscuit'} width={compact ? 80 : 240} height={compact ? 68 : 204} />
    </View>
  );
  const badge = r.match_label && (
    <View style={{ alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999,
      backgroundColor: exact ? c.primary : t.tint.orange }}>
      <Text style={{ fontSize: 12, fontFamily: fontFamily('semibold', rtl), color: exact ? c.onPrimary : t.brand.navy }}>
        {exact ? tr('match.exact') : tr('match.close')}
      </Text>
    </View>
  );
  const info = (
    <View style={{ flex: 1, gap: 4, padding: compact ? 0 : 20 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flexShrink: 1 }}>
          <Text style={{ fontFamily: fontFamily('bold', rtl), fontSize: compact ? 18 : 24, color: c.text }}>{r.first_name}</Text>
          <Text style={{ color: c.textMuted, fontSize: 13, fontFamily: fontFamily('regular', rtl) }}>
            {isNew ? tr('card.new') : tr('card.rating', { rating: r.rating_avg ?? '–', stays: tn('count.stay', r.stays_count) })}{r.area ? ` · ${r.area}` : ''}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ fontFamily: fontFamily('bold', rtl), fontSize: compact ? 17 : 22, color: c.primary }}>{priceLabel(r)}</Text>
          {r.offers.includes('paid') && (
            <Text style={{ color: c.textMuted, fontSize: 12, fontFamily: fontFamily('regular', rtl) }}>
              {r.negotiable ? tr('card.perNightNegotiable') : tr('card.perNight')}
            </Text>
          )}
        </View>
      </View>
      <Text style={{ color: c.textMuted, fontSize: 13, fontFamily: fontFamily('regular', rtl) }}>
        {tr('card.available', { from: formatDay(r.starts_on), to: formatDay(r.ends_on) })}
        {r.distance_km != null ? ` · ${tr('card.km', { km: r.distance_km })}` : ''}
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
