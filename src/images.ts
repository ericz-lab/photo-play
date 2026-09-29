/**
 * What the service knows about image bytes without an image library: the type
 * from the first bytes, the size from the header, and the metadata blocks that
 * can carry a location (EXIF), which are dropped before a file is kept.
 */

export type ImageType = "image/png" | "image/jpeg" | "image/webp";
export const EXT: Record<ImageType, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

export function sniff(b: Uint8Array): ImageType | null {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 30 && str(b, 0, 4) === "RIFF" && str(b, 8, 4) === "WEBP") return "image/webp";
  return null;
}

/** Width and height from the header; null when the header is not where it should be. */
export function dimensions(b: Uint8Array, type: ImageType): { width: number; height: number } | null {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (type === "image/png") return str(b, 12, 4) === "IHDR" ? { width: v.getUint32(16), height: v.getUint32(20) } : null;
  if (type === "image/webp") {
    const kind = str(b, 12, 4);
    if (kind === "VP8X") return { width: 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16)), height: 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16)) };
    if (kind === "VP8 ") return { width: v.getUint16(26, true) & 0x3fff, height: v.getUint16(28, true) & 0x3fff };
    if (kind === "VP8L") { const n = v.getUint32(21, true); return { width: (n & 0x3fff) + 1, height: ((n >> 14) & 0x3fff) + 1 }; }
    return null;
  }
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1]!;
    const len = v.getUint16(i + 2);
    // SOF0..SOF15 carry the size, except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { width: v.getUint16(i + 7), height: v.getUint16(i + 5) };
    i += 2 + len;
  }
  return null;
}

/** The same image without EXIF: JPEG APP1 segments, the PNG eXIf chunk, the WebP EXIF chunk. */
export function stripMetadata(b: Uint8Array, type: ImageType): Uint8Array {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const parts: Uint8Array[] = [];
  if (type === "image/jpeg") {
    parts.push(b.subarray(0, 2));
    let i = 2;
    while (i + 4 <= b.length && b[i] === 0xff) {
      const marker = b[i + 1]!;
      if (marker === 0xda) break; // start of scan: the rest is image data
      const end = i + 2 + v.getUint16(i + 2);
      if (marker !== 0xe1) parts.push(b.subarray(i, end));
      i = end;
    }
    parts.push(b.subarray(i));
  } else if (type === "image/png") {
    parts.push(b.subarray(0, 8));
    let i = 8;
    while (i + 12 <= b.length) {
      const end = i + 12 + v.getUint32(i);
      if (str(b, i + 4, 4) !== "eXIf") parts.push(b.subarray(i, end));
      i = end;
    }
  } else {
    // RIFF chunks after the 12-byte header; the VP8X flag for EXIF is cleared with the chunk.
    const head = b.slice(0, 12);
    const chunks: Uint8Array[] = [];
    let i = 12;
    while (i + 8 <= b.length) {
      const size = v.getUint32(i + 4, true);
      const end = Math.min(b.length, i + 8 + size + (size & 1));
      const id = str(b, i, 4);
      if (id === "VP8X") { const c = b.slice(i, end); c[8] = c[8]! & ~0x08; chunks.push(c); }
      else if (id !== "EXIF") chunks.push(b.subarray(i, end));
      i = end;
    }
    const total = chunks.reduce((n, c) => n + c.length, 4);
    new DataView(head.buffer).setUint32(4, total, true);
    parts.push(head, ...chunks);
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

function str(b: Uint8Array, at: number, n: number): string {
  return String.fromCharCode(...b.subarray(at, at + n));
}
