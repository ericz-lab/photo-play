/**
 * PhotoPlay service. Contract (ai-space docs/app-spec.md, "service"): read
 * PORT, bind 127.0.0.1 only, answer GET /healthz with 200, log to stdout,
 * exit on SIGTERM within 10 seconds.
 */
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import index from "../web/index.html";
import iconFile from "../icon.svg" with { type: "file" };
import { createRoutes } from "./app.ts";
import { blobDir, config, databasePath } from "./config.ts";
import { Store } from "./db.ts";
import { generate } from "./model.ts";
import { Worker } from "./worker.ts";

const dbPath = databasePath();
if (dbPath !== ":memory:") await mkdir(dirname(dbPath), { recursive: true });
const store = new Store(dbPath, blobDir());
const interrupted = store.recoverInterrupted();
if (interrupted) console.log(`[photo-play] ${interrupted} job(s) cut off by the last stop marked for checking`);
const worker = new Worker(store, generate, config.jobTimeoutSec * 1000);

// The bundled release (dist/index.js) finds its page's files from the working directory: run in its
// own. The data paths above are already absolute.
if (!Bun.main.endsWith(".ts")) process.chdir(import.meta.dir);

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: config.port,
  idleTimeout: 60,
  maxRequestBodySize: config.maxUploadBytes + 1024 * 1024,
  routes: {
    "/": index,
    "/icon.svg": () => new Response(Bun.file(iconFile), { headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400" } }),
    ...createRoutes({ store, worker, maxUploadBytes: config.maxUploadBytes, publicBase: config.publicBase }),
  },
  fetch: () => new Response("not found", { status: 404 }),
  development: process.env.NODE_ENV !== "production" ? { hmr: true, console: true } : false,
});

console.log(`[photo-play] listening on http://127.0.0.1:${server.port}`);
void worker.kick();

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    console.log(`[photo-play] ${signal}, shutting down`);
    server.stop();
    // A job still running is marked for checking on the next boot; it is not retried.
    setTimeout(() => process.exit(0), 500).unref();
  });
}
