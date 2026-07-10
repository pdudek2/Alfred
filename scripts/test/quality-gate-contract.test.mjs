import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const packageFiles = [
  "apps/api/package.json",
  "apps/desktop/package.json",
  "apps/runner/package.json",
  "packages/adapters/package.json",
  "packages/db/package.json",
  "packages/schema/package.json",
];

async function json(path) {
  return JSON.parse(await readFile(new URL(path, root), "utf8"));
}

test("root quality gates are independent and ordered", async () => {
  const pkg = await json("package.json");
  assert.equal(pkg.scripts.lint, "eslint . --max-warnings 0");
  assert.equal(pkg.scripts["verify:quality"], "pnpm lint && pnpm typecheck && pnpm test && pnpm build");
  assert.equal(pkg.scripts.verify, "pnpm verify:quality && pnpm smoke:electron");
  assert.equal(pkg.scripts["smoke:electron"], "pnpm --filter @alfred/desktop smoke:electron");
  assert.ok(pkg.pnpm.onlyBuiltDependencies.includes("electron"));
});

test("package manifests do not advertise typecheck as lint", async () => {
  for (const path of packageFiles) {
    const pkg = await json(path);
    assert.equal(pkg.scripts?.lint, undefined, path);
  }
});

test("Turbo owns build, test and typecheck but not lint", async () => {
  const turbo = await json("turbo.json");
  assert.equal(turbo.tasks.lint, undefined);
  assert.ok(turbo.tasks.build);
  assert.ok(turbo.tasks.test);
  assert.ok(turbo.tasks.typecheck);
});
