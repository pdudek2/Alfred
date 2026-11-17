import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { acquireLock, CI_JOBS, ciPassed, deploy, mainHash, releasesToPrune } from "../deploy-preview.mjs";

const run = (name, status, conclusion, started_at = "2026-11-17T10:00:00Z") => ({ name, status, conclusion, started_at });

test("CI passes only when every job's latest run succeeded", () => {
  assert.equal(ciPassed(CI_JOBS.map((job) => run(job, "completed", "success"))), true);
  // A fresh push has no check runs for a while.
  assert.equal(ciPassed([]), false);
  assert.equal(ciPassed(CI_JOBS.slice(1).map((job) => run(job, "completed", "success"))), false);
  assert.equal(ciPassed(CI_JOBS.map((job, index) => run(job, index === 0 ? "in_progress" : "completed", index === 0 ? null : "success"))), false);
  assert.equal(ciPassed(CI_JOBS.map((job, index) => run(job, "completed", index === 1 ? "failure" : "success"))), false);
  // A rerun that passed replaces the failed run.
  const rerun = [...CI_JOBS.map((job) => run(job, "completed", "success", "2026-11-17T11:00:00Z")), run("quality", "completed", "failure", "2026-11-17T10:00:00Z")];
  assert.equal(ciPassed(rerun), true);
});

test("the main hash follows everything the main process loads", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "alfred-hash-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const write = (file, text) => {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), text);
  };
  write("apps/desktop/dist/main/main.js", "main");
  write("apps/desktop/dist/main/preload.cjs", "preload");
  write("apps/desktop/dist/shared/ipc.js", "shared");
  write("packages/schema/dist/index.js", "schema");
  write("pnpm-lock.yaml", "lock");
  write("apps/desktop/dist/renderer/index.html", "renderer");
  const base = mainHash(dir, "45.2.1");

  write("apps/desktop/dist/renderer/index.html", "renderer 2");
  assert.equal(mainHash(dir, "45.2.1"), base);
  assert.notEqual(mainHash(dir, "45.3.0"), base);
  for (const file of ["apps/desktop/dist/main/preload.cjs", "apps/desktop/dist/shared/ipc.js", "packages/schema/dist/index.js", "pnpm-lock.yaml"]) {
    const before = readFileSync(path.join(dir, file), "utf8");
    write(file, `${before} changed`);
    assert.notEqual(mainHash(dir, "45.2.1"), base, file);
    write(file, before);
  }
  assert.equal(mainHash(dir, "45.2.1"), base);
});

test("pruning keeps the running, current and ready releases and one previous", () => {
  const releases = ["a", "b", "c", "d", "e"].map((name, index) => ({ path: `/r/${name}`, builtAt: index }));
  // Two window reloads in a row: the main process still runs from a, current and ready moved on to d and e.
  assert.deepEqual(releasesToPrune(releases, { running: "/r/a", current: "/r/d", ready: "/r/e" }).sort(), ["/r/b"]);
  assert.deepEqual(releasesToPrune(releases, { running: "/r/e", current: "/r/e", ready: undefined }).sort(), ["/r/a", "/r/b", "/r/c"]);
});

test("a lock held by a process that is gone is taken over", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "alfred-lock-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const lock = path.join(dir, "deploy.lock");
  assert.equal(acquireLock(lock, 10, () => true), true);
  assert.equal(acquireLock(lock, 11, () => true), false);
  assert.equal(acquireLock(lock, 11, () => false), true);
  assert.equal(readFileSync(lock, "utf8"), "11");
});

test("an automatic deploy does not fetch while main is the commit it last built, and waits for CI", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "alfred-deploy-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const calls = [];
  let checkRuns = [];
  const fake = (command, args) => {
    calls.push([command, ...args].join(" "));
    if (args.includes("ls-remote")) return "abc123\trefs/heads/main\n";
    if (args.includes("rev-parse")) return "def456\n";
    if (command === "gh") return JSON.stringify({ check_runs: checkRuns });
    return "";
  };
  const env = { ALFRED_DEPLOY_ROOT: root };
  writeFileSync(path.join(root, "deploy-state.json"), JSON.stringify({ lastBuilt: "abc123" }));
  assert.equal(await deploy({ argv: ["--auto", "--checkout", "/repo"], env, run: fake, log: () => {} }), "unchanged");
  assert.equal(calls.some((call) => call.includes("fetch")), false);

  writeFileSync(path.join(root, "deploy-state.json"), JSON.stringify({ lastBuilt: "older" }));
  checkRuns = CI_JOBS.slice(0, 3).map((job) => run(job, "completed", "success"));
  assert.equal(await deploy({ argv: ["--auto", "--checkout", "/repo"], env, run: fake, log: () => {} }), "ci-pending");
  assert.equal(calls.some((call) => call.includes("fetch")), true);
  assert.equal(calls.some((call) => call.includes("archive")), false);
});

test("a commit that is already current or ready is not built again", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "alfred-deploy-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const release = path.join(root, "releases", "def456");
  mkdirSync(release, { recursive: true });
  symlinkSync(release, path.join(root, "current"));
  const calls = [];
  const fake = (command, args) => {
    calls.push([command, ...args].join(" "));
    return args.includes("rev-parse") ? "def456\n" : "";
  };
  assert.equal(await deploy({ argv: ["--ref", "my-branch", "--checkout", "/repo"], env: { ALFRED_DEPLOY_ROOT: root }, run: fake, log: () => {} }), "unchanged");
  assert.equal(calls.some((call) => call.includes("archive") || call.startsWith("gh")), false);
});
