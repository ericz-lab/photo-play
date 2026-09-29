import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRoutes } from "./app.ts";
import { Store } from "./db.ts";
import type { Generator, ImageCall } from "./model.ts";
import { png } from "./testing.ts";
import { Worker } from "./worker.ts";

let dir: string;
let store: Store;
let server: ReturnType<typeof Bun.serve>;
let base: string;
let calls: ImageCall[];
/** What the stand-in for ai-space answers; each call waits for `release` when `hold` is set. */
let answer: Awaited<ReturnType<Generator>>;
let hold: Promise<void> | null;
let release: () => void;
let worker: Worker;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "photo-play-"));
  store = new Store(":memory:", join(dir, "blobs"));
  calls = [];
  hold = null;
  answer = { ok: true, image: png(64, 48, [200, 90, 40]), text: "Made a warmer version.", model: "gpt-6-sol", runtime: "codex", callId: 42, usage: { inputTokens: 5000, cacheReadTokens: 2000, cacheWriteTokens: 0, outputTokens: 150 } };
  const generate: Generator = async (call) => {
    calls.push(call);
    if (hold) await hold;
    return answer;
  };
  worker = new Worker(store, generate, 5000, () => {});
  server = Bun.serve({ port: 0, routes: createRoutes({ store, worker, maxUploadBytes: 1024 * 1024, ready: () => ({ ok: true }) }), fetch: () => new Response("nf", { status: 404 }) });
  base = `http://127.0.0.1:${server.port}`;
});

afterEach(async () => {
  server.stop(true);
  store.close();
  await rm(dir, { recursive: true, force: true });
});

const call = async (path: string, init: RequestInit = {}) => {
  const res = await fetch(`${base}${path}`, init);
  return { status: res.status, body: (await res.json()) as any };
};
const post = (path: string, body: unknown) => call(path, { method: "POST", body: JSON.stringify(body) });

async function artworkWithPhoto(bytes = png(64, 48)) {
  const up = await call("/api/assets", { method: "POST", body: new Blob([bytes as Uint8Array<ArrayBuffer>]) });
  expect(up.status).toBe(201);
  const art = await post("/api/artworks", { assetId: up.body.asset.id });
  expect(art.status).toBe(201);
  return { assetId: up.body.asset.id as number, artworkId: art.body.artwork.id as number };
}

async function settle() {
  for (let i = 0; i < 50 && (worker.running || store.nextQueued()); i++) await Bun.sleep(10);
}

test("upload, one edit, the version with its result, and the file served back", async () => {
  const { artworkId, assetId } = await artworkWithPhoto();
  const r = await post("/api/jobs", { artworkId, parentId: null, templateId: "light", params: { tone: "golden", strength: 3 }, extra: "天空更蓝", key: "key-00000001" });
  expect(r.status).toBe(201);
  await settle();
  expect(calls).toHaveLength(1);
  expect(calls[0]!.tag).toBe("light");
  expect(calls[0]!.prompt).toContain("golden-hour");
  expect(calls[0]!.prompt).toContain("Also: 天空更蓝");
  expect([...calls[0]!.image]).toEqual([...new Uint8Array(await Bun.file(store.assetPath(store.getAsset(assetId)!)).arrayBuffer())]);
  const { body } = await call(`/api/artworks/${artworkId}`);
  expect(body.artwork.versions).toBe(1);
  const job = body.jobs[0];
  expect(job).toMatchObject({ status: "done", templateName: "调光调色", model: "gpt-6-sol", runtime: "codex", callId: 42, text: "Made a warmer version." });
  expect(job.result).toMatchObject({ width: 64, height: 48, type: "image/png" });
  expect(body.artwork.cover.id).toBe(job.result.id);
  const file = await fetch(`${base}${job.result.url}?name=v1`);
  expect(file.headers.get("content-type")).toBe("image/png");
  expect(file.headers.get("content-disposition")).toBe('attachment; filename="v1.png"');
});

test("the same key never makes a second job; a double click costs one call", async () => {
  const { artworkId } = await artworkWithPhoto();
  const body = { artworkId, parentId: null, templateId: "cleanup", params: {}, key: "same-key-123" };
  const [a, b] = await Promise.all([post("/api/jobs", body), post("/api/jobs", body)]);
  expect([a.status, b.status].sort()).toEqual([200, 201]);
  expect(a.body.job.id).toBe(b.body.job.id);
  await settle();
  expect(calls).toHaveLength(1);
});

test("a version builds on its parent's result; a parent that is not done is refused", async () => {
  const { artworkId } = await artworkWithPhoto();
  let release!: () => void;
  hold = new Promise((r) => (release = r));
  const first = await post("/api/jobs", { artworkId, parentId: null, templateId: "cleanup", params: {}, key: "first-key-1" });
  const early = await post("/api/jobs", { artworkId, parentId: first.body.job.id, templateId: "light", params: {}, key: "second-key-1" });
  expect(early.status).toBe(400);
  release();
  hold = null;
  await settle();
  const second = await post("/api/jobs", { artworkId, parentId: first.body.job.id, templateId: "light", params: {}, key: "second-key-2" });
  expect(second.status).toBe(201);
  const done = store.getJob(first.body.job.id)!;
  expect(second.body.job.baseId).toBe(done.resultId);
  await settle();
});

test("a failure is kept with its reason; retry is by hand and makes a new job", async () => {
  const { artworkId } = await artworkWithPhoto();
  answer = { ok: false, error: "no image produced", callId: 7 };
  const r = await post("/api/jobs", { artworkId, parentId: null, templateId: "free", params: { instruction: "加一只猫" }, key: "fail-key-1" });
  await settle();
  const failed = (await call(`/api/jobs/${r.body.job.id}`)).body.job;
  expect(failed).toMatchObject({ status: "failed", error: "no image produced", callId: 7 });
  expect(calls).toHaveLength(1);
  answer = { ok: true, image: png(32, 32), text: "ok" };
  const retry = await post(`/api/jobs/${failed.id}/retry`, { key: "retry-key-1" });
  expect(retry.status).toBe(201);
  expect(retry.body.job.params).toEqual({ instruction: "加一只猫" });
  await settle();
  expect(calls).toHaveLength(2);
  expect((await post(`/api/jobs/${retry.body.job.id}/retry`, { key: "retry-key-2" })).status).toBe(400);
});

test("a restart marks the running job for checking and never runs it again", async () => {
  const { artworkId } = await artworkWithPhoto();
  const { job } = store.createJob({ artworkId, parentId: null, baseId: store.getArtwork(artworkId)!.originalId, templateId: "light", templateVersion: 1, params: {}, extra: "", overlay: {}, prompt: "p", key: "boot-key-1" });
  store.markRunning(job.id);
  expect(store.recoverInterrupted()).toBe(1);
  expect(store.getJob(job.id)).toMatchObject({ status: "unknown" });
  await worker.kick();
  expect(calls).toHaveLength(0);
});

test("overlay words are edited without a model call and checked against the template", async () => {
  const { artworkId } = await artworkWithPhoto();
  const r = await post("/api/jobs", { artworkId, parentId: null, templateId: "postcard", params: { title: "京都", date: "2026.10.03" }, key: "card-key-1" });
  await settle();
  expect(calls[0]!.prompt).not.toContain("京都");
  const id = r.body.job.id;
  const ok = await call(`/api/jobs/${id}/overlay`, { method: "PATCH", body: JSON.stringify({ overlay: { title: "京都的秋天", place: "岚山", position: "top", junk: "x" } }) });
  expect(ok.body.job.overlay).toEqual({ title: "京都的秋天", place: "岚山", date: "", position: "top" });
  expect((await call(`/api/jobs/${id}/overlay`, { method: "PATCH", body: JSON.stringify({ overlay: { title: "长".repeat(40) } }) })).status).toBe(400);
  expect(calls).toHaveLength(1);
});

test("deleting an artwork removes only the files nothing else uses", async () => {
  const photo = png(80, 60);
  const a = await artworkWithPhoto(photo);
  const b = await artworkWithPhoto(photo);
  expect(a.assetId).toBe(b.assetId);
  await post("/api/jobs", { artworkId: a.artworkId, parentId: null, templateId: "cleanup", params: {}, key: "del-key-1" });
  await settle();
  const count = async () => (await readdir(join(dir, "blobs"), { recursive: true })).filter((f) => f.includes(".")).length;
  expect(await count()).toBe(2);
  expect((await call(`/api/artworks/${a.artworkId}`, { method: "DELETE" })).body.removedFiles).toBe(1);
  expect(await count()).toBe(1);
  expect((await fetch(`${base}/api/assets/${a.assetId}`)).status).toBe(200);
  expect((await call(`/api/artworks/${b.artworkId}`, { method: "DELETE" })).body.removedFiles).toBe(1);
  expect(await count()).toBe(0);
});

test("an artwork with a job in progress cannot be deleted", async () => {
  const { artworkId } = await artworkWithPhoto();
  let release!: () => void;
  hold = new Promise((r) => (release = r));
  await post("/api/jobs", { artworkId, parentId: null, templateId: "cleanup", params: {}, key: "busy-key-1" });
  expect((await call(`/api/artworks/${artworkId}`, { method: "DELETE" })).status).toBe(409);
  release();
  await settle();
});

test("uploads are checked: type, size, and EXIF-free storage", async () => {
  expect((await call("/api/assets", { method: "POST", body: "not an image" })).status).toBe(400);
  expect((await call("/api/assets", { method: "POST", body: new Uint8Array(2 * 1024 * 1024) })).status).toBe(400);
  expect((await post("/api/jobs", { artworkId: 999, parentId: null, templateId: "light", params: {}, key: "nope-key-1" })).status).toBe(404);
  const { artworkId } = await artworkWithPhoto();
  expect((await post("/api/jobs", { artworkId, parentId: null, templateId: "light", params: {} })).status).toBe(400);
  expect((await post("/api/jobs", { artworkId, parentId: null, templateId: "nope", params: {}, key: "nope-key-2" })).status).toBe(400);
});

test("not connected to ai-space: jobs are refused with the reason", async () => {
  const s2 = Bun.serve({ port: 0, routes: createRoutes({ store, worker, maxUploadBytes: 1024 * 1024, ready: () => ({ ok: false, reason: "未接入 ai-space" }) }), fetch: () => new Response("nf", { status: 404 }) });
  try {
    const { artworkId } = await artworkWithPhoto();
    const r = await fetch(`http://127.0.0.1:${s2.port}/api/jobs`, { method: "POST", body: JSON.stringify({ artworkId, parentId: null, templateId: "light", params: {}, key: "ready-key-1" }) });
    expect(r.status).toBe(503);
    expect(((await r.json()) as { error: string }).error).toBe("未接入 ai-space");
    expect(((await (await fetch(`http://127.0.0.1:${s2.port}/api/status`)).json()) as { ready: boolean }).ready).toBe(false);
  } finally {
    s2.stop(true);
  }
});

test("widget lists recent works", async () => {
  const { artworkId } = await artworkWithPhoto();
  const { body } = await call("/api/widget");
  expect(body.items[0]).toMatchObject({ text: `作品 #${artworkId} · 0 个版本`, url: `/#/a/${artworkId}` });
});
