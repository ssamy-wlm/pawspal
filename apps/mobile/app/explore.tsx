import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useTheme } from '../src/theme';
import { Chip } from '../src/components/Chip';
import { Button } from '../src/components/Button';
import { CalendarRange } from '../src/components/CalendarRange';
import { BrowseCard } from '../src/components/BrowseCard';
import { SwipeDeck, SwipeDirection } from '../src/components/SwipeDeck';
import { HeartBurst, HeartBurstHandle } from '../src/components/HeartBurst';
import { browseRandom, nights, Offer, PetType, searchStays, SearchFilters, StayResult } from '../src/lib/search';

type Mode = 'search' | 'swipe' | 'both';
const BUDGETS: { label: string; min: number; max: number | null; free?: boolean }[] = [
  { label: 'Any', min: 0, max: null },
  { label: 'Free or swap', min: 0, max: 0, free: true },
  { label: 'Up to 200', min: 0, max: 200 },
  { label: '200 to 400', min: 200, max: 400 },
  { label: '400+', min: 400, max: null },
];
const OFFERS: { key: Offer; label: string }[] = [
  { key: 'food_provided', label: 'Food provided' },
  { key: 'stay_at_my_place', label: 'Can stay at my place' },
  { key: 'swap', label: 'Swap welcome' },
  { key: 'volunteer', label: 'Volunteer' },
];

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
    } catch (e: any) {
      setError('Could not load hosts. Check your connection and try again.');
    } finally { setLoading(false); }
  }, [filters, petType]);

  const exact = results?.filter((r) => r.match_label !== 'Close match') ?? [];
  const close = results?.filter((r) => r.match_label === 'Close match') ?? [];

  const onSwipe = (r: StayResult, dir: SwipeDirection) => {
    if (dir === 'like') { burst.current?.burst(); /* TODO(phase 5): save to shortlist / open request flow */ }
  };

  const segment = () => (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', backgroundColor: c.surface, borderRadius: 999, padding: 4, borderWidth: 1, borderColor: c.border }}>
      {([['search', 'Search'], ['swipe', 'Swipe'], ['both', 'Search + swipe']] as [Mode, string][]).map(([m, label]) => (
        <Pressable key={m} accessibilityRole="tab" accessibilityState={{ selected: mode === m }}
          onPress={() => { setMode(m); setResults(null); if (m === 'swipe') run('swipe'); }}
          style={{ flex: 1, minHeight: 44, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: mode === m ? c.primary : 'transparent' }}>
          <Text style={{ color: mode === m ? c.onPrimary : c.text, fontFamily: 'Poppins_600', fontSize: 14 }}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );

  const deck = (items: StayResult[]) => (
    <View style={{ gap: 16 }}>
      {items.length === 0 ? <Text style={{ color: c.textMuted, textAlign: 'center' }}>No more hosts here. Try other dates or a wider budget.</Text> : (
        <SwipeDeck items={items} keyOf={(r) => r.availability_id} cardHeight={480}
          bindControls={(fn) => { swipe.current = fn; }} onSwipe={onSwipe} renderCard={(r) => <BrowseCard r={r} />} />
      )}
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 32 }}>
        <Pressable accessibilityLabel="Pass" onPress={() => swipe.current?.('pass')}
          style={{ width: 68, height: 68, borderRadius: 34, borderWidth: 4, borderColor: t.brand.coral, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 26, color: t.brand.coral }}>✕</Text>
        </Pressable>
        <View>
          <Pressable accessibilityLabel="Like" onPress={() => swipe.current?.('like')}
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
          {(['dog', 'cat', 'other'] as PetType[]).map((p) => (
            <Chip key={p} label={p === 'dog' ? 'Dogs' : p === 'cat' ? 'Cats' : 'Other'} selected={petType === p}
              onPress={() => { setPetType(p); run('swipe', p); }} />
          ))}
        </View>
        {loading ? <ActivityIndicator color={c.primary} /> : deck(results ?? [])}
        {error && <Text style={{ color: c.danger }}>{error}</Text>}
      </ScrollView>
    );
  }

  // ---------- Results (search list, or search + swipe)
  if (results) {
    const n = start && end ? nights(start, end) : 0;
    return (
      <View style={{ flex: 1, backgroundColor: c.background }}>
        <Pressable onPress={() => setResults(null)} accessibilityRole="button" accessibilityLabel="Edit filters"
          style={{ margin: 20, padding: 16, borderRadius: 24, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border }}>
          <Text style={{ color: c.text, fontFamily: 'Poppins_600' }}>{start} to {end} · {n} nights · {petType}s</Text>
          <Text style={{ color: c.link }}>Edit filters</Text>
        </Pressable>
        {mode === 'both' ? (
          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}>{deck(results)}</ScrollView>
        ) : (
          <FlatList
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40, gap: 12 }}
            data={[...exact, ...close]}
            keyExtractor={(r) => r.availability_id}
            ListHeaderComponent={<Text style={{ color: c.text, fontFamily: 'Poppins_700', fontSize: 18, marginBottom: 4 }}>
              {exact.length} exact {exact.length === 1 ? 'match' : 'matches'}{close.length ? `, ${close.length} close` : ''}
            </Text>}
            ListEmptyComponent={<Text style={{ color: c.textMuted }}>No hosts match yet. Try other dates or a wider budget, or post your dates so hosts can find you.</Text>}
            renderItem={({ item, index }) => (
              <View>
                {index === exact.length && close.length > 0 && (
                  <Text style={{ color: c.textMuted, marginVertical: 8 }}>Close matches: dates partly fit, or the price is a little over budget but negotiable.</Text>
                )}
                <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/showcase', params: { host: item.user_id } })}>
                  {/* TODO(phase 4): open the host profile screen (mockup 03) instead of the showcase. */}
                  <BrowseCard r={item} compact />
                </Pressable>
              </View>
            )}
          />
        )}
      </View>
    );
  }

  // ---------- Filters
  return (
    <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={{ padding: 20, gap: 22, paddingBottom: 48 }}>
      {segment()}
      <Text style={{ fontFamily: 'Poppins_800', fontSize: 28, color: c.text }}>When are you away?</Text>
      <View style={{ padding: 16, borderRadius: 24, backgroundColor: c.surface }}>
        <CalendarRange start={start} end={end} onChange={(s, e) => { setStart(s); setEnd(e); }} />
      </View>

      <Section color={c.text} title="Your pet">
        {(['dog', 'cat', 'other'] as PetType[]).map((p) => (
          <Chip key={p} label={p === 'dog' ? 'Dog' : p === 'cat' ? 'Cat' : 'Other'} selected={petType === p} onPress={() => setPetType(p)} />
        ))}
      </Section>

      <Section color={c.text} title="Budget per night (EGP)">
        {BUDGETS.map((b, i) => <Chip key={b.label} label={b.label} selected={budget === i && !customMin && !customMax}
          onPress={() => { setBudget(i); setCustomMin(''); setCustomMax(''); }} />)}
        <View style={{ flexDirection: 'row', gap: 10, width: '100%' }}>
          {[['Min', customMin, setCustomMin], ['Max', customMax, setCustomMax]].map(([label, val, set]: any) => (
            <TextInput key={label} accessibilityLabel={`${label} price per night`} placeholder={label} placeholderTextColor={c.textMuted}
              keyboardType="number-pad" value={val} onChangeText={(v) => set(v.replace(/[^0-9]/g, '').slice(0, 6))}
              style={{ flex: 1, minHeight: 48, borderRadius: 16, borderWidth: 2, borderColor: c.border, paddingHorizontal: 14, color: c.text, backgroundColor: c.surface }} />
          ))}
        </View>
      </Section>

      <Section color={c.text} title="Nice to have">
        {OFFERS.map((o) => <Chip key={o.key} label={o.label} selected={offers.includes(o.key)}
          onPress={() => setOffers((cur) => cur.includes(o.key) ? cur.filter((x) => x !== o.key) : [...cur, o.key])} />)}
      </Section>

      <Section color={c.text} title="Distance">
        {[3, 10, 25].map((k) => <Chip key={k} label={`Within ${k} km`} selected={maxKm === k} onPress={() => setMaxKm(k)} />)}
      </Section>

      <Button title={!filters ? 'Choose your dates' : mode === 'both' ? 'Swipe through matches' : 'Show matches'}
        disabled={!filters || loading} onPress={() => run(mode)} />
      {error && <Text style={{ color: c.danger }}>{error}</Text>}
    </ScrollView>
  );

}

function Section({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ fontFamily: 'Poppins_700', fontSize: 17, color }}>{title}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{children}</View>
    </View>
  );
}
