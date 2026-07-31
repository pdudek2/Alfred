# Phase S7.2 Tooling and Accessibility Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove obsolete agent tooling, put `dev-doctor` under a hermetic process gate, correct project-navigator semantics, and prove Windows junction escapes are rejected on Windows.

**Architecture:** Delete the one-off launcher rather than generalizing it. Test the real `dev-doctor.mjs` executable with temporary command shims and loopback fixtures, keep project selection on native buttons inside a navigation list, and reuse the existing `realpath` boundary while adding a narrow Windows CI execution of the alias regression.

**Tech Stack:** Node.js 22, `node:test`, TypeScript, React 19, Vitest/Testing Library, Electron/Playwright, GitHub Actions, pnpm/Turbo.

## Global Constraints

- Electron remains the only user client; do not add a browser UI or browser-session authentication.
- Do not add a replacement agent launcher, orchestration abstraction, dependency, schema change, migration, or lockfile change.
- Do not change broad renderer styles, visual hierarchy, glass material, terminal layout, or accepted UI copy.
- Keep `dev-doctor` read-only and test it without real Docker, Postgres, runner, API, renderer, external network, or `~/.codex`.
- Preserve project Arrow, Home, and End shortcuts while returning every project destination to native Tab order.
- Use `aria-current="location"` for the active workspace and `aria-current="page"` for the active session.
- Keep the existing canonical `realpath` implementation; do not add a path abstraction or duplicate path-containment logic.
- The Windows CI job runs only `src/main/workspace-path.test.ts`.
- Run `pnpm verify` and a focused diff review before closeout.
- Never push without Patryk's explicit permission.

---

### Task 1: Preserve the approved S7.2 contract

**Files:**
- Create: `docs/superpowers/specs/2026-07-31-phase-s7-2-tooling-accessibility-cleanup-design.md`
- Create: `docs/superpowers/plans/2026-07-31-phase-s7-2-tooling-accessibility-cleanup.md`
- Modify: `docs/superpowers/specs/2026-07-29-post-v1-stabilization-roadmap.md`

**Interfaces:**
- Consumes: the closed S7.1 contract and the S7 residue routes in the canonical roadmap.
- Produces: the approved S7.2 scope, acceptance gate, and task sequence used by every later task.

- [ ] **Step 1: Confirm the planning diff contains only the three intended documents**

Run:

```bash
git status --short
git diff -- \
  docs/superpowers/specs/2026-07-31-phase-s7-2-tooling-accessibility-cleanup-design.md \
  docs/superpowers/plans/2026-07-31-phase-s7-2-tooling-accessibility-cleanup.md \
  docs/superpowers/specs/2026-07-29-post-v1-stabilization-roadmap.md
```

Expected: the two new S7.2 documents plus only S7.2 status/link edits in the
roadmap. Existing untracked `.impeccable/`, `.tmp/`,
`apps/desktop/.impeccable/`, and `apps/desktop/PRODUCT.md` remain untouched.

- [ ] **Step 2: Verify the roadmap has one active next gate**

Run:

```bash
rg -n 'S7\.2 (planned|approved)|Approved phase contract|Approved implementation plan|execute S7\.2' \
  docs/superpowers/specs/2026-07-29-post-v1-stabilization-roadmap.md
```

Expected: the lineage and phase table say S7.2 is planned, both documents are
linked, and the next gate is execution rather than another convergence pass.

- [ ] **Step 3: Commit the approved planning artifacts**

```bash
git add \
  docs/superpowers/specs/2026-07-31-phase-s7-2-tooling-accessibility-cleanup-design.md \
  docs/superpowers/specs/2026-07-29-post-v1-stabilization-roadmap.md
git add -f docs/superpowers/plans/2026-07-31-phase-s7-2-tooling-accessibility-cleanup.md
git commit -m "docs: plan S7.2 tooling accessibility cleanup"
```

---

### Task 2: Delete the historical parallel-agent launcher

**Files:**
- Delete: `scripts/launch-parallel-agents.mjs`
- Delete: `scripts/monitor-parallel-agents.mjs`
- Modify: `package.json:28-30`

**Interfaces:**
- Consumes: root package scripts `agent:launch` and `agent:monitor`.
- Produces: no replacement interface; active agent coordination remains outside repository runtime tooling.

- [ ] **Step 1: Reconfirm that no live caller depends on the helpers**

Run:

```bash
rg -n 'launch-parallel-agents|monitor-parallel-agents|agent:launch|agent:monitor' \
  . \
  --glob '!docs/**' \
  --glob '!node_modules/**' \
  --glob '!.git/**'
```

Expected: only the two root `package.json` entries and the two script files
themselves. If another live caller appears, stop this task and reconverge that
caller rather than deleting through it.

- [ ] **Step 2: Remove the two package commands**

Delete these entries from `package.json` and remove the now-trailing comma from
`verify`:

```json
"agent:launch": "node scripts/launch-parallel-agents.mjs",
"agent:monitor": "node scripts/monitor-parallel-agents.mjs"
```

The final end of the scripts block must be:

```json
"verify:quality": "pnpm lint && pnpm typecheck && pnpm test && pnpm build",
"verify": "pnpm verify:quality && pnpm smoke:electron"
```

- [ ] **Step 3: Delete the obsolete scripts**

Delete `scripts/launch-parallel-agents.mjs` and
`scripts/monitor-parallel-agents.mjs`. Do not retain a task table, generic
wrapper, compatibility command, or deprecation shim.

- [ ] **Step 4: Verify the package and live residue**

Run:

```bash
node -e 'JSON.parse(require("node:fs").readFileSync("package.json", "utf8"))'
if rg -n 'launch-parallel-agents|monitor-parallel-agents|agent:launch|agent:monitor' \
  package.json scripts --glob '!scripts/test/**'; then
  echo "stale agent launcher remains"
  exit 1
fi
pnpm test:scripts
```

Expected: package parsing succeeds, the residue scan has no matches, and the
current script suite passes.

- [ ] **Step 5: Commit the deletion**

```bash
git add package.json scripts/launch-parallel-agents.mjs scripts/monitor-parallel-agents.mjs
git commit -m "chore: remove stale agent launch helpers"
```

---

### Task 3: Put `dev-doctor` under a hermetic process gate

**Files:**
- Create: `scripts/test/dev-doctor.test.mjs`
- Modify only if the characterization exposes a defect: `scripts/dev-doctor.mjs`

**Interfaces:**
- Consumes: the real `node scripts/dev-doctor.mjs` executable, its existing environment variables, and its PASS/FAIL output contract.
- Produces: `runDoctorFixture({ healthy }): Promise<{ code, stdout, stderr }>` inside the test file; no production test seam.

- [ ] **Step 1: Add temporary command shims**

Create `scripts/test/dev-doctor.test.mjs` with the standard imports and this
fixture executable. The same executable is written as `pnpm`, `docker`, and
`ps` so `dev-doctor` still invokes commands exactly as production does:

```js
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const doctorPath = path.join(repoRoot, "scripts", "dev-doctor.mjs");

const fakeToolSource = `#!/usr/bin/env node
const tool = process.argv[1].split(/[\\\\/]/).at(-1);
const args = process.argv.slice(2);
const healthy = process.env.ALFRED_DOCTOR_FIXTURE === "healthy";
if (tool === "pnpm") {
  if (args[0] === "--version") console.log("10.0.0");
  else console.log(JSON.stringify({ tasks: [
    { task: "test" }, { task: "typecheck" }, { task: "build" }
  ] }));
} else if (tool === "docker") {
  if (args[0] === "--version") console.log("Docker version fixture");
  else if (!healthy && args[0] === "info") {
    console.error("fixture daemon unavailable");
    process.exitCode = 1;
  } else if (args[0] === "info") console.log("29.1.5");
  else if (args[0] === "inspect") console.log(JSON.stringify({
    Running: true, Status: "running", Health: { Status: "healthy" }
  }));
  else if (args[0] === "exec") console.log("accepting connections");
} else if (tool === "ps") {
  console.log(healthy
    ? "4242 1 00:10 node apps/runner/src/index.ts"
    : "PID PPID ELAPSED COMMAND");
}`;

async function installFakeTools(binDirectory) {
  for (const name of ["pnpm", "docker", "ps"]) {
    const target = path.join(binDirectory, name);
    await writeFile(target, fakeToolSource);
    await chmod(target, 0o755);
  }
}
```

Do not import or copy any production `dev-doctor` helper into the test.

- [ ] **Step 2: Add loopback fixtures and spawned-process collection**

Add these helpers below the shim code:

```js
async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture port is unavailable");
  return address.port;
}

function runNode(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: repoRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => child.kill("SIGKILL"), 20_000);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ code, stderr, stdout });
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      resolve({ code: null, stderr: `${stderr}\n${error.message}`, stdout });
    });
  });
}

async function runDoctorFixture({ healthy }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "alfred-dev-doctor-"));
  const binDirectory = path.join(root, "bin");
  await mkdir(binDirectory);
  await installFakeTools(binDirectory);

  const http = createHttpServer((request, response) => {
    if (!healthy) {
      response.writeHead(503, { "content-type": "text/plain" });
      response.end("fixture unavailable");
    } else if (request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, service: "alfred-api" }));
    } else {
      response.writeHead(200, { "content-type": "text/html" });
      response.end('<div id="root"></div>');
    }
  });
  const tcp = createTcpServer((socket) => socket.end());
  const httpPort = await listen(http);
  const tcpPort = healthy ? await listen(tcp) : 1;

  try {
    return await runNode([doctorPath], {
      ...process.env,
      ALFRED_DOCTOR_FIXTURE: healthy ? "healthy" : "unhealthy",
      API_HEALTH_URL: `http://127.0.0.1:${httpPort}/health`,
      DATABASE_URL: `postgres://alfred:alfred@127.0.0.1:${tcpPort}/alfred`,
      DESKTOP_HEALTH_URL: `http://127.0.0.1:${httpPort}/`,
      PATH: `${binDirectory}${path.delimiter}${process.env.PATH ?? ""}`,
    });
  } finally {
    await Promise.all([
      new Promise((resolve) => http.close(resolve)),
      healthy ? new Promise((resolve) => tcp.close(resolve)) : Promise.resolve(),
    ]);
    await rm(root, { force: true, recursive: true });
  }
}
```

- [ ] **Step 3: Prove the healthy and unhealthy contracts**

Add the two process tests:

```js
describe("dev doctor", () => {
  it("reports a fully healthy controlled environment", async () => {
    const result = await runDoctorFixture({ healthy: true });

    assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Alfred dev doctor \(read-only\)/);
    assert.match(result.stdout, /PASS docker daemon:/);
    assert.match(result.stdout, /PASS postgres readiness:/);
    assert.match(result.stdout, /PASS runner process:/);
    assert.match(result.stdout, /Summary: 12 passed, 0 failed\./);
  });

  it("finishes all checks and prints recovery actions when dependencies fail", async () => {
    const result = await runDoctorFixture({ healthy: false });

    assert.equal(result.code, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /FAIL docker daemon:/);
    assert.match(result.stdout, /Action: start Docker Desktop/);
    assert.match(result.stdout, /FAIL postgres tcp:/);
    assert.match(result.stdout, /FAIL api health:/);
    assert.match(result.stdout, /FAIL runner process:/);
    assert.match(result.stdout, /FAIL desktop renderer health:/);
    assert.match(result.stdout, /Summary: \d+ passed, [1-9]\d* failed\./);
  });
});
```

- [ ] **Step 4: Run the new test and the complete script suite**

Run:

```bash
node --test scripts/test/dev-doctor.test.mjs
pnpm test:scripts
```

Expected: both doctor scenarios pass and the complete script suite remains
green. If the test exposes an output or exit-status defect, make the minimum
local fix in `scripts/dev-doctor.mjs`, rerun both commands, and include that
file in the task commit. Do not add dependency injection or export production
internals solely for testing.

- [ ] **Step 5: Commit the process gate**

```bash
git add scripts/test/dev-doctor.test.mjs scripts/dev-doctor.mjs
git commit -m "test: cover dev doctor process behavior"
```

If `scripts/dev-doctor.mjs` is unchanged, omit it from `git add`.

---

### Task 4: Replace incomplete tab semantics with navigation-list semantics

**Files:**
- Modify: `apps/desktop/src/renderer/components/ProjectNavigator.tsx:49-238`
- Test: `apps/desktop/src/renderer/components/ProjectNavigator.test.tsx:69-250`
- Test: `apps/desktop/e2e/slice-2-project-shell.spec.ts:68-102,245-273`
- Test: `apps/desktop/e2e/workspace-switch.spec.ts:47-62`

**Interfaces:**
- Consumes: `ProjectNavigator` selection callbacks and existing keyboard shortcut handler.
- Produces: one labelled project list, native project buttons, `aria-current="location"` for the active workspace, and `aria-current="page"` for the active session.

- [ ] **Step 1: Rewrite the component assertions before changing the component**

In `ProjectNavigator.test.tsx`, replace tab queries with a labelled list and
native button queries. The first behavior test must include:

```ts
const projectList = screen.getByRole("list", { name: "Workspaces" });
const projects = within(projectList).getAllByRole("button", { name: / workspace(?:,|$)/i });

expect(projects.map((row) => row.textContent)).toEqual([
  expect.stringContaining("Alfred"),
  expect.stringContaining("ClientApp"),
  expect.stringContaining("Chmury_lab04"),
  expect.stringContaining("GothamTab"),
  expect.stringContaining("IronLog"),
]);
expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
expect(screen.queryByRole("tab")).not.toBeInTheDocument();
expect(screen.getByRole("button", { name: "Alfred workspace" })).toHaveAttribute(
  "aria-current",
  "location",
);
expect(screen.getByRole("button", { name: /Codex · Slice 2/i })).toHaveAttribute(
  "aria-current",
  "page",
);
```

Update the remaining project selectors from `tab` to `button`, replace
`aria-selected="true"` assertions with `aria-current="location"`, and replace
the collapsed-mode `[role="tablist"]` assertion with the labelled list.

- [ ] **Step 2: Require native Tab order and preserved arrow shortcuts**

Update the keyboard test to prove every visible project is a native tab stop
and that the optional Arrow/Home/End shortcuts still select and focus:

```ts
const projectList = screen.getByRole("list", { name: "Workspaces" });
const before = within(projectList)
  .getAllByRole("button", { name: / workspace(?:,|$)/i })
  .map((node) => node.getAttribute("data-label"));

rerender(navigatorWithWaitingSessionInClientApp());
const projectButtons = within(screen.getByRole("list", { name: "Workspaces" }))
  .getAllByRole("button", { name: / workspace(?:,|$)/i });
expect(projectButtons.map((node) => node.getAttribute("data-label"))).toEqual(before);
expect(projectButtons.every((button) => button.tabIndex === 0)).toBe(true);

screen.getByRole("button", { name: /Alfred workspace/i }).focus();
await userEvent.keyboard("{ArrowDown}{End}{Home}{ArrowUp}");
expect(screen.getByRole("button", { name: /IronLog workspace/i })).toHaveFocus();
```

- [ ] **Step 3: Run the focused test and verify the old component fails**

Run:

```bash
pnpm --filter @alfred/desktop exec vitest run src/renderer/components/ProjectNavigator.test.tsx
```

Expected: FAIL because the current component still exposes `tablist`/`tab`,
uses roving `tabIndex`, and reports active state through `aria-selected`.

- [ ] **Step 4: Implement the honest semantic contract**

In `ProjectNavigator.tsx`:

```tsx
<div className="project-list" role="list" aria-label="Workspaces">
  {visibleProjects.map((workspace, visibleIndex) => {
    // existing projection logic remains unchanged
    return (
      <section
        className={`project-item${active ? " is-active" : ""}`}
        key={workspace.id}
        role="listitem"
      >
        <div className="project-row">
          <button
            type="button"
            className="project-row-button"
            aria-current={active ? "location" : undefined}
            aria-label={`${workspace.label} workspace${
              hasAttention
                ? `, ${attentionCount} decision${attentionCount === 1 ? " needs" : "s need"} review`
                : ""
            }`}
            data-attention={hasAttention ? "true" : undefined}
            data-label={workspace.label}
            data-project-destination={workspace.id}
            onClick={() => onSelectWorkspace(workspace.id)}
            onKeyDown={(event) =>
              handleProjectKeyDown(event, visibleProjects, visibleIndex, onSelectWorkspace, projectRefs)
            }
            ref={(element) => {
              projectRefs.current[workspace.id] = element;
            }}
            title={workspace.label}
          >
            {/* existing visible children */}
          </button>
          {/* existing workspace actions */}
        </div>
        {/* existing session group */}
      </section>
    );
  })}
</div>
```

Rename `tabRefs` to `projectRefs`. Remove `role="tab"`, `aria-selected`,
`aria-orientation`, and the explicit `tabIndex`. In
`NavigatorSessionButton`, change:

```tsx
aria-current={active ? "page" : undefined}
```

Do not change CSS classes, DOM ordering, labels, attention projection, overflow
behavior, or selection callbacks.

- [ ] **Step 5: Update the real-Electron role contract**

In `slice-2-project-shell.spec.ts`, replace project `tab` locators with project
`button` locators and change active assertions to:

```ts
const projectButtons = navigator.getByRole("list", { name: "Workspaces" })
  .getByRole("button", { name: / workspace(?:,|$)/i });
await expect(projectButtons).toHaveCount(5);
await expect(
  navigator.getByRole("button", { name: `${longProjectLabel} workspace` }),
).toBeVisible();

await destination.click();
await expect(destination).toHaveAttribute("aria-current", "location");
```

Make the same role and current-state replacements in
`workspace-switch.spec.ts`. After switching to Fixture Beta, assert:

```ts
await expect(betaWorkspace).toHaveAttribute("aria-current", "location");
await expect(alphaWorkspace).not.toHaveAttribute("aria-current");
```

- [ ] **Step 6: Run focused renderer and Electron checks**

Run:

```bash
pnpm --filter @alfred/desktop exec vitest run src/renderer/components/ProjectNavigator.test.tsx
pnpm --filter @alfred/desktop typecheck
pnpm --filter @alfred/desktop... build
pnpm --filter @alfred/desktop exec playwright test \
  --config playwright.config.ts \
  e2e/slice-2-project-shell.spec.ts \
  e2e/workspace-switch.spec.ts
```

Expected: the component suite passes with no tab roles, and both real-Electron
scenarios pass without renderer errors or xterm replacement.

- [ ] **Step 7: Commit the navigator correction**

```bash
git add \
  apps/desktop/src/renderer/components/ProjectNavigator.tsx \
  apps/desktop/src/renderer/components/ProjectNavigator.test.tsx \
  apps/desktop/e2e/slice-2-project-shell.spec.ts \
  apps/desktop/e2e/workspace-switch.spec.ts
git commit -m "fix: use honest project navigation semantics"
```

---

### Task 5: Gate Windows directory-junction escapes

**Files:**
- Test: `apps/desktop/src/main/workspace-path.test.ts:60-98`
- Modify: `.github/workflows/ci.yml:36-55`

**Interfaces:**
- Consumes: `isAllowedWorkspacePath(resolvedPath, allowedRoots)` and Node `fs.symlink`.
- Produces: one cross-platform directory-alias regression that creates a real `junction` on Windows and a narrow Windows CI job that executes it.

- [ ] **Step 1: Add the cross-platform alias regression**

Add this test next to the existing symlink escape cases in
`workspace-path.test.ts`:

```ts
it("rejects directory aliases that escape an allowed root, including Windows junctions", async () => {
  const allowedRoot = path.join(temporaryDirectory, "junction-workspace");
  const outsideRoot = path.join(temporaryDirectory, "junction-outside");
  const outsideFile = path.join(outsideRoot, "secret.txt");
  const aliasPath = path.join(allowedRoot, "outside-alias");
  await fs.mkdir(allowedRoot);
  await fs.mkdir(outsideRoot);
  await fs.writeFile(outsideFile, "secret\n");
  await fs.symlink(
    outsideRoot,
    aliasPath,
    process.platform === "win32" ? "junction" : "dir",
  );

  await expect(
    resolveWorkspacePathForReveal(
      { cwd: allowedRoot, path: "outside-alias/secret.txt" },
      { allowedRoots: [allowedRoot] },
    ),
  ).resolves.toEqual({
    ok: false,
    error: "Path is outside registered workspaces.",
    resolvedPath: path.join(aliasPath, "secret.txt"),
  });
});
```

Do not skip the test on non-Windows platforms. The platform branch controls
only which native alias primitive is created.

- [ ] **Step 2: Run the focused path suite locally**

Run:

```bash
pnpm --filter @alfred/desktop exec vitest run src/main/workspace-path.test.ts
```

Expected: PASS on macOS/Linux using a directory symlink. The existing
`realpath` implementation should need no production change.

- [ ] **Step 3: Add the narrow Windows CI job**

Append this job to `.github/workflows/ci.yml` at the same level as `quality`
and `electron-smoke`:

```yaml
  windows-path-security:
    runs-on: windows-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v6
      - uses: pnpm/action-setup@v6
        with:
          version: 10.0.0
      - uses: actions/setup-node@v6
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @alfred/desktop exec vitest run src/main/workspace-path.test.ts
```

Do not add Electron installation, build, smoke, or the full repository suite to
this job.

- [ ] **Step 4: Validate the workflow shape and local test**

Run:

```bash
pnpm --filter @alfred/desktop exec vitest run src/main/workspace-path.test.ts
node -e '
const text = require("node:fs").readFileSync(".github/workflows/ci.yml", "utf8");
for (const value of ["windows-path-security:", "runs-on: windows-latest", "src/main/workspace-path.test.ts"]) {
  if (!text.includes(value)) throw new Error(`missing ${value}`);
}
'
```

Expected: the focused suite passes and the workflow contains the narrow
Windows job. The first remote run of the job is a required implementation gate
before S7.2 closeout.

- [ ] **Step 5: Commit the Windows gate**

```bash
git add apps/desktop/src/main/workspace-path.test.ts .github/workflows/ci.yml
git commit -m "test: gate Windows junction path escapes"
```

---

### Task 6: Run integration, review, and closeout gates

**Files:**
- Modify after accepted implementation: `docs/superpowers/specs/2026-07-31-phase-s7-2-tooling-accessibility-cleanup-design.md`
- Modify after accepted implementation: `docs/superpowers/specs/2026-07-29-post-v1-stabilization-roadmap.md`

**Interfaces:**
- Consumes: Tasks 2-5 and the existing repository quality gates.
- Produces: focused review evidence and, only after local plus remote acceptance, the S7.2 closeout record.

- [ ] **Step 1: Run the complete local gate**

Run:

```bash
TURBO_FORCE=true pnpm verify
```

Expected: lint, root and package typechecks/tests/builds, script tests, and the
macOS Electron suite all pass without cached task reuse.

- [ ] **Step 2: Run the residue and scope checks**

Run:

```bash
git diff --check
if rg -n 'launch-parallel-agents|monitor-parallel-agents|agent:launch|agent:monitor' \
  package.json scripts --glob '!scripts/test/**'; then
  echo "stale agent launcher remains"
  exit 1
fi
if rg -n 'role="tablist"|role="tab"|aria-selected' \
  apps/desktop/src/renderer/components/ProjectNavigator.tsx; then
  echo "stale project tab semantics remain"
  exit 1
fi
git diff --name-only HEAD~4..HEAD
```

Expected: no whitespace errors or stale contracts. The diff is limited to the
approved docs, two deleted tooling scripts, root package scripts, one script
test, navigator/unit/Electron tests, one path test, and CI workflow.

- [ ] **Step 3: Perform the focused review**

Review `main...HEAD` for these exact invariants:

- no live caller was left behind by launcher deletion;
- the doctor harness spawns the real script and cannot reach real services;
- every temporary server/process/directory is closed on success and failure;
- project rail visual classes and ordering are unchanged;
- native buttons remain Tab-reachable and optional arrow navigation still
  selects/focuses the same workspace;
- the Windows job executes the real junction branch;
- no dependency, lockfile, schema, migration, browser, auth, runner, or broad
  CSS change entered the diff.

Expected: 0 Critical, 0 Important, and 0 Minor findings. Fix any finding in the
owning task and rerun its focused tests plus the complete gate.

- [ ] **Step 4: Verify the remote Windows gate**

After Patryk separately authorizes push/PR work, wait for
`windows-path-security` and the existing `quality`/`electron-smoke` jobs.

Expected: all three jobs pass. Do not mark the junction criterion Observed from
a macOS run; only the Windows job proves the native junction branch.

- [ ] **Step 5: Record closeout only after acceptance**

Append a `## Closeout` section to the S7.2 spec containing implementation
commit hashes, exact focused/full gate totals, Windows job evidence, review
findings, and confirmation that visual output did not change. Update the
roadmap phase table and lineage from S7.2 planned to complete, and replace the
next gate with either a newly converged roadmap item or `none planned`.

- [ ] **Step 6: Commit the closeout documents**

```bash
git add \
  docs/superpowers/specs/2026-07-31-phase-s7-2-tooling-accessibility-cleanup-design.md \
  docs/superpowers/specs/2026-07-29-post-v1-stabilization-roadmap.md
git commit -m "docs: close phase S7.2"
```

Do not push this commit without Patryk's explicit permission.
