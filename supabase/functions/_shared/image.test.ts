import test from 'node:test';
import assert from 'node:assert/strict';
import { ImageError, inspectImage, minimalExif, readExifOrientation, sanitizeImage } from './image.ts';

import { be16, be32, cat, enc, entropy, has, photo, png, seg } from './test-images.ts';

test('JPEG: GPS, XMP, IPTC, comments, thumbnail and trailing data are all gone', () => {
  const input = photo();
  for (const secret of ['GPS-LAT', '28.4951', 'XMP-SECRET', 'IPTC-SECRET', 'COMMENT-SECRET', 'THUMBNAIL-PIXELS', 'TRAILER-SECRET']) {
    assert.ok(has(input, enc(secret)), `test photo should contain ${secret}`);
  }
  const { bytes, info } = sanitizeImage(input);
  for (const secret of ['GPS', '28.4951', 'XMP', 'xmpmeta', 'IPTC', 'Photoshop', 'COMMENT', 'THUMBNAIL', 'TRAILER']) {
    assert.ok(!has(bytes, enc(secret)), `output must not contain ${secret}`);
  }
  assert.deepEqual(info, { type: 'jpeg', width: 300, height: 400 });
});

test('JPEG: the picture data is untouched, and the file is still a well-formed JPEG', () => {
  const { bytes } = sanitizeImage(photo());
  assert.ok(has(bytes, entropy), 'the compressed picture data is copied as it was');
  assert.deepEqual([bytes[0], bytes[1], bytes[bytes.length - 2], bytes[bytes.length - 1]], [0xff, 0xd8, 0xff, 0xd9]);
  assert.deepEqual(inspectImage(bytes), { type: 'jpeg', width: 300, height: 400 });
  assert.ok(has(bytes, cat(enc('ICC_PROFILE\0'))), 'the colour profile stays');
});

test('JPEG: the rotation survives, as a tiny EXIF block with nothing else in it', () => {
  const { bytes, orientation } = sanitizeImage(photo({ orientation: 6 }));
  assert.equal(orientation, 6);
  // find the single EXIF block in the output
  let found = 0;
  for (let i = 2; i < bytes.length - 4; i++) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xe1) {
      found++;
      const len = (bytes[i + 2] << 8) | bytes[i + 3];
      assert.equal(len, 34, 'the new EXIF block is exactly 36 bytes');
      assert.equal(readExifOrientation(bytes.subarray(i + 4, i + 2 + len)), 6);
      assert.ok(!has(bytes.subarray(i, i + 2 + len), Uint8Array.of(0x88, 0x25)), 'no GPS pointer');
    }
  }
  assert.equal(found, 1);
});

test('JPEG: an upright photo gets no EXIF block at all', () => {
  const { bytes, orientation } = sanitizeImage(photo({ orientation: 1 }));
  assert.equal(orientation, 1);
  for (let i = 2; i < bytes.length - 1; i++) assert.ok(!(bytes[i] === 0xff && bytes[i + 1] === 0xe1), 'no APP1 block');
});

test('JPEG: little-endian EXIF is read too', () => {
  const le = cat(enc('Exif\0\0'), enc('II'), Uint8Array.of(42, 0), Uint8Array.of(8, 0, 0, 0), Uint8Array.of(1, 0), Uint8Array.of(0x12, 0x01, 3, 0, 1, 0, 0, 0, 3, 0, 0, 0), Uint8Array.of(0, 0, 0, 0));
  assert.equal(readExifOrientation(le), 3);
  assert.equal(readExifOrientation(enc('not exif')), 1);
  assert.equal(readExifOrientation(Uint8Array.of()), 1);
  assert.equal(minimalExif(8).length, 36);
});

test('JPEG: a progressive file with several scans keeps every scan', () => {
  const scan2 = cat(seg(0xda, Uint8Array.of(1, 1, 0, 0, 63, 0)), Uint8Array.of(0xaa, 0xbb, 0xff, 0x00, 0xcc));
  const input = cat(Uint8Array.of(0xff, 0xd8), seg(0xc2, cat(Uint8Array.of(8), be16(300), be16(300), Uint8Array.of(1, 1, 0x11, 0))),
    seg(0xda, Uint8Array.of(1, 1, 0, 0, 63, 0)), Uint8Array.of(1, 2, 3, 4), scan2, Uint8Array.of(0xff, 0xd9));
  const { bytes } = sanitizeImage(input);
  assert.ok(has(bytes, Uint8Array.of(1, 2, 3, 4)) && has(bytes, Uint8Array.of(0xaa, 0xbb, 0xff, 0x00, 0xcc)));
});

test('PNG: text, EXIF and time chunks and trailing data are dropped; picture chunks stay', () => {
  const { bytes, info } = sanitizeImage(png());
  for (const secret of ['tEXt', 'eXIf', 'tIME', 'GPS', 'EXIF-SECRET', 'TRAILER']) assert.ok(!has(bytes, enc(secret)), secret);
  for (const kept of ['IHDR', 'IDAT', 'IEND']) assert.ok(has(bytes, enc(kept)), kept);
  assert.deepEqual(info, { type: 'png', width: 300, height: 300 });
});

test('refuses other formats, damaged files, tiny and huge pictures', () => {
  const refuse = (b: Uint8Array, code: string) => assert.throws(() => sanitizeImage(b), (e: unknown) => e instanceof ImageError && e.code === code, code);
  refuse(enc('GIF89a....'), 'unsupported');
  refuse(cat(Uint8Array.of(0, 0, 0, 0x18), enc('ftypheic')), 'unsupported');
  refuse(enc('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'unsupported');
  refuse(new Uint8Array(), 'unsupported');
  refuse(photo().subarray(0, 120), 'corrupt');                       // cut off
  refuse(photo().subarray(0, photo().length - 20), 'corrupt');       // the end marker is cut off
  refuse(photo({ width: 100, height: 100 }), 'too_small');
  refuse(photo({ width: 30000, height: 300 }), 'too_big');
  refuse(photo({ width: 9000, height: 9000 }), 'too_big');           // too many pixels
  refuse(new Uint8Array(9 * 1024 * 1024), 'too_big');
  refuse(png(50, 50), 'too_small');
});
