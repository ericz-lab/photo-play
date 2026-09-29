/**
 * The effects a person picks from. A template turns validated parameters into
 * one instruction for the model; the words that must be exact (a title, a
 * place, a date) are `overlay` fields the page draws over the picture, so a
 * typo is fixed without paying for another generation. Templates are
 * versioned: a job records the version it ran with.
 */

export type Param =
  | { key: string; label: string; kind: "select"; options: { value: string; label: string }[]; default: string; overlay?: false }
  | { key: string; label: string; kind: "range"; min: number; max: number; labels: string[]; default: number; overlay?: false }
  | { key: string; label: string; kind: "text" | "textarea"; maxLength: number; placeholder?: string; default?: string; required?: boolean; overlay?: boolean };

/** How the page lays the overlay fields out; `none` has none. */
export type OverlayStyle = "none" | "postcard" | "annotate";

export type Template = {
  id: string;
  version: number;
  name: string;
  summary: string;
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
    name: "清理背景",
    summary: "去掉路人和杂物，保留主体",
    badge: "🧹",
    overlay: "none",
    params: [
      { key: "target", label: "清理什么", kind: "select", default: "both", options: [{ value: "people", label: "路人" }, { value: "clutter", label: "杂物" }, { value: "both", label: "路人和杂物" }] },
      { key: "keep", label: "保留的主体", kind: "text", maxLength: 60, default: "画面中的主要人物", placeholder: "例如：穿红裙子的女孩" },
    ],
    prompt: (p) => {
      const what = p.target === "people" ? "passers-by and other people in the background" : p.target === "clutter" ? "background clutter such as trash, signs, cables, cones and parked vehicles" : "passers-by, other people in the background and background clutter such as trash, signs, cables and parked vehicles";
      return `${KEEP} Keep this subject exactly as it is: ${p.keep}. Remove ${what}, and fill the removed areas with background that matches the scene's texture, light and perspective, so nothing looks erased. Change nothing else.`;
    },
  },
  {
    id: "light",
    version: 1,
    name: "调光调色",
    summary: "修正明暗，换一种色调",
    badge: "🌅",
    overlay: "none",
    params: [
      { key: "tone", label: "色调", kind: "select", default: "natural", options: [
        { value: "natural", label: "自然通透" }, { value: "golden", label: "暖阳金调" }, { value: "fresh", label: "清新日系" }, { value: "film", label: "电影感" }, { value: "mono", label: "黑白胶片" },
      ] },
      { key: "strength", label: "调整程度", kind: "range", min: 1, max: 3, labels: ["轻微", "适中", "明显"], default: 2 },
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
    name: "旅行明信片",
    summary: "做成一张明信片，标题日期精确排版",
    badge: "💌",
    overlay: "postcard",
    params: [
      { key: "style", label: "风格", kind: "select", default: "vintage", options: [{ value: "vintage", label: "复古胶片" }, { value: "watercolor", label: "水彩边框" }, { value: "minimal", label: "极简白边" }] },
      { key: "title", label: "标题", kind: "text", maxLength: 24, placeholder: "例如：京都的秋天", overlay: true },
      { key: "place", label: "地点", kind: "text", maxLength: 30, placeholder: "例如：京都 · 岚山", overlay: true },
      { key: "date", label: "日期", kind: "text", maxLength: 20, placeholder: "例如：2026.10.03", overlay: true },
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
    name: "手绘注释",
    summary: "白色马克笔涂鸦，配一句手写",
    badge: "✏️",
    overlay: "annotate",
    params: [
      { key: "amount", label: "装饰程度", kind: "range", min: 1, max: 3, labels: ["少量", "适中", "丰富"], default: 2 },
      { key: "title", label: "标题", kind: "text", maxLength: 20, placeholder: "例如：终于爬上来了！", overlay: true },
      { key: "note", label: "一句话", kind: "text", maxLength: 40, placeholder: "例如：海拔 3000 米的风", overlay: true },
    ],
    prompt: (p) => `${KEEP} Add playful hand-drawn doodles as if drawn on the print with a white paint marker: outlines tracing around the main people, small arrows, stars, hearts, sparkles, swirls and tiny sketches of things in the scene. Use ${level(Number(p.amount), ["a few doodles", "a moderate number of doodles", "plenty of doodles, still leaving the faces clear"])}. Keep faces uncovered. Leave the top left and bottom right corners free of doodles for handwriting added later.`,
  },
  {
    id: "free",
    version: 1,
    name: "自由描述",
    summary: "用一句话说想怎么改",
    badge: "🪄",
    overlay: "none",
    params: [{ key: "instruction", label: "想怎么改", kind: "textarea", maxLength: 500, required: true, placeholder: "例如：把阴天改成晴天，天空加一点晚霞" }],
    prompt: (p) => `${KEEP} The person asks: ${p.instruction}`,
  },
];

export function template(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

/** Parameters as the template allows them: unknown keys dropped, defaults filled, limits enforced. Throws with the reason. */
export function cleanParams(t: Template, raw: unknown): Params {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: Params = {};
  for (const p of t.params) {
    const v = src[p.key];
    if (p.kind === "select") {
      const s = v === undefined || v === "" ? p.default : String(v);
      if (!p.options.some((o) => o.value === s)) throw new Error(`${p.label}：不是可选的值`);
      out[p.key] = s;
    } else if (p.kind === "range") {
      const n = v === undefined || v === "" ? p.default : Number(v);
      if (!Number.isInteger(n) || n < p.min || n > p.max) throw new Error(`${p.label}：应在 ${p.min} 到 ${p.max} 之间`);
      out[p.key] = n;
    } else {
      const s = (v === undefined ? p.default ?? "" : String(v)).replace(/\s+/g, " ").trim();
      if (s.length > p.maxLength) throw new Error(`${p.label}：最多 ${p.maxLength} 个字`);
      if (p.required && !s) throw new Error(`请填写${p.label}`);
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
