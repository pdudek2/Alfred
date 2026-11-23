import { spawn } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, realpathSync, renameSync, symlinkSync, unlinkSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { BrowserWindow } from "electron";
import { desktopStateChannels, type DesktopRestartRequest, type DesktopUpdate } from "../shared/desktop-state-ipc.js";
import { beginEntrySwitch, finishEntrySwitch, isTrustedDocumentUrl, isTrustedIpcRecipient, trustedIpc } from "./trusted-ipc.js";

const CHECK_INTERVAL_MS = 5 * 60_000;

/** Settings the Preview launcher passes to the release it starts; they stay out of the terminals. */
export const PREVIEW_DEPLOY_ENV_KEYS = ["ALFRED_DEPLOY_ROOT", "ALFRED_DEPLOY_CHECKOUT", "ALFRED_DEPLOY_RELEASE"] as const;
const FIRST_CHECK_MS = 60_000;
/** A resume list older than this is from a restart that never came back, not from this start. */
const RESTART_RESUME_MAX_AGE_MS = 2 * 60_000;
const MAX_RESUMED_SESSIONS = 200;

type Release = { sha: string; ref: string; subject: string; mainHash: string; electron: string; path: string };

/**
 * The release a ready.json names, or nothing for a missing or partial file, or one that points outside the deploy
 * folder's releases: its renderer becomes the trusted window and its Electron binary runs on restart.
 */
export function readRelease(file: string, releasesDir: string): Release | undefined {
  try {
    const value = JSON.parse(readFileSync(file, "utf8")) as Partial<Release>;
    const fields = [value.sha, value.ref, value.subject, value.mainHash, value.electron, value.path];
    if (!fields.every((field) => typeof field === "string" && field.length > 0)) return undefined;
    const release = realpathSync(value.path!);
    const inside = (child: string, parent: string) => child.startsWith(`${parent}${path.sep}`);
    if (!inside(release, realpathSync(releasesDir)) || !inside(realpathSync(value.electron!), release)) return undefined;
    return { ...value, path: release } as Release;
  } catch {
    return undefined;
  }
}

/** A release whose main-process code hashes the same loads with a window reload; anything else needs a restart. */
export function updateFor(ready: Release, ownMainHash: string | undefined, reloadFailed = false): DesktopUpdate {
  return {
    sha: ready.sha,
    subject: ready.subject,
    ref: ready.ref,
    action: ownMainHash !== undefined && ready.mainHash === ownMainHash ? "reload" : "restart",
    ...(reloadFailed ? { reloadFailed } : {}),
  };
}

/** How the restarted Alfred starts: the target's app folder with the same user data. */
export function relaunchOptions(target: Release, userDataPath: string): { execPath: string; args: string[] } {
  return { execPath: target.electron, args: [path.join(target.path, "apps", "desktop"), `--user-data-dir=${userDataPath}`] };
}

/** Points `current` at a release without a moment where it is missing. */
function pointCurrentAt(root: string, release: string): void {
  const next = path.join(root, `.current-${process.pid}`);
  if (existsSync(next)) unlinkSync(next);
  symlinkSync(release, next);
  renameSync(next, path.join(root, "current"));
}

export type PreviewDeploy = {
  /** The renderer file a window loads: the one a reload moved to, or this release's own. */
  rendererFile(fallback: string): string;
  /** Called where the quit flow is cancelled, so a later Quit is a plain quit. */
  cancelRestart(): void;
  /** True for a restart that waited until Alfred was quiet and resumes the agents: it stops nothing worth asking about. */
  restartSkipsQuitDialog(): boolean;
  /** Called once the quit flow has saved everything; true when it restarts into a new release. */
  relaunchIfArmed(relaunch: (options: { execPath: string; args: string[] }) => void, userDataPath: string): boolean;
};

/**
 * Alfred Preview runs a built release from `ALFRED_DEPLOY_ROOT` (see scripts/deploy-preview.mjs). This watches for a
 * newer ready release, tells the window, and loads it by a reload or a restart. Without that variable it does nothing.
 */
export function startPreviewDeploy(options: {
  env: NodeJS.ProcessEnv;
  appPath: string;
  windowMaterialQuery: Record<string, string> | undefined;
  window: () => BrowserWindow | null;
  quit: () => void;
  userDataPath: string;
  restartBlockers: () => string[];
  liveAgentClientIds: () => string[];
}): PreviewDeploy | null {
  const resumeFile = path.join(options.userDataPath, "restart-resume.json");
  trustedIpc.handle(desktopStateChannels.takeRestartResume, () => takeRestartResume(resumeFile));
  const configuredRoot = options.env.ALFRED_DEPLOY_ROOT;
  const ownRelease = (() => {
    try {
      return realpathSync(options.env.ALFRED_DEPLOY_RELEASE ?? path.resolve(options.appPath, "../.."));
    } catch {
      return undefined;
    }
  })();
  const root = configuredRoot && existsSync(configuredRoot) ? realpathSync(configuredRoot) : undefined;
  // Only an Alfred started from one of the folder's releases manages it; a dev instance that inherited the variable
  // must not record itself as running or move `current`.
  if (!root || !ownRelease || !ownRelease.startsWith(`${path.join(root, "releases")}${path.sep}`)) {
    // The window asks either way; an Alfred that does not run releases never has a new one.
    trustedIpc.handle(desktopStateChannels.getUpdate, () => null);
    trustedIpc.handle(desktopStateChannels.applyUpdate, () => undefined);
    return null;
  }
  const releasesDir = path.join(root, "releases");
  const ownMainHash = (() => {
    try {
      return (JSON.parse(readFileSync(path.join(ownRelease, "release.json"), "utf8")) as { mainHash?: string }).mainHash;
    } catch {
      return undefined;
    }
  })();
  writeFileSync(path.join(root, "running.json"), JSON.stringify({ release: ownRelease, mainHash: ownMainHash, pid: process.pid }));

  let rendererRelease = ownRelease;
  let reloadFailed = false;
  let restartTarget: Release | null = null;
  let restartRequest: (DesktopRestartRequest & { resume: string[] }) | null = null;
  const readyFile = path.join(root, "ready.json");
  const pending = (): Release | undefined => {
    const ready = readRelease(readyFile, releasesDir);
    return !ready || ready.path === rendererRelease ? undefined : ready;
  };
  const currentUpdate = (): DesktopUpdate | null => {
    const ready = pending();
    return ready ? updateFor(ready, ownMainHash, reloadFailed) : null;
  };
  const notify = () => {
    const window = options.window();
    if (window && !window.isDestroyed() && isTrustedIpcRecipient(window.webContents)) {
      window.webContents.send(desktopStateChannels.update, currentUpdate());
    }
  };

  let watcher: FSWatcher | null = null;
  try {
    watcher = watch(root, { persistent: false }, (_event, name) => {
      if (name === "ready.json") {
        reloadFailed = false;
        notify();
      }
    });
  } catch (error) {
    console.error("Alfred could not watch for new releases.", error);
  }

  const reload = (ready: Release) => {
    const window = options.window();
    if (!window || window.isDestroyed()) return;
    const file = path.join(ready.path, "apps", "desktop", "dist", "renderer", "index.html");
    const url = pathToFileURL(file);
    for (const [key, value] of Object.entries(options.windowMaterialQuery ?? {})) url.searchParams.set(key, value);
    const previous = path.join(rendererRelease, "apps", "desktop", "dist", "renderer", "index.html");
    beginEntrySwitch(url.toString());
    const contents = window.webContents;
    const landed = (_event: unknown, navigated: string) => {
      if (!isTrustedDocumentUrl(navigated, url.toString())) return;
      contents.off("did-navigate", landed);
      contents.off("did-fail-load", failed);
      finishEntrySwitch(true);
      rendererRelease = ready.path;
      pointCurrentAt(root, rendererRelease);
    };
    const failed = (_event: unknown, _code: number, _description: string, _url: string, isMainFrame: boolean) => {
      if (!isMainFrame) return;
      contents.off("did-navigate", landed);
      contents.off("did-fail-load", failed);
      finishEntrySwitch(false);
      reloadFailed = true;
      void window.loadFile(previous, options.windowMaterialQuery ? { query: options.windowMaterialQuery } : undefined);
    };
    contents.on("did-navigate", landed);
    contents.on("did-fail-load", failed);
    void window.loadFile(file, options.windowMaterialQuery ? { query: options.windowMaterialQuery } : undefined).catch(() => undefined);
  };

  trustedIpc.handle(desktopStateChannels.getUpdate, () => currentUpdate());
  trustedIpc.handle(desktopStateChannels.applyUpdate, (_event, action: unknown, restart: unknown): { waitingFor: string[] } | undefined => {
    const ready = pending();
    if (!ready) return undefined;
    const update = updateFor(ready, ownMainHash);
    if (action === "reload" && update.action === "reload") reload(ready);
    if (action === "restart") {
      const now = typeof restart === "object" && restart !== null && (restart as DesktopRestartRequest).now === true;
      const waitingFor = now ? [] : options.restartBlockers();
      if (waitingFor.length > 0) return { waitingFor };
      restartTarget = ready;
      // Main names the agents to resume from its own sessions; the window only chooses when.
      restartRequest = { ...(now ? { now } : {}), resume: options.liveAgentClientIds() };
      options.quit();
    }
    return undefined;
  });

  // The background check runs the deploy script of the release this main process came from, never a checkout's.
  const checkout = options.env.ALFRED_DEPLOY_CHECKOUT;
  const script = path.join(ownRelease, "scripts", "deploy-preview.mjs");
  let checking = false;
  const check = () => {
    if (checking || !checkout || !existsSync(script)) return;
    checking = true;
    const log = path.join(root, "deploy.log");
    const child = spawn("nice", ["-n", "10", "node", script, "--auto", "--checkout", checkout], {
      env: { ...options.env, ALFRED_DEPLOY_ROOT: root },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const append = (chunk: Buffer) => {
      try {
        appendFileSync(log, chunk);
      } catch {
        // A full disk only loses the log.
      }
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("error", () => { checking = false; });
    child.on("close", () => { checking = false; });
  };
  const timers = checkout
    ? [setTimeout(check, FIRST_CHECK_MS), setInterval(check, CHECK_INTERVAL_MS)]
    : [];
  for (const timer of timers) timer.unref();

  return {
    rendererFile: (fallback) => rendererRelease === ownRelease
      ? fallback
      : path.join(rendererRelease, "apps", "desktop", "dist", "renderer", "index.html"),
    cancelRestart: () => {
      restartTarget = null;
      restartRequest = null;
    },
    restartSkipsQuitDialog: () => restartTarget !== null && restartRequest?.now !== true,
    relaunchIfArmed: (relaunch, userDataPath) => {
      watcher?.close();
      if (!restartTarget) return false;
      pointCurrentAt(root, restartTarget.path);
      // Written only here, past the last chance to cancel, so a cancelled restart never resumes anything later.
      if (restartRequest?.resume.length) writeRestartResume(resumeFile, restartRequest.resume);
      relaunch(relaunchOptions(restartTarget, userDataPath));
      return true;
    },
  };
}

function clientIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 200).slice(0, MAX_RESUMED_SESSIONS)
    : [];
}

function writeRestartResume(file: string, clientIds: string[]): void {
  const temporary = `${file}.${process.pid}`;
  writeFileSync(temporary, JSON.stringify({ clientIds, writtenAt: Date.now() }), { mode: 0o600 });
  renameSync(temporary, file);
}

/** The ids a restart asked to resume, read once; a missing, broken or old file resumes nothing. */
export function takeRestartResume(file: string, now = Date.now()): string[] {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
    unlinkSync(file);
  } catch {
    return [];
  }
  try {
    const value = JSON.parse(text) as { clientIds?: unknown; writtenAt?: unknown };
    const age = typeof value.writtenAt === "number" ? now - value.writtenAt : Number.NaN;
    if (!(age >= -5_000 && age <= RESTART_RESUME_MAX_AGE_MS)) return [];
    return clientIds(value.clientIds);
  } catch {
    return [];
  }
}
