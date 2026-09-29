import type { ImageType } from "./images.ts";

export type Asset = {
  id: number;
  sha256: string;
  /** `upload`: a person's photo; `result`: what the model made; `thumb`: a small copy the page made. */
  kind: "upload" | "result" | "thumb";
  type: ImageType;
  width: number;
  height: number;
  bytes: number;
  file: string;
  thumbId: number | null;
  createdAt: string;
};

export type Artwork = { id: number; title: string; originalId: number; createdAt: string; updatedAt: string };

/** `unknown`: a restart cut the job off and whether the model made the picture cannot be told. */
export type JobStatus = "queued" | "running" | "done" | "failed" | "unknown";

export type Usage = { inputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; outputTokens: number };

export type Job = {
  id: number;
  artworkId: number;
  /** The version this one was made from; null when made from the original. */
  parentId: number | null;
  /** The picture the model was given: the original, or the parent's result. */
  baseId: number;
  templateId: string;
  templateVersion: number;
  params: Record<string, string | number>;
  extra: string;
  overlay: Record<string, string>;
  /** What the model was told. */
  prompt: string;
  status: JobStatus;
  resultId: number | null;
  text: string | null;
  model: string | null;
  runtime: string | null;
  /** The row in ai-space's model ledger. */
  callId: number | null;
  usage: Usage | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};
