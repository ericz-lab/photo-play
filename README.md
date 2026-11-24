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

## Install

From an ai-space Space's app catalog, or `space app install photo-play`. New pictures need the Space to have a `codex` runtime; without one the works, comparing, editing the words and downloading still work.

## Deploy from git

Push to a bare repository on the host whose `hooks/post-receive` is `deploy/post-receive` (checkout, install, checks, restart), or `DEPLOY_HOST=<ssh host> ./deploy.sh` and then `POST /api/apps/sync` there. The ai-space there must include `POST /api/model/image`.

## Release

Raise `version` in `space.release.yaml` and `package.json`, commit, and push a tag `v<version>`; the release workflow builds, signs and attaches the packages, and the catalog lists them. `bun run pack` builds the same packages locally.

## Samples

The before/after pictures on the start screen are open-licence photos (CC0 / public domain) with one real run of each effect; sources are in [web/samples/README.md](web/samples/README.md).

## License

MIT. This is an [ai-space](https://github.com/ericz-lab/ai-space) app; the contract is its `docs/app-spec.md`.
