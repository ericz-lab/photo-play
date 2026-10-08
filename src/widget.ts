/**
 * The panel card `recent` (ai-space docs/app-spec.md, "widgets"): the list of recent works,
 * unchanged for older panels, plus state blocks. The hero is the work touched last; then the
 * queue when something is being made, failed versions not yet followed by a good one,
 * the versions finished each day, the totals, and the next works. Every value is read from the
 * database; nothing is estimated.
 */
import type { Store } from "./db.ts";
import type { Artwork } from "./types.ts";

type Text = string | { en: string; zh: string };
type Block = Record<string, unknown> & { type: string; label: Text };

export const TREND_DAYS = 14;
/** The card is refreshed every 2 minutes; a few misses mark it out of date. */
export const STALE_AFTER_S = 600;
const DAY_MS = 86_400_000;

/** The calendar day of `d` in `timeZone`, as YYYY-MM-DD. */
const dayOf = (d: Date, timeZone?: string) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/** Versions finished on each of the last `days` days (oldest first), by the service's time zone. */
export function versionsPerDay(store: Store, now: Date, days = TREND_DAYS, timeZone?: string): { t: string; v: number }[] {
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i--) keys.push(dayOf(new Date(now.getTime() - i * DAY_MS), timeZone));
  const counts = new Map<string, number>(keys.map((k) => [k, 0]));
  // A day can be 23-25 hours; one extra day of rows is filtered by key below.
  const since = new Date(now.getTime() - (days + 1) * DAY_MS).toISOString();
  const rows = store.db.query("SELECT finished_at AS at FROM jobs WHERE status = 'done' AND finished_at >= ?").all(since) as { at: string }[];
  for (const r of rows) {
    const k = dayOf(new Date(r.at), timeZone);
    if (counts.has(k)) counts.set(k, counts.get(k)! + 1);
  }
  return keys.map((t) => ({ t, v: counts.get(t)! }));
}

type Counts = { works: number; versions: number; pending: number; oldestPending: string | null; failed: number };

function counts(store: Store, since: string): Counts {
  const q = <T>(sql: string, ...args: string[]) => store.db.query(sql).get(...args) as T;
  const pending = q<{ n: number; at: string | null }>("SELECT COUNT(*) AS n, MIN(created_at) AS at FROM jobs WHERE status IN ('queued', 'running')");
  return {
    works: q<{ n: number }>("SELECT COUNT(*) AS n FROM artworks").n,
    versions: q<{ n: number }>("SELECT COUNT(*) AS n FROM jobs WHERE status = 'done'").n,
    pending: pending.n,
    oldestPending: pending.at,
    // A failed version counts until a later version of the same work is made.
    failed: q<{ n: number }>(
      `SELECT COUNT(*) AS n FROM jobs f WHERE f.status IN ('failed', 'unknown') AND f.created_at >= ?
         AND NOT EXISTS (SELECT 1 FROM jobs d WHERE d.artwork_id = f.artwork_id AND d.id > f.id AND d.status = 'done')`,
      since,
    ).n,
  };
}

export type WorkView = { title: string; versions: number; pending: number };

export function widgetPayload(store: Store, view: (a: Artwork) => WorkView, publicBase: string, now = new Date(), timeZone?: string) {
  const works = store.listArtworks({ limit: 20 }).map((a) => ({ a, v: view(a) }));
  // The list, as it always was: newest first.
  const items = works.map(({ a, v }) => ({
    text: `${v.title || `作品 #${a.id}`} · ${v.versions} 个版本${v.pending ? `，${v.pending} 个生成中` : ""}`,
    url: `${publicBase}/#/a/${a.id}`,
    time: a.updatedAt,
  }));

  const blocks: Block[] = [];
  const work = ({ a, v }: (typeof works)[number], label: Text): Block => ({
    type: "status",
    label,
    value: v.title ? v.title.slice(0, 80) : { en: `Work #${a.id}`, zh: `作品 #${a.id}` },
    caption: { en: `${v.versions} version${v.versions === 1 ? "" : "s"}${v.pending ? `, ${v.pending} in progress` : ""}`, zh: `${v.versions} 个版本${v.pending ? `，${v.pending} 个生成中` : ""}` },
    time: a.updatedAt,
    url: `/#/a/${a.id}`,
    tone: "neutral",
  });

  const [last, ...rest] = works;
  if (!last) {
    blocks.push({ type: "status", label: { en: "Works", zh: "作品" }, value: { en: "No works yet", zh: "还没有作品" }, caption: { en: "Upload a photo to start", zh: "上传一张照片开始" }, url: "/" });
    return { ok: true as const, items, asOf: now.toISOString(), staleAfter: STALE_AFTER_S, blocks };
  }

  const c = counts(store, new Date(now.getTime() - TREND_DAYS * DAY_MS).toISOString());
  blocks.push(work(last, { en: "Latest work", zh: "最近作品" }));
  if (c.pending) {
    blocks.push({ type: "status", label: { en: "Generating", zh: "生成中" }, value: { en: `${c.pending} in the queue`, zh: `队列中 ${c.pending} 个` }, time: c.oldestPending ?? undefined, tone: "neutral" });
  }
  if (c.failed) {
    blocks.push({
      type: "metric",
      label: { en: "Needs a retry", zh: "待重试" },
      caption: { en: `Failed or cut off in the last ${TREND_DAYS} days, nothing made since`, zh: `近 ${TREND_DAYS} 天失败或中断，之后未再出片` },
      value: c.failed,
      unit: { en: "versions", zh: "个" },
      tone: "warning",
    });
  }
  blocks.push({
    type: "trend",
    style: "bar",
    label: { en: `Versions, last ${TREND_DAYS} days`, zh: `近 ${TREND_DAYS} 天出片` },
    caption: { en: "Versions finished per day", zh: "每天完成的版本数" },
    unit: { en: "versions", zh: "个" },
    points: versionsPerDay(store, now, TREND_DAYS, timeZone),
  });
  blocks.push({ type: "metric", label: { en: "Works", zh: "作品总数" }, value: c.works, caption: { en: `${c.versions} versions in all`, zh: `共 ${c.versions} 个版本` }, url: "/" });
  for (const w of rest.slice(0, 4)) blocks.push(work(w, { en: "Work", zh: "作品" }));

  return { ok: true as const, items, asOf: now.toISOString(), staleAfter: STALE_AFTER_S, blocks };
}
