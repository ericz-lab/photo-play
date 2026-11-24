/** The exact words over a picture, drawn on a canvas by the page and never by the model, so a typo costs nothing. */

import { t } from "./i18n.ts";
import type { AssetView, JobView, OverlayStyle } from "./state.ts";

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(t("pictureNotLoaded")));
    img.src = src;
  });
}

/** The page makes the small copies the gallery shows: the service has no image library. */
const thumbed = new Set<number>();
export async function ensureThumb(a: AssetView, img: HTMLImageElement) {
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

const FONT_TITLE = '"Noto Serif SC", "Songti SC", serif';
const FONT_HAND = '"Ma Shan Zheng", "Kaiti SC", cursive';

/** The exact words over the picture: drawn here, never by the model, so they can be fixed for free. */
export async function drawOverlay(ctx: CanvasRenderingContext2D, w: number, hgt: number, style: OverlayStyle, o: Record<string, string>) {
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
export async function compose(job: JobView): Promise<HTMLCanvasElement> {
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

export const hasWords = (j: JobView) => j.overlayStyle !== "none" && Object.entries(j.overlay).some(([k, v]) => k !== "position" && k !== "scale" && v);
