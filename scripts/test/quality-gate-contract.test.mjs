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

function assertCiWorkflowShape(source) {
  const workflow = activeYaml(source);
  assert.match(workflow, /^on:\s*$/m);
  const triggers = yamlBlock(workflow, "on");
  assert.match(triggers, /^ {2}pull_request:\s*$/m);
  assert.match(triggers, /^ {2}workflow_dispatch:\s*$/m);
  const push = yamlBlock(triggers, "push", 2);
  assert.match(push, /^ {4}branches: \[main\]\s*$/m);

  const permissions = yamlBlock(workflow, "permissions");
  assert.match(permissions, /^ {2}contents: read\s*$/m);
  const concurrency = yamlBlock(workflow, "concurrency");
  assert.match(
    concurrency,
    /^ {2}group: ci-\$\{\{ github\.workflow \}\}-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}\s*$/m,
  );
  assert.match(concurrency, /^ {2}cancel-in-progress: true\s*$/m);

  const jobs = yamlBlock(workflow, "jobs");
  const quality = yamlBlock(jobs, "quality", 2);
  assert.match(quality, /^ {4}runs-on: ubuntu-latest\s*$/m);
  assert.match(quality, /^ {4}timeout-minutes: 20\s*$/m);
  assert.match(quality, /^ {6}- run: pnpm install --frozen-lockfile\s*$/m);
  assert.match(quality, /^ {6}- run: pnpm verify:quality\s*$/m);

  const electron = yamlBlock(jobs, "electron-smoke", 2);
  assert.match(electron, /^ {4}runs-on: macos-14\s*$/m);
  assert.match(electron, /^ {4}timeout-minutes: 15\s*$/m);
  assert.match(electron, /^ {6}- run: pnpm install --frozen-lockfile\s*$/m);
  assert.match(electron, /^ {6}- run: pnpm --filter @alfred\/desktop\.\.\. build\s*$/m);
  assert.match(
    electron,
    /^ {6}- run: pnpm --filter @alfred\/desktop\.\.\. build\s*$[\s\S]*^ {6}- run: pnpm smoke:electron\s*$/m,
  );
  assert.match(
    electron,
    /^ {6}- name: Upload Electron diagnostics\s*\n {8}if: failure\(\)\s*\n {8}uses: actions\/upload-artifact@v7\s*\n {8}with:\s*\n {10}name: electron-smoke-diagnostics\s*\n {10}path: \|\s*\n {12}output\/playwright\s*\n {10}if-no-files-found: warn\s*$/m,
  );

  const windowsPathSecurity = yamlBlock(jobs, "windows-path-security", 2);
  assert.match(windowsPathSecurity, /^ {4}runs-on: windows-latest\s*$/m);
  assert.match(windowsPathSecurity, /^ {4}timeout-minutes: 10\s*$/m);
  assert.match(windowsPathSecurity, /^ {6}- run: pnpm install --frozen-lockfile\s*$/m);
  assert.match(
    windowsPathSecurity,
    /^ {6}- run: pnpm --filter @alfred\/desktop exec vitest run src\/main\/workspace-path\.test\.ts\s*$/m,
  );
  assert.doesNotMatch(workflow, /^\s*continue-on-error:\s*true\s*$/m);
}

test("root quality gates are independent and ordered", async () => {
  const pkg = await json("package.json");
  assert.equal(pkg.scripts.lint, "eslint . --max-warnings 0");
  assert.equal(pkg.scripts["verify:quality"], "pnpm lint && pnpm typecheck && pnpm test && pnpm build");
  assert.equal(pkg.scripts.verify, "pnpm verify:quality && pnpm smoke:electron");
  assert.equal(pkg.scripts["smoke:electron"], "pnpm --filter @alfred/desktop smoke:electron");
  assert.ok(!pkg.pnpm.onlyBuiltDependencies.includes("electron"));
  const desktop = await json("apps/desktop/package.json");
  assert.equal(
    desktop.scripts["smoke:electron"],
    "electron --version && playwright test --config playwright.config.ts",
  );
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

test("CI exposes quality, electron smoke and Windows path security without weakening failures", async () => {
  const workflow = await readFile(new URL(".github/workflows/ci.yml", root), "utf8");
  assertCiWorkflowShape(workflow);
});

test("CI workflow contract catches missing critical safeguards", async () => {
  const workflow = await readFile(new URL(".github/workflows/ci.yml", root), "utf8");
  assert.doesNotThrow(() => assertCiWorkflowShape(workflow));

  const mutations = [
    ["push trigger", /^ {2}push:\s*\n {4}branches: \[main\]\s*\n/m, ""],
    ["concurrency", /^concurrency:\s*\n(?:^[\t ]+.*(?:\n|$))+/m, ""],
    [
      "dependency-aware desktop build",
      "pnpm --filter @alfred/desktop... build",
      "pnpm --filter @alfred/desktop build",
    ],
    ["Windows path security job", /^ {2}windows-path-security:\s*\n(?:^ {4,}.*(?:\n|$))+/m, ""],
  ];
  for (const [name, pattern, replacement] of mutations) {
    const mutated = workflow.replace(pattern, replacement);
    assert.notEqual(mutated, workflow, `${name} mutation must change the fixture`);
    assert.throws(() => assertCiWorkflowShape(mutated), undefined, name);
  }
});
