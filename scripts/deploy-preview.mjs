#!/usr/bin/env node
// Builds a commit into its own release folder for Alfred Preview, checks that it starts, and marks it ready.
// Usage: pnpm deploy:preview [--ref <ref>] [--auto] [--checkout <repo>]
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

/** The jobs of .github/workflows/ci.yml; main deploys only when every one of them passed on the commit. */
export const CI_JOBS = ["quality", "electron-smoke", "electron-smoke-linux", "windows-path-security"];

export const DEFAULT_DEPLOY_ROOT = path.join(os.homedir(), "Library", "Application Support", "Alfred Deploy");

/** Check runs as GitHub lists them; a job counts by its latest run. An empty or partial list is not a pass. */
export function ciPassed(checkRuns) {
  return CI_JOBS.every((job) => {
    const runs = checkRuns.filter((run) => run.name === job);
    const latest = runs.sort((a, b) => String(b.started_at ?? "").localeCompare(String(a.started_at ?? "")))[0];
    return latest?.status === "completed" && latest.conclusion === "success";
  });
}

/** Everything the main process loads, so equal hashes mean a window reload keeps a compatible main process. */
export function mainHash(releaseDir, electronVersion) {
  const hash = createHash("sha256");
  hash.update(`electron ${electronVersion}\n`);
  const roots = ["apps/desktop/dist/main", "apps/desktop/dist/shared", "packages/schema/dist", "pnpm-lock.yaml"];
  for (const root of roots) {
    for (const file of listFiles(path.join(releaseDir, root))) {
      hash.update(`${path.relative(releaseDir, file)}\n`);
      hash.update(readFileSync(file));
    }
  }
  return hash.digest("hex");
}

function listFiles(target) {
  if (!existsSync(target)) return [];
  if (statSync(target).isFile()) return [target];
  return readdirSync(target).sort().flatMap((name) => listFiles(path.join(target, name)));
}

/**
 * Releases to delete: never the one the running app started its main process from, the one the launcher starts
 * next (current), or the ready one; of the rest, the newest one stays as the previous release.
 */
export function releasesToPrune(releases, { running, current, ready }) {
  const kept = new Set([running, current, ready].filter(Boolean));
  const others = releases.filter((release) => !kept.has(release.path)).sort((a, b) => b.builtAt - a.builtAt);
  return others.slice(1).map((release) => release.path);
}

/** A lock file holds the pid of the deploy that runs; a pid that is gone frees it. Creating it is atomic. */
export function acquireLock(lockPath, pid, isAlive) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(lockPath, String(pid), { flag: "wx" });
      return true;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const holder = Number(readFileSync(lockPath, "utf8").trim());
      if (holder === pid) return true;
      if (Number.isInteger(holder) && isAlive(holder)) return false;
      rmSync(lockPath, { force: true });
    }
  }
  return false;
}

/** Replaces a file or symlink in one step, so a reader never sees it missing or half written. */
function replaceAtomically(target, write) {
  const staging = `${target}.${process.pid}.tmp`;
  rmSync(staging, { force: true });
  write(staging);
  renameSync(staging, target);
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

function defaultRun(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...options });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed (${result.status ?? result.signal}): ${`${result.stdout ?? ""}${result.stderr ?? ""}`.slice(-2000)}`);
  }
  return result.stdout ?? "";
}

/**
 * One deploy. `run` executes a command and returns its stdout (tests pass a fake). Returns what happened:
 * "locked", "unchanged", "ci-pending" or "built".
 */
export async function deploy({ argv, env = process.env, run = defaultRun, log: print = console.log, launchCheck = checkLaunch }) {
  const options = parseArgs(argv);
  mkdirSync(env.ALFRED_DEPLOY_ROOT || DEFAULT_DEPLOY_ROOT, { recursive: true });
  // One spelling of every path, so a release compares equal to what `current` and running.json name.
  const root = realpathSync(env.ALFRED_DEPLOY_ROOT || DEFAULT_DEPLOY_ROOT);
  const log = (line) => {
    print(line);
    try {
      appendFileSync(path.join(root, "deploy.log"), `${new Date().toISOString()} ${line}\n`);
    } catch {
      // The log is for reading later; a deploy does not fail on it.
    }
  };
  // The main checkout, also when run from a worktree: it holds the .env a release links.
  const checkout = options.checkout ?? env.ALFRED_DEPLOY_CHECKOUT
    ?? path.dirname(run("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim());
  const git = (...args) => run("git", ["-C", checkout, ...args]).trim();
  const releasesDir = path.join(root, "releases");
  mkdirSync(releasesDir, { recursive: true });

  const lockPath = path.join(root, "deploy.lock");
  if (!acquireLock(lockPath, process.pid, pidAlive)) {
    log("Another deploy is running.");
    return "locked";
  }
  try {
    const statePath = path.join(root, "deploy-state.json");
    const state = readJson(statePath) ?? {};
    const ref = options.ref ?? "origin/main";
    const isMain = ref === "origin/main";

    if (options.auto) {
      const remote = git("ls-remote", "origin", "refs/heads/main").split(/\s+/)[0];
      // A commit that failed to build waits for the next one instead of building again every five minutes.
      if (remote && (remote === state.lastBuilt || remote === state.lastFailed)) return "unchanged";
    }
    if (isMain || ref.startsWith("origin/")) git("fetch", "--quiet", "origin");
    const sha = git("rev-parse", `${ref}^{commit}`);

    const releaseDir = path.join(releasesDir, sha);
    const readyPath = path.join(root, "ready.json");
    const currentPath = path.join(root, "current");
    const currentTarget = existsSync(currentPath) ? realpathSync(currentPath) : undefined;
    if (currentTarget === releaseDir || readJson(readyPath)?.path === releaseDir) {
      if (isMain) writeFileSync(statePath, JSON.stringify({ ...state, lastBuilt: sha }));
      return "unchanged";
    }

    if (isMain) {
      const runs = JSON.parse(run("gh", ["api", `repos/{owner}/{repo}/commits/${sha}/check-runs?per_page=100`], { cwd: checkout }));
      if (!ciPassed(runs.check_runs ?? [])) {
        log(`CI has not passed on ${sha.slice(0, 7)} yet.`);
        return "ci-pending";
      }
    }

    let release = readJson(path.join(releaseDir, "release.json"));
    if (!release) {
      try {
        release = await build({ checkout, sha, ref, releasesDir, releaseDir, run, git, log, launchCheck });
      } catch (error) {
        if (isMain) writeFileSync(statePath, JSON.stringify({ ...state, lastFailed: sha }));
        log(`Build of ${sha.slice(0, 7)} failed: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      }
    }
    if (currentTarget === undefined) {
      // The first release: the launcher has nothing to start yet, so it starts this one.
      replaceAtomically(currentPath, (staging) => symlinkSync(releaseDir, staging));
      log(`Current: ${sha.slice(0, 7)} ${release.subject}`);
      return "built";
    }
    replaceAtomically(readyPath, (staging) => writeFileSync(staging, JSON.stringify({ path: releaseDir, ...release }, null, 2)));
    if (isMain) writeFileSync(statePath, JSON.stringify({ ...state, lastBuilt: sha }));
    log(`Ready: ${sha.slice(0, 7)} ${release.subject}`);

    const running = readJson(path.join(root, "running.json"));
    const releases = readdirSync(releasesDir)
      .filter((name) => !name.startsWith("."))
      .map((name) => {
        const dir = path.join(releasesDir, name);
        return { path: dir, builtAt: readJson(path.join(dir, "release.json"))?.builtAt ?? 0 };
      });
    for (const old of releasesToPrune(releases, { running: running?.release, current: currentTarget, ready: releaseDir })) {
      rmSync(old, { recursive: true, force: true });
      log(`Removed ${path.basename(old).slice(0, 7)}.`);
    }
    return "built";
  } finally {
    rmSync(lockPath, { force: true });
  }
}

async function build({ checkout, sha, ref, releasesDir, releaseDir, run, git, log, launchCheck }) {
  const staging = path.join(releasesDir, `.build-${sha}`);
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  try {
    log(`Building ${sha.slice(0, 7)} (${ref})…`);
    run("/bin/sh", ["-c", `git -C "${checkout}" archive ${sha} | tar -x -C "${staging}"`]);
    if (existsSync(path.join(checkout, ".env"))) symlinkSync(path.join(checkout, ".env"), path.join(staging, ".env"));
    run("pnpm", ["install", "--frozen-lockfile"], { cwd: staging });
    const desktop = path.join(staging, "apps", "desktop");
    run("pnpm", ["exec", "install-electron"], { cwd: desktop });
    run("pnpm", ["--filter", "@alfred/desktop...", "build"], { cwd: staging });
    const electronVersion = run("node", ["-p", "require('electron/package.json').version"], { cwd: desktop }).trim();
    await launchCheck(desktop);
    rmSync(releaseDir, { recursive: true, force: true });
    renameSync(staging, releaseDir);
    const release = {
      sha,
      ref,
      subject: git("log", "-1", "--format=%s", sha),
      mainHash: mainHash(releaseDir, electronVersion),
      electron: run("node", ["-p", "require('electron')"], { cwd: path.join(releaseDir, "apps", "desktop") }).trim(),
      builtAt: Date.now(),
    };
    writeFileSync(path.join(releaseDir, "release.json"), JSON.stringify(release, null, 2));
    return release;
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

/** Starts the built app once, isolated from the user's home and Alfred's deploy settings, and waits for the Deck. */
async function checkLaunch(desktop) {
  const { createRequire } = await import("node:module");
  const { _electron } = createRequire(path.join(desktop, "package.json"))("@playwright/test");
  const home = path.join(os.tmpdir(), `alfred-deploy-check-${process.pid}`);
  mkdirSync(home, { recursive: true });
  const app = await _electron.launch({
    args: [desktop, `--user-data-dir=${path.join(home, "user-data")}`],
    cwd: home,
    env: { PATH: process.env.PATH ?? "", HOME: home, TMPDIR: home, ALFRED_E2E_HIDDEN: "1", ALFRED_DESKTOP_WORKSPACE_CWD: home },
    timeout: 60_000,
  });
  try {
    const window = await app.firstWindow();
    await window.getByRole("button", { name: "Deck", exact: true }).waitFor({ timeout: 60_000 });
  } finally {
    await app.close().catch(() => undefined);
    rmSync(home, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const options = { auto: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--auto") options.auto = true;
    else if (arg === "--ref") options.ref = argv[++index];
    else if (arg === "--checkout") options.checkout = argv[++index];
    else throw new Error(`Unknown argument ${arg}. Usage: deploy-preview [--ref <ref>] [--auto] [--checkout <repo>]`);
  }
  return options;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  deploy({ argv: process.argv.slice(2) }).then(
    () => undefined,
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    },
  );
}
