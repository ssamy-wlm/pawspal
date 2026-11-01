import { buildMapHtml, DEFAULT_TILE_URL, MAPLIBRE_CSS_SRI, MAPLIBRE_JS_SRI, MAPLIBRE_VERSION, MapColors, MapPin, pinsFromRows, safeJson, tileOrigin } from '../src/lib/mapHtml';

const colors: MapColors = { pin: 'orange', pinText: 'navy', selected: 'navy', selectedText: 'orange', ring: 'navy', background: 'white' };
const pin = (over: Partial<MapPin> = {}): MapPin => ({ id: 'a1', lat: 28.5, lng: 34.5, price: '250 EGP', name: 'Hana', area: 'Masbat', aria: 'Hana, Masbat, 250 EGP', ...over });
const html = (over: Partial<Parameters<typeof buildMapHtml>[0]> = {}) => buildMapHtml({ pins: [pin()], labels: { map: 'Map of hosts' }, colors, ...over });

describe('map page: the library', () => {
  it('loads MapLibre from one exact version with integrity hashes and anonymous CORS', () => {
    const h = html();
    expect(MAPLIBRE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(h).toContain(`<script src="https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.js" integrity="${MAPLIBRE_JS_SRI}" crossorigin="anonymous"></script>`);
    expect(h).toContain(`<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.css" integrity="${MAPLIBRE_CSS_SRI}" crossorigin="anonymous">`);
    expect(MAPLIBRE_JS_SRI).toMatch(/^sha384-[A-Za-z0-9+/]{64}$/);
    expect(MAPLIBRE_CSS_SRI).toMatch(/^sha384-[A-Za-z0-9+/]{64}$/);
    expect(h).not.toMatch(/maplibre-gl@(latest|\^|~|\d+(\.\d+)?\/)/);                 // never a floating version
  });
  it('allows nothing but the library host and the tile host', () => {
    const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html())![1];
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain('script-src https://unpkg.com');
    expect(csp).toContain('img-src https://tile.openstreetmap.org');
    expect(csp).toContain('connect-src https://tile.openstreetmap.org');
  });
});

describe('map page: tiles and attribution', () => {
  it('defaults to OpenStreetMap and shows the attribution in full (not compact)', () => {
    const h = html();
    expect(h).toContain(JSON.stringify(DEFAULT_TILE_URL).replace(/\//g, '/'));
    expect(h).toContain('© OpenStreetMap contributors');
    expect(h).toContain('compact: false');
    expect(h).toContain("tileSize: 256");
  });
  it('uses a configured provider, and falls back to the default for anything that is not https', () => {
    expect(html({ tileUrl: 'https://tiles.example.com/{z}/{x}/{y}.png', attribution: '© Example' })).toContain('https://tiles.example.com/{z}/{x}/{y}.png');
    expect(html({ tileUrl: 'https://tiles.example.com/{z}/{x}/{y}.png' })).toContain('img-src https://tiles.example.com');
    const bad = html({ tileUrl: 'http://evil.example/{z}/{x}/{y}.png' });
    expect(bad).not.toContain('evil.example');
    expect(bad).toContain(DEFAULT_TILE_URL);
    expect(tileOrigin('javascript:alert(1)')).toBeNull();
    expect(tileOrigin('https://{a}.tile.example.org/{z}/{x}/{y}.png')).toBe('https://*.tile.example.org');
  });
  it('treats the attribution as text, not markup', () => {
    expect(html({ attribution: '<img src=x onerror=alert(1)> ©' })).not.toContain('<img src=x');
  });
});

describe('map page: pins', () => {
  it('draws one pill per pin with its price label, and the colours come in as parameters', () => {
    const h = html({ pins: [pin(), pin({ id: 'a2', lat: 28.51, lng: 34.51, price: 'Free', name: 'Sam', aria: 'Sam, Free' })] });
    expect(h).toContain('"price":"250 EGP"');
    expect(h).toContain('"price":"Free"');
    expect(h).toContain('"pin":"orange"');
    expect(h).toContain('"selected":"navy"');
    expect(h).not.toMatch(/#[0-9a-f]{3,8}\b/i);                                            // no hard-coded hex in the page
  });
  it('only turns rows with a usable approximate position into pins, and copies only the allowed fields', () => {
    const rows = [
      { availability_id: 'ok', first_name: 'Hana', area: 'Masbat', approx_lat: 28.5, approx_lng: 34.5, price_per_night: 250, user_id: 'SECRET-USER', face_photo_path: 'faces/x.jpg', home_photo_path: 'homes/y.jpg' },
      { availability_id: 'nolat', first_name: 'A', area: null, approx_lat: null, approx_lng: 34.5, price_per_night: null },
      { availability_id: 'nan', first_name: 'B', area: null, approx_lat: Number.NaN, approx_lng: 34.5, price_per_night: null },
      { availability_id: 'inf', first_name: 'C', area: null, approx_lat: 28, approx_lng: Infinity, price_per_night: null },
      { availability_id: 'range', first_name: 'D', area: null, approx_lat: 91, approx_lng: 34.5, price_per_night: null },
      { availability_id: 'range2', first_name: 'E', area: null, approx_lat: 28, approx_lng: -181, price_per_night: null },
    ];
    const pins = pinsFromRows(rows, (r) => (r.price_per_night != null ? `${r.price_per_night} EGP` : 'Free'), (r, price) => `${r.first_name}, ${price}`);
    expect(pins).toEqual([{ id: 'ok', lat: 28.5, lng: 34.5, price: '250 EGP', name: 'Hana', area: 'Masbat', aria: 'Hana, 250 EGP' }]);
    const h = html({ pins });
    for (const secret of ['SECRET-USER', 'faces/x.jpg', 'homes/y.jpg', 'user_id', 'photo']) expect(h).not.toContain(secret);
  });
  it('drops pins with bad coordinates even when they are passed in directly', () => {
    const h = html({ pins: [pin({ id: 'bad', lat: 200 }), pin({ id: 'nan', lng: Number.NaN }), pin({ id: 'good' })] });
    expect(h).toContain('"id":"good"');
    expect(h).not.toContain('"id":"bad"');
    expect(h).not.toContain('"id":"nan"');
  });
  it('lets a pin send its id to the app, and the app select a pin', () => {
    const h = html();
    expect(h).toContain("post({ type: 'select', id: id })");
    expect(h).toContain("post({ type: 'ready' })");
    expect(h).toContain('window.__select');
  });
  it('jumps instead of flying when Reduce Motion is on', () => {
    expect(html({ reducedMotion: true })).toContain('"reduced":true');
    expect(html()).toContain('"reduced":false');
    expect(html()).toContain('map.jumpTo');
  });
});

describe('map page: embedding data safely', () => {
  it('cannot be broken out of the script by a first name like </script>', () => {
    const evil = '</script><script>alert(1)</script><!--';
    const h = html({ pins: [pin({ name: evil, aria: evil, area: evil })] });
    expect(h.split('</script>').length).toBe(3);                                           // only our own two script elements close
    expect(h).not.toContain('<script>alert(1)');
    expect(h).toContain('\\u003c/script\\u003e');
    expect(h).not.toContain('<!--');
  });
  it('escapes line and paragraph separators and ampersands', () => {
    const out = safeJson({ s: 'a\u2028b\u2029c&d<e>' });
    expect(out).not.toMatch(/[\u2028\u2029]/);
    expect(out).toContain('\\u2028');
    expect(out).toContain('\\u2029');
    expect(out).toContain('\\u0026');
    expect(JSON.parse(out)).toEqual({ s: 'a\u2028b\u2029c&d<e>' });
  });
  it('escapes the labels and colours too', () => {
    const h = html({ labels: { map: '</script>x' }, colors: { ...colors, pin: '</script>' } });
    expect(h.split('</script>').length).toBe(3);
  });
});
