import type { Store } from "./db.ts";
import type { Generator } from "./model.ts";

/**
 * One generation at a time, oldest first, from the jobs table: a restart loses
 * nothing that was waiting. `kick` is called after every new job and at boot.
 */
export class Worker {
  private busy = false;
  constructor(private readonly store: Store, private readonly generate: Generator, private readonly timeoutMs: number, private readonly log = (m: string) => console.log(`[photo-play] ${m}`)) {}

  get running(): boolean { return this.busy; }

  /** Resolves when the queue is empty; a second call while running returns at once. */
  async kick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      for (let j = this.store.nextQueued(); j; j = this.store.nextQueued()) await this.run(j.id);
    } finally {
      this.busy = false;
    }
  }

  private async run(id: number) {
    const job = this.store.getJob(id)!;
    const base = this.store.getAsset(job.baseId);
    this.store.markRunning(id);
    if (!base) return this.store.finishJob(id, "failed", { error: "the picture to start from is gone" });
    const started = Date.now();
    let answer;
    try {
      const image = new Uint8Array(await Bun.file(this.store.assetPath(base)).arrayBuffer());
      answer = await this.generate({ prompt: job.prompt, image, tag: job.templateId, timeoutMs: this.timeoutMs }, AbortSignal.timeout(this.timeoutMs + 60_000));
    } catch (e) {
      answer = { ok: false as const, error: (e as Error).message };
    }
    const meta = { model: answer.model, runtime: answer.runtime, callId: answer.callId, usage: answer.usage };
    if (!answer.ok) {
      this.log(`job ${id} failed after ${Math.round((Date.now() - started) / 1000)}s: ${answer.error}`);
      return this.store.finishJob(id, "failed", { ...meta, error: answer.error });
    }
    try {
      const result = await this.store.putAsset(answer.image, "result");
      this.store.finishJob(id, "done", { ...meta, resultId: result.id, text: answer.text });
      this.log(`job ${id} done in ${Math.round((Date.now() - started) / 1000)}s`);
    } catch (e) {
      this.store.finishJob(id, "failed", { ...meta, error: `the result could not be saved: ${(e as Error).message}` });
    }
  }
}
