// Builds small synthetic photos for tests: a JPEG full of hidden data (GPS, XMP, a thumbnail...) and a PNG with text chunks.
export const enc = (s: string) => new TextEncoder().encode(s);
export const cat = (...p: Uint8Array[]) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };
export const seg = (marker: number, payload: Uint8Array) => cat(Uint8Array.of(0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff), payload);
export const has = (hay: Uint8Array, needle: Uint8Array) => { outer: for (let i = 0; i <= hay.length - needle.length; i++) { for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer; return true; } return false; };
export const be16 = (n: number) => Uint8Array.of(n >> 8, n & 255);
export const be32 = (n: number) => Uint8Array.of((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);

// EXIF with rotation 6 and a GPS block that holds a recognisable position.
export function exifWithGps(orientation = 6) {
  const gpsText = enc('GPS-LAT-28.4951N-LON-34.5135E');
  const ifd0Count = 2, ifd0Size = 2 + ifd0Count * 12 + 4;
  const gpsOffset = 8 + ifd0Size;
  const ifd0 = cat(be16(ifd0Count),
    be16(0x0112), be16(3), be32(1), be16(orientation), be16(0),
    be16(0x8825), be16(4), be32(1), be32(gpsOffset), be32(0));
  const gps = cat(be16(1), be16(0x0001), be16(2), be32(gpsText.length), be32(gpsOffset + 18), be32(0), gpsText);
  return cat(enc('Exif\0\0'), enc('MM'), be16(42), be32(8), ifd0, gps);
}

export const entropy = Uint8Array.of(0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd0, 0x78, 0x9a);   // includes an escaped FF and a restart marker
export function photo(opts: { width?: number; height?: number; orientation?: number } = {}) {
  const w = opts.width ?? 300, h = opts.height ?? 400;
  const thumb = enc('THUMBNAIL-PIXELS');
  return cat(
    Uint8Array.of(0xff, 0xd8),
    seg(0xe0, cat(enc('JFIF\0'), Uint8Array.of(1, 1, 0, 0, 72, 0, 72, 2, 2), thumb)),            // JFIF with a 2x2 thumbnail
    seg(0xe1, exifWithGps(opts.orientation ?? 6)),
    seg(0xe1, enc('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>XMP-SECRET</x:xmpmeta>')),
    seg(0xed, enc('Photoshop 3.0\0IPTC-SECRET')),
    seg(0xfe, enc('COMMENT-SECRET')),
    seg(0xe2, cat(enc('ICC_PROFILE\0'), Uint8Array.of(1, 1, 9, 9))),
    seg(0xdb, Uint8Array.of(0, 8, 8, 8, 8, 8, 8, 8)),
    seg(0xc0, cat(Uint8Array.of(8), be16(h), be16(w), Uint8Array.of(1, 1, 0x11, 0))),
    seg(0xc4, Uint8Array.of(0, 1, 2, 3)),
    seg(0xda, Uint8Array.of(1, 1, 0, 0, 63, 0)),
    entropy,
    Uint8Array.of(0xff, 0xd9),
    enc('TRAILER-SECRET'),
  );
}


const crc = Uint8Array.of(0, 0, 0, 0);
const chunk = (type: string, data: Uint8Array) => cat(be32(data.length), enc(type), data, crc);
export function png(w = 300, h = 300) {
  return cat(Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    chunk('IHDR', cat(be32(w), be32(h), Uint8Array.of(8, 2, 0, 0, 0))),
    chunk('tEXt', enc('Comment\0GPS 28.4951N')), chunk('eXIf', enc('EXIF-SECRET')), chunk('tIME', Uint8Array.of(7, 234, 10, 29, 9, 0, 0)),
    chunk('IDAT', Uint8Array.of(1, 2, 3)), chunk('IEND', new Uint8Array()), enc('TRAILER-SECRET'));
}

