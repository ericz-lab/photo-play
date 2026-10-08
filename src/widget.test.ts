import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "./db.ts";
import { png } from "./testing.ts";
import type { Artwork } from "./types.ts";
import { STALE_AFTER_S, TREND_DAYS, versionsPerDay, widgetPayload } from "./widget.ts";

const TZ = "Asia/Seoul";
const NOW = new Date("2026-10-08T02:00:00Z"); // 11:00 on Oct 8 in Seoul
let clock = "";
const dirs: string[] = [];

async function store() {
  const dir = await mkdtemp(join(tmpdir(), "photo-play-widget-"));
  dirs.push(dir);
  return new Store(":memory:", join(dir, "blobs"), () => clock);
}

afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

let keyN = 0;
function version(s: Store, artworkId: number, baseId: number, at: string, status: "done" | "failed" | "unknown" | "queued", finishedAt = at) {
  clock = at;
  const { job } = s.createJob({ artworkId, parentId: null, baseId, templateId: "light", templateVersion: 1, params: {}, extra: "", overlay: {}, prompt: "p", key: `key-${++keyN}-xxxx` });
  if (status === "queued") return job;
  clock = finishedAt;
  s.finishJob(job.id, status, status === "done" ? { resultId: baseId } : { error: "x" });
  return job;
}

/** What the routes report for a work, recomputed from the jobs here. */
const view = (s: Store) => (a: Artwork) => {
  const jobs = s.jobsOf(a.id);
  return { title: a.title, versions: jobs.filter((j) => j.status === "done").length, pending: jobs.filter((j) => j.status === "queued" || j.status === "running").length };
};

async function seed() {
  const s = await store();
  clock = "2026-09-20T00:00:00Z";
  const photo = await s.putAsset(png(64, 48), "upload");
  const a = s.createArtwork(photo.id, "上线自测");
  version(s, a.id, photo.id, "2026-09-29T16:16:00Z", "unknown"); // followed by a good version: settled
  version(s, a.id, photo.id, "2026-09-29T16:17:00Z", "done", "2026-09-29T16:19:00Z");
  clock = "2026-09-30T02:50:00Z";
  const b = s.createArtwork(photo.id);
  version(s, b.id, photo.id, "2026-09-30T02:52:00Z", "done", "2026-09-30T02:54:00Z");
  version(s, b.id, photo.id, "2026-10-07T15:10:00Z", "done", "2026-10-07T15:12:00Z"); // Oct 8, 00:12 in Seoul
  version(s, b.id, photo.id, "2026-10-07T16:00:00Z", "failed"); // nothing since: needs a retry
  return { s, a, b, photo };
}

describe("widget", () => {
  test("versions per day count finished versions by local day, zeros where none finished", async () => {
    const { s } = await seed();
    const pts = versionsPerDay(s, NOW, TREND_DAYS, TZ);
    expect(pts).toHaveLength(TREND_DAYS);
    expect(pts[0]?.t).toBe("2026-09-25");
    expect(pts.at(-1)).toEqual({ t: "2026-10-08", v: 1 });
    const by = Object.fromEntries(pts.map((p) => [p.t, p.v]));
    expect(by["2026-09-30"]).toBe(2); // 01:19 and 11:54 in Seoul
    expect(by["2026-10-07"]).toBe(0);
    expect(pts.reduce((n, p) => n + p.v, 0)).toBe(3);
  });

  test("payload keeps the list and adds blocks: latest work, retry, trend, totals, next works", async () => {
    const { s, a, b } = await seed();
    const w = widgetPayload(s, view(s), "https://photo.test", NOW, TZ);
    expect(w.ok).toBe(true);
    expect(w.asOf).toBe(NOW.toISOString());
    expect(w.staleAfter).toBe(STALE_AFTER_S);
    expect(w.items).toEqual([
      { text: `作品 #${b.id} · 2 个版本`, url: `https://photo.test/#/a/${b.id}`, time: "2026-10-07T16:00:00Z" },
      { text: "上线自测 · 1 个版本", url: `https://photo.test/#/a/${a.id}`, time: "2026-09-29T16:19:00Z" },
    ]);
    expect(w.blocks.map((x) => x.type)).toEqual(["status", "metric", "trend", "metric", "status"]);
    expect(w.blocks[0]).toMatchObject({ value: { en: `Work #${b.id}` }, caption: { en: "2 versions" }, url: `/#/a/${b.id}`, time: "2026-10-07T16:00:00Z" });
    expect(w.blocks[1]).toMatchObject({ label: { en: "Needs a retry" }, value: 1, tone: "warning" });
    expect(w.blocks[2]).toMatchObject({ style: "bar", points: versionsPerDay(s, NOW, TREND_DAYS, TZ) });
    expect(w.blocks[3]).toMatchObject({ label: { en: "Works" }, value: 2, caption: { en: "3 versions in all" } });
    expect(w.blocks[4]).toMatchObject({ value: "上线自测", caption: { en: "1 version" } });
  });

  test("a queued version shows as generating, and a later good version clears the retry", async () => {
    const { s, b, photo } = await seed();
    version(s, b.id, photo.id, "2026-10-08T01:00:00Z", "done", "2026-10-08T01:01:00Z");
    version(s, b.id, photo.id, "2026-10-08T01:50:00Z", "queued");
    const w = widgetPayload(s, view(s), "", NOW, TZ);
    expect(w.blocks.map((x) => x.type)).toEqual(["status", "status", "trend", "metric", "status"]);
    expect(w.blocks[0]).toMatchObject({ caption: { en: "3 versions, 1 in progress" } });
    expect(w.blocks[1]).toMatchObject({ label: { en: "Generating" }, value: { en: "1 in the queue" }, time: "2026-10-08T01:50:00Z" });
  });

  test("no works: one compact status", async () => {
    const s = await store();
    const w = widgetPayload(s, view(s), "", NOW, TZ);
    expect(w.items).toEqual([]);
    expect(w.blocks).toHaveLength(1);
    expect(w.blocks[0]).toMatchObject({ type: "status", value: { en: "No works yet" }, url: "/" });
  });
});
