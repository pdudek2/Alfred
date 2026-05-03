import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outdir = resolve(repoRoot, "api/.generated");
const outfile = resolve(outdir, "app.cjs");
const workspaceAliases = new Map([
  ["@alfred/db", resolve(repoRoot, "packages/db/src/index.ts")],
  ["@alfred/schema", resolve(repoRoot, "packages/schema/src/index.ts")],
]);

const alfredWorkspaceAliasPlugin = {
  name: "alfred-workspace-alias",
  setup(build) {
    build.onResolve({ filter: /^@alfred\/(db|schema)$/ }, (args) => {
      const path = workspaceAliases.get(args.path);
      if (!path) return undefined;

      return { path };
    });
  },
};

await mkdir(outdir, { recursive: true });

await build({
  bundle: true,
  entryPoints: [resolve(repoRoot, "apps/api/src/app.ts")],
  external: ["pg-native"],
  format: "cjs",
  outfile,
  platform: "node",
  plugins: [alfredWorkspaceAliasPlugin],
  sourcemap: false,
  target: "node22",
});

await writeFile(
  resolve(outdir, "app.d.cts"),
  'export { createApp } from "../../apps/api/src/app";\n',
);
