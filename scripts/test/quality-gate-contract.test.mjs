import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const packageFiles = [
  "apps/desktop/package.json",
  "packages/schema/package.json",
];

async function json(path) {
  return JSON.parse(await readFile(new URL(path, root), "utf8"));
}

function activeYaml(source) {
  return source.replace(/^[\t ]*#.*(?:\r?\n|$)/gm, "");
}

function yamlBlock(source, name, indent = 0) {
  const lines = source.split(/\r?\n/);
  const header = `${" ".repeat(indent)}${name}:`;
  const start = lines.findIndex((line) => line.trimEnd() === header);
  assert.notEqual(start, -1, `missing ${name} block at indent ${indent}`);

  let end = start + 1;
  for (; end < lines.length; end += 1) {
    if (!lines[end].trim()) continue;
    const currentIndent = lines[end].match(/^ */)[0].length;
    if (currentIndent <= indent) break;
  }
  return lines.slice(start, end).join("\n");
}

test("root quality gates are independent and ordered", async () => {
  const pkg = await json("package.json");
  assert.equal(pkg.scripts.lint, "eslint . --max-warnings 0");
  assert.equal(pkg.scripts["verify:quality"], "pnpm lint && pnpm typecheck && pnpm test && pnpm build");
  assert.equal(pkg.scripts.verify, "pnpm verify:quality && pnpm smoke:electron");
  assert.ok(!pkg.pnpm.onlyBuiltDependencies.includes("electron"));
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

// Only what keeps a gate honest: when it runs, a locked install, what each job checks, and no soft failures.
test("CI runs every gate on pull requests and main without softening failures", async () => {
  const workflow = activeYaml(await readFile(new URL(".github/workflows/ci.yml", root), "utf8"));
  const triggers = yamlBlock(workflow, "on");
  assert.match(triggers, /^ {2}pull_request:\s*$/m);
  assert.match(yamlBlock(triggers, "push", 2), /^ {4}branches: \[main\]\s*$/m);

  const jobs = yamlBlock(workflow, "jobs");
  const job = (name) => yamlBlock(jobs, name, 2);
  for (const name of ["quality", "electron-smoke", "windows-path-security"]) {
    assert.match(job(name), /^ {6}- run: pnpm install --frozen-lockfile\s*$/m, name);
  }
  assert.match(job("quality"), /^ {6}- run: pnpm verify:quality\s*$/m);
  // The smoke runs against a build that includes the packages the desktop app depends on.
  assert.match(
    job("electron-smoke"),
    /^ {6}- run: pnpm --filter @alfred\/desktop\.\.\. build\s*$[\s\S]*^ {6}- run: pnpm smoke:electron\s*$/m,
  );
  assert.match(
    job("windows-path-security"),
    /^ {6}- run: pnpm --filter @alfred\/desktop exec vitest run src\/main\/workspace-path\.test\.ts\s*$/m,
  );
  assert.doesNotMatch(workflow, /^\s*continue-on-error:\s*true\s*$/m);
});
