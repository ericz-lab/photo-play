import { config } from "./config.ts";
import type { Usage } from "./types.ts";

/**
 * Pictures come from ai-space's model service (`POST /api/model/image`), never
 * from a key or a CLI of this app's own: the space picks the runtime, caps
 * concurrency and records the call in its ledger. The model follows the
 * manifest's `model:` section and the panel's overrides, per tag.
 */

export type ImageCall = { prompt: string; image: Uint8Array; tag: string; timeoutMs: number };

export type ImageAnswer =
  | { ok: true; image: Uint8Array; text: string; model?: string; runtime?: string; callId?: number; usage?: Usage }
  | { ok: false; error: string; model?: string; runtime?: string; callId?: number; usage?: Usage };

type Call = { id?: number; model?: string; runtime?: string; usage?: Usage };

export type Generator = (call: ImageCall, signal?: AbortSignal) => Promise<ImageAnswer>;

export function ready(): { ok: boolean; reason?: string } {
  if (!config.spaceApiUrl || !config.spaceAppToken) return { ok: false, reason: "未接入 ai-space（缺少 SPACE_API_URL 或 SPACE_APP_TOKEN），暂时无法生成" };
  return { ok: true };
}

export const generate: Generator = async (call, signal) => {
  const r = ready();
  if (!r.ok) return { ok: false, error: r.reason! };
  let res: Response;
  try {
    res = await fetch(`${config.spaceApiUrl}/api/model/image`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.spaceAppToken}` },
      body: JSON.stringify({ prompt: call.prompt, tag: call.tag, timeoutMs: call.timeoutMs, images: [{ data: Buffer.from(call.image).toString("base64") }] }),
      signal,
      // A generation takes minutes; Bun's default fetch timeout would cut it.
      timeout: false,
    } as RequestInit);
  } catch (e) {
    return { ok: false, error: `连不上 ai-space：${(e as Error).message}` };
  }
  const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; text?: string; images?: { type: string; data: string }[]; call?: Call } | null;
  const meta = { model: body?.call?.model, runtime: body?.call?.runtime, callId: body?.call?.id, usage: body?.call?.usage };
  if (!body) return { ok: false, error: `ai-space 返回了无法解析的内容（HTTP ${res.status}）` };
  if (!res.ok || !body.ok) return { ok: false, error: body.error || `HTTP ${res.status}`, ...meta };
  const first = body.images?.[0];
  if (!first) return { ok: false, error: "模型没有返回图片", ...meta };
  return { ok: true, image: new Uint8Array(Buffer.from(first.data, "base64")), text: body.text ?? "", ...meta };
};
