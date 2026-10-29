// Cleans an uploaded photo so it carries no hidden data: no GPS position, no camera or phone model, no time, no
// thumbnails, no comments. It rewrites the file's structure and does NOT decode the picture, so the pixels are not touched.
//
// JPEG: keeps only the picture data, a plain JFIF header (no thumbnail), Adobe colour info and the colour profile. If the phone stored the
//       rotation in the EXIF block, a tiny new EXIF block with only the rotation is written, so the photo stays upright.
// PNG:  keeps only an allow-list of chunks. Text, EXIF and time chunks are dropped.
// Anything else (HEIC, GIF, SVG, PDF, ...) is refused. Bytes after the end of the image are cut off.

export class ImageError extends Error {
  code: 'unsupported' | 'corrupt' | 'too_big' | 'too_small';
  constructor(code: 'unsupported' | 'corrupt' | 'too_big' | 'too_small') {
    super(code);
    this.name = 'ImageError';
    this.code = code;
  }
}

export interface ImageInfo {
  type: 'jpeg' | 'png';
  width: number;
  height: number;
}

export interface SanitizeLimits {
  maxBytes: number;
  minSide: number;
  maxSide: number;
  maxPixels: number;
}

export const DEFAULT_LIMITS: SanitizeLimits = { maxBytes: 8 * 1024 * 1024, minSide: 200, maxSide: 12000, maxPixels: 50_000_000 };

const u16 = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));

// ---------------------------------------------------------------- JPEG
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/** Reads only the rotation (tag 0x0112) from an EXIF block. Returns 1 (upright) when absent or unreadable. */
export function readExifOrientation(payload: Uint8Array): number {
  try {
    if (ascii(payload, 0, 6) !== 'Exif\0\0') return 1;
    const t = 6;                                         // start of the TIFF header
    const little = ascii(payload, t, 2) === 'II';
    if (!little && ascii(payload, t, 2) !== 'MM') return 1;
    const r16 = (o: number) => (little ? payload[o] | (payload[o + 1] << 8) : u16(payload, o));
    const r32 = (o: number) => (little
      ? (payload[o] | (payload[o + 1] << 8) | (payload[o + 2] << 16) | (payload[o + 3] << 24)) >>> 0
      : u32(payload, o));
    if (r16(t + 2) !== 42) return 1;
    const ifd = t + r32(t + 4);
    const n = r16(ifd);
    for (let i = 0; i < n && i < 64; i++) {
      const e = ifd + 2 + i * 12;
      if (e + 12 > payload.length) return 1;
      if (r16(e) === 0x0112) {
        const v = r16(e + 8);
        return v >= 1 && v <= 8 ? v : 1;
      }
    }
  } catch { /* fall through */ }
  return 1;
}

/** A new EXIF block holding only the rotation. 36 bytes, no GPS, no dates, no device. */
export function minimalExif(orientation: number): Uint8Array {
  return Uint8Array.from([
    0xff, 0xe1, 0x00, 0x22,                               // APP1, length 34
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00,                   // "Exif\0\0"
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08,      // big-endian TIFF header, first directory at offset 8
    0x00, 0x01,                                           // one entry
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00,   // Orientation, SHORT, 1 value
    0x00, 0x00, 0x00, 0x00,                               // no next directory
  ]);
}

interface Segment { marker: number; bytes: Uint8Array }

function sanitizeJpeg(b: Uint8Array): { bytes: Uint8Array; info: ImageInfo; orientation: number } {
  if (b[0] !== 0xff || b[1] !== 0xd8) throw new ImageError('corrupt');
  const kept: Segment[] = [];
  let width = 0, height = 0, orientation = 1, pos = 2, ended = false;

  while (pos < b.length && !ended) {
    if (b[pos] !== 0xff) throw new ImageError('corrupt');
    while (b[pos] === 0xff && pos < b.length) pos++;       // skip fill bytes
    const marker = b[pos++];
    if (marker === 0xd9) { ended = true; break; }          // EOI
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8) || marker === 0x00) continue;   // markers without a length
    if (pos + 2 > b.length) throw new ImageError('corrupt');
    const len = u16(b, pos);
    if (len < 2 || pos + len > b.length) throw new ImageError('corrupt');
    const payload = b.subarray(pos + 2, pos + len);
    const whole = b.subarray(pos - 2, pos + len);          // marker bytes + length + payload

    if (SOF.has(marker)) {
      if (payload.length < 6) throw new ImageError('corrupt');
      height = u16(payload, 1);
      width = u16(payload, 3);
    }
    if (marker === 0xe1) {
      if (ascii(payload, 0, 6) === 'Exif\0\0') orientation = readExifOrientation(payload);
      // Every other APP1 block (XMP and friends) is dropped too.
    } else if (marker === 0xe0) {
      // JFIF header: rebuilt with no embedded thumbnail (a thumbnail can hold pixels that were cropped out of the photo).
      // Other APP0 blocks (JFXX extensions) are dropped.
      if (ascii(payload, 0, 5) === 'JFIF\0' && payload.length >= 14) {
        kept.push({ marker, bytes: Uint8Array.of(0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00,
          payload[5], payload[6], payload[7], payload[8], payload[9], payload[10], payload[11], 0x00, 0x00) });
      }
    } else if (marker === 0xee) {
      if (ascii(payload, 0, 5) === 'Adobe') kept.push({ marker, bytes: whole });   // colour transform info
    } else if (marker === 0xe2) {
      if (ascii(payload, 0, 12) === 'ICC_PROFILE\0') kept.push({ marker, bytes: whole });   // colour profile only
    } else if ((marker >= 0xe3 && marker <= 0xef) || marker === 0xfe) {
      // other APPn blocks and comments: dropped
    } else {
      kept.push({ marker, bytes: whole });                 // tables, frame header, ...
    }
    pos += len;

    if (marker === 0xda) {                                 // start of scan: copy the picture data as it is
      const start = pos;
      while (pos < b.length) {
        if (b[pos] === 0xff && b[pos + 1] !== 0x00 && !(b[pos + 1] >= 0xd0 && b[pos + 1] <= 0xd7)) break;
        pos++;
      }
      kept.push({ marker: -1, bytes: b.subarray(start, pos) });
    }
  }
  if (!ended || !width || !height) throw new ImageError('corrupt');

  const out: Uint8Array[] = [Uint8Array.of(0xff, 0xd8)];
  let exifWritten = orientation === 1;
  for (const s of kept) {
    out.push(s.bytes);
    if (!exifWritten && s.marker === 0xe0) { out.push(minimalExif(orientation)); exifWritten = true; }
  }
  if (!exifWritten) out.splice(1, 0, minimalExif(orientation));
  out.push(Uint8Array.of(0xff, 0xd9));
  return { bytes: concat(out), info: { type: 'jpeg', width, height }, orientation };
}

// ---------------------------------------------------------------- PNG
const PNG_KEEP = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT', 'bKGD', 'hIST', 'pHYs', 'acTL', 'fcTL', 'fdAT']);

function sanitizePng(b: Uint8Array): { bytes: Uint8Array; info: ImageInfo; orientation: number } {
  let pos = 8, width = 0, height = 0, ended = false;
  const out: Uint8Array[] = [b.subarray(0, 8)];
  while (pos + 12 <= b.length && !ended) {
    const len = u32(b, pos);
    const type = ascii(b, pos + 4, 4);
    if (pos + 12 + len > b.length) throw new ImageError('corrupt');
    if (pos === 8 && type !== 'IHDR') throw new ImageError('corrupt');
    if (type === 'IHDR') { width = u32(b, pos + 8); height = u32(b, pos + 12); }
    if (PNG_KEEP.has(type)) out.push(b.subarray(pos, pos + 12 + len));
    if (type === 'IEND') ended = true;
    pos += 12 + len;
  }
  if (!ended || !width || !height) throw new ImageError('corrupt');
  return { bytes: concat(out), info: { type: 'png', width, height }, orientation: 1 };
}

// ---------------------------------------------------------------- public
export function inspectImage(b: Uint8Array): ImageInfo | null {
  try {
    if (b[0] === 0xff && b[1] === 0xd8) return sanitizeJpeg(b).info;
    if (b.length > 8 && ascii(b, 1, 3) === 'PNG' && b[0] === 0x89) return sanitizePng(b).info;
  } catch { /* not an image we accept */ }
  return null;
}

export function sanitizeImage(b: Uint8Array, limits: SanitizeLimits = DEFAULT_LIMITS): { bytes: Uint8Array; info: ImageInfo; orientation: number } {
  if (b.length > limits.maxBytes) throw new ImageError('too_big');
  let r;
  if (b[0] === 0xff && b[1] === 0xd8) r = sanitizeJpeg(b);
  else if (b.length > 8 && b[0] === 0x89 && ascii(b, 1, 3) === 'PNG') r = sanitizePng(b);
  else throw new ImageError('unsupported');
  const { width, height } = r.info;
  if (width < limits.minSide || height < limits.minSide) throw new ImageError('too_small');
  if (width > limits.maxSide || height > limits.maxSide || width * height > limits.maxPixels) throw new ImageError('too_big');
  return r;
}
