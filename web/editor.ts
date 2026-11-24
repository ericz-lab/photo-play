/**
 * One artwork: the stage (a version with its words, or a wipe against what it was made from), the
 * versions strip, and the inspector (the version's facts and downloads, its words layer, a new
 * edit). Everything that costs a model call is a job on the server; the editor only polls it.
 */

import { $, api, ask, h, icon, newKey, pad2, toast } from "./dom.ts";
import { errorText, num, t, tx, versionLabel, when } from "./i18n.ts";
import { compose, ensureThumb, hasWords } from "./overlay.ts";
import { renderSide } from "./side.ts";
import { art } from "./start.ts";
import { app, type ArtworkView, type AssetView, type JobView, type Param, thumb, tpl } from "./state.ts";

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

const live = (j: JobView) => j.status === "queued" || j.status === "running";

/** The parameters of a job in words, from its template. */
function paramText(j: JobView): string {
  const tp = tpl(j.templateId);
  if (!tp) return "";
  const words: string[] = [];
  for (const p of tp.params) {
    const v = j.params[p.key];
    if (v === undefined || v === "") continue;
    if (p.kind === "select") words.push(tx(p.options.find((o) => o.value === v)?.label) || String(v));
    else if (p.kind === "range") words.push(tx(p.labels[Number(v) - p.min]) || String(v));
    else if (!p.overlay) words.push(String(v).length > 16 ? `${String(v).slice(0, 16)}…` : String(v));
  }
  return words.join(" / ");
}

/** The state word of a job that is not done. */
function statusWord(j: JobView): string {
  return j.status === "queued" ? t("queued", { n: j.ahead + 1 }) : t(j.status);
}

const tplName = (j: JobView) => tx(tpl(j.templateId)?.name) || j.templateId;

export async function renderEditor(view: HTMLElement, id: number) {
  view.replaceChildren(h("div", { class: "heading" }, h("div", { class: "skeleton", style: "min-height:40px;width:260px" })), h("div", { class: "skeleton", style: "min-height:420px" }));
  let data: { artwork: ArtworkView; jobs: JobView[] };
  try {
    data = await api(`/api/artworks/${id}`);
  } catch (e) {
    view.replaceChildren(h("div", { class: "state error", style: "margin-top:24px" }, t("cannotOpen", { error: errorText(e) }), h("br"),
      h("button", { type: "button", onclick: () => void renderEditor(view, id) }, icon("i-retry"), t("retry")), " ", h("a", { class: "button", href: "#/" }, t("backToStart"))));
    return;
  }
  const latest = [...data.jobs].reverse().find((j) => j.status !== "failed") ?? null;
  const st: EditorState = {
    art: data.artwork, jobs: data.jobs, selected: latest?.id ?? null, compare: false,
    templateId: app.pendingTemplate ?? latest?.templateId ?? app.templates[0]!.id, fromSelected: !!latest && latest.status === "done", submitKey: newKey(), submitting: false,
  };
  app.pendingTemplate = null;

  const mat = h("div", { class: "mat" });
  const versionTag = h("span", { class: "tag" });
  const compareBtn = h("button", { type: "button", "aria-pressed": "false", onclick: () => { st.compare = !st.compare; void drawStage(); } }, icon("i-compare"), t("compareBefore")) as HTMLButtonElement;
  const expandBtn = h("button", { class: "icon-btn", type: "button", "aria-label": t("viewLarger"), onclick: () => { const c = mat.querySelector("canvas, img") as HTMLCanvasElement | HTMLImageElement | null; if (c) openLightbox(c); } }, icon("i-expand"));
  const strip = h("div", { class: "versions" });
  const count = h("small", {});
  const info = h("section", { class: "panel" });
  const words = h("section", { class: "panel" });
  const form = h("section", { class: "panel", id: "new-edit" });
  const title = h("input", { class: "title-input", value: st.art.title, placeholder: t("nameWork"), maxlength: 60, "aria-label": t("workName") }) as HTMLInputElement;
  title.addEventListener("change", async () => {
    try { await api(`/api/artworks/${id}`, { method: "PATCH", body: JSON.stringify({ title: title.value }) }); toast(t("saved")); void renderSide(); } catch (e) { toast(errorText(e), "error"); }
  });
  const del = h("button", { class: "ghost danger", type: "button", onclick: async () => {
    if (!(await ask(t("deleteWorkQ"), t("deleteWorkText"), t("deleteWork")))) return;
    try { await api(`/api/artworks/${id}`, { method: "DELETE" }); toast(t("deleted")); location.hash = "#/"; } catch (e) { toast(errorText(e), "error"); }
  } }, t("deleteWork"));

  view.replaceChildren(
    h("div", { class: "heading" },
      h("div", { style: "min-width:0;flex:1" },
        h("div", { class: "title-row" }, title, h("button", { class: "ghost icon-btn", type: "button", "aria-label": t("renameWork"), onclick: () => title.focus() }, icon("i-edit"))),
      ),
      del,
    ),
    h("div", { class: "desk" },
      h("div", {},
        h("section", { class: "viewer" },
          h("div", { class: "viewer-bar" }, h("div", { class: "row" }, h("h2", {}, t("preview")), versionTag), h("div", { class: "actions" }, compareBtn, expandBtn)),
          mat,
        ),
        h("section", { class: "timeline" }, h("div", { class: "timeline-head" }, h("h2", {}, t("versions")), count), strip),
      ),
      h("aside", { class: "inspector", "aria-label": t("editPanel") }, info, words, form),
    ),
  );

  const selectedJob = () => st.jobs.find((j) => j.id === st.selected) ?? null;
  const numberOf = (jobId: number) => st.jobs.findIndex((x) => x.id === jobId) + 1;
  const sourceOf = (j: JobView) => (j.parentId ? versionLabel(numberOf(j.parentId)) : t("theOriginal"));
  const assetOf = (assetId: number): AssetView | null => assetId === st.art.original.id ? st.art.original : st.jobs.find((j) => j.result?.id === assetId)?.result ?? null;

  // The stage: the selected picture with its words, and the picture it was made from under a wipe.
  let stageFor = "";
  async function drawStage() {
    const j = selectedJob();
    const done = !!j && j.status === "done" && !!j.result;
    if (!done) st.compare = false;
    compareBtn.disabled = !done;
    compareBtn.setAttribute("aria-pressed", String(st.compare));
    versionTag.textContent = j ? versionLabel(numberOf(j.id)) : t("original");
    const sig = JSON.stringify([st.selected, st.compare, j?.status, j?.ahead, j?.overlay]);
    if (sig === stageFor) return;
    stageFor = sig;
    if (!j || !done) {
      const img = h("img", { src: st.art.original.url, alt: t("original") }) as HTMLImageElement;
      img.addEventListener("load", () => void ensureThumb(st.art.original, img), { once: true });
      const note = j && live(j)
        ? h("div", { class: "stage-note" }, h("div", { class: "spinner small" }), j.status === "queued" ? (j.ahead ? t("queuedShowing", { n: j.ahead + 1 }) : t("startingShowing")) : t("generatingShowing"))
        : j ? h("div", { class: "stage-note" }, icon("i-alert"), j.status === "failed" ? t("failedShowing") : t("unknownShowing"))
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
      const under = h("img", { class: "under", src: base?.url ?? st.art.original.url, alt: t("beforeEdit") });
      const split = h("span", { class: "split" });
      const range = h("input", { type: "range", min: 0, max: 100, value: 50, class: "wipe", "aria-label": t("wipeStage") }) as HTMLInputElement;
      const setCut = () => { under.style.clipPath = `inset(0 ${100 - Number(range.value)}% 0 0)`; split.style.left = `${range.value}%`; };
      range.addEventListener("input", setCut);
      setCut();
      frame.append(under, split, h("span", { class: "label l" }, j.parentId ? sourceOf(j) : t("original")), h("span", { class: "label r" }, versionLabel(numberOf(j.id))), range);
    } else canvas.addEventListener("click", () => openLightbox(canvas));
    mat.replaceChildren(frame);
  }

  function drawStrip() {
    const tile = (jobId: number | null, pic: Node, name: (Node | string)[], note: string) =>
      h("button", { class: "tile", type: "button", "aria-current": String(st.selected === jobId), onclick: () => { st.selected = jobId; const j = selectedJob(); st.fromSelected = !!j && j.status === "done"; drawAll(); } },
        pic, h("strong", {}, ...name), h("small", {}, note));
    const o = st.art.original;
    strip.replaceChildren(
      tile(null, h("span", { class: "thumb" }, h("img", { src: thumb(o), alt: "", loading: "lazy" })), [t("original")], `${o.width}×${o.height} · ${t("keptAsIs")}`),
      ...st.jobs.map((j, i) => {
        const pic = j.result ? h("span", { class: "thumb" }, h("img", { src: thumb(j.result), alt: "", loading: "lazy" }))
          : live(j) ? h("span", { class: "thumb wait" }, icon("i-clock"))
          : h("span", { class: "thumb bad" }, icon("i-alert"));
        const state = j.status === "done" ? paramText(j) : statusWord(j);
        return tile(j.id, pic, [h("span", { class: "no" }, pad2(i + 1)), tplName(j)], [state, t("fromSource", { source: sourceOf(j) })].filter(Boolean).join(" / "));
      }),
    );
    const n = st.jobs.length;
    count.textContent = n === 0 ? t("originalOnly") : n === 1 ? t("originalPlusOne") : t("originalPlus", { n });
  }

  function drawInfo() {
    const j = selectedJob();
    const head = (tag: Node | null) => h("div", { class: "panel-head" }, h("h2", {}, t("versionInfo")), tag);
    if (!j) {
      const o = st.art.original;
      info.replaceChildren(
        head(h("span", { class: "tag" }, t("original"))),
        h("dl", { class: "facts" },
          h("div", {}, h("dt", {}, t("size")), h("dd", {}, `${o.width}×${o.height}`)),
          h("div", {}, h("dt", {}, t("uploaded")), h("dd", {}, when(st.art.createdAt))),
        ),
        h("div", { class: "actions" }, download(o, `photoplay-${id}-original`, t("downloadOriginal")),
          h("button", { type: "button", onclick: () => { st.fromSelected = false; drawForm(); focusForm(); } }, t("editOriginal"))),
      );
      if (!st.jobs.length) info.append(h("p", { class: "hint foot-note" }, t("noVersionsYet")));
      return;
    }
    const took = seconds(j.startedAt, j.finishedAt);
    const rows: (Node | null)[] = [
      head(h("span", { class: `tag ${j.status}` }, statusWord(j))),
      h("dl", { class: "facts" },
        h("div", { class: "wide" }, h("dt", {}, t("effectParams")), h("dd", {}, [tplName(j), paramText(j)].filter(Boolean).join(" / "))),
        h("div", {}, h("dt", {}, t("madeFrom")), h("dd", {}, sourceOf(j))),
        h("div", {}, h("dt", {}, t("took")), h("dd", {}, took !== null ? t("minSec", { m: Math.floor(took / 60), s: pad2(took % 60) }) : "—")),
        h("div", {}, h("dt", {}, t("model")), h("dd", {}, j.model ? `${j.runtime ? `${j.runtime}/` : ""}${j.model}` : "—")),
        h("div", {}, h("dt", {}, t("cost")), h("dd", {}, j.callId ? t("costUnknownLedger", { id: j.callId }) : t("costUnknown"))),
        j.usage ? h("div", { class: "wide" }, h("dt", {}, "tokens"), h("dd", {}, t("tokens", { in: num(j.usage.inputTokens + j.usage.cacheReadTokens), out: num(j.usage.outputTokens) }))) : null,
        j.extra ? h("div", { class: "wide" }, h("dt", {}, t("alsoAsked")), h("dd", {}, j.extra)) : null,
      ),
      // What went wrong comes from ai-space or the model: shown as it is.
      j.error ? h("p", { class: "error small", style: "margin-bottom:10px" }, j.error) : null,
    ];
    if (live(j)) rows.push(h("p", { class: "hint" }, t("oneAtATime")));
    if (j.status === "failed" || j.status === "unknown") {
      rows.push(h("button", { type: "button", onclick: async (e: Event) => {
        const b = e.currentTarget as HTMLButtonElement;
        b.disabled = true;
        try {
          const { job } = await api<{ job: JobView }>(`/api/jobs/${j.id}/retry`, { method: "POST", body: JSON.stringify({ key: newKey() }) });
          st.jobs.push(job);
          st.selected = job.id;
          drawAll();
          poll();
        } catch (err) { toast(errorText(err), "error"); b.disabled = false; }
      } }, icon("i-retry"), j.status === "unknown" ? t("retryUnknown") : t("retry")));
    }
    if (j.status === "done" && j.result) {
      const actions = h("div", { class: "actions" });
      if (hasWords(j)) {
        actions.append(h("button", { class: "primary", type: "button", onclick: async () => {
          const c = await compose(j);
          c.toBlob((b) => b && save(b, `photoplay-${id}-v${j.id}.png`), "image/png");
        } }, icon("i-down"), t("downloadFinished")), download(j.result, `photoplay-${id}-v${j.id}-plain`, t("withoutWords")));
      } else actions.append(download(j.result, `photoplay-${id}-v${j.id}`, t("download"), true));
      actions.append(h("button", { type: "button", onclick: () => { st.fromSelected = true; drawForm(); focusForm(); } }, t("continueFrom")));
      rows.push(actions);
    }
    info.replaceChildren(...rows.filter((x): x is Node => !!x));
  }

  function drawWords() {
    const j = selectedJob();
    if (!j || j.status !== "done" || j.overlayStyle === "none") { words.hidden = true; return; }
    words.hidden = false;
    const fields = (tpl(j.templateId)?.params ?? []).filter((p) => p.kind === "text" && p.overlay) as Extract<Param, { maxLength: number }>[];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const saveOverlay = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          const { job } = await api<{ job: JobView }>(`/api/jobs/${j.id}/overlay`, { method: "PATCH", body: JSON.stringify({ overlay: j.overlay }) });
          Object.assign(j, { overlay: job.overlay });
        } catch (e) { toast(errorText(e), "error"); }
      }, 500);
    };
    const set = (k: string, v: string) => { j.overlay = { ...j.overlay, [k]: v }; void drawStage(); saveOverlay(); };
    const inputs = fields.map((p) => {
      const input = h("input", { value: j.overlay[p.key] ?? "", maxlength: p.maxLength, placeholder: tx(p.placeholder) }) as HTMLInputElement;
      input.addEventListener("input", () => set(p.key, input.value));
      return h("label", {}, h("span", {}, tx(p.label)), input);
    });
    const positions = j.overlayStyle === "postcard" ? [["bottom", t("bottom")], ["top", t("top")]] : [["default", t("titleTopLeft")], ["swap", t("titleBottomRight")]];
    const now = j.overlay.position || positions[0]![0]!;
    const seg = h("div", { class: "segmented", role: "group", "aria-label": t("wordsPosition") }, ...positions.map(([v, l]) =>
      h("button", { type: "button", "aria-pressed": String(now === v), onclick: (e: Event) => {
        for (const b of seg.children) b.setAttribute("aria-pressed", String(b === e.currentTarget));
        set("position", v!);
      } }, l!)));
    const size = h("input", { type: "range", min: 0.6, max: 1.6, step: 0.1, value: j.overlay.scale || 1, "aria-label": t("fontSize") }) as HTMLInputElement;
    size.addEventListener("change", () => set("scale", size.value));
    words.replaceChildren(
      h("div", { class: "panel-head" }, h("h2", {}, t("wordsLayer")), h("small", {}, t("wordsFree"))),
      h("div", { class: "fields" },
        inputs[0] ?? null,
        inputs.length > 2 ? h("div", { class: "two" }, ...inputs.slice(1)) : inputs[1] ?? null,
        h("div", { class: "two" }, h("label", {}, h("span", {}, t("position")), seg), h("label", {}, h("span", {}, t("fontSize")), size)),
      ),
    );
  }

  function focusForm() {
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function drawForm() {
    const tp = tpl(st.templateId) ?? app.templates[0]!;
    const sel = selectedJob();
    const canBuild = !!sel && sel.status === "done";
    if (!canBuild) st.fromSelected = false;
    const values: Record<string, string | number> = {};
    const inputs = tp.params.map((p) => {
      if (p.kind === "select") {
        values[p.key] = p.default;
        const s = h("select", {}, ...p.options.map((o) => h("option", { value: o.value, selected: o.value === p.default }, tx(o.label)))) as HTMLSelectElement;
        s.addEventListener("change", () => (values[p.key] = s.value));
        return h("label", {}, h("span", {}, tx(p.label)), s);
      }
      if (p.kind === "range") {
        values[p.key] = p.default;
        const seg = h("div", { class: "segmented", role: "group", "aria-label": tx(p.label) }, ...p.labels.map((l, i) =>
          h("button", { type: "button", "aria-pressed": String(p.min + i === p.default), onclick: (e: Event) => {
            values[p.key] = p.min + i;
            for (const b of seg.children) b.setAttribute("aria-pressed", String(b === e.currentTarget));
          } }, tx(l))));
        return h("div", { class: "fields" }, h("span", { class: "small", style: "color:var(--ink2)" }, tx(p.label)), seg);
      }
      const start = tx(p.default);
      values[p.key] = start;
      const el = (p.kind === "textarea"
        ? h("textarea", { rows: 3, maxlength: p.maxLength, placeholder: tx(p.placeholder) }, start)
        : h("input", { value: start, maxlength: p.maxLength, placeholder: tx(p.placeholder) })) as HTMLInputElement;
      el.addEventListener("input", () => (values[p.key] = el.value));
      return h("label", {}, h("span", {}, tx(p.label), p.overlay ? h("small", {}, t("setByPage")) : null), el);
    });
    const extra = h("textarea", { rows: 2, maxlength: 300, placeholder: t("extraPlaceholder") }) as HTMLTextAreaElement;
    const button = h("button", { class: "primary generate", type: "button", disabled: !app.status.ready || st.submitting }, icon("i-plus"), st.submitting ? t("submitting") : t("makeVersion")) as HTMLButtonElement;
    button.addEventListener("click", async () => {
      if (st.submitting) return;
      st.submitting = true;
      button.disabled = true;
      button.lastChild!.textContent = t("submitting");
      try {
        const { job } = await api<{ job: JobView }>("/api/jobs", { method: "POST", body: JSON.stringify({
          artworkId: id, parentId: st.fromSelected && sel ? sel.id : null, templateId: tp.id, params: values, extra: tp.id === "free" ? "" : extra.value, key: st.submitKey,
        }) });
        if (!st.jobs.some((x) => x.id === job.id)) st.jobs.push(job);
        st.selected = job.id;
        st.submitKey = newKey();
        toast(t("submitted"));
        void renderSide();
        poll();
      } catch (e) {
        toast(errorText(e), "error");
      } finally {
        st.submitting = false;
        drawAll();
      }
    });
    const base = h("div", { class: "segmented", role: "group", "aria-label": t("startFrom") },
      h("button", { type: "button", "aria-pressed": String(!st.fromSelected), onclick: () => { st.fromSelected = false; drawForm(); } }, t("original")),
      h("button", { type: "button", "aria-pressed": String(st.fromSelected), disabled: !canBuild, onclick: () => { st.fromSelected = true; drawForm(); } },
        canBuild ? versionLabel(numberOf(sel!.id)) : t("thisVersion")),
    );
    form.replaceChildren(...[
      h("div", { class: "panel-head" }, h("h2", {}, t("newEdit")), h("small", {}, t("onePicture"))),
      h("div", { class: "modes", role: "group", "aria-label": t("effect") }, ...app.templates.map((x) =>
        h("button", { class: "mode", type: "button", "aria-pressed": String(x.id === tp.id), onclick: () => { st.templateId = x.id; st.submitKey = newKey(); drawForm(); } }, art(x.id), tx(x.name)))),
      h("p", { class: "hint", style: "margin-bottom:10px" }, tx(tp.summary)),
      h("div", { class: "fields" },
        ...inputs,
        tp.id === "free" ? null : h("label", {}, h("span", {}, t("alsoAsk")), extra),
        h("div", { class: "fields" }, h("span", { class: "small", style: "color:var(--ink2)" }, t("startFrom")), base),
        h("p", { class: "hint" }, t("costHint")),
        !app.status.ready ? h("p", { class: "error small" }, t("notReadyForm")) : null,
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
    if (app.stopPolling) return;
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
          const v = versionLabel(fresh.jobs.indexOf(j) + 1);
          if (prev && prev !== j.status && j.status === "done") toast(t("versionReady", { v }));
          if (prev && prev !== j.status && j.status === "failed") toast(t("versionFailed", { v }), "error");
        }
        if (JSON.stringify(st.jobs.map((j) => [j.id, j.status, j.ahead])) !== before) {
          const j = selectedJob();
          if (j && j.status === "done" && was.get(j.id) !== "done") st.fromSelected = true;
          drawAll();
          void renderSide();
        }
      } catch { /* keep polling */ }
      if (st.jobs.some(live)) setTimeout(tick, 4000);
      else { alive = false; app.stopPolling = null; }
    };
    app.stopPolling = () => { alive = false; app.stopPolling = null; };
    setTimeout(tick, 2000);
  }

  drawAll();
  if (st.jobs.some(live)) poll();
}

const seconds = (a: string | null, b: string | null) => (a && b ? Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 1000)) : null);

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

export function openLightbox(pic: HTMLCanvasElement | HTMLImageElement) {
  const box = $("#lightbox");
  const img = h("img", { src: pic instanceof HTMLCanvasElement ? pic.toDataURL("image/jpeg", 0.92) : pic.src, alt: "" });
  box.replaceChildren(h("button", { class: "close", type: "button", "aria-label": t("close"), onclick: () => (box.hidden = true) }, icon("i-close")), img);
  box.hidden = false;
  box.onclick = (e) => { if (e.target === box) box.hidden = true; };
}
