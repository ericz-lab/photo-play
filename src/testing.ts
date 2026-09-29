import { deflateSync } from "node:zlib";

/** A real PNG of the given size and colour, for tests. */
export function png(width: number, height: number, rgb: [number, number, number] = [40, 120, 200], extraChunk?: { type: string; data: Uint8Array }): Uint8Array {
  const row = new Uint8Array(1 + width * 3);
  for (let x = 0; x < width; x++) row.set(rgb, 1 + x * 3);
  const raw = new Uint8Array(row.length * height);
  for (let y = 0; y < height; y++) raw.set(row, y * row.length);
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width); v.setUint32(4, height); ihdr[8] = 8; ihdr[9] = 2;
  const chunks = [chunk("IHDR", ihdr), ...(extraChunk ? [chunk(extraChunk.type, extraChunk.data)] : []), chunk("IDAT", new Uint8Array(deflateSync(raw))), chunk("IEND", new Uint8Array())];
  return concat([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ...chunks]);
}

/** A JPEG header with an EXIF segment and a frame header: enough for type, size and stripping. */
export function jpegWithExif(width: number, height: number): Uint8Array {
  const exif = new TextEncoder().encode("Exif\0\0GPS-LOCATION-HERE");
  const app1 = concat([new Uint8Array([0xff, 0xe1, 0, exif.length + 2]), exif]);
  const sof = new Uint8Array([0xff, 0xc0, 0, 11, 8, height >> 8, height & 255, width >> 8, width & 255, 1, 1, 0x11, 0]);
  const sos = new Uint8Array([0xff, 0xda, 0, 8, 1, 1, 0, 0, 0x3f, 0, 1, 2, 3, 4, 0xff, 0xd9]);
  return concat([new Uint8Array([0xff, 0xd8]), app1, sof, sos]);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function crc32(b: Uint8Array): number {
  let c = ~0;
  for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return ~c >>> 0;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
