import { Conflict, NotFound, type Store } from "./db.ts";
import { ready as defaultReady } from "./model.ts";
import { buildPrompt, cleanParams, overlayOf, publicTemplates, template } from "./templates.ts";
import type { Asset, Job } from "./types.ts";
import type { Worker } from "./worker.ts";

/**
 * The HTTP API the page uses. Page routes trust loopback: the space's edge
 * holds the login, and nothing here is public. Every change of state that
 * costs a model call is a job, created once per idempotency key.
 */

export type AppDeps = {
  store: Store;
  worker: Worker;
  maxUploadBytes: number;
  publicBase?: string;
  ready?: () => { ok: boolean; reason?: string };
};

type Req = Request & { params: Record<string, string> };
type Handler = (req: Req) => Response | Promise<Response>;
export type Routes = Record<string, Handler | Partial<Record<"GET" | "POST" | "PUT" | "PATCH" | "DELETE", Handler>>>;

const KEY = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_THUMB_BYTES = 400 * 1024;

export function createRoutes(deps: AppDeps): Routes {
  const { store, worker } = deps;
  const ready = deps.ready ?? defaultReady;

  const assetView = (a: Asset | null) => a && { id: a.id, type: a.type, width: a.width, height: a.height, bytes: a.bytes, url: `/api/assets/${a.id}`, thumbUrl: a.thumbId ? `/api/assets/${a.thumbId}` : null };
  const jobView = (j: Job) => {
    const t = template(j.templateId);
    return {
      ...j,
      templateName: t?.name ?? j.templateId,
      overlayStyle: t?.overlay ?? "none",
      result: assetView(j.resultId ? store.getAsset(j.resultId) : null),
      ahead: j.status === "queued" ? store.aheadOf(j.id) : 0,
    };
  };
  const artworkView = (id: number) => {
    const art = store.getArtwork(id);
    if (!art) return null;
    const jobs = store.jobsOf(id);
    const lastDone = [...jobs].reverse().find((j) => j.status === "done" && j.resultId);
    const original = store.getAsset(art.originalId);
    return {
      ...art,
      original: assetView(original),
      cover: assetView(lastDone ? store.getAsset(lastDone.resultId!) : original),
      versions: jobs.filter((j) => j.status === "done").length,
      pending: jobs.filter((j) => j.status === "queued" || j.status === "running").length,
      templates: [...new Set(jobs.map((j) => j.templateId))],
    };
  };
  const idOf = (req: Req) => {
    const n = Number(req.params.id);
    if (!Number.isSafeInteger(n) || n <= 0) throw new BadRequest("id 不正确");
    return n;
  };

  /** Create the job, or return the one this key already made, and start the worker. */
  const submit = (input: { artworkId: number; parentId: number | null; templateId: string; params: unknown; extra: unknown; key: unknown }) => {
    if (typeof input.key !== "string" || !KEY.test(input.key)) throw new BadRequest("缺少提交标识 key");
    const art = store.getArtwork(input.artworkId);
    if (!art) throw new NotFound("作品不存在");
    const t = template(input.templateId);
    if (!t) throw new BadRequest("没有这个玩法");
    let baseId = art.originalId;
    if (input.parentId !== null) {
      const parent = store.getJob(input.parentId);
      if (!parent || parent.artworkId !== art.id) throw new BadRequest("基础版本不属于这个作品");
      if (parent.status !== "done" || !parent.resultId) throw new BadRequest("基础版本还没有生成成功");
      baseId = parent.resultId;
    }
    const r = ready();
    if (!r.ok) throw new Unavailable(r.reason ?? "暂时无法生成");
    let params;
    try {
      params = cleanParams(t, input.params);
    } catch (e) {
      throw new BadRequest((e as Error).message);
    }
    const extra = typeof input.extra === "string" ? input.extra.replace(/\s+/g, " ").trim() : "";
    if (extra.length > 300) throw new BadRequest("补充要求最多 300 个字");
    const { job, created } = store.createJob({ artworkId: art.id, parentId: input.parentId, baseId, templateId: t.id, templateVersion: t.version, params, extra, overlay: overlayOf(t, params), prompt: buildPrompt(t, params, extra), key: input.key });
    void worker.kick();
    return json({ ok: true, created, job: jobView(store.getJob(job.id)!) }, created ? 201 : 200);
  };

  return {
    "/healthz": () => new Response("ok"),

    "/api/status": { GET: () => { const r = ready(); return json({ ok: true, ready: r.ok, reason: r.reason ?? null, working: worker.running }); } },

    "/api/templates": { GET: () => json({ ok: true, templates: publicTemplates() }) },

    "/api/assets": {
      POST: wrap(async (req) => {
        const bytes = new Uint8Array(await req.arrayBuffer());
        if (!bytes.length) throw new BadRequest("没有收到图片");
        if (bytes.length > deps.maxUploadBytes) throw new BadRequest(`图片超过 ${Math.round(deps.maxUploadBytes / 1024 / 1024)} MB`);
        const a = await store.putAsset(bytes, "upload").catch((e) => { throw new BadRequest((e as Error).message); });
        return json({ ok: true, asset: assetView(a) }, 201);
      }),
    },

    "/api/assets/:id": {
      GET: wrap(async (req) => {
        const a = store.getAsset(idOf(req));
        if (!a) throw new NotFound("图片不存在");
        const headers: Record<string, string> = { "content-type": a.type, "cache-control": "private, max-age=31536000, immutable" };
        const name = new URL(req.url).searchParams.get("name");
        if (name !== null) headers["content-disposition"] = `attachment; filename="${(name.replace(/[^A-Za-z0-9._-]/g, "") || `photo-${a.id}`)}.${a.file.split(".").pop()}"`;
        return new Response(Bun.file(store.assetPath(a)), { headers });
      }),
    },

    // The page draws a small copy after it shows a picture: the service has no image library to do it.
    "/api/assets/:id/thumb": {
      PUT: wrap(async (req) => {
        const a = store.getAsset(idOf(req));
        if (!a) throw new NotFound("图片不存在");
        if (a.kind === "thumb") throw new BadRequest("缩略图不能再有缩略图");
        const bytes = new Uint8Array(await req.arrayBuffer());
        if (!bytes.length || bytes.length > MAX_THUMB_BYTES) throw new BadRequest("缩略图大小不合适");
        const t = await store.putAsset(bytes, "thumb").catch((e) => { throw new BadRequest((e as Error).message); });
        if (Math.max(t.width, t.height) > 800) throw new BadRequest("缩略图太大");
        store.setThumb(a.id, t.id);
        return json({ ok: true, thumb: assetView(t) });
      }),
    },

    "/api/artworks": {
      GET: wrap((req) => {
        const q = new URL(req.url).searchParams;
        const tpl = q.get("template") || undefined;
        return json({ ok: true, artworks: store.listArtworks({ template: tpl }).map((a) => artworkView(a.id)) });
      }),
      POST: wrap(async (req) => {
        const body = await readJson(req);
        const assetId = Number(body.assetId);
        const a = Number.isSafeInteger(assetId) ? store.getAsset(assetId) : null;
        if (!a || a.kind !== "upload") throw new BadRequest("请先上传一张照片");
        const title = typeof body.title === "string" ? body.title.trim().slice(0, 60) : "";
        return json({ ok: true, artwork: artworkView(store.createArtwork(a.id, title).id) }, 201);
      }),
    },

    "/api/artworks/:id": {
      GET: wrap((req) => {
        const view = artworkView(idOf(req));
        if (!view) throw new NotFound("作品不存在");
        return json({ ok: true, artwork: view, jobs: store.jobsOf(view.id).map(jobView) });
      }),
      PATCH: wrap(async (req) => {
        const id = idOf(req);
        if (!store.getArtwork(id)) throw new NotFound("作品不存在");
        const body = await readJson(req);
        if (typeof body.title !== "string") throw new BadRequest("title 应为文字");
        store.renameArtwork(id, body.title.trim().slice(0, 60));
        return json({ ok: true, artwork: artworkView(id) });
      }),
      DELETE: wrap(async (req) => json({ ok: true, ...(await store.deleteArtwork(idOf(req))) })),
    },

    "/api/jobs": {
      POST: wrap(async (req) => {
        const body = await readJson(req);
        const parentId = body.parentId === null || body.parentId === undefined ? null : Number(body.parentId);
        return submit({ artworkId: Number(body.artworkId), parentId, templateId: String(body.templateId ?? ""), params: body.params, extra: body.extra, key: body.key });
      }),
    },

    "/api/jobs/:id": {
      GET: wrap((req) => {
        const j = store.getJob(idOf(req));
        if (!j) throw new NotFound("任务不存在");
        return json({ ok: true, job: jobView(j) });
      }),
    },

    // Manual retry of a failed or unconfirmed job: a new job with the same inputs, under the page's new key.
    "/api/jobs/:id/retry": {
      POST: wrap(async (req) => {
        const j = store.getJob(idOf(req));
        if (!j) throw new NotFound("任务不存在");
        if (j.status !== "failed" && j.status !== "unknown") throw new BadRequest("只有失败或待核对的任务可以重试");
        const body = await readJson(req);
        return submit({ artworkId: j.artworkId, parentId: j.parentId, templateId: j.templateId, params: { ...j.params, ...j.overlay }, extra: j.extra, key: body.key });
      }),
    },

    "/api/jobs/:id/overlay": {
      PATCH: wrap(async (req) => {
        const j = store.getJob(idOf(req));
        if (!j) throw new NotFound("任务不存在");
        const t = template(j.templateId);
        if (!t || t.overlay === "none") throw new BadRequest("这个玩法没有文字排版");
        const body = await readJson(req);
        const raw = body.overlay && typeof body.overlay === "object" ? (body.overlay as Record<string, unknown>) : {};
        const overlay: Record<string, string> = {};
        for (const p of t.params) {
          if (p.kind === "select" || p.kind === "range" || !p.overlay) continue;
          const v = String(raw[p.key] ?? "").replace(/\s+/g, " ").trim();
          if (v.length > p.maxLength) throw new BadRequest(`${p.label}：最多 ${p.maxLength} 个字`);
          overlay[p.key] = v;
        }
        for (const k of ["position", "scale"]) if (typeof raw[k] === "string" && /^[a-z0-9.-]{1,16}$/.test(raw[k] as string)) overlay[k] = raw[k] as string;
        store.setOverlay(j.id, overlay);
        return json({ ok: true, job: jobView(store.getJob(j.id)!) });
      }),
    },

    "/api/widget": {
      GET: () => {
        try {
          const base = deps.publicBase ?? "";
          const items = store.listArtworks({ limit: 20 }).map((a) => {
            const v = artworkView(a.id)!;
            const label = v.title || `作品 #${a.id}`;
            return { text: `${label} · ${v.versions} 个版本${v.pending ? `，${v.pending} 个生成中` : ""}`, url: `${base}/#/a/${a.id}`, time: a.updatedAt };
          });
          return json({ ok: true, items });
        } catch (e) {
          return json({ ok: false, error: (e as Error).message });
        }
      },
    },
  };
}

class BadRequest extends Error {}
class Unavailable extends Error {}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new BadRequest("请求体应为 JSON 对象");
  return body as Record<string, unknown>;
}

function wrap(h: Handler): Handler {
  return async (req) => {
    try {
      return await h(req);
    } catch (e) {
      const status = e instanceof BadRequest ? 400 : e instanceof NotFound ? 404 : e instanceof Conflict ? 409 : e instanceof Unavailable ? 503 : 500;
      if (status === 500) console.error("[photo-play]", e);
      return json({ ok: false, error: (e as Error).message }, status);
    }
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}
