import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outdir = resolve(repoRoot, "api/.generated");
const outfile = resolve(outdir, "app.mjs");

await mkdir(outdir, { recursive: true });

await build({
  bundle: true,
  entryPoints: [resolve(repoRoot, "apps/api/src/app.ts")],
  external: ["pg-native"],
  format: "esm",
  outfile,
  platform: "node",
  sourcemap: false,
  target: "node22",
});

await writeFile(
  resolve(outdir, "app.d.mts"),
  'export { createApp } from "../../apps/api/src/app";\n',
);
