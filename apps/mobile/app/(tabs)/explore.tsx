import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { fontFamily, useTheme } from '../../src/theme';
import { formatDay, isRTL, Key, t as tr } from '../../src/i18n';
import { Chip } from '../../src/components/Chip';
import { Button } from '../../src/components/Button';
import { CalendarRange } from '../../src/components/CalendarRange';
import { BrowseCard } from '../../src/components/BrowseCard';
import { SwipeDeck, SwipeDirection } from '../../src/components/SwipeDeck';
import { HeartBurst, HeartBurstHandle } from '../../src/components/HeartBurst';
import { browseRandom, nights, Offer, PetType, searchStays, SearchFilters, StayResult } from '../../src/lib/search';

type Mode = 'search' | 'swipe' | 'both';
const MODES: { mode: Mode; label: Key }[] = [
  { mode: 'search', label: 'explore.mode.search' },
  { mode: 'swipe', label: 'explore.mode.swipe' },
  { mode: 'both', label: 'explore.mode.both' },
];
const BUDGETS: { label: Key; min: number; max: number | null; free?: boolean }[] = [
  { label: 'explore.budget.any', min: 0, max: null },
  { label: 'explore.budget.free', min: 0, max: 0, free: true },
  { label: 'explore.budget.upTo200', min: 0, max: 200 },
  { label: 'explore.budget.200to400', min: 200, max: 400 },
  { label: 'explore.budget.400plus', min: 400, max: null },
];
const OFFERS: { key: Offer; label: Key }[] = [
  { key: 'food_provided', label: 'offer.food_provided' },
  { key: 'stay_at_my_place', label: 'offer.stay_at_my_place' },
  { key: 'swap', label: 'offer.swap' },
  { key: 'volunteer', label: 'offer.volunteer' },
];
const PETS: PetType[] = ['dog', 'cat', 'other'];
const petLabel = (p: PetType): Key => (p === 'dog' ? 'pet.dog' : p === 'cat' ? 'pet.cat' : 'pet.other');
const petPlural = (p: PetType): Key => (p === 'dog' ? 'pet.dogs' : p === 'cat' ? 'pet.cats' : 'pet.others');

/**
 * Explore: three ways to find a host.
 *  - Search: pick dates, budget and filters, then choose from the matches (like booking on Airbnb).
 *  - Swipe: browse hosts at random, card by card.
 *  - Both: search first, then swipe through only the matches.
 * Hosts include dedicated sitters AND pet owners who offer to host.
 */
export default function Explore() {
  const t = useTheme();
  const c = t.color;
  const rtl = isRTL();
  const [mode, setMode] = useState<Mode>('search');
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);
  const [petType, setPetType] = useState<PetType>('dog');
  const [budget, setBudget] = useState(0);
  const [customMin, setCustomMin] = useState('');
  const [customMax, setCustomMax] = useState('');
  const [offers, setOffers] = useState<Offer[]>([]);
  const [maxKm, setMaxKm] = useState(10);
  const [results, setResults] = useState<StayResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const burst = useRef<HeartBurstHandle>(null);
  const swipe = useRef<((d: SwipeDirection) => void) | null>(null);

  const filters = useMemo<SearchFilters | null>(() => {
    if (!start || !end) return null;
    const b = BUDGETS[budget];
    const min = customMin ? Number(customMin) : b.min;
    const max = customMax ? Number(customMax) : b.max;
    return { start, end, petType, budgetMin: min, budgetMax: max, offers, freeOnly: !!b.free, maxKm };
  }, [start, end, petType, budget, customMin, customMax, offers, maxKm]);

  const run = useCallback(async (m: Mode, pt: PetType = petType) => {
    setLoading(true); setError(null);
    try {
      setResults(m === 'swipe' ? await browseRandom(pt) : filters ? await searchStays(filters) : []);
    } catch {
      setError(tr('explore.error.load'));
    } finally { setLoading(false); }
  }, [filters, petType]);

  const exact = results?.filter((r) => r.match_label !== 'Close match') ?? [];
  const close = results?.filter((r) => r.match_label === 'Close match') ?? [];

  const onSwipe = (_r: StayResult, dir: SwipeDirection) => {
    if (dir === 'like') { burst.current?.burst(); /* TODO(phase 5): save to shortlist / open request flow */ }
  };

  const heading = { color: c.text, fontFamily: fontFamily('bold', rtl) } as const;
  const muted = { color: c.textMuted, fontFamily: fontFamily('regular', rtl) } as const;

  const segment = () => (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', backgroundColor: c.surface, borderRadius: 999, padding: 4, borderWidth: 1, borderColor: c.border }}>
      {MODES.map(({ mode: m, label }) => (
        <Pressable key={m} accessibilityRole="tab" accessibilityState={{ selected: mode === m }}
          onPress={() => { setMode(m); setResults(null); if (m === 'swipe') run('swipe'); }}
          style={{ flex: 1, minHeight: 44, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: mode === m ? c.primary : 'transparent' }}>
          <Text style={{ color: mode === m ? c.onPrimary : c.text, fontFamily: fontFamily('semibold', rtl), fontSize: 14 }}>{tr(label)}</Text>
        </Pressable>
      ))}
    </View>
  );

  const deck = (items: StayResult[]) => (
    <View style={{ gap: 16 }}>
      {items.length === 0 ? <Text style={[muted, { textAlign: 'center' }]}>{tr('explore.empty.swipe')}</Text> : (
        <SwipeDeck items={items} keyOf={(r) => r.availability_id} cardHeight={480}
          bindControls={(fn) => { swipe.current = fn; }} onSwipe={onSwipe} renderCard={(r) => <BrowseCard r={r} />} />
      )}
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 32 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={tr('swipe.pass')} onPress={() => swipe.current?.('pass')}
          style={{ width: 68, height: 68, borderRadius: 34, borderWidth: 4, borderColor: t.brand.coral, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 26, color: t.brand.coral }}>✕</Text>
        </Pressable>
        <View>
          <Pressable accessibilityRole="button" accessibilityLabel={tr('swipe.like')} onPress={() => swipe.current?.('like')}
            style={{ width: 84, height: 84, borderRadius: 42, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 32, color: c.onPrimary }}>♥</Text>
          </Pressable>
          <HeartBurst ref={burst} />
        </View>
      </View>
    </View>
  );

  // ---------- Swipe-only mode
  if (mode === 'swipe') {
    return (
      <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={{ padding: 20, gap: 18 }}>
        {segment()}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {PETS.map((p) => (
            <Chip key={p} label={tr(petPlural(p))} selected={petType === p} onPress={() => { setPetType(p); run('swipe', p); }} />
          ))}
        </View>
        {loading ? <ActivityIndicator color={c.primary} /> : deck(results ?? [])}
        {error && <Text style={{ color: c.danger, fontFamily: fontFamily('regular', rtl) }}>{error}</Text>}
      </ScrollView>
    );
  }

  // ---------- Results (search list, or search + swipe)
  if (results) {
    const n = start && end ? nights(start, end) : 0;
    return (
      <View style={{ flex: 1, backgroundColor: c.background }}>
        <Pressable onPress={() => setResults(null)} accessibilityRole="button" accessibilityLabel={tr('explore.editFilters')}
          style={{ margin: 20, padding: 16, borderRadius: 24, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border }}>
          <Text style={{ color: c.text, fontFamily: fontFamily('semibold', rtl) }}>
            {tr('explore.summary', { start: start ? formatDay(start) : '', end: end ? formatDay(end) : '', nights: n, pet: tr(petPlural(petType)) })}
          </Text>
          <Text style={{ color: c.link, fontFamily: fontFamily('regular', rtl) }}>{tr('explore.editFilters')}</Text>
        </Pressable>
        {mode === 'both' ? (
          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}>{deck(results)}</ScrollView>
        ) : (
          <FlatList
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40, gap: 12 }}
            data={[...exact, ...close]}
            keyExtractor={(r) => r.availability_id}
            ListHeaderComponent={<Text style={[heading, { fontSize: 18, marginBottom: 4 }]}>
              {tr('explore.results.exact', { count: exact.length })}{close.length ? ` · ${tr('explore.results.close', { count: close.length })}` : ''}
            </Text>}
            ListEmptyComponent={<Text style={muted}>{tr('explore.results.empty')}</Text>}
            renderItem={({ item, index }) => (
              <View>
                {index === exact.length && close.length > 0 && <Text style={[muted, { marginVertical: 8 }]}>{tr('explore.results.closeNote')}</Text>}
                {/* TODO(phase 4): tap opens the host profile screen (mockup 03). */}
                <BrowseCard r={item} compact />
              </View>
            )}
          />
        )}
      </View>
    );
  }

  // ---------- Filters
  const input = { flex: 1, minHeight: 48, borderRadius: 16, borderWidth: 2, borderColor: c.border, paddingHorizontal: 14, color: c.text, backgroundColor: c.surface, fontFamily: fontFamily('regular', rtl), textAlign: rtl ? 'right' : 'left' } as const;
  return (
    <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={{ padding: 20, gap: 22, paddingBottom: 48 }}>
      {segment()}
      <Text style={{ fontFamily: fontFamily('extrabold', rtl), fontSize: 28, color: c.text }}>{tr('explore.whenAway')}</Text>
      <View style={{ padding: 16, borderRadius: 24, backgroundColor: c.surface }}>
        <CalendarRange start={start} end={end} onChange={(s, e) => { setStart(s); setEnd(e); }} />
      </View>

      <Section color={c.text} title={tr('explore.yourPet')}>
        {PETS.map((p) => <Chip key={p} label={tr(petLabel(p))} selected={petType === p} onPress={() => setPetType(p)} />)}
      </Section>

      <Section color={c.text} title={tr('explore.budget.title')}>
        {BUDGETS.map((b, i) => <Chip key={b.label} label={tr(b.label)} selected={budget === i && !customMin && !customMax}
          onPress={() => { setBudget(i); setCustomMin(''); setCustomMax(''); }} />)}
        <View style={{ flexDirection: 'row', gap: 10, width: '100%' }}>
          <TextInput accessibilityLabel={tr('explore.budget.minLabel')} placeholder={tr('explore.budget.min')} placeholderTextColor={c.textMuted}
            keyboardType="number-pad" value={customMin} onChangeText={(v) => setCustomMin(v.replace(/[^0-9]/g, '').slice(0, 6))} style={input} />
          <TextInput accessibilityLabel={tr('explore.budget.maxLabel')} placeholder={tr('explore.budget.max')} placeholderTextColor={c.textMuted}
            keyboardType="number-pad" value={customMax} onChangeText={(v) => setCustomMax(v.replace(/[^0-9]/g, '').slice(0, 6))} style={input} />
        </View>
      </Section>

      <Section color={c.text} title={tr('explore.nice.title')}>
        {OFFERS.map((o) => <Chip key={o.key} label={tr(o.label)} selected={offers.includes(o.key)}
          onPress={() => setOffers((cur) => cur.includes(o.key) ? cur.filter((x) => x !== o.key) : [...cur, o.key])} />)}
      </Section>

      <Section color={c.text} title={tr('explore.distance.title')}>
        {[3, 10, 25].map((k) => <Chip key={k} label={tr('explore.distance.within', { km: k })} selected={maxKm === k} onPress={() => setMaxKm(k)} />)}
      </Section>

      <Button title={!filters ? tr('explore.cta.chooseDates') : mode === 'both' ? tr('explore.cta.swipeMatches') : tr('explore.cta.showMatches')}
        disabled={!filters || loading} onPress={() => run(mode)} />
      {error && <Text style={{ color: c.danger, fontFamily: fontFamily('regular', rtl) }}>{error}</Text>}
    </ScrollView>
  );
}

function Section({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 10 }}>
      <Text accessibilityRole="header" style={{ fontFamily: fontFamily('bold', isRTL()), fontSize: 17, color }}>{title}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{children}</View>
    </View>
  );
}
