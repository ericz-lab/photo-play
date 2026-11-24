/**
 * The effects a person picks from. A template turns validated parameters into
 * one instruction for the model; the words that must be exact (a title, a
 * place, a date) are `overlay` fields the page draws over the picture, so a
 * typo is fixed without paying for another generation. Templates are
 * versioned: a job records the version it ran with.
 */

import { badRequest } from "./errors.ts";

/** Words a person reads, in both page languages (ai-space docs/app-spec.md#app-pages). */
export type Text = { zh: string; en: string };

export type Param =
  | { key: string; label: Text; kind: "select"; options: { value: string; label: Text }[]; default: string; overlay?: false }
  | { key: string; label: Text; kind: "range"; min: number; max: number; labels: Text[]; default: number; overlay?: false }
  | { key: string; label: Text; kind: "text" | "textarea"; maxLength: number; placeholder?: Text; default?: Text; required?: boolean; overlay?: boolean };

/** How the page lays the overlay fields out; `none` has none. */
export type OverlayStyle = "none" | "postcard" | "annotate";

export type Template = {
  id: string;
  version: number;
  name: Text;
  summary: Text;
  /** Emoji on the card. */
  badge: string;
  overlay: OverlayStyle;
  params: Param[];
  prompt: (p: Record<string, string | number>) => string;
};

export type Params = Record<string, string | number>;

/** Said to the model on every edit: what must survive, and no lettering of its own. */
const KEEP = [
  "Edit img1, the person's travel photo, and produce exactly one image.",
  "Keep the same aspect ratio and framing as img1.",
  "Keep every person's identity, face, expression, body shape, pose and clothing unchanged unless this request says otherwise.",
  "Do not add any text, letters, numbers, captions, watermarks or logos.",
].join(" ");

const level = (n: number, words: string[]) => words[Math.max(0, Math.min(words.length - 1, n - 1))]!;

export const TEMPLATES: Template[] = [
  {
    id: "cleanup",
    version: 1,
    name: { zh: "清理背景", en: "Clean up" },
    summary: { zh: "去掉路人和杂物，保留主体", en: "Remove passers-by and clutter, keep the subject" },
    badge: "🧹",
    overlay: "none",
    params: [
      { key: "target", label: { zh: "清理什么", en: "Remove" }, kind: "select", default: "both", options: [{ value: "people", label: { zh: "路人", en: "Passers-by" } }, { value: "clutter", label: { zh: "杂物", en: "Clutter" } }, { value: "both", label: { zh: "路人和杂物", en: "Both" } }] },
      { key: "keep", label: { zh: "保留的主体", en: "Keep" }, kind: "text", maxLength: 60, default: { zh: "画面中的主要人物", en: "the main people in the picture" }, placeholder: { zh: "例如：穿红裙子的女孩", en: "e.g. the girl in the red dress" } },
    ],
    prompt: (p) => {
      const what = p.target === "people" ? "passers-by and other people in the background" : p.target === "clutter" ? "background clutter such as trash, signs, cables, cones and parked vehicles" : "passers-by, other people in the background and background clutter such as trash, signs, cables and parked vehicles";
      return `${KEEP} Keep this subject exactly as it is: ${p.keep}. Remove ${what}, and fill the removed areas with background that matches the scene's texture, light and perspective, so nothing looks erased. Change nothing else.`;
    },
  },
  {
    id: "light",
    version: 1,
    name: { zh: "调光调色", en: "Light & colour" },
    summary: { zh: "修正明暗，换一种色调", en: "Fix the exposure, try another tone" },
    badge: "🌅",
    overlay: "none",
    params: [
      { key: "tone", label: { zh: "色调", en: "Tone" }, kind: "select", default: "natural", options: [
        { value: "natural", label: { zh: "自然通透", en: "Natural" } }, { value: "golden", label: { zh: "暖阳金调", en: "Golden hour" } }, { value: "fresh", label: { zh: "清新日系", en: "Airy" } }, { value: "film", label: { zh: "电影感", en: "Cinematic" } }, { value: "mono", label: { zh: "黑白胶片", en: "Black & white" } },
      ] },
      { key: "strength", label: { zh: "调整程度", en: "Strength" }, kind: "range", min: 1, max: 3, labels: [{ zh: "轻微", en: "Subtle" }, { zh: "适中", en: "Medium" }, { zh: "明显", en: "Strong" }], default: 2 },
    ],
    prompt: (p) => {
      const tones: Record<string, string> = {
        natural: "a clean, natural look: balanced exposure, recovered shadows and highlights, true-to-life colours and a clear sky",
        golden: "warm golden-hour light: soft warm highlights, gentle glow and rich but natural skin tones",
        fresh: "a light, airy Japanese style: bright exposure, soft contrast, slightly cool greens and blues",
        film: "a cinematic grade: gentle teal shadows and warm highlights, deeper contrast, subtle film grain",
        mono: "classic black-and-white film: rich tonal range, deep blacks, fine grain",
      };
      return `${KEEP} Only adjust light and colour; do not move, add or remove anything. Grade the photo towards ${tones[String(p.tone)] ?? tones.natural}. Make the change ${level(Number(p.strength), ["subtle", "moderate", "strong but still photographic"])}.`;
    },
  },
  {
    id: "postcard",
    version: 1,
    name: { zh: "旅行明信片", en: "Postcard" },
    summary: { zh: "做成一张明信片，标题日期精确排版", en: "A postcard, with the title and date set exactly" },
    badge: "💌",
    overlay: "postcard",
    params: [
      { key: "style", label: { zh: "风格", en: "Style" }, kind: "select", default: "vintage", options: [{ value: "vintage", label: { zh: "复古胶片", en: "Vintage film" } }, { value: "watercolor", label: { zh: "水彩边框", en: "Watercolour frame" } }, { value: "minimal", label: { zh: "极简白边", en: "White border" } }] },
      { key: "title", label: { zh: "标题", en: "Title" }, kind: "text", maxLength: 24, placeholder: { zh: "例如：京都的秋天", en: "e.g. Autumn in Kyoto" }, overlay: true },
      { key: "place", label: { zh: "地点", en: "Place" }, kind: "text", maxLength: 30, placeholder: { zh: "例如：京都 · 岚山", en: "e.g. Arashiyama, Kyoto" }, overlay: true },
      { key: "date", label: { zh: "日期", en: "Date" }, kind: "text", maxLength: 20, placeholder: { zh: "例如：2026.10.03", en: "e.g. 2026.10.03" }, overlay: true },
    ],
    prompt: (p) => {
      const styles: Record<string, string> = {
        vintage: "a vintage travel postcard: warm faded film colours, soft vignette, a thin cream paper border with slightly rounded corners",
        watercolor: "an illustrated travel postcard: the photo framed by a loose hand-painted watercolour border in colours taken from the scene",
        minimal: "a minimal modern postcard: a clean even white border and crisp, bright colours",
      };
      return `${KEEP} Turn it into ${styles[String(p.style)] ?? styles.vintage}. Leave the lower fifth of the picture calm and uncluttered (sky, ground or border) so a title can be printed there later. The postcard must contain no writing, stamps with text or postmarks with text.`;
    },
  },
  {
    id: "annotate",
    version: 1,
    name: { zh: "手绘注释", en: "Doodles" },
    summary: { zh: "白色马克笔涂鸦，配一句手写", en: "White marker doodles and a handwritten line" },
    badge: "✏️",
    overlay: "annotate",
    params: [
      { key: "amount", label: { zh: "装饰程度", en: "How many" }, kind: "range", min: 1, max: 3, labels: [{ zh: "少量", en: "A few" }, { zh: "适中", en: "Some" }, { zh: "丰富", en: "Lots" }], default: 2 },
      { key: "title", label: { zh: "标题", en: "Title" }, kind: "text", maxLength: 20, placeholder: { zh: "例如：终于爬上来了！", en: "e.g. Made it to the top!" }, overlay: true },
      { key: "note", label: { zh: "一句话", en: "A line" }, kind: "text", maxLength: 40, placeholder: { zh: "例如：海拔 3000 米的风", en: "e.g. wind at 3000 m" }, overlay: true },
    ],
    prompt: (p) => `${KEEP} Add playful hand-drawn doodles as if drawn on the print with a white paint marker: outlines tracing around the main people, small arrows, stars, hearts, sparkles, swirls and tiny sketches of things in the scene. Use ${level(Number(p.amount), ["a few doodles", "a moderate number of doodles", "plenty of doodles, still leaving the faces clear"])}. Keep faces uncovered. Leave the top left and bottom right corners free of doodles for handwriting added later.`,
  },
  {
    id: "free",
    version: 1,
    name: { zh: "自由描述", en: "Describe it" },
    summary: { zh: "用一句话说想怎么改", en: "Say in one sentence what to change" },
    badge: "🪄",
    overlay: "none",
    params: [{ key: "instruction", label: { zh: "想怎么改", en: "What to change" }, kind: "textarea", maxLength: 500, required: true, placeholder: { zh: "例如：把阴天改成晴天，天空加一点晚霞", en: "e.g. make the grey sky sunny with a touch of sunset" } }],
    prompt: (p) => `${KEEP} The person asks: ${p.instruction}`,
  },
];

export function template(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

/** Parameters as the template allows them: unknown keys dropped, defaults filled, limits enforced. Throws an AppError with the reason. */
export function cleanParams(t: Template, raw: unknown): Params {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: Params = {};
  for (const p of t.params) {
    const v = src[p.key];
    if (p.kind === "select") {
      const s = v === undefined || v === "" ? p.default : String(v);
      if (!p.options.some((o) => o.value === s)) throw badRequest("param_choice", `${p.key}: not one of the choices`, { param: p.key });
      out[p.key] = s;
    } else if (p.kind === "range") {
      const n = v === undefined || v === "" ? p.default : Number(v);
      if (!Number.isInteger(n) || n < p.min || n > p.max) throw badRequest("param_range", `${p.key}: between ${p.min} and ${p.max}`, { param: p.key, min: p.min, max: p.max });
      out[p.key] = n;
    } else {
      const s = (v === undefined ? p.default?.en ?? "" : String(v)).replace(/\s+/g, " ").trim();
      if (s.length > p.maxLength) throw badRequest("param_length", `${p.key}: at most ${p.maxLength} characters`, { param: p.key, max: p.maxLength });
      if (p.required && !s) throw badRequest("param_required", `${p.key} is required`, { param: p.key });
      out[p.key] = s;
    }
  }
  return out;
}

/** The instruction the model gets: the template's, plus the person's own line when there is one. */
export function buildPrompt(t: Template, params: Params, extra: string): string {
  const base = t.prompt(params);
  return extra ? `${base} Also: ${extra}` : base;
}

/** The overlay fields of a template, from the parameters. */
export function overlayOf(t: Template, params: Params): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of t.params) if (p.kind !== "select" && p.kind !== "range" && p.overlay) out[p.key] = String(params[p.key] ?? "");
  return out;
}

/** What the page needs to render the forms; the prompt builders stay on the server. */
export function publicTemplates() {
  return TEMPLATES.map(({ prompt: _prompt, ...t }) => t);
}
