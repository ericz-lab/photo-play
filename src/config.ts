import { resolve } from "node:path";

const env = (k: string, d = "") => (process.env[k] ?? d).trim();
const num = (k: string, d: number) => { const n = Number(env(k)); return Number.isFinite(n) && env(k) !== "" ? n : d; };

export const config = {
  port: num("PORT", 8975),
  publicBase: env("PUBLIC_BASE").replace(/\/$/, ""),
  /** ai-space's API and this app's token (space.env); every picture is made through them. */
  spaceApiUrl: env("SPACE_API_URL").replace(/\/$/, ""),
  spaceAppToken: env("SPACE_APP_TOKEN"),
  /** Wall-clock cap of one generation, seconds. */
  jobTimeoutSec: num("PHOTO_JOB_TIMEOUT", 600),
  /** Largest upload, bytes; the model service takes at most 5 MB per image. */
  maxUploadBytes: num("PHOTO_MAX_UPLOAD", 5 * 1024 * 1024),
};

/** SQLite file: `DATABASE_URL` (sqlite:///abs/path) from ai-space, else data/main.db. */
export function databasePath(e: Record<string, string | undefined> = process.env): string {
  const url = (e.DATABASE_URL ?? "").trim();
  if (url === ":memory:") return url;
  if (url) {
    const m = /^sqlite:\/\/(.*)$/.exec(url);
    if (!m) throw new Error(`DATABASE_URL must be sqlite:///path, got ${url}`);
    return m[1]!.startsWith("/") ? m[1]! : resolve(m[1]!);
  }
  return resolve(e.SPACE_APP_DATA_DIR ?? "data", "main.db");
}

/** Directory of the image files: `BLOB_URL` (file:///abs/path) from ai-space, else data/blobs. */
export function blobDir(e: Record<string, string | undefined> = process.env): string {
  const url = (e.BLOB_URL ?? "").trim();
  if (url) {
    if (!url.startsWith("file://")) throw new Error(`BLOB_URL must be a file:// store (space.yaml storage.blobs: file), got ${url}`);
    return decodeURIComponent(new URL(url).pathname);
  }
  return resolve(e.SPACE_APP_DATA_DIR ?? "data", "blobs");
}
