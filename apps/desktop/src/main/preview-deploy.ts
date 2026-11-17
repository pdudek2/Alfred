import { spawn } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, realpathSync, renameSync, symlinkSync, unlinkSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { BrowserWindow } from "electron";
import { desktopStateChannels, type DesktopUpdate } from "../shared/desktop-state-ipc.js";
import { beginEntrySwitch, finishEntrySwitch, isTrustedIpcRecipient, trustedIpc } from "./trusted-ipc.js";

const CHECK_INTERVAL_MS = 5 * 60_000;
const FIRST_CHECK_MS = 60_000;

type Release = { sha: string; ref: string; subject: string; mainHash: string; electron: string; path: string };

/** The release a ready.json names, or nothing for a missing or partial file. */
export function readRelease(file: string): Release | undefined {
  try {
    const value = JSON.parse(readFileSync(file, "utf8")) as Partial<Release>;
    const fields = [value.sha, value.ref, value.subject, value.mainHash, value.electron, value.path];
    return fields.every((field) => typeof field === "string" && field.length > 0) ? value as Release : undefined;
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
}): PreviewDeploy | null {
  const root = options.env.ALFRED_DEPLOY_ROOT;
  if (!root || !existsSync(root)) {
    // The window asks either way; an Alfred that does not run releases never has a new one.
    trustedIpc.handle(desktopStateChannels.getUpdate, () => null);
    trustedIpc.handle(desktopStateChannels.applyUpdate, () => undefined);
    return null;
  }
  const ownRelease = realpathSync(options.env.ALFRED_DEPLOY_RELEASE ?? path.resolve(options.appPath, "../.."));
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
  const readyFile = path.join(root, "ready.json");
  const pending = (): Release | undefined => {
    const ready = readRelease(readyFile);
    if (!ready || !existsSync(ready.path)) return undefined;
    return realpathSync(ready.path) === rendererRelease ? undefined : ready;
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
    const landed = () => {
      contents.off("did-fail-load", failed);
      finishEntrySwitch(true);
      rendererRelease = realpathSync(ready.path);
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
    contents.once("did-navigate", landed);
    contents.on("did-fail-load", failed);
    void window.loadFile(file, options.windowMaterialQuery ? { query: options.windowMaterialQuery } : undefined).catch(() => undefined);
  };

  trustedIpc.handle(desktopStateChannels.getUpdate, () => currentUpdate());
  trustedIpc.handle(desktopStateChannels.applyUpdate, (_event, action: unknown) => {
    const ready = pending();
    if (!ready) return;
    const update = updateFor(ready, ownMainHash);
    if (action === "reload" && update.action === "reload") reload(ready);
    if (action === "restart") {
      restartTarget = ready;
      options.quit();
    }
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
    },
    relaunchIfArmed: (relaunch, userDataPath) => {
      watcher?.close();
      if (!restartTarget) return false;
      pointCurrentAt(root, realpathSync(restartTarget.path));
      relaunch(relaunchOptions(restartTarget, userDataPath));
      return true;
    },
  };
}
