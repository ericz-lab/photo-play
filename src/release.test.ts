import { expect, test } from "bun:test";
import { join } from "node:path";

// The package's declaration (space.release.yaml, spec 2) and the git deployment's (space.yaml,
// spec 1) describe the same app until the deployment moves to the package: they must not drift.

const root = join(import.meta.dir, "..");
const read = async (file: string) => Bun.YAML.parse(await Bun.file(join(root, file)).text()) as Record<string, unknown>;

test("space.release.yaml carries space.yaml's components", async () => {
  const source = await read("space.yaml");
  const release = await read("space.release.yaml");
  const { spec: _s, service, url: _u, deploy: _d, ...components } = source;
  const { spec, version, requires, offline, launch, build, ...releaseComponents } = release;
  expect(releaseComponents).toEqual(components);
  expect(spec).toBe(2);
  expect(version).toBe((await Bun.file(join(root, "package.json")).json()).version);
  expect(requires).toMatchObject({ spaceApi: 1 });
  expect(offline).toBeDefined();
  expect(launch).toMatchObject({ kind: "process", entry: "dist/index.js", health: (service as { health: string }).health });
  expect(build).toMatchObject({ run: "bun run build" });
  // The page, its sample pictures and the app icon: dist/ holds the bundled page.
  expect((build as { include: string[] }).include).toEqual(expect.arrayContaining(["dist", "icon.svg"]));
});

// A Space before ai-space PR 190 validates a package by writing its components out with Bun.YAML.stringify
// and reading them back; Bun 1.3.0 cannot read " ... " in a quoted string, so such a package fails to install there.
test("space.release.yaml survives Bun's YAML round trip", async () => {
  const release = await read("space.release.yaml");
  expect(Bun.YAML.parse(Bun.YAML.stringify(release))).toEqual(release);
});
