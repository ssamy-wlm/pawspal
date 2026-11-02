// The web page that draws the host-availability map inside a WebView (MapLibre GL JS + raster tiles).
// A pure function: the app passes in what to draw and gets one HTML string back. Nothing but the approximate position,
// the first name, the area and the price label ever goes into the page (no photos, no user ids, no exact places).

/** MapLibre is pinned to one exact version and checked by hash (SRI). Change both together (recompute both hashes from the npm package). */
export const MAPLIBRE_VERSION = '4.7.1';
export const MAPLIBRE_JS_URL = `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.js`;
export const MAPLIBRE_CSS_URL = `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.css`;
export const MAPLIBRE_JS_SRI = 'sha384-SYKAG6cglRMN0RVvhNeBY0r3FYKNOJtznwA0v7B5Vp9tr31xAHsZC0DqkQ/pZDmj';
export const MAPLIBRE_CSS_SRI = 'sha384-MinO0mNliZ3vwppuPOUnGa+iq619pfMhLVUXfC4LHwSCvF9H+6P/KO4Q7qBOYV5V';

export const DEFAULT_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const DEFAULT_ATTRIBUTION = '© OpenStreetMap contributors';
export const DEFAULT_CENTER = { lat: 28.5, lng: 34.5 };            // Dahab and the Sinai coast

/** One pin: an approximate position, a first name, an area and the price label. Nothing else. */
export interface MapPin { id: string; lat: number; lng: number; price: string; name: string; area: string | null; aria: string }
/** Colours as CSS values, read from the theme by the caller. */
export interface MapColors { pin: string; pinText: string; selected: string; selectedText: string; ring: string; background: string }
export interface MapLabels { map: string }

/** A row of `map_availability`, as far as the pins need it. */
export interface MapRow { availability_id: string; first_name: string | null; area: string | null; approx_lat: number | null; approx_lng: number | null; price_per_night: number | null }

const validCoord = (lat: unknown, lng: unknown): lat is number =>
  typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

/** Only rows with a usable approximate position become pins; only the allowed fields are copied. */
export function pinsFromRows<R extends MapRow>(rows: R[], priceOf: (r: R) => string, ariaOf: (r: R, price: string) => string): MapPin[] {
  const pins: MapPin[] = [];
  for (const r of rows) {
    if (!validCoord(r.approx_lat, r.approx_lng) || typeof r.availability_id !== 'string') continue;
    const price = priceOf(r);
    pins.push({ id: r.availability_id, lat: r.approx_lat as number, lng: r.approx_lng as number, price, name: r.first_name ?? '', area: r.area, aria: ariaOf(r, price) });
  }
  return pins;
}

/** The map page may only be the page itself. Every other navigation (links, redirects, other sites) is refused. */
export const allowMapRequest = (url: string): boolean => url === 'about:blank' || url === 'about:srcdoc';

/** JSON that is safe inside a <script> element: no "</script>", no HTML comment openers, no line separators. */
export function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** The origin (scheme and host) of a tile URL template, or null when it is not an https URL. */
export function tileOrigin(tileUrl: string): string | null {
  const m = /^https:\/\/([^/?#\s{}]+|\{[a-z]\}\.[^/?#\s{}]+)(?=\/|$)/i.exec(tileUrl);
  if (!m) return null;
  return m[1].startsWith('{') ? `https://*.${m[1].replace(/^\{[a-z]\}\./i, '')}` : `https://${m[1]}`;
}

export interface MapHtmlInput {
  pins: MapPin[];
  tileUrl?: string;
  attribution?: string;
  center?: { lat: number; lng: number };
  labels: MapLabels;
  colors: MapColors;
  selectedId?: string | null;
  /** Reduce Motion is on: jump instead of flying. */
  reducedMotion?: boolean;
}

export function buildMapHtml(input: MapHtmlInput): string {
  const origin = input.tileUrl ? tileOrigin(input.tileUrl) : null;
  const tileUrl = origin && input.tileUrl ? input.tileUrl : DEFAULT_TILE_URL;
  const tileHost = tileOrigin(tileUrl) as string;
  const attribution = escapeHtml(input.attribution || DEFAULT_ATTRIBUTION);
  const c = input.center && validCoord(input.center.lat, input.center.lng) ? input.center : DEFAULT_CENTER;
  const pins = input.pins
    .filter((p) => validCoord(p.lat, p.lng))
    .map((p) => ({ id: p.id, lat: p.lat, lng: p.lng, price: p.price, name: p.name, area: p.area, aria: p.aria }));
  const data = safeJson({ pins, tileUrl, attribution, center: c, labels: { map: input.labels.map }, colors: input.colors, selected: input.selectedId ?? null, reduced: !!input.reducedMotion });
  const csp = [
    "default-src 'none'",
    "script-src https://unpkg.com 'unsafe-inline'",
    "style-src https://unpkg.com 'unsafe-inline'",
    `img-src ${tileHost} data: blob:`,
    `connect-src ${tileHost} blob: data:`,
    "worker-src blob:",
    "child-src blob:",
    "font-src data:",
  ].join('; ');

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<link rel="stylesheet" href="${MAPLIBRE_CSS_URL}" integrity="${MAPLIBRE_CSS_SRI}" crossorigin="anonymous">
<style>
html,body,#map{margin:0;padding:0;height:100%;width:100%}
body{background:var(--bg);font-family:-apple-system,system-ui,sans-serif}
.maplibregl-ctrl-attrib{font-size:12px!important}
.maplibregl-ctrl-attrib a{text-decoration:underline}
.pin{appearance:none;-webkit-appearance:none;border:2px solid var(--ring);border-radius:999px;background:var(--pin);color:var(--pin-text);
  font:700 14px/1 -apple-system,system-ui,sans-serif;min-height:32px;padding:0 12px;cursor:pointer;white-space:nowrap}
.pin.on{background:var(--sel);color:var(--sel-text);border-color:var(--ring);transform:scale(1.12)}
</style>
</head><body>
<div id="map" role="region"></div>
<script src="${MAPLIBRE_JS_URL}" integrity="${MAPLIBRE_JS_SRI}" crossorigin="anonymous"></script>
<script>
(function () {
  var D = ${data};
  function post(m) { try { window.ReactNativeWebView.postMessage(JSON.stringify(m)); } catch (e) {} }
  if (typeof maplibregl === 'undefined') { post({ type: 'error' }); return; }
  var root = document.documentElement.style;
  root.setProperty('--pin', D.colors.pin); root.setProperty('--pin-text', D.colors.pinText);
  root.setProperty('--sel', D.colors.selected); root.setProperty('--sel-text', D.colors.selectedText);
  root.setProperty('--ring', D.colors.ring); root.setProperty('--bg', D.colors.background);
  var el = document.getElementById('map');
  el.setAttribute('aria-label', D.labels.map);
  var map = new maplibregl.Map({
    container: el, attributionControl: false, dragRotate: false, pitchWithRotate: false, touchPitch: false,
    style: { version: 8, sources: { tiles: { type: 'raster', tiles: [D.tileUrl], tileSize: 256, attribution: D.attribution } }, layers: [{ id: 'tiles', type: 'raster', source: 'tiles' }] },
    center: [D.center.lng, D.center.lat], zoom: 11
  });
  map.addControl(new maplibregl.AttributionControl({ compact: false }), 'bottom-right');
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  var items = {};
  var current = null;
  function select(id, fromPage) {
    if (!items[id]) return;
    if (current && items[current]) { items[current].el.classList.remove('on'); items[current].marker.getElement().style.zIndex = ''; }
    current = id;
    items[id].el.classList.add('on'); items[id].marker.getElement().style.zIndex = '2';
    var to = [items[id].pin.lng, items[id].pin.lat];
    if (D.reduced) map.jumpTo({ center: to }); else map.easeTo({ center: to, duration: 300 });
    if (fromPage) post({ type: 'select', id: id });
  }
  window.__select = function (id) { select(String(id), false); };
  D.pins.forEach(function (p) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'pin'; b.textContent = p.price; b.setAttribute('aria-label', p.aria);
    b.addEventListener('click', function (ev) { ev.stopPropagation(); select(p.id, true); });
    var marker = new maplibregl.Marker({ element: b, anchor: 'bottom' }).setLngLat([p.lng, p.lat]).addTo(map);
    items[p.id] = { el: b, marker: marker, pin: p };
  });
  if (D.pins.length > 1) {
    var bounds = new maplibregl.LngLatBounds();
    D.pins.forEach(function (p) { bounds.extend([p.lng, p.lat]); });
    map.fitBounds(bounds, { padding: 56, maxZoom: 14, animate: false });
  } else if (D.pins.length === 1) { map.jumpTo({ center: [D.pins[0].lng, D.pins[0].lat], zoom: 13 }); }
  if (D.selected) select(D.selected, false);
  map.on('load', function () { post({ type: 'ready' }); });
})();
</script>
</body></html>`;
}
