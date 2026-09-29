import { Database } from "bun:sqlite";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { dimensions, EXT, type ImageType, sniff, stripMetadata } from "./images.ts";
import type { Artwork, Asset, Job, JobStatus } from "./types.ts";

/**
 * Metadata in SQLite, image bytes as files named by their hash. An asset is
 * kept once however many artworks or versions use it, so a file is removed
 * only when nothing refers to it any more.
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY,
  sha256 TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  type TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  bytes INTEGER NOT NULL,
  file TEXT NOT NULL,
  thumb_id INTEGER,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS artworks (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  original_id INTEGER NOT NULL REFERENCES assets(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY,
  artwork_id INTEGER NOT NULL REFERENCES artworks(id),
  parent_id INTEGER REFERENCES jobs(id),
  base_id INTEGER NOT NULL REFERENCES assets(id),
  template_id TEXT NOT NULL,
  template_version INTEGER NOT NULL,
  params TEXT NOT NULL,
  extra TEXT NOT NULL DEFAULT '',
  overlay TEXT NOT NULL DEFAULT '{}',
  prompt TEXT NOT NULL,
  status TEXT NOT NULL,
  result_id INTEGER REFERENCES assets(id),
  text TEXT,
  model TEXT,
  runtime TEXT,
  call_id INTEGER,
  usage TEXT,
  error TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS jobs_artwork ON jobs(artwork_id);
CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status);
`;

type Row = Record<string, unknown>;

export class Store {
  readonly db: Database;
  constructor(path: string, readonly blobDir: string, private readonly now = () => new Date().toISOString()) {
    this.db = new Database(path, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.db.exec(SCHEMA);
  }

  close() { this.db.close(); }

  // ------------------------------------------------------------- assets

  /** Keep image bytes: type checked from the bytes, EXIF dropped, stored once per content. Throws with the reason. */
  async putAsset(raw: Uint8Array, kind: Asset["kind"]): Promise<Asset> {
    const type = sniff(raw);
    if (!type) throw new Error("只支持 JPEG、PNG 或 WebP 图片");
    const bytes = stripMetadata(raw, type);
    const size = dimensions(bytes, type);
    if (!size || size.width < 16 || size.height < 16) throw new Error("读不出图片尺寸，文件可能已损坏");
    const sha = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    const existing = this.db.query("SELECT * FROM assets WHERE sha256 = ?").get(sha) as Row | null;
    if (existing) return asset(existing);
    const file = join(sha.slice(0, 2), `${sha}.${EXT[type]}`);
    await mkdir(dirname(join(this.blobDir, file)), { recursive: true });
    await Bun.write(join(this.blobDir, file), bytes);
    const row = this.db.query("INSERT INTO assets (sha256, kind, type, width, height, bytes, file, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *")
      .get(sha, kind, type, size.width, size.height, bytes.length, file, this.now()) as Row;
    return asset(row);
  }

  getAsset(id: number): Asset | null {
    const row = this.db.query("SELECT * FROM assets WHERE id = ?").get(id) as Row | null;
    return row ? asset(row) : null;
  }

  assetPath(a: Asset): string { return join(this.blobDir, a.file); }

  setThumb(assetId: number, thumbId: number) {
    this.db.query("UPDATE assets SET thumb_id = ? WHERE id = ?").run(thumbId, assetId);
  }

  // ------------------------------------------------------------- artworks

  createArtwork(originalId: number, title = ""): Artwork {
    const at = this.now();
    return artwork(this.db.query("INSERT INTO artworks (title, original_id, created_at, updated_at) VALUES (?, ?, ?, ?) RETURNING *").get(title, originalId, at, at) as Row);
  }

  getArtwork(id: number): Artwork | null {
    const row = this.db.query("SELECT * FROM artworks WHERE id = ?").get(id) as Row | null;
    return row ? artwork(row) : null;
  }

  /** Newest first; `template` keeps the artworks with at least one version made with it. */
  listArtworks(opts: { template?: string; limit?: number } = {}): Artwork[] {
    const rows = opts.template
      ? this.db.query("SELECT * FROM artworks WHERE id IN (SELECT artwork_id FROM jobs WHERE template_id = ?) ORDER BY updated_at DESC, id DESC LIMIT ?").all(opts.template, opts.limit ?? 200)
      : this.db.query("SELECT * FROM artworks ORDER BY updated_at DESC, id DESC LIMIT ?").all(opts.limit ?? 200);
    return (rows as Row[]).map(artwork);
  }

  renameArtwork(id: number, title: string) {
    this.db.query("UPDATE artworks SET title = ? WHERE id = ?").run(title, id);
  }

  /**
   * Remove an artwork, its versions, and every file nothing else uses. Refused while one of its
   * versions is waiting or being made, since that job would write into a deleted artwork.
   */
  async deleteArtwork(id: number): Promise<{ removedFiles: number }> {
    const art = this.getArtwork(id);
    if (!art) throw new NotFound("作品不存在");
    const busy = this.db.query("SELECT COUNT(*) AS n FROM jobs WHERE artwork_id = ? AND status IN ('queued', 'running')").get(id) as { n: number };
    if (busy.n) throw new Conflict("还有版本在生成，完成后再删除");
    const jobs = this.jobsOf(id);
    const candidates = new Set<number>([art.originalId, ...jobs.flatMap((j) => [j.baseId, ...(j.resultId ? [j.resultId] : [])])]);
    this.db.transaction(() => {
      this.db.query("DELETE FROM jobs WHERE artwork_id = ?").run(id);
      this.db.query("DELETE FROM artworks WHERE id = ?").run(id);
    })();
    let removedFiles = 0;
    for (const assetId of candidates) {
      const used = this.db.query("SELECT (SELECT COUNT(*) FROM artworks WHERE original_id = ?1) + (SELECT COUNT(*) FROM jobs WHERE base_id = ?1 OR result_id = ?1) AS n").get(assetId) as { n: number };
      if (used.n) continue;
      const a = this.getAsset(assetId);
      if (!a) continue;
      const thumb = a.thumbId ? this.getAsset(a.thumbId) : null;
      for (const gone of [a, ...(thumb ? [thumb] : [])]) {
        this.db.query("DELETE FROM assets WHERE id = ?").run(gone.id);
        await rm(this.assetPath(gone), { force: true });
        removedFiles++;
      }
    }
    return { removedFiles };
  }

  // ------------------------------------------------------------- jobs

  /** A new version to make; the same idempotency key returns the job it created the first time. */
  createJob(input: { artworkId: number; parentId: number | null; baseId: number; templateId: string; templateVersion: number; params: Record<string, unknown>; extra: string; overlay: Record<string, string>; prompt: string; key: string }): { job: Job; created: boolean } {
    const seen = this.db.query("SELECT * FROM jobs WHERE idempotency_key = ?").get(input.key) as Row | null;
    if (seen) return { job: job(seen), created: false };
    const at = this.now();
    const row = this.db.query(`INSERT INTO jobs (artwork_id, parent_id, base_id, template_id, template_version, params, extra, overlay, prompt, status, idempotency_key, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?) RETURNING *`)
      .get(input.artworkId, input.parentId, input.baseId, input.templateId, input.templateVersion, JSON.stringify(input.params), input.extra, JSON.stringify(input.overlay), input.prompt, input.key, at) as Row;
    this.touch(input.artworkId);
    return { job: job(row), created: true };
  }

  getJob(id: number): Job | null {
    const row = this.db.query("SELECT * FROM jobs WHERE id = ?").get(id) as Row | null;
    return row ? job(row) : null;
  }

  jobsOf(artworkId: number): Job[] {
    return (this.db.query("SELECT * FROM jobs WHERE artwork_id = ? ORDER BY id").all(artworkId) as Row[]).map(job);
  }

  nextQueued(): Job | null {
    const row = this.db.query("SELECT * FROM jobs WHERE status = 'queued' ORDER BY id LIMIT 1").get() as Row | null;
    return row ? job(row) : null;
  }

  /** Jobs ahead of this one in the queue, the running one included. */
  aheadOf(id: number): number {
    return (this.db.query("SELECT COUNT(*) AS n FROM jobs WHERE (status = 'queued' AND id < ?) OR status = 'running'").get(id) as { n: number }).n;
  }

  markRunning(id: number) {
    this.db.query("UPDATE jobs SET status = 'running', started_at = ? WHERE id = ? AND status = 'queued'").run(this.now(), id);
  }

  finishJob(id: number, status: Exclude<JobStatus, "queued" | "running">, out: { resultId?: number; text?: string; model?: string; runtime?: string; callId?: number; usage?: unknown; error?: string }) {
    this.db.query("UPDATE jobs SET status = ?, result_id = ?, text = ?, model = ?, runtime = ?, call_id = ?, usage = ?, error = ?, finished_at = ? WHERE id = ?")
      .run(status, out.resultId ?? null, out.text ?? null, out.model ?? null, out.runtime ?? null, out.callId ?? null, out.usage === undefined ? null : JSON.stringify(out.usage), out.error ?? null, this.now(), id);
    const j = this.getJob(id);
    if (j) this.touch(j.artworkId);
  }

  setOverlay(id: number, overlay: Record<string, string>) {
    this.db.query("UPDATE jobs SET overlay = ? WHERE id = ?").run(JSON.stringify(overlay), id);
  }

  /**
   * Jobs a restart cut off. The model call may have finished and been counted, but its picture
   * is gone with the process; the job is marked for the person to check and retry by hand, never
   * run again on its own.
   */
  recoverInterrupted(): number {
    return this.db.query("UPDATE jobs SET status = 'unknown', error = ?, finished_at = ? WHERE status = 'running'")
      .run("服务在生成过程中重启，结果无法确认；没有自动重试，请确认后手动重试", this.now()).changes;
  }

  private touch(artworkId: number) {
    this.db.query("UPDATE artworks SET updated_at = ? WHERE id = ?").run(this.now(), artworkId);
  }
}

export class NotFound extends Error {}
export class Conflict extends Error {}

function asset(r: Row): Asset {
  return { id: r.id as number, sha256: r.sha256 as string, kind: r.kind as Asset["kind"], type: r.type as ImageType, width: r.width as number, height: r.height as number, bytes: r.bytes as number, file: r.file as string, thumbId: (r.thumb_id as number | null) ?? null, createdAt: r.created_at as string };
}

function artwork(r: Row): Artwork {
  return { id: r.id as number, title: r.title as string, originalId: r.original_id as number, createdAt: r.created_at as string, updatedAt: r.updated_at as string };
}

function job(r: Row): Job {
  return {
    id: r.id as number, artworkId: r.artwork_id as number, parentId: (r.parent_id as number | null) ?? null, baseId: r.base_id as number,
    templateId: r.template_id as string, templateVersion: r.template_version as number, params: JSON.parse(r.params as string), extra: r.extra as string,
    overlay: JSON.parse(r.overlay as string), prompt: r.prompt as string, status: r.status as JobStatus, resultId: (r.result_id as number | null) ?? null, text: (r.text as string | null) ?? null,
    model: (r.model as string | null) ?? null, runtime: (r.runtime as string | null) ?? null, callId: (r.call_id as number | null) ?? null,
    usage: r.usage ? JSON.parse(r.usage as string) : null, error: (r.error as string | null) ?? null,
    createdAt: r.created_at as string, startedAt: (r.started_at as string | null) ?? null, finishedAt: (r.finished_at as string | null) ?? null,
  };
}
