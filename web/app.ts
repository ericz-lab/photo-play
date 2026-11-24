/**
 * The page, one screen: the works on the left; on the right the start (upload,
 * effects with a real before/after each) or the editor of one artwork
 * (versions, compare, text overlay, download, a new edit).
 * Hash routes, no framework. Everything that costs a model call is a job on
 * the server; the page only polls it, so closing the tab loses nothing.
 */

import cleanupBefore from "./samples/cleanup-before.jpg";
import cleanupAfter from "./samples/cleanup-after.jpg";
import lightBefore from "./samples/light-before.jpg";
import lightAfter from "./samples/light-after.jpg";
import postcardBefore from "./samples/postcard-before.jpg";
import postcardAfter from "./samples/postcard-after.jpg";
import annotateBefore from "./samples/annotate-before.jpg";
import annotateAfter from "./samples/annotate-after.jpg";
import freeBefore from "./samples/free-before.jpg";
import freeAfter from "./samples/free-after.jpg";

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

// ------------------------------------------------------------------ look

/** Markup to one element; used for the SVG icons and illustrations, which `h` cannot make. */
function markup(html: string): Element {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild!;
}
const icon = (id: string) => markup(`<svg class="icon" aria-hidden="true"><use href="#${id}" /></svg>`);
const pad2 = (n: number) => String(n).padStart(2, "0");

/** An effect's picture: the result of its sample run, or a plain photo mark. */
const art = (id: string): Element => {
  const sample = SAMPLES[id];
  return sample ? h("img", { class: "art", src: sample.after, alt: "", loading: "lazy" }) : h("span", { class: "art art-blank" }, icon("i-photo"));
};

/** A confirm in the page's own dialog. */
function ask(title: string, text: string, yes: string): Promise<boolean> {
  const d = $<HTMLDialogElement>("#confirm");
  $("#confirm-title").textContent = title;
  $("#confirm-text").textContent = text;
  $("#confirm-yes").textContent = yes;
  return new Promise((resolve) => {
    const done = (v: boolean) => { d.close(); resolve(v); };
    $("#confirm-yes").onclick = () => done(true);
    $("#confirm-no").onclick = () => done(false);
    d.oncancel = () => resolve(false);
    d.showModal();
  });
}

function setupTheme() {
  const root = document.documentElement;
  $("#theme").addEventListener("click", () => {
    const now = root.dataset.theme ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    root.dataset.theme = now === "dark" ? "light" : "dark";
    try { localStorage.setItem("photoplay-theme", root.dataset.theme); } catch { /* the theme just isn't remembered */ }
  });
}

// ------------------------------------------------------------------ side: the works, always there

const side = $("#side");
/** The effect the works list is filtered by; null: all. */
let sideFilter: string | null = null;
/** The artwork open in the editor; null: the start screen. */
let openId: number | null = null;
let sideSeq = 0;

async function renderSide() {
  const seq = ++sideSeq;
  const filter = h("select", { "aria-label": "按玩法筛选" },
    h("option", { value: "", selected: !sideFilter }, "全部玩法"),
    ...templates.map((t) => h("option", { value: t.id, selected: sideFilter === t.id }, t.name))) as HTMLSelectElement;
  filter.addEventListener("change", () => { sideFilter = filter.value || null; void renderSide(); });
  const list = h("div", { class: "side-list" }, ...[0, 1, 2].map(() => h("div", { class: "skeleton side-skel" })));
  const count = h("small", {});
  side.replaceChildren(
    h("div", { class: "side-head" }, h("div", { class: "row" }, h("h2", {}, "作品"), count), filter),
    h("button", { class: "primary upload-btn", type: "button", onclick: () => openPicker() }, icon("i-up"), "上传照片"),
    h("a", { class: `side-new${openId === null ? " on" : ""}`, href: "#/" }, icon("i-plus"), "新的作品"),
    list,
  );
  try {
    const { artworks } = await api<{ artworks: ArtworkView[] }>(`/api/artworks${sideFilter ? `?template=${sideFilter}` : ""}`);
    if (seq !== sideSeq) return;
    count.textContent = String(artworks.length);
    list.replaceChildren(...(artworks.length ? artworks.map(item) : [h("p", { class: "side-empty" }, sideFilter ? `还没有用「${tpl(sideFilter)?.name ?? sideFilter}」做过的作品。` : "还没有作品。上传第一张旅行照片吧。")]));
  } catch (e) {
    if (seq !== sideSeq) return;
    list.replaceChildren(h("div", { class: "side-empty error" }, `作品读取失败：${(e as Error).message}`, h("br"), h("button", { type: "button", onclick: () => void renderSide() }, icon("i-retry"), "重试")));
  }
}

function item(a: ArtworkView): HTMLElement {
  return h("a", { class: "item", href: `#/a/${a.id}`, "aria-current": openId === a.id ? "page" : null },
    h("img", { src: thumb(a.cover), alt: "", loading: "lazy" }),
    h("span", { class: "item-copy" },
      h("strong", {}, a.title || when(a.createdAt)),
      h("small", {}, a.versions ? `${a.versions} 个版本` : "原图", a.pending ? h("span", { class: "busy-mark" }, ` · ${a.pending} 张生成中`) : null),
    ),
  );
}

// ------------------------------------------------------------------ start: no artwork open

async function renderStart() {
  const fine = matchMedia("(pointer: fine)").matches;
  view.replaceChildren(
    h("section", { class: "start" },
      h("div", { class: "drop", id: "drop", role: "button", tabindex: 0, "aria-label": "选择一张旅行照片",
        onclick: () => openPicker(),
        onkeydown: (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPicker(); } } },
        h("span", { class: "uploadmark" }, icon("i-photo")),
        h("strong", {}, fine ? "把旅行照片拖到这里" : "选一张旅行照片"),
        h("span", { class: "button primary" }, icon("i-up"), "选择照片"),
        h("small", {}, "JPG、PNG、WebP 等常见格式 · 原图和每个版本都会保留"),
      ),
      h("div", { class: "section-head" }, h("h2", {}, "或先选个玩法"), h("small", {}, "选好再挑照片，进来就用这个玩法")),
      h("div", { class: "play-grid" }, ...templates.map(playCard)),
    ),
  );
}

/**
 * One real run of each effect on an open-licence photo (web/samples/README.md): the
 * result and the photo under a wipe. Words the page would draw go on top as text.
 */
const SAMPLES: Record<string, { before: string; after: string }> = {
  cleanup: { before: cleanupBefore, after: cleanupAfter },
  light: { before: lightBefore, after: lightAfter },
  postcard: { before: postcardBefore, after: postcardAfter },
  annotate: { before: annotateBefore, after: annotateAfter },
  free: { before: freeBefore, after: freeAfter },
};
const sampleWords = (id: string): HTMLElement | null =>
  id === "postcard" ? h("span", { class: "words post" }, h("strong", {}, "布拉耶斯湖"), h("span", {}, "多洛米蒂 · 2026.07.12"))
  : id === "annotate" ? h("span", { class: "words hand" }, h("strong", {}, "终于爬上来了！"), h("span", {}, "山顶的风"))
  : null;

function playCard(t: Template): HTMLElement {
  const pick = () => openPicker(t.id);
  const sample = SAMPLES[t.id];
  if (!sample) {
    return h("button", { class: "play", type: "button", onclick: pick }, art(t.id), h("span", { class: "caption" }, h("strong", {}, t.name), h("small", {}, t.summary)));
  }
  const before = h("img", { class: "before", src: sample.before, alt: "", loading: "lazy", draggable: "false" });
  const line = h("span", { class: "split" });
  const range = h("input", { type: "range", min: 0, max: 100, value: 50, class: "wipe", "aria-label": `${t.name}：拖动对比原图和效果` }) as HTMLInputElement;
  const set = (v: number) => {
    const x = Math.max(0, Math.min(100, v));
    before.style.clipPath = `inset(0 ${100 - x}% 0 0)`;
    line.style.left = `${x}%`;
    range.value = String(Math.round(x));
  };
  range.addEventListener("input", () => set(Number(range.value)));
  const shot = h("div", { class: "shot" },
    h("img", { class: "after", src: sample.after, alt: `${t.name}的效果示例`, loading: "lazy", draggable: "false" }),
    sampleWords(t.id),
    before, line,
    h("span", { class: "label l" }, "原图"), h("span", { class: "label r" }, "效果"),
    range,
  );
  // With a mouse the wipe follows the pointer; a finger drags the range itself.
  shot.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    const r = shot.getBoundingClientRect();
    set(((e.clientX - r.left) / r.width) * 100);
  });
  shot.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") set(50); });
  set(50);
  return h("div", { class: "play sample" },
    shot,
    h("button", { class: "caption", type: "button", onclick: pick, "aria-label": `用「${t.name}」开始：选一张照片` },
      h("span", { class: "caption-text" }, h("strong", {}, t.name), h("small", {}, t.summary)),
      h("span", { class: "go", "aria-hidden": "true" }, icon("i-arrow"))),
  );
}

/** A photo dropped anywhere on the page starts a new artwork. */
function setupDrop() {
  let depth = 0;
  const hasFile = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes("Files");
  document.addEventListener("dragenter", (e) => { if (!hasFile(e)) return; depth++; document.body.classList.add("dragging"); });
  document.addEventListener("dragleave", (e) => { if (!hasFile(e)) return; if (--depth <= 0) { depth = 0; document.body.classList.remove("dragging"); } });
  document.addEventListener("dragover", (e) => { if (hasFile(e)) e.preventDefault(); });
  document.addEventListener("drop", (e) => {
    if (!hasFile(e)) return;
    e.preventDefault();
    depth = 0;
    document.body.classList.remove("dragging");
    const f = e.dataTransfer?.files?.[0];
    if (f) void upload(f);
  });
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

/** The parameters of a job in words, from its template. */
function paramText(j: JobView): string {
  const t = tpl(j.templateId);
  if (!t) return "";
  const words: string[] = [];
  for (const p of t.params) {
    const v = j.params[p.key];
    if (v === undefined || v === "") continue;
    if (p.kind === "select") words.push(p.options.find((o) => o.value === v)?.label ?? String(v));
    else if (p.kind === "range") words.push(p.labels[Number(v) - p.min] ?? String(v));
    else if (!p.overlay) words.push(String(v).length > 16 ? `${String(v).slice(0, 16)}…` : String(v));
  }
  return words.join(" / ");
}

async function renderEditor(id: number) {
  view.replaceChildren(h("div", { class: "heading" }, h("div", { class: "skeleton", style: "min-height:40px;width:260px" })), h("div", { class: "skeleton", style: "min-height:420px" }));
  let data: { artwork: ArtworkView; jobs: JobView[] };
  try {
    data = await api(`/api/artworks/${id}`);
  } catch (e) {
    view.replaceChildren(h("div", { class: "state error", style: "margin-top:24px" }, `这个作品打不开：${(e as Error).message}`, h("br"),
      h("button", { type: "button", onclick: () => void renderEditor(id) }, icon("i-retry"), "重试"), " ", h("a", { class: "button", href: "#/" }, "回到开始")));
    return;
  }
  const latest = [...data.jobs].reverse().find((j) => j.status !== "failed") ?? null;
  const st: EditorState = {
    art: data.artwork, jobs: data.jobs, selected: latest?.id ?? null, compare: false,
    templateId: pendingTemplate ?? latest?.templateId ?? templates[0]!.id, fromSelected: !!latest && latest.status === "done", submitKey: key(), submitting: false,
  };
  pendingTemplate = null;

  const mat = h("div", { class: "mat" });
  const versionTag = h("span", { class: "tag" });
  const compareBtn = h("button", { type: "button", "aria-pressed": "false", onclick: () => { st.compare = !st.compare; void drawStage(); } }, icon("i-compare"), "对比修改前") as HTMLButtonElement;
  const expandBtn = h("button", { class: "icon-btn", type: "button", "aria-label": "放大查看", onclick: () => { const c = mat.querySelector("canvas, img") as HTMLCanvasElement | HTMLImageElement | null; if (c) openLightbox(c); } }, icon("i-expand"));
  const strip = h("div", { class: "versions" });
  const count = h("small", {});
  const info = h("section", { class: "panel" });
  const words = h("section", { class: "panel" });
  const form = h("section", { class: "panel", id: "new-edit" });
  const title = h("input", { class: "title-input", value: st.art.title, placeholder: "给作品起个名字", maxlength: 60, "aria-label": "作品名称" }) as HTMLInputElement;
  title.addEventListener("change", async () => {
    try { await api(`/api/artworks/${id}`, { method: "PATCH", body: JSON.stringify({ title: title.value }) }); toast("已保存"); void renderSide(); } catch (e) { toast((e as Error).message, "error"); }
  });
  const del = h("button", { class: "ghost danger", type: "button", onclick: async () => {
    if (!(await ask("删除这个作品？", "它的全部版本会一起删除；原图如果没有被别的作品使用，也会删除。", "删除作品"))) return;
    try { await api(`/api/artworks/${id}`, { method: "DELETE" }); toast("已删除"); location.hash = "#/"; } catch (e) { toast((e as Error).message, "error"); }
  } }, "删除作品");

  view.replaceChildren(
    h("div", { class: "heading" },
      h("div", { style: "min-width:0;flex:1" },
        h("div", { class: "title-row" }, title, h("button", { class: "ghost icon-btn", type: "button", "aria-label": "重命名作品", onclick: () => title.focus() }, icon("i-edit"))),
      ),
      del,
    ),
    h("div", { class: "desk" },
      h("div", {},
        h("section", { class: "viewer" },
          h("div", { class: "viewer-bar" }, h("div", { class: "row" }, h("h2", {}, "作品预览"), versionTag), h("div", { class: "actions" }, compareBtn, expandBtn)),
          mat,
        ),
        h("section", { class: "timeline" }, h("div", { class: "timeline-head" }, h("h2", {}, "版本记录"), count), strip),
      ),
      h("aside", { class: "inspector", "aria-label": "编辑面板" }, info, words, form),
    ),
  );

  const selectedJob = () => st.jobs.find((j) => j.id === st.selected) ?? null;
  const numberOf = (jobId: number) => st.jobs.findIndex((x) => x.id === jobId) + 1;
  const sourceOf = (j: JobView) => (j.parentId ? `版本 ${pad2(numberOf(j.parentId))}` : "原图");
  const assetOf = (assetId: number): AssetView | null => assetId === st.art.original.id ? st.art.original : st.jobs.find((j) => j.result?.id === assetId)?.result ?? null;

  // The stage: the selected picture with its words, and the picture it was made from under a wipe.
  let stageFor = "";
  async function drawStage() {
    const j = selectedJob();
    const done = !!j && j.status === "done" && !!j.result;
    if (!done) st.compare = false;
    compareBtn.disabled = !done;
    compareBtn.setAttribute("aria-pressed", String(st.compare));
    versionTag.textContent = j ? `版本 ${pad2(numberOf(j.id))}` : "原图";
    const sig = JSON.stringify([st.selected, st.compare, j?.status, j?.ahead, j?.overlay]);
    if (sig === stageFor) return;
    stageFor = sig;
    if (!j || !done) {
      const img = h("img", { src: st.art.original.url, alt: "原图" }) as HTMLImageElement;
      img.addEventListener("load", () => void ensureThumb(st.art.original, img), { once: true });
      const note = j && (j.status === "queued" || j.status === "running")
        ? h("div", { class: "stage-note" }, h("div", { class: "spinner small" }), j.status === "queued" ? (j.ahead ? `排队第 ${j.ahead + 1} 位，先显示原图` : "马上开始，先显示原图") : "正在生成，通常需要 1 到 3 分钟")
        : j ? h("div", { class: "stage-note" }, icon("i-alert"), j.status === "failed" ? "这一版没有生成出来，显示的是原图" : "这一版结果不明，显示的是原图")
        : null;
      mat.replaceChildren(h("div", { class: "frame" }, img, note));
      return;
    }
    const canvas = await compose(j);
    if (sig !== stageFor) return;
    canvas.className = "result";
    const frame = h("div", { class: "frame", style: `aspect-ratio:${canvas.width}/${canvas.height}` }, canvas);
    if (st.compare) {
      const base = assetOf(j.baseId);
      const under = h("img", { class: "under", src: base?.url ?? st.art.original.url, alt: "修改前" });
      const split = h("span", { class: "split" });
      const range = h("input", { type: "range", min: 0, max: 100, value: 50, class: "wipe", "aria-label": "拖动对比修改前后" }) as HTMLInputElement;
      const setCut = () => { under.style.clipPath = `inset(0 ${100 - Number(range.value)}% 0 0)`; split.style.left = `${range.value}%`; };
      range.addEventListener("input", setCut);
      setCut();
      frame.append(under, split, h("span", { class: "label l" }, j.parentId ? sourceOf(j) : "原图"), h("span", { class: "label r" }, `版本 ${pad2(numberOf(j.id))}`), range);
    } else canvas.addEventListener("click", () => openLightbox(canvas));
    mat.replaceChildren(frame);
  }

  function drawStrip() {
    const tile = (jobId: number | null, pic: Node, name: (Node | string)[], note: string) =>
      h("button", { class: "tile", type: "button", "aria-current": String(st.selected === jobId), onclick: () => { st.selected = jobId; const j = selectedJob(); st.fromSelected = !!j && j.status === "done"; drawAll(); } },
        pic, h("strong", {}, ...name), h("small", {}, note));
    const o = st.art.original;
    strip.replaceChildren(
      tile(null, h("span", { class: "thumb" }, h("img", { src: thumb(o), alt: "", loading: "lazy" })), ["原图"], `${o.width}×${o.height} · 保留底片`),
      ...st.jobs.map((j, i) => {
        const pic = j.result ? h("span", { class: "thumb" }, h("img", { src: thumb(j.result), alt: "", loading: "lazy" }))
          : j.status === "queued" || j.status === "running" ? h("span", { class: "thumb wait" }, icon("i-clock"))
          : h("span", { class: "thumb bad" }, icon("i-alert"));
        const state = j.status === "queued" ? `排队第 ${j.ahead + 1} 位` : j.status === "running" ? "生成中" : j.status === "failed" ? "失败" : j.status === "unknown" ? "待核对" : paramText(j);
        return tile(j.id, pic, [h("span", { class: "no" }, pad2(i + 1)), j.templateName], [state, `来自${sourceOf(j)}`].filter(Boolean).join(" / "));
      }),
    );
    count.textContent = st.jobs.length ? `原图 + ${st.jobs.length} 个版本` : "只有原图";
  }

  function drawInfo() {
    const j = selectedJob();
    const head = (tag: Node | null) => h("div", { class: "panel-head" }, h("h2", {}, "版本信息"), tag);
    if (!j) {
      const o = st.art.original;
      info.replaceChildren(
        head(h("span", { class: "tag" }, "原图")),
        h("dl", { class: "facts" },
          h("div", {}, h("dt", {}, "尺寸"), h("dd", {}, `${o.width}×${o.height}`)),
          h("div", {}, h("dt", {}, "上传于"), h("dd", {}, when(st.art.createdAt))),
        ),
        h("div", { class: "actions" }, download(o, `photoplay-${id}-original`, "下载原图"),
          h("button", { type: "button", onclick: () => { st.fromSelected = false; drawForm(); focusForm(); } }, "从原图修改")),
      );
      if (!st.jobs.length) info.append(h("p", { class: "hint foot-note" }, "还没有版本。在下面选一个玩法，生成第一张。"));
      return;
    }
    const statusText = { queued: `排队第 ${j.ahead + 1} 位`, running: "生成中", done: "已完成", failed: "失败", unknown: "待核对" }[j.status];
    const took = seconds(j.startedAt, j.finishedAt);
    const rows: (Node | null)[] = [
      head(h("span", { class: `tag ${j.status}` }, statusText)),
      h("dl", { class: "facts" },
        h("div", { class: "wide" }, h("dt", {}, "玩法参数"), h("dd", {}, [j.templateName, paramText(j)].filter(Boolean).join(" / "))),
        h("div", {}, h("dt", {}, "来源"), h("dd", {}, sourceOf(j))),
        h("div", {}, h("dt", {}, "用时"), h("dd", {}, took !== null ? `${Math.floor(took / 60)} 分 ${pad2(took % 60)} 秒` : "—")),
        h("div", {}, h("dt", {}, "模型"), h("dd", {}, j.model ? `${j.runtime ? `${j.runtime}/` : ""}${j.model}` : "—")),
        h("div", {}, h("dt", {}, "费用"), h("dd", {}, j.callId ? `未知（账本 #${j.callId}）` : "未知")),
        j.usage ? h("div", { class: "wide" }, h("dt", {}, "tokens"), h("dd", {}, `${(j.usage.inputTokens + j.usage.cacheReadTokens).toLocaleString()} 输入 / ${j.usage.outputTokens.toLocaleString()} 输出`)) : null,
        j.extra ? h("div", { class: "wide" }, h("dt", {}, "补充要求"), h("dd", {}, j.extra)) : null,
      ),
      j.error ? h("p", { class: "error small", style: "margin-bottom:10px" }, j.error) : null,
    ];
    if (j.status === "queued" || j.status === "running") rows.push(h("p", { class: "hint" }, "服务器一次做一张，通常 1 到 3 分钟；关掉页面也不影响，做好会出现在版本记录里。"));
    if (j.status === "failed" || j.status === "unknown") {
      rows.push(h("button", { type: "button", onclick: async (e: Event) => {
        const b = e.currentTarget as HTMLButtonElement;
        b.disabled = true;
        try {
          const { job } = await api<{ job: JobView }>(`/api/jobs/${j.id}/retry`, { method: "POST", body: JSON.stringify({ key: key() }) });
          st.jobs.push(job);
          st.selected = job.id;
          drawAll();
          poll();
        } catch (err) { toast((err as Error).message, "error"); b.disabled = false; }
      } }, icon("i-retry"), j.status === "unknown" ? "确认没有生成，手动重试" : "重试"));
    }
    if (j.status === "done" && j.result) {
      const actions = h("div", { class: "actions" });
      if (hasWords(j)) {
        actions.append(h("button", { class: "primary", type: "button", onclick: async () => {
          const c = await compose(j);
          c.toBlob((b) => b && save(b, `photoplay-${id}-v${j.id}.png`), "image/png");
        } }, icon("i-down"), "下载成品"), download(j.result, `photoplay-${id}-v${j.id}-plain`, "不带文字"));
      } else actions.append(download(j.result, `photoplay-${id}-v${j.id}`, "下载", true));
      actions.append(h("button", { type: "button", onclick: () => { st.fromSelected = true; drawForm(); focusForm(); } }, "从此版本继续改"));
      rows.push(actions);
    }
    info.replaceChildren(...rows.filter((x): x is Node => !!x));
  }

  function drawWords() {
    const j = selectedJob();
    if (!j || j.status !== "done" || j.overlayStyle === "none") { words.hidden = true; return; }
    words.hidden = false;
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
    const inputs = fields.map((p) => {
      const input = h("input", { value: j.overlay[p.key] ?? "", maxlength: p.maxLength, placeholder: p.placeholder ?? "" }) as HTMLInputElement;
      input.addEventListener("input", () => set(p.key, input.value));
      return h("label", {}, h("span", {}, p.label), input);
    });
    const positions = j.overlayStyle === "postcard" ? [["bottom", "下方"], ["top", "上方"]] : [["default", "标题在左上"], ["swap", "标题在右下"]];
    const now = j.overlay.position || positions[0]![0]!;
    const seg = h("div", { class: "segmented", role: "group", "aria-label": "文字位置" }, ...positions.map(([v, l]) =>
      h("button", { type: "button", "aria-pressed": String(now === v), onclick: (e: Event) => {
        for (const b of seg.children) b.setAttribute("aria-pressed", String(b === e.currentTarget));
        set("position", v!);
      } }, l!)));
    const size = h("input", { type: "range", min: 0.6, max: 1.6, step: 0.1, value: j.overlay.scale || 1, "aria-label": "字号" }) as HTMLInputElement;
    size.addEventListener("change", () => set("scale", size.value));
    words.replaceChildren(
      h("div", { class: "panel-head" }, h("h2", {}, "文字层"), h("small", {}, "改字不用重新生成")),
      h("div", { class: "fields" },
        inputs[0] ?? null,
        inputs.length > 2 ? h("div", { class: "two" }, ...inputs.slice(1)) : inputs[1] ?? null,
        h("div", { class: "two" }, h("label", {}, h("span", {}, "位置"), seg), h("label", {}, h("span", {}, "字号"), size)),
      ),
    );
  }

  function focusForm() {
    form.scrollIntoView({ behavior: "smooth", block: "start" });
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
        return h("label", {}, h("span", {}, p.label), s);
      }
      if (p.kind === "range") {
        values[p.key] = p.default;
        const seg = h("div", { class: "segmented", role: "group", "aria-label": p.label }, ...p.labels.map((l, i) =>
          h("button", { type: "button", "aria-pressed": String(p.min + i === p.default), onclick: (e: Event) => {
            values[p.key] = p.min + i;
            for (const b of seg.children) b.setAttribute("aria-pressed", String(b === e.currentTarget));
          } }, l)));
        return h("div", { class: "fields" }, h("span", { class: "small", style: "color:var(--ink2)" }, p.label), seg);
      }
      values[p.key] = p.default ?? "";
      const el = (p.kind === "textarea" ? h("textarea", { rows: 3, maxlength: p.maxLength, placeholder: p.placeholder ?? "" }, p.default ?? "") : h("input", { value: p.default ?? "", maxlength: p.maxLength, placeholder: p.placeholder ?? "" })) as HTMLInputElement;
      el.addEventListener("input", () => (values[p.key] = el.value));
      return h("label", {}, h("span", {}, p.label, p.overlay ? h("small", {}, " · 页面排版，之后可改") : null), el);
    });
    const extra = h("textarea", { rows: 2, maxlength: 300, placeholder: "可选：再补充一句要求" }) as HTMLTextAreaElement;
    const button = h("button", { class: "primary generate", type: "button", disabled: !status.ready || st.submitting }, icon("i-plus"), st.submitting ? "提交中…" : "生成新版本") as HTMLButtonElement;
    button.addEventListener("click", async () => {
      if (st.submitting) return;
      st.submitting = true;
      button.disabled = true;
      button.lastChild!.textContent = "提交中…";
      try {
        const { job } = await api<{ job: JobView }>("/api/jobs", { method: "POST", body: JSON.stringify({
          artworkId: id, parentId: st.fromSelected && sel ? sel.id : null, templateId: t.id, params: values, extra: t.id === "free" ? "" : extra.value, key: st.submitKey,
        }) });
        if (!st.jobs.some((x) => x.id === job.id)) st.jobs.push(job);
        st.selected = job.id;
        st.submitKey = key();
        toast("已提交，生成完成后会自动显示");
        void renderSide();
        poll();
      } catch (e) {
        toast((e as Error).message, "error");
      } finally {
        st.submitting = false;
        drawAll();
      }
    });
    const base = h("div", { class: "segmented", role: "group", "aria-label": "基于" },
      h("button", { type: "button", "aria-pressed": String(!st.fromSelected), onclick: () => { st.fromSelected = false; drawForm(); } }, "原图"),
      h("button", { type: "button", "aria-pressed": String(st.fromSelected), disabled: !canBuild, onclick: () => { st.fromSelected = true; drawForm(); } },
        canBuild ? `版本 ${pad2(numberOf(sel!.id))}` : "当前版本"),
    );
    form.replaceChildren(...[
      h("div", { class: "panel-head" }, h("h2", {}, "新的修改"), h("small", {}, "输出 1 张")),
      h("div", { class: "modes", role: "group", "aria-label": "玩法" }, ...templates.map((x) =>
        h("button", { class: "mode", type: "button", "aria-pressed": String(x.id === t.id), onclick: () => { st.templateId = x.id; st.submitKey = key(); drawForm(); } }, art(x.id), x.name))),
      h("p", { class: "hint", style: "margin-bottom:10px" }, t.summary),
      h("div", { class: "fields" },
        ...inputs,
        t.id === "free" ? null : h("label", {}, h("span", {}, "补充要求"), extra),
        h("div", { class: "fields" }, h("span", { class: "small", style: "color:var(--ink2)" }, "基于"), base),
        h("p", { class: "hint" }, "费用未知（走 ai-space 的模型额度）· 原图和旧版本都会保留"),
        !status.ready ? h("p", { class: "error small" }, "生成服务未接入，暂时不能生成（见页面顶部）") : null,
        button,
      ),
    ].filter((x): x is HTMLElement => !!x));
  }

  let formFor = "";
  function drawAll() {
    drawStrip();
    drawInfo();
    drawWords();
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
          if (prev && prev !== j.status && j.status === "done") toast(`版本 ${pad2(fresh.jobs.indexOf(j) + 1)} 生成好了`);
          if (prev && prev !== j.status && j.status === "failed") toast(`版本 ${pad2(fresh.jobs.indexOf(j) + 1)} 生成失败`, "error");
        }
        if (JSON.stringify(st.jobs.map((j) => [j.id, j.status, j.ahead])) !== before) {
          const j = selectedJob();
          if (j && j.status === "done" && was.get(j.id) !== "done") st.fromSelected = true;
          drawAll();
          void renderSide();
        }
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
  return h("a", { class: `button${primary ? " primary" : ""}`, href: `${a.url}?name=${encodeURIComponent(name)}` }, icon("i-down"), label);
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function openLightbox(pic: HTMLCanvasElement | HTMLImageElement) {
  const box = $("#lightbox");
  const img = h("img", { src: pic instanceof HTMLCanvasElement ? pic.toDataURL("image/jpeg", 0.92) : pic.src, alt: "" });
  box.replaceChildren(h("button", { class: "close", type: "button", "aria-label": "关闭", onclick: () => (box.hidden = true) }, icon("i-close")), img);
  box.hidden = false;
  box.onclick = (e) => { if (e.target === box) box.hidden = true; };
}

// ------------------------------------------------------------------ routing

async function route() {
  stopPolling?.();
  $("#lightbox").hidden = true;
  const parts = location.hash.replace(/^#/, "").split("?")[0]!.split("/").filter(Boolean);
  const id = parts[0] === "a" && Number(parts[1]) ? Number(parts[1]) : null;
  if (parts.length && !id) { history.replaceState(null, "", "#/"); }
  openId = id;
  void renderSide();
  window.scrollTo(0, 0);
  if (id) return renderEditor(id);
  return renderStart();
}

async function boot() {
  setupTheme();
  setupDrop();
  try {
    const [t, s] = await Promise.all([api<{ templates: Template[] }>("/api/templates"), api<{ ready: boolean; reason: string | null }>("/api/status")]);
    templates = t.templates;
    status = s;
    if (!s.ready) {
      const n = $("#notice");
      n.replaceChildren(icon("i-info"), h("span", {}, h("strong", {}, "暂时不能生成新版本"), `　${s.reason ?? "生成服务未接入"}。作品、改字和下载照常可用。`));
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
