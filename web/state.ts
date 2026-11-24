/** What the API sends, and the little the page shares between its screens. */

import type { Text } from "./i18n.ts";

export type Param =
  | { key: string; label: Text; kind: "select"; options: { value: string; label: Text }[]; default: string }
  | { key: string; label: Text; kind: "range"; min: number; max: number; labels: Text[]; default: number }
  | { key: string; label: Text; kind: "text" | "textarea"; maxLength: number; placeholder?: Text; default?: Text; required?: boolean; overlay?: boolean };
export type OverlayStyle = "none" | "postcard" | "annotate";
export type Template = { id: string; version: number; name: Text; summary: Text; badge: string; overlay: OverlayStyle; params: Param[] };
export type AssetView = { id: number; type: string; width: number; height: number; bytes: number; url: string; thumbUrl: string | null };
type Usage = { inputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; outputTokens: number };
export type JobView = {
  id: number; artworkId: number; parentId: number | null; baseId: number; templateId: string; overlayStyle: OverlayStyle;
  params: Record<string, string | number>; extra: string; overlay: Record<string, string>; status: "queued" | "running" | "done" | "failed" | "unknown";
  result: AssetView | null; text: string | null; model: string | null; runtime: string | null; callId: number | null; usage: Usage | null; error: string | null;
  createdAt: string; startedAt: string | null; finishedAt: string | null; ahead: number;
};
export type ArtworkView = { id: number; title: string; originalId: number; createdAt: string; updatedAt: string; original: AssetView; cover: AssetView; versions: number; pending: number; templates: string[] };

export const app = {
  templates: [] as Template[],
  /** `reason` is a code (i18n.ts, `reason.<code>`). */
  status: { ready: true, reason: null } as { ready: boolean; reason: string | null },
  /** The effect picked on the start screen before the photo, handed to the editor. */
  pendingTemplate: null as string | null,
  /** The artwork open in the editor; null: the start screen. */
  openId: null as number | null,
  stopPolling: null as (() => void) | null,
};

export const tpl = (id: string) => app.templates.find((x) => x.id === id);
export const thumb = (a: AssetView) => a.thumbUrl ?? a.url;
