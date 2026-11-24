/**
 * The start screen (a drop zone and the effects, each with a real before/after) and the way in
 * for a photo: the picker, a drop anywhere on the page, and the upload that makes an artwork.
 */

import { $, api, busy, h, icon, toast } from "./dom.ts";
import { errorText, t, tx } from "./i18n.ts";
import { app, type ArtworkView, type AssetView, type Template } from "./state.ts";
import annotateAfter from "./samples/annotate-after.jpg";
import annotateBefore from "./samples/annotate-before.jpg";
import cleanupAfter from "./samples/cleanup-after.jpg";
import cleanupBefore from "./samples/cleanup-before.jpg";
import freeAfter from "./samples/free-after.jpg";
import freeBefore from "./samples/free-before.jpg";
import lightAfter from "./samples/light-after.jpg";
import lightBefore from "./samples/light-before.jpg";
import postcardAfter from "./samples/postcard-after.jpg";
import postcardBefore from "./samples/postcard-before.jpg";

// ------------------------------------------------------------------ upload

const picker = $<HTMLInputElement>("#picker");

/** Decode, turn upright, fit into 2048 px and re-encode as JPEG: drops EXIF and stays under the 5 MB the model takes. */
async function prepare(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error(t("pictureUnreadable"));
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
  throw new Error(t("pictureTooLarge"));
}

async function upload(file: File) {
  busy(t("preparing"));
  try {
    const blob = await prepare(file);
    busy(t("uploading"));
    const { asset } = await api<{ asset: AssetView }>("/api/assets", { method: "POST", body: blob });
    const { artwork } = await api<{ artwork: ArtworkView }>("/api/artworks", { method: "POST", body: JSON.stringify({ assetId: asset.id }) });
    location.hash = `#/a/${artwork.id}`;
  } catch (e) {
    toast(errorText(e), "error");
  } finally {
    busy(null);
    picker.value = "";
  }
}

picker.addEventListener("change", () => {
  const f = picker.files?.[0];
  if (f) void upload(f);
});

/** Choose a photo; with an effect, the editor opens on it. */
export function openPicker(templateId: string | null = null) {
  app.pendingTemplate = templateId;
  picker.click();
}

/** A photo dropped anywhere on the page starts a new artwork. */
export function setupDrop() {
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

// ------------------------------------------------------------------ samples

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

/** An effect's picture: the result of its sample run, or a plain photo mark. */
export const art = (id: string): Element => {
  const sample = SAMPLES[id];
  return sample ? h("img", { class: "art", src: sample.after, alt: "", loading: "lazy" }) : h("span", { class: "art art-blank" }, icon("i-photo"));
};

const sampleWords = (id: string): HTMLElement | null =>
  id === "postcard" ? h("span", { class: "words post" }, h("strong", {}, t("sampleCardTitle")), h("span", {}, t("sampleCardPlace")))
  : id === "annotate" ? h("span", { class: "words hand" }, h("strong", {}, t("sampleHandTitle")), h("span", {}, t("sampleHandNote")))
  : null;

function playCard(tp: Template): HTMLElement {
  const name = tx(tp.name);
  const pick = () => openPicker(tp.id);
  const caption = () => [h("strong", {}, name), h("small", {}, tx(tp.summary))];
  const sample = SAMPLES[tp.id];
  if (!sample) return h("button", { class: "play", type: "button", onclick: pick }, art(tp.id), h("span", { class: "caption" }, ...caption()));
  const before = h("img", { class: "before", src: sample.before, alt: "", loading: "lazy", draggable: "false" });
  const line = h("span", { class: "split" });
  const range = h("input", { type: "range", min: 0, max: 100, value: 50, class: "wipe", "aria-label": t("wipeSample", { name }) }) as HTMLInputElement;
  const set = (v: number) => {
    const x = Math.max(0, Math.min(100, v));
    before.style.clipPath = `inset(0 ${100 - x}% 0 0)`;
    line.style.left = `${x}%`;
    range.value = String(Math.round(x));
  };
  range.addEventListener("input", () => set(Number(range.value)));
  const shot = h("div", { class: "shot" },
    h("img", { class: "after", src: sample.after, alt: t("sampleAlt", { name }), loading: "lazy", draggable: "false" }),
    sampleWords(tp.id),
    before, line,
    h("span", { class: "label l" }, t("before")), h("span", { class: "label r" }, t("after")),
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
    h("button", { class: "caption", type: "button", onclick: pick, "aria-label": t("startWith", { name }) },
      h("span", { class: "caption-text" }, ...caption()),
      h("span", { class: "go", "aria-hidden": "true" }, icon("i-arrow"))),
  );
}

// ------------------------------------------------------------------ the screen

export function renderStart(view: HTMLElement) {
  const fine = matchMedia("(pointer: fine)").matches;
  view.replaceChildren(
    h("section", { class: "start" },
      h("div", { class: "drop", id: "drop", role: "button", tabindex: 0, "aria-label": t("chooseTravelPhoto"),
        onclick: () => openPicker(),
        onkeydown: (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPicker(); } } },
        h("span", { class: "uploadmark" }, icon("i-photo")),
        h("strong", {}, fine ? t("dropTravelPhoto") : t("pickTravelPhoto")),
        h("span", { class: "button primary" }, icon("i-up"), t("choosePhoto")),
        h("small", {}, t("formats")),
      ),
      h("div", { class: "section-head" }, h("h2", {}, t("orPickEffect")), h("small", {}, t("orPickEffectHint"))),
      h("div", { class: "play-grid" }, ...app.templates.map(playCard)),
    ),
  );
}
