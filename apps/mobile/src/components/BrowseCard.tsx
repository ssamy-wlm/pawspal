import React from 'react';
import { Text, View } from 'react-native';
import { fontFamily, useTheme } from '../theme';
import { CardArt } from './CardArt';
import { formatDay, isRTL, Key, t as tr, tn } from '../i18n';
import { HOME_TAGS } from '../lib/profile';
import type { StayResult } from '../lib/search';

const PET_LABEL: Record<string, Key> = { dog: 'pet.dogs', cat: 'pet.cats', other: 'pet.others' };
const OFFER_CHIP: Record<string, Key> = { food_provided: 'offer.food_provided', stay_at_my_place: 'offer.stay_at_my_place', swap: 'offer.swap', volunteer: 'offer.volunteer' };

/** The chips under a browse card: who lives there, which pets are welcome, what is offered, and what the home has. */
export function cardChips(r: StayResult): { label: string; strong?: boolean }[] {
  return [
    { label: r.pet_name ? tr('card.livesHere', { pet: r.pet_name }) : tr('card.petFriendly'), strong: true },
    ...r.pets_accepted.filter((p) => PET_LABEL[p]).map((p) => ({ label: tr(PET_LABEL[p]) })),
    ...r.offers.filter((o) => OFFER_CHIP[o]).map((o) => ({ label: tr(OFFER_CHIP[o]) })),
    ...(r.home_tags ?? []).filter((k) => (HOME_TAGS as readonly string[]).includes(k)).slice(0, 3).map((k) => ({ label: tr(`tag.${k}` as Key) })),
  ].slice(0, 7);
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
  const isNew = !r.stays_count;
  const exact = r.match_label === 'Exact match';
  const art = <CardArt illustration={r.card_illustration} background={r.card_background} height={300} compact={compact} label={tr(`art.${r.card_illustration}`)} />;
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
          <Text numberOfLines={compact ? 1 : undefined} maxFontSizeMultiplier={compact ? 1.3 : undefined} style={{ fontFamily: fontFamily('bold', rtl), fontSize: compact ? 18 : 24, color: c.text }}>{r.first_name}</Text>
          <Text numberOfLines={compact ? 1 : undefined} maxFontSizeMultiplier={compact ? 1.3 : undefined} style={{ color: c.textMuted, fontSize: 13, fontFamily: fontFamily('regular', rtl) }}>
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
      <Text numberOfLines={compact ? 1 : undefined} maxFontSizeMultiplier={compact ? 1.3 : undefined} style={{ color: c.textMuted, fontSize: 13, fontFamily: fontFamily('regular', rtl) }}>
        {tr('card.available', { from: formatDay(r.starts_on), to: formatDay(r.ends_on) })}
        {r.distance_km != null ? ` · ${tr('card.km', { km: r.distance_km })}` : ''}
      </Text>
      {badge}
      {compact ? null : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
          {cardChips(r).map((chip) => (
            <View key={chip.label} style={{ minHeight: 32, paddingHorizontal: 12, borderRadius: 999, justifyContent: 'center',
              backgroundColor: chip.strong ? t.tint.teal : 'transparent', borderWidth: chip.strong ? 0 : 1, borderColor: t.brand.sand }}>
              <Text style={{ color: chip.strong ? t.brand.navy : c.text, fontSize: 13, fontFamily: fontFamily(chip.strong ? 'semibold' : 'regular', rtl) }}>{chip.label}</Text>
            </View>
          ))}
        </View>
      )}
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
