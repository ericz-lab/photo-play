/**
 * The page: home (upload, effects, recent works), the editor of one artwork
 * (versions, compare, text overlay, download, a new edit) and the gallery.
 * Hash routes, no framework. Everything that costs a model call is a job on
 * the server; the page only polls it, so closing the tab loses nothing.
 */

type Param =
  | { key: string; label: string; kind: "select"; options: { value: string; label: string }[]; default: string }
  | { key: string; label: string; kind: "range"; min: number; max: number; labels: string[]; default: number }
  | { key: string; label: string; kind: "text" | "textarea"; maxLength: number; placeholder?: string; default?: string; required?: boolean; overlay?: boolean };
type Template = { id: string; version: number; name: string; summary: string; badge: string; overlay: "none" | "postcard" | "annotate"; params: Param[] };
type AssetView = { id: number; type: string; width: number; height: number; bytes: number; url: string; thumbUrl: string | null };
type Usage = { inputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; outputTokens: number };
type JobView = {
  id: number; artworkId: number; parentId: number | null; baseId: number; templateId: string; templateName: string; overlayStyle: Template["overlay"];
  params: Record<string, string | number>; extra: string; overlay: Record<string, string>; status: "queued" | "running" | "done" | "failed" | "unknown";
  result: AssetView | null; text: string | null; model: string | null; runtime: string | null; callId: number | null; usage: Usage | null; error: string | null;
  createdAt: string; startedAt: string | null; finishedAt: string | null; ahead: number;
};
type ArtworkView = { id: number; title: string; originalId: number; createdAt: string; updatedAt: string; original: AssetView; cover: AssetView; versions: number; pending: number; templates: string[] };

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
const view = $("#view");
const picker = $<HTMLInputElement>("#picker");

let templates: Template[] = [];
let status: { ready: boolean; reason: string | null } = { ready: true, reason: null };
/** The effect picked on the home page before the photo, handed to the editor. */
let pendingTemplate: string | null = null;
let stopPolling: (() => void) | null = null;

// ------------------------------------------------------------------ helpers

async function api<T = Record<string, unknown>>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { ...init, headers: init.body && !(init.body instanceof Blob) ? { "content-type": "application/json", ...init.headers } : init.headers });
  const body = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  if (!res.ok || body.ok === false) throw new Error(body.error || `HTTP ${res.status}`);
  return body as T;
}

function h(tag: string, attrs: Record<string, unknown> = {}, ...children: (Node | string | null | undefined | false)[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v as EventListener);
    else if (k === "class") el.className = String(v);
    else if (k === "html") el.innerHTML = String(v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(text: string, kind: "ok" | "error" = "ok") {
  const t = $("#toast");
  t.textContent = text;
  t.className = `toast ${kind}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), kind === "error" ? 6000 : 2500);
}

function busy(text: string | null) {
  $("#busy").hidden = text === null;
  if (text) $("#busy-text").textContent = text;
}

const key = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).replace(/[^A-Za-z0-9-]/g, "").slice(0, 40);
const when = (iso: string) => new Date(iso).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const seconds = (a: string | null, b: string | null) => (a && b ? Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 1000)) : null);
const thumb = (a: AssetView) => a.thumbUrl ?? a.url;
const tpl = (id: string) => templates.find((t) => t.id === id);

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片加载失败"));
    img.src = src;
  });
}

// ------------------------------------------------------------------ upload

/** Decode, turn upright, fit into 2048 px and re-encode as JPEG: drops EXIF and stays under the 5 MB the model takes. */
async function prepare(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("这张图片无法读取，请换成 JPEG 或 PNG");
  }
  const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const q of [0.9, 0.8, 0.7, 0.6]) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", q));
    if (blob && blob.size < 4.5 * 1024 * 1024) return blob;
  }
  throw new Error("图片压缩后仍然过大");
}

async function upload(file: File) {
  busy("正在准备照片…");
  try {
    const blob = await prepare(file);
    busy("正在上传…");
    const { asset } = await api<{ asset: AssetView }>("/api/assets", { method: "POST", body: blob });
    const { artwork } = await api<{ artwork: ArtworkView }>("/api/artworks", { method: "POST", body: JSON.stringify({ assetId: asset.id }) });
    location.hash = `#/a/${artwork.id}`;
  } catch (e) {
    toast((e as Error).message, "error");
  } finally {
    busy(null);
    picker.value = "";
  }
}

picker.addEventListener("change", () => {
  const f = picker.files?.[0];
  if (f) void upload(f);
});

function openPicker(templateId: string | null = null) {
  pendingTemplate = templateId;
  picker.click();
}

/** The page makes the small copies the gallery shows: the service has no image library. */
const thumbed = new Set<number>();
async function ensureThumb(a: AssetView, img: HTMLImageElement) {
  if (a.thumbUrl || thumbed.has(a.id)) return;
  thumbed.add(a.id);
  const scale = Math.min(1, 480 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.8));
  if (blob) await fetch(`/api/assets/${a.id}/thumb`, { method: "PUT", body: blob }).catch(() => {});
}

// ------------------------------------------------------------------ overlay

const FONT_TITLE = '"Noto Serif SC", "Songti SC", serif';
const FONT_HAND = '"Ma Shan Zheng", "Kaiti SC", cursive';

/** The exact words over the picture: drawn here, never by the model, so they can be fixed for free. */
async function drawOverlay(ctx: CanvasRenderingContext2D, w: number, hgt: number, style: Template["overlay"], o: Record<string, string>) {
  if (style === "none") return;
  const s = (Math.min(w, hgt) / 1000) * Number(o.scale || 1);
  const shadow = (blur: number) => { ctx.shadowColor = "rgba(0,0,0,.45)"; ctx.shadowBlur = blur * s; ctx.shadowOffsetY = 2 * s; };
  if (style === "postcard") {
    const title = o.title ?? "";
    const sub = [o.place, o.date].filter(Boolean).join("  ·  ");
    if (!title && !sub) return;
    await document.fonts.load(`700 ${Math.round(80 * s)}px ${FONT_TITLE}`, title + sub).catch(() => {});
    const top = o.position === "top";
    const band = 230 * s;
    const g = ctx.createLinearGradient(0, top ? 0 : hgt - band * 1.4, 0, top ? band * 1.4 : hgt);
    g.addColorStop(top ? 0 : 1, "rgba(0,0,0,.45)");
    g.addColorStop(top ? 1 : 0, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, top ? 0 : hgt - band * 1.4, w, band * 1.4);
    ctx.fillStyle = "#fff";
    ctx.textBaseline = "alphabetic";
    shadow(8);
    const x = 60 * s;
    const titleY = top ? 120 * s : hgt - (sub ? 110 : 60) * s;
    ctx.font = `700 ${Math.round(80 * s)}px ${FONT_TITLE}`;
    ctx.fillText(title, x, titleY, w - 2 * x);
    if (sub) {
      ctx.font = `500 ${Math.round(34 * s)}px ${FONT_TITLE}`;
      ctx.letterSpacing = `${Math.round(4 * s)}px`;
      ctx.fillText(sub, x + 4 * s, titleY + 62 * s, w - 2 * x);
      ctx.letterSpacing = "0px";
    }
  } else {
    const swap = o.position === "swap";
    await document.fonts.load(`${Math.round(90 * s)}px ${FONT_HAND}`, (o.title ?? "") + (o.note ?? "")).catch(() => {});
    const hand = (text: string, size: number, x: number, y: number, align: CanvasTextAlign, angle: number) => {
      if (!text) return;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.font = `${Math.round(size * s)}px ${FONT_HAND}`;
      ctx.textAlign = align;
      ctx.lineJoin = "round";
      ctx.lineWidth = 8 * s;
      ctx.strokeStyle = "rgba(20,20,20,.55)";
      shadow(4);
      ctx.strokeText(text, 0, 0, w * 0.8);
      ctx.shadowColor = "transparent";
      ctx.fillStyle = "#fff";
      ctx.fillText(text, 0, 0, w * 0.8);
      ctx.restore();
    };
    const [a, b] = swap ? [o.note ?? "", o.title ?? ""] : [o.title ?? "", o.note ?? ""];
    hand(a, swap ? 56 : 92, 60 * s, 130 * s, "left", -0.06);
    hand(b, swap ? 92 : 56, w - 60 * s, hgt - 70 * s, "right", -0.04);
  }
}

/** The picture of a version with its words on it, at full size. */
async function compose(job: JobView): Promise<HTMLCanvasElement> {
  const img = await loadImage(job.result!.url);
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  await drawOverlay(ctx, c.width, c.height, job.overlayStyle, job.overlay);
  void ensureThumb(job.result!, img);
  return c;
}

const hasWords = (j: JobView) => j.overlayStyle !== "none" && Object.entries(j.overlay).some(([k, v]) => k !== "position" && k !== "scale" && v);

// ------------------------------------------------------------------ home

async function renderHome() {
  view.replaceChildren(
    h("section", { class: "hero" },
      h("div", { class: "hero-text" },
        h("h1", {}, "把旅行照片，变成想发的那张"),
        h("p", {}, "上传一张照片，选个玩法，调几个参数。原图和每个版本都会保留，可以对比、继续改、随时下载。"),
      ),
      h("button", { class: "drop", id: "drop", onclick: () => openPicker() },
        h("span", { class: "drop-icon" }, "＋"),
        h("strong", {}, "上传照片"),
        h("span", { class: "muted" }, matchMedia("(pointer: fine)").matches ? "点击选择，或把照片拖到这里" : "从相册选择一张照片"),
      ),
    ),
    h("h2", { class: "section" }, "玩法"),
    h("div", { class: "effects" }, ...templates.map((t) =>
      h("button", { class: "effect", onclick: () => openPicker(t.id) },
        h("span", { class: "badge" }, t.badge),
        h("strong", {}, t.name),
        h("span", { class: "muted" }, t.summary),
      ))),
    h("div", { class: "section-row" }, h("h2", { class: "section" }, "最近作品"), h("a", { href: "#/works", class: "more" }, "全部 →")),
    h("div", { class: "grid", id: "recent" }, h("p", { class: "muted" }, "加载中…")),
  );
  const drop = $("#drop");
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("over");
    const f = (e as DragEvent).dataTransfer?.files?.[0];
    if (f) void upload(f);
  });
  try {
    const { artworks } = await api<{ artworks: ArtworkView[] }>("/api/artworks");
    $("#recent").replaceChildren(...(artworks.length ? artworks.slice(0, 6).map(card) : [h("p", { class: "muted empty" }, "还没有作品。上传第一张照片试试。")]));
  } catch (e) {
    $("#recent").replaceChildren(h("p", { class: "error" }, (e as Error).message));
  }
}

function card(a: ArtworkView): HTMLElement {
  return h("a", { class: "card", href: `#/a/${a.id}` },
    h("img", { src: thumb(a.cover), alt: "", loading: "lazy" }),
    h("div", { class: "card-meta" },
      h("strong", {}, a.title || when(a.createdAt)),
      h("span", { class: "muted" }, a.pending ? `${a.versions} 个版本 · ${a.pending} 个生成中` : `${a.versions} 个版本`),
    ),
  );
}

// ------------------------------------------------------------------ works

async function renderWorks(filter: string | null) {
  const chips = h("div", { class: "chips" },
    h("a", { class: `chip${filter ? "" : " on"}`, href: "#/works" }, "全部"),
    ...templates.map((t) => h("a", { class: `chip${filter === t.id ? " on" : ""}`, href: `#/works?t=${t.id}` }, `${t.badge} ${t.name}`)));
  const grid = h("div", { class: "grid" }, h("p", { class: "muted" }, "加载中…"));
  view.replaceChildren(h("h1", { class: "page-title" }, "作品"), chips, grid);
  try {
    const { artworks } = await api<{ artworks: ArtworkView[] }>(`/api/artworks${filter ? `?template=${filter}` : ""}`);
    grid.replaceChildren(...(artworks.length ? artworks.map(card) : [h("p", { class: "muted empty" }, "这里还没有作品。")]));
  } catch (e) {
    grid.replaceChildren(h("p", { class: "error" }, (e as Error).message));
  }
}

// ------------------------------------------------------------------ editor

type EditorState = {
  art: ArtworkView;
  jobs: JobView[];
  /** null: the original is shown. */
  selected: number | null;
  compare: boolean;
  templateId: string;
  /** Build on the original, or on the selected version. */
  fromSelected: boolean;
  submitKey: string;
  submitting: boolean;
};

async function renderEditor(id: number) {
  view.replaceChildren(h("p", { class: "muted pad" }, "加载中…"));
  let data: { artwork: ArtworkView; jobs: JobView[] };
  try {
    data = await api(`/api/artworks/${id}`);
  } catch (e) {
    view.replaceChildren(h("p", { class: "error pad" }, (e as Error).message), h("a", { href: "#/" }, "回到首页"));
    return;
  }
  const latest = [...data.jobs].reverse().find((j) => j.status !== "failed") ?? null;
  const st: EditorState = {
    art: data.artwork, jobs: data.jobs, selected: latest?.id ?? null, compare: false,
    templateId: pendingTemplate ?? latest?.templateId ?? templates[0]!.id, fromSelected: false, submitKey: key(), submitting: false,
  };
  pendingTemplate = null;

  const stage = h("div", { class: "stage" });
  const strip = h("div", { class: "strip" });
  const info = h("div", { class: "info" });
  const form = h("div", { class: "form" });
  const title = h("input", { class: "title-input", value: st.art.title, placeholder: "给作品起个名字", maxlength: 60 }) as HTMLInputElement;
  title.addEventListener("change", async () => {
    try { await api(`/api/artworks/${id}`, { method: "PATCH", body: JSON.stringify({ title: title.value }) }); toast("已保存"); } catch (e) { toast((e as Error).message, "error"); }
  });
  const del = h("button", { class: "link danger", onclick: async () => {
    if (!confirm("删除这个作品和它的全部版本？原图如果没有被别的作品使用，也会一并删除。")) return;
    try { await api(`/api/artworks/${id}`, { method: "DELETE" }); toast("已删除"); location.hash = "#/works"; } catch (e) { toast((e as Error).message, "error"); }
  } }, "删除作品");

  view.replaceChildren(h("div", { class: "editor" },
    h("div", { class: "left" }, stage, strip),
    h("div", { class: "right" }, title, info, form, h("div", { class: "foot" }, del)),
  ));

  const selectedJob = () => st.jobs.find((j) => j.id === st.selected) ?? null;
  const assetOf = (assetId: number): AssetView | null => assetId === st.art.original.id ? st.art.original : st.jobs.find((j) => j.result?.id === assetId)?.result ?? null;

  // The stage: the selected picture with its words, and the picture it was made from under a slider.
  let stageFor = "";
  async function drawStage() {
    const j = selectedJob();
    const sig = JSON.stringify([st.selected, st.compare, j?.status, j?.overlay]);
    if (sig === stageFor) return;
    stageFor = sig;
    if (!j || j.status !== "done" || !j.result) {
      const img = h("img", { src: st.art.original.url, alt: "原图" }) as HTMLImageElement;
      img.addEventListener("load", () => void ensureThumb(st.art.original, img), { once: true });
      const pendingNote = j && (j.status === "queued" || j.status === "running")
        ? h("div", { class: "stage-note" }, h("div", { class: "spinner small" }), j.status === "queued" ? (j.ahead ? `排队中，前面还有 ${j.ahead} 个` : "即将开始") : "正在生成，通常需要 1 到 3 分钟")
        : null;
      stage.replaceChildren(h("div", { class: "frame" }, img, pendingNote));
      return;
    }
    const canvas = await compose(j);
    if (sig !== stageFor) return;
    canvas.className = "result";
    const frame = h("div", { class: "frame", style: `aspect-ratio:${canvas.width}/${canvas.height}` }, canvas);
    if (st.compare) {
      const base = assetOf(j.baseId);
      const under = h("img", { class: "under", src: base?.url ?? st.art.original.url, alt: "修改前" });
      const range = h("input", { type: "range", min: 0, max: 100, value: 50, class: "compare-range", "aria-label": "对比" }) as HTMLInputElement;
      const setCut = () => (under.style.clipPath = `inset(0 ${100 - Number(range.value)}% 0 0)`);
      range.addEventListener("input", setCut);
      setCut();
      frame.append(under, h("span", { class: "tag left" }, "修改前"), h("span", { class: "tag right" }, "修改后"), range);
    }
    canvas.addEventListener("click", () => openLightbox(canvas));
    stage.replaceChildren(frame);
  }

  function drawStrip() {
    const item = (label: string, asset: AssetView | null, jobId: number | null, badge: string | null) =>
      h("button", { class: `ver${st.selected === jobId ? " on" : ""}`, onclick: () => { st.selected = jobId; st.fromSelected = jobId !== null; drawAll(); } },
        asset ? h("img", { src: thumb(asset), alt: "" }) : h("span", { class: "ver-empty" }, badge === "failed" ? "!" : badge === "unknown" ? "?" : "…"),
        h("span", {}, label));
    strip.replaceChildren(
      item("原图", st.art.original, null, null),
      ...st.jobs.map((j, i) => item(`${i + 1} ${tpl(j.templateId)?.badge ?? ""}`, j.result, j.id, j.status)),
    );
  }

  function drawInfo() {
    const j = selectedJob();
    if (!j) {
      info.replaceChildren(h("p", { class: "muted" }, `原图 · ${st.art.original.width}×${st.art.original.height}`), download(st.art.original, `photoplay-${id}-original`, "下载原图"));
      return;
    }
    const statusText = { queued: j.ahead ? `排队中（前面 ${j.ahead} 个）` : "排队中", running: "生成中", done: "已完成", failed: "失败", unknown: "待核对" }[j.status];
    const took = seconds(j.startedAt, j.finishedAt);
    const rows: (HTMLElement | null)[] = [
      h("div", { class: "info-head" }, h("strong", {}, `${tpl(j.templateId)?.badge ?? ""} ${j.templateName}`), h("span", { class: `pill ${j.status}` }, statusText)),
      h("p", { class: "muted small" }, `基于${j.parentId ? `版本 ${st.jobs.findIndex((x) => x.id === j.parentId) + 1}` : "原图"} · ${when(j.createdAt)}${took !== null ? ` · 用时 ${took} 秒` : ""}`),
      j.extra ? h("p", { class: "small" }, `补充要求：${j.extra}`) : null,
      j.error ? h("p", { class: "error small" }, j.error) : null,
      j.model ? h("p", { class: "muted small" }, `模型：${j.runtime ? `${j.runtime}/` : ""}${j.model}${j.usage ? ` · ${(j.usage.inputTokens + j.usage.cacheReadTokens).toLocaleString()} 输入 / ${j.usage.outputTokens.toLocaleString()} 输出 tokens` : ""} · 费用：未知${j.callId ? `（ai-space 账本 #${j.callId}）` : ""}`) : null,
    ];
    if (j.status === "failed" || j.status === "unknown") {
      rows.push(h("button", { class: "btn", onclick: async (e: Event) => {
        const b = e.currentTarget as HTMLButtonElement;
        b.disabled = true;
        try {
          const { job } = await api<{ job: JobView }>(`/api/jobs/${j.id}/retry`, { method: "POST", body: JSON.stringify({ key: key() }) });
          st.jobs.push(job);
          st.selected = job.id;
          drawAll();
          poll();
        } catch (err) { toast((err as Error).message, "error"); b.disabled = false; }
      } }, j.status === "unknown" ? "确认没有生成，手动重试" : "重试"));
    }
    if (j.status === "done" && j.result) {
      rows.push(h("div", { class: "row" },
        h("label", { class: "switch" }, (() => { const c = h("input", { type: "checkbox" }) as HTMLInputElement; c.checked = st.compare; c.addEventListener("change", () => { st.compare = c.checked; void drawStage(); }); return c; })(), " 和修改前对比"),
        h("button", { class: "link", onclick: () => window.open(j.result!.url, "_blank") }, "查看原尺寸"),
      ));
      if (j.overlayStyle !== "none") rows.push(overlayEditor(j));
      const actions = h("div", { class: "row" });
      if (hasWords(j)) {
        actions.append(h("button", { class: "btn primary", onclick: async () => {
          const c = await compose(j);
          c.toBlob((b) => b && save(b, `photoplay-${id}-v${j.id}.png`), "image/png");
        } }, "下载（含文字）"), download(j.result, `photoplay-${id}-v${j.id}-plain`, "下载无文字版"));
      } else actions.append(download(j.result, `photoplay-${id}-v${j.id}`, "下载", true));
      rows.push(actions);
    }
    info.replaceChildren(...rows.filter(Boolean) as HTMLElement[]);
  }

  function overlayEditor(j: JobView): HTMLElement {
    const t = tpl(j.templateId);
    const fields = (t?.params ?? []).filter((p) => p.kind === "text" && p.overlay) as Extract<Param, { maxLength: number }>[];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const saveOverlay = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          const { job } = await api<{ job: JobView }>(`/api/jobs/${j.id}/overlay`, { method: "PATCH", body: JSON.stringify({ overlay: j.overlay }) });
          Object.assign(j, { overlay: job.overlay });
        } catch (e) { toast((e as Error).message, "error"); }
      }, 500);
    };
    const set = (k: string, v: string) => { j.overlay = { ...j.overlay, [k]: v }; void drawStage(); saveOverlay(); };
    const positions = j.overlayStyle === "postcard" ? [["bottom", "底部"], ["top", "顶部"]] : [["default", "标题在左上"], ["swap", "标题在右下"]];
    return h("details", { class: "overlay-box", open: true },
      h("summary", {}, "文字排版（改字不用重新生成）"),
      ...fields.map((p) => {
        const input = h("input", { value: j.overlay[p.key] ?? "", maxlength: p.maxLength, placeholder: p.placeholder ?? "" }) as HTMLInputElement;
        input.addEventListener("input", () => set(p.key, input.value));
        return h("label", { class: "field" }, h("span", {}, p.label), input);
      }),
      h("div", { class: "row" },
        (() => {
          const sel = h("select", {}, ...positions.map(([v, l]) => h("option", { value: v!, selected: (j.overlay.position || positions[0]![0]) === v }, l!))) as HTMLSelectElement;
          sel.addEventListener("change", () => set("position", sel.value));
          return h("label", { class: "field inline" }, h("span", {}, "位置"), sel);
        })(),
        (() => {
          const r = h("input", { type: "range", min: 0.6, max: 1.6, step: 0.1, value: j.overlay.scale || 1 }) as HTMLInputElement;
          r.addEventListener("change", () => set("scale", r.value));
          return h("label", { class: "field inline" }, h("span", {}, "字号"), r);
        })(),
      ),
    );
  }

  function drawForm() {
    const t = tpl(st.templateId) ?? templates[0]!;
    const sel = selectedJob();
    const canBuild = !!sel && sel.status === "done";
    if (!canBuild) st.fromSelected = false;
    const values: Record<string, string | number> = {};
    const inputs = t.params.map((p) => {
      if (p.kind === "select") {
        values[p.key] = p.default;
        const s = h("select", {}, ...p.options.map((o) => h("option", { value: o.value, selected: o.value === p.default }, o.label))) as HTMLSelectElement;
        s.addEventListener("change", () => (values[p.key] = s.value));
        return h("label", { class: "field" }, h("span", {}, p.label), s);
      }
      if (p.kind === "range") {
        values[p.key] = p.default;
        const out = h("em", {}, p.labels[p.default - p.min]!);
        const r = h("input", { type: "range", min: p.min, max: p.max, step: 1, value: p.default }) as HTMLInputElement;
        r.addEventListener("input", () => { values[p.key] = Number(r.value); out.textContent = p.labels[Number(r.value) - p.min]!; });
        return h("label", { class: "field" }, h("span", {}, p.label, " ", out), r);
      }
      values[p.key] = p.default ?? "";
      const el = (p.kind === "textarea" ? h("textarea", { rows: 3, maxlength: p.maxLength, placeholder: p.placeholder ?? "" }, p.default ?? "") : h("input", { value: p.default ?? "", maxlength: p.maxLength, placeholder: p.placeholder ?? "" })) as HTMLInputElement;
      el.addEventListener("input", () => (values[p.key] = el.value));
      return h("label", { class: "field" }, h("span", {}, p.label, p.overlay ? h("small", { class: "muted" }, " · 由页面排版，可随时改") : null), el);
    });
    const extra = h("textarea", { rows: 2, maxlength: 300, placeholder: "可选：再补充一句要求" }) as HTMLTextAreaElement;
    const button = h("button", { class: "btn primary big", disabled: !status.ready || st.submitting }, st.submitting ? "提交中…" : "生成新版本") as HTMLButtonElement;
    button.addEventListener("click", async () => {
      if (st.submitting) return;
      st.submitting = true;
      button.disabled = true;
      button.textContent = "提交中…";
      try {
        const { job } = await api<{ job: JobView }>("/api/jobs", { method: "POST", body: JSON.stringify({
          artworkId: id, parentId: st.fromSelected && sel ? sel.id : null, templateId: t.id, params: values, extra: t.id === "free" ? "" : extra.value, key: st.submitKey,
        }) });
        if (!st.jobs.some((x) => x.id === job.id)) st.jobs.push(job);
        st.selected = job.id;
        st.submitKey = key();
        toast("已提交，生成完成后会自动显示");
        poll();
      } catch (e) {
        toast((e as Error).message, "error");
      } finally {
        st.submitting = false;
        drawAll();
      }
    });
    form.replaceChildren(...[
      h("h3", {}, "新的修改"),
      h("div", { class: "chips" }, ...templates.map((x) => h("button", { class: `chip${x.id === t.id ? " on" : ""}`, onclick: () => { st.templateId = x.id; st.submitKey = key(); drawForm(); } }, `${x.badge} ${x.name}`))),
      h("p", { class: "muted small" }, t.summary),
      ...inputs,
      t.id === "free" ? null : h("label", { class: "field" }, h("span", {}, "补充要求"), extra),
      h("div", { class: "base-choice" },
        h("span", {}, "基于"),
        h("label", {}, (() => { const r = h("input", { type: "radio", name: "base", checked: !st.fromSelected }) as HTMLInputElement; r.addEventListener("change", () => { st.fromSelected = false; }); return r; })(), " 原图"),
        h("label", { class: canBuild ? "" : "disabled" }, (() => { const r = h("input", { type: "radio", name: "base", checked: st.fromSelected, disabled: !canBuild }) as HTMLInputElement; r.addEventListener("change", () => { st.fromSelected = true; }); return r; })(), canBuild ? ` 当前版本 ${st.jobs.findIndex((x) => x.id === sel!.id) + 1}` : " 当前版本"),
      ),
      h("p", { class: "muted small" }, "输出 1 张 · 费用：未知（走 ai-space 的模型额度） · 原图和旧版本都会保留"),
      !status.ready ? h("p", { class: "error small" }, status.reason ?? "暂时无法生成") : null,
      button,
    ].filter((x): x is HTMLElement => !!x));
  }

  let formFor = "";
  function drawAll() {
    drawStrip();
    drawInfo();
    void drawStage();
    // The form keeps what the person typed unless what it depends on changed.
    const sel = selectedJob();
    const sig = JSON.stringify([st.templateId, st.selected, sel?.status, st.submitting]);
    if (sig !== formFor) { formFor = sig; drawForm(); }
  }

  function poll() {
    if (stopPolling) return;
    let alive = true;
    const tick = async () => {
      if (!alive) return;
      try {
        const fresh = await api<{ artwork: ArtworkView; jobs: JobView[] }>(`/api/artworks/${id}`);
        const before = JSON.stringify(st.jobs.map((j) => [j.id, j.status, j.ahead]));
        const was = new Map(st.jobs.map((j) => [j.id, j.status]));
        // Keep overlay edits made on the page since the last save.
        for (const j of fresh.jobs) { const old = st.jobs.find((x) => x.id === j.id); if (old && old.status === "done") j.overlay = old.overlay; }
        st.art = fresh.artwork;
        st.jobs = fresh.jobs;
        for (const j of fresh.jobs) {
          const prev = was.get(j.id);
          if (prev && prev !== j.status && j.status === "done") toast(`版本 ${fresh.jobs.indexOf(j) + 1} 生成好了`);
          if (prev && prev !== j.status && j.status === "failed") toast(`版本 ${fresh.jobs.indexOf(j) + 1} 生成失败`, "error");
        }
        if (JSON.stringify(st.jobs.map((j) => [j.id, j.status, j.ahead])) !== before) drawAll();
      } catch { /* keep polling */ }
      if (st.jobs.some((j) => j.status === "queued" || j.status === "running")) setTimeout(tick, 4000);
      else { alive = false; stopPolling = null; }
    };
    stopPolling = () => { alive = false; stopPolling = null; };
    setTimeout(tick, 2000);
  }

  drawAll();
  if (st.jobs.some((j) => j.status === "queued" || j.status === "running")) poll();
}

function download(a: AssetView, name: string, label: string, primary = false): HTMLElement {
  return h("a", { class: `btn${primary ? " primary" : ""}`, href: `${a.url}?name=${encodeURIComponent(name)}` }, label);
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function openLightbox(canvas: HTMLCanvasElement) {
  const box = $("#lightbox");
  const img = h("img", { src: canvas.toDataURL("image/jpeg", 0.92), alt: "" });
  box.replaceChildren(h("button", { class: "close", "aria-label": "关闭", onclick: () => (box.hidden = true) }, "×"), img);
  box.hidden = false;
  box.onclick = (e) => { if (e.target === box) box.hidden = true; };
}

// ------------------------------------------------------------------ routing

async function route() {
  stopPolling?.();
  $("#lightbox").hidden = true;
  const [path, query] = location.hash.replace(/^#/, "").split("?");
  const parts = (path || "/").split("/").filter(Boolean);
  for (const a of document.querySelectorAll<HTMLElement>("[data-nav]")) a.classList.toggle("on", a.dataset.nav === (parts[0] === "works" ? "works" : parts.length ? "" : "home"));
  window.scrollTo(0, 0);
  if (parts[0] === "a" && Number(parts[1])) return renderEditor(Number(parts[1]));
  if (parts[0] === "works") return renderWorks(new URLSearchParams(query).get("t"));
  return renderHome();
}

async function boot() {
  try {
    const [t, s] = await Promise.all([api<{ templates: Template[] }>("/api/templates"), api<{ ready: boolean; reason: string | null }>("/api/status")]);
    templates = t.templates;
    status = s;
    if (!s.ready) {
      const n = $("#notice");
      n.textContent = s.reason ?? "暂时无法生成";
      n.hidden = false;
    }
  } catch (e) {
    view.replaceChildren(h("p", { class: "error pad" }, `服务不可用：${(e as Error).message}`));
    return;
  }
  addEventListener("hashchange", () => void route());
  await route();
}

void boot();
