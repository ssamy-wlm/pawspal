import React from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { Button } from './Button';
import { Chip } from './Chip';
import { fontFamily, useTheme } from '../theme';
import { formatDay, isRTL, t as tr } from '../i18n';
import { useReducedMotion } from '../motion';
import { fetchMapAvailability, MapAvailability } from '../lib/explore';
import { buildMapHtml, DEFAULT_ATTRIBUTION, DEFAULT_TILE_URL, pinsFromRows, tileOrigin } from '../lib/mapHtml';
import type { PetType } from '../lib/search';

const PETS: PetType[] = ['dog', 'cat', 'other'];
const petPlural = (p: PetType) => (p === 'dog' ? 'pet.dogs' : p === 'cat' ? 'pet.cats' : 'pet.others') as 'pet.dogs';
const MAP_HEIGHT = 380;

/** The map page may only be the page itself. Every other navigation (links, redirects, other sites) is refused. */
export const allowMapRequest = (url: string): boolean => url === 'about:blank' || url === 'about:srcdoc';

/** What the page may say to the app: pick a pin, say it is ready, or say it could not load. Anything else is ignored. */
export function parseMapMessage(data: string, knownIds: ReadonlySet<string>): { type: 'select'; id: string } | { type: 'ready' } | { type: 'error' } | null {
  try {
    const m = JSON.parse(data) as { type?: unknown; id?: unknown };
    if (m.type === 'ready') return { type: 'ready' };
    if (m.type === 'error') return { type: 'error' };
    if (m.type === 'select' && typeof m.id === 'string' && knownIds.has(m.id)) return { type: 'select', id: m.id };
  } catch { /* not ours */ }
  return null;
}

const priceText = (r: MapAvailability) => (r.price_per_night != null ? tr('price.egp', { amount: r.price_per_night }) : tr('price.free'));

/**
 * Map of host availability: MapLibre GL JS in a locked-down WebView, one pill per open availability with the price per
 * night. Positions are approximate (the server fuzzes them), never a home. The map is not screen-reader friendly, so the
 * same hosts are listed below it as real buttons, and the selected host's card is ordinary app UI.
 */
export function AvailabilityMap({ onOpen }: { onOpen: (userId: string) => void }) {
  const t = useTheme();
  const c = t.color;
  const rtl = isRTL();
  const reduced = useReducedMotion();
  const [petType, setPetType] = React.useState<PetType | null>(null);
  const [rows, setRows] = React.useState<MapAvailability[] | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [mapFailed, setMapFailed] = React.useState(false);
  const [ready, setReady] = React.useState(false);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [attempt, setAttempt] = React.useState(0);
  const web = React.useRef<WebView<object>>(null);

  React.useEffect(() => {
    let live = true;
    fetchMapAvailability(petType).then((r) => { if (live) setRows(r); }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [petType, attempt]);

  // Back to "loading" whenever the question changes (done where the change happens, not in the effect).
  const reset = () => { setRows(null); setFailed(false); setMapFailed(false); setReady(false); setSelected(null); };
  const retry = () => { reset(); setAttempt((n) => n + 1); };

  const tileUrl = process.env.EXPO_PUBLIC_MAP_TILE_URL || DEFAULT_TILE_URL;
  const attribution = process.env.EXPO_PUBLIC_MAP_ATTRIBUTION || DEFAULT_ATTRIBUTION;

  const shown = React.useMemo(() => {
    const pins = pinsFromRows(rows ?? [], priceText, (r, price) => [r.first_name, r.area, price].filter(Boolean).join(', '));
    const ids = new Set(pins.map((p) => p.id));
    return { pins, ids, hosts: (rows ?? []).filter((r) => ids.has(r.availability_id)) };
  }, [rows]);

  const html = React.useMemo(() => buildMapHtml({
    pins: shown.pins, tileUrl, attribution, labels: { map: tr('map.availability.label') }, reducedMotion: reduced,
    colors: { pin: t.brand.orange, pinText: t.brand.navy, selected: t.brand.navy, selectedText: t.brand.orange, ring: t.brand.navy, background: c.background },
  }), [shown.pins, tileUrl, attribution, reduced, t.brand.orange, t.brand.navy, c.background]);

  const whitelist = React.useMemo(() => ['about:blank', 'https://unpkg.com', tileOrigin(tileUrl) ?? tileOrigin(DEFAULT_TILE_URL) ?? 'https://tile.openstreetmap.org'], [tileUrl]);

  const onMessage = (e: WebViewMessageEvent) => {
    const m = parseMapMessage(e.nativeEvent.data, shown.ids);
    if (!m) return;
    if (m.type === 'select') setSelected(m.id);
    else if (m.type === 'ready') setReady(true);
    else setMapFailed(true);
  };
  const choose = (id: string) => {
    setSelected(id);
    web.current?.injectJavaScript?.(`window.__select&&window.__select(${JSON.stringify(id)});true;`);
  };

  const current = shown.hosts.find((r) => r.availability_id === selected) ?? null;
  const muted = { color: c.textMuted, fontFamily: fontFamily('regular', rtl) } as const;

  return (
    <View style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {PETS.map((p) => <Chip key={p} label={tr(petPlural(p))} selected={petType === p} onPress={() => { reset(); setPetType((cur) => (cur === p ? null : p)); }} />)}
      </View>

      {failed ? (
        <View style={{ gap: 12 }}>
          <Text accessibilityRole="alert" style={{ color: c.danger, fontFamily: fontFamily('medium', rtl) }}>{tr('map.availability.error')}</Text>
          <Button variant="secondary" title={tr('map.availability.retry')} onPress={retry} />
        </View>
      ) : rows === null ? (
        <ActivityIndicator color={c.primary} accessibilityLabel={tr('map.availability.loading')} />
      ) : shown.pins.length === 0 ? (
        <Text style={[muted, { textAlign: 'center' }]}>{tr('map.availability.empty')}</Text>
      ) : (
        <>
          <View accessible accessibilityLabel={tr('map.availability.label')} style={{ height: MAP_HEIGHT, borderRadius: 24, overflow: 'hidden', backgroundColor: c.surface }}>
            {mapFailed ? (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20, gap: 12 }}>
                <Text accessibilityRole="alert" style={[muted, { textAlign: 'center' }]}>{tr('map.availability.error')}</Text>
                <Button variant="secondary" title={tr('map.availability.retry')} onPress={retry} />
              </View>
            ) : (
              <WebView<object>
                ref={web}
                testID="availability-map"
                source={{ html, baseUrl: 'about:blank' }}
                originWhitelist={whitelist}
                onShouldStartLoadWithRequest={(req) => allowMapRequest(req.url)}
                onMessage={onMessage}
                onError={() => setMapFailed(true)}
                onHttpError={() => setMapFailed(true)}
                javaScriptEnabled
                domStorageEnabled={false}
                allowFileAccess={false}
                allowFileAccessFromFileURLs={false}
                allowUniversalAccessFromFileURLs={false}
                allowsLinkPreview={false}
                geolocationEnabled={false}
                setSupportMultipleWindows={false}
                javaScriptCanOpenWindowsAutomatically={false}
                mixedContentMode="never"
                thirdPartyCookiesEnabled={false}
                sharedCookiesEnabled={false}
                overScrollMode="never"
                style={{ flex: 1, backgroundColor: c.surface }}
              />
            )}
            {!ready && !mapFailed ? <View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={c.primary} /></View> : null}
          </View>

          {current ? (
            <View accessibilityLiveRegion="polite" style={{ gap: 12, padding: 16, borderRadius: 24, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
                <View style={{ flexShrink: 1 }}>
                  <Text style={{ color: c.text, fontSize: 20, fontFamily: fontFamily('bold', rtl) }}>{current.first_name}</Text>
                  {current.area ? <Text style={[muted, { fontSize: 14 }]}>{current.area}</Text> : null}
                </View>
                <Text style={{ color: c.primary, fontSize: 18, fontFamily: fontFamily('bold', rtl) }}>{priceText(current)}</Text>
              </View>
              <Text style={[muted, { fontSize: 14 }]}>{tr('card.available', { from: formatDay(current.starts_on), to: formatDay(current.ends_on) })}</Text>
              <Button title={tr('explore.viewProfile')} onPress={() => onOpen(current.user_id)} />
            </View>
          ) : null}

          <Text style={[muted, { fontSize: 14 }]}>{tr('map.availability.note')}</Text>
          <View style={{ gap: 8 }}>
            {shown.hosts.map((r) => {
              const on = r.availability_id === selected;
              return (
                <Pressable key={r.availability_id} accessibilityRole="button" accessibilityState={{ selected: on }}
                  accessibilityLabel={[r.first_name, r.area, priceText(r), tr('card.available', { from: formatDay(r.starts_on), to: formatDay(r.ends_on) })].filter(Boolean).join('. ')}
                  onPress={() => choose(r.availability_id)}
                  style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 16, borderWidth: 2, borderColor: on ? c.primary : c.border, backgroundColor: c.surface }}>
                  <Text numberOfLines={1} style={{ flexShrink: 1, color: c.text, fontSize: 15, fontFamily: fontFamily('semibold', rtl) }}>{r.first_name}{r.area ? ` · ${r.area}` : ''}</Text>
                  <Text style={{ color: c.primary, fontSize: 15, fontFamily: fontFamily('bold', rtl) }}>{priceText(r)}</Text>
                </Pressable>
              );
            })}
          </View>
        </>
      )}
    </View>
  );
}
