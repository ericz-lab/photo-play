# PhotoPlay 旅行出片

Upload a travel photo, pick an effect, adjust a few settings, and get a new version to compare and download. You don't write any prompts. Every edit is a separate version. The original and older versions are never overwritten, and you can continue from any result or redo from the original.

MVP effects: clean up the background, light and colour, travel postcard, hand-drawn notes, and free description. On postcards and notes, the title, place and date are drawn by the page over the picture rather than by the model. They come out exact, and fixing a typo costs no new generation.

## Use

- Open the app at its public URL (`url: /` in `space.yaml` resolves to `https://photo-play.<SPACE_DOMAIN>/`), or on the host at `http://127.0.0.1:8975`.
- The panel shows the `recent` widget.
- Generation takes one to three minutes per picture. It runs on the server, one at a time, so closing the page loses nothing.

## How pictures are made

Through ai-space's model service, `POST /api/model/image`: the space runs Codex's image tool and records the call in its ledger. The app holds no key and spawns no CLI. `model.default: codex/intermediate` in `space.yaml` picks the runtime, and the panel can override it per tag (the tag is the template id). The image tool's own cost is not reported, so the page says the cost is unknown.

## Run locally

```bash
bun install
PORT=8975 SPACE_API_URL=http://127.0.0.1:8700 SPACE_APP_TOKEN=... bun src/index.ts
bun run check            # typecheck + tests
```

Without `SPACE_API_URL` and `SPACE_APP_TOKEN` the page opens but says generation is not ready.

## Deploy

Push to a bare repository on the host whose `hooks/post-receive` is `deploy/post-receive` (checkout, install, sync, restart), or `DEPLOY_HOST=<ssh host> ./deploy.sh` and then `POST /api/apps/sync` there. The ai-space there must include `POST /api/model/image` (ai-space commit `feat(model): make images through codex's image tool`).

This is an [ai-space](https://github.com/Zhang-Shubo/ai-space) app; the contract is its `docs/app-spec.md`.
