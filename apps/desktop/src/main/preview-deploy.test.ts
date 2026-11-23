import { existsSync, mkdirSync, mkdtempSync, readlinkSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { desktopStateChannels } from "../shared/desktop-state-ipc.js";
import { relaunchOptions, startPreviewDeploy, takeRestartResume, updateFor } from "./preview-deploy.js";
import { beginEntrySwitch, configureTrustedIpc, finishEntrySwitch, isTrustedEntry } from "./trusted-ipc.js";

const handlers = vi.hoisted(() => new Map<string, (event: unknown, ...args: unknown[]) => unknown>());
vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => handlers.set(channel, listener),
    on: vi.fn(),
  },
}));

const release = (dir: string, mainHash: string) => ({
  sha: path.basename(dir), ref: "origin/main", subject: "A change", mainHash, electron: "/e/Electron", path: dir,
});

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function deployRoot() {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "alfred-deploy-")));
  roots.push(root);
  const own = path.join(root, "releases", "own");
  mkdirSync(own, { recursive: true });
  writeFileSync(path.join(own, "release.json"), JSON.stringify({ mainHash: "same" }));
  return { root, own };
}

describe("Alfred Preview releases", () => {
  it("reloads only a release whose main-process code hashes the same", () => {
    expect(updateFor(release("/r/a", "same"), "same").action).toBe("reload");
    expect(updateFor(release("/r/a", "other"), "same").action).toBe("restart");
    // A main process that does not know its own hash cannot vouch for a reload.
    expect(updateFor(release("/r/a", "same"), undefined).action).toBe("restart");
  });

  it("restarts into the target's app folder with the same user data", () => {
    expect(relaunchOptions(release("/r/b", "x"), "/u/Alfred Preview")).toEqual({
      execPath: "/e/Electron",
      args: ["/r/b/apps/desktop", "--user-data-dir=/u/Alfred Preview"],
    });
  });

  it("trusts both entries while a reload is under way, then only the one it ended on", () => {
    const contents = { mainFrame: { url: "file:///old/index.html" }, once: vi.fn() };
    configureTrustedIpc(contents as never, "file:///old/index.html");
    beginEntrySwitch("file:///new/index.html");
    expect(isTrustedEntry("file:///old/index.html")).toBe(true);
    expect(isTrustedEntry("file:///new/index.html")).toBe(true);
    finishEntrySwitch(true);
    expect(isTrustedEntry("file:///old/index.html")).toBe(false);
    expect(isTrustedEntry("file:///new/index.html")).toBe(true);
    beginEntrySwitch("file:///next/index.html");
    finishEntrySwitch(false);
    expect(isTrustedEntry("file:///next/index.html")).toBe(false);
    expect(isTrustedEntry("file:///new/index.html")).toBe(true);
  });

  it("does nothing without a deploy root, and tells the window there is no new version", async () => {
    const quit = vi.fn();
    expect(startPreviewDeploy({ env: {}, appPath: "/x/apps/desktop", windowMaterialQuery: undefined, window: () => null, quit, userDataPath: "/missing", restartBlockers: () => [], liveAgentClientIds: () => [] })).toBeNull();
    const mainFrame = { url: "file:///own/index.html" };
    const contents = { mainFrame, once: vi.fn() };
    configureTrustedIpc(contents as never, mainFrame.url);
    expect(await handlers.get(desktopStateChannels.getUpdate)!({ sender: contents, senderFrame: mainFrame })).toBeNull();
    await handlers.get(desktopStateChannels.applyUpdate)!({ sender: contents, senderFrame: mainFrame }, "restart");
    expect(quit).not.toHaveBeenCalled();
  });

  it("leaves the folder alone in an Alfred that was not started from one of its releases", () => {
    const { root } = deployRoot();
    const elsewhere = realpathSync(mkdtempSync(path.join(os.tmpdir(), "alfred-dev-")));
    roots.push(elsewhere);
    expect(startPreviewDeploy({ env: { ALFRED_DEPLOY_ROOT: root }, appPath: path.join(elsewhere, "apps", "desktop"), windowMaterialQuery: undefined, window: () => null, quit: vi.fn(), userDataPath: elsewhere, restartBlockers: () => [], liveAgentClientIds: () => [] })).toBeNull();
    expect(existsSync(path.join(root, "running.json"))).toBe(false);
  });

  it("offers a ready release, and a restart the quit dialog cancelled does not happen later", async () => {
    const { root, own } = deployRoot();
    const quit = vi.fn();
    const deploy = startPreviewDeploy({
      env: { ALFRED_DEPLOY_ROOT: root, ALFRED_DEPLOY_RELEASE: own },
      appPath: path.join(own, "apps", "desktop"),
      windowMaterialQuery: undefined,
      window: () => null,
      quit,
      userDataPath: root,
      restartBlockers: () => [],
      liveAgentClientIds: () => [],
    })!;
    expect(deploy).not.toBeNull();
    const mainFrame = { url: "file:///own/index.html" };
    const contents = { mainFrame, once: vi.fn() };
    configureTrustedIpc(contents as never, mainFrame.url);
    const trusted = { sender: contents, senderFrame: mainFrame };
    const getUpdate = (_event: unknown) => handlers.get(desktopStateChannels.getUpdate)!(trusted);
    const applyUpdate = (_event: unknown, action: string, restart?: unknown) => handlers.get(desktopStateChannels.applyUpdate)!(trusted, action, restart);
    const takeResume = () => handlers.get(desktopStateChannels.takeRestartResume)!(trusted);
    expect(await getUpdate({})).toBeNull();

    // A ready.json naming a folder outside the releases, or an Electron outside its release, is not offered.
    const outside = realpathSync(mkdtempSync(path.join(os.tmpdir(), "alfred-outside-")));
    roots.push(outside);
    writeFileSync(path.join(root, "ready.json"), JSON.stringify(release(outside, "changed")));
    expect(await getUpdate({})).toBeNull();

    const next = path.join(root, "releases", "next");
    mkdirSync(path.join(next, "e"), { recursive: true });
    writeFileSync(path.join(next, "e", "Electron"), "");
    writeFileSync(path.join(root, "ready.json"), JSON.stringify(release(next, "changed")));
    expect(await getUpdate({})).toBeNull();
    writeFileSync(path.join(root, "ready.json"), JSON.stringify({ ...release(next, "changed"), electron: path.join(next, "e", "Electron") }));
    expect(await getUpdate({})).toMatchObject({ sha: "next", action: "restart" });

    await applyUpdate({}, "restart");
    expect(quit).toHaveBeenCalledTimes(1);
    deploy.cancelRestart();
    const relaunch = vi.fn();
    expect(deploy.relaunchIfArmed(relaunch, "/u")).toBe(false);
    expect(relaunch).not.toHaveBeenCalled();

    await applyUpdate({}, "restart");
    expect(deploy.relaunchIfArmed(relaunch, "/u")).toBe(true);
    expect(relaunch).toHaveBeenCalledWith({ execPath: path.join(next, "e", "Electron"), args: [path.join(next, "apps", "desktop"), "--user-data-dir=/u"] });
    expect(readlinkSync(path.join(root, "current"))).toBe(next);
    // Nothing was asked back, so the next start resumes nothing.
    expect(await takeResume()).toEqual([]);
  });

  it("waits for Alfred to be quiet, skips the quit question for that restart, and hands its own running agents to the next start", async () => {
    const { root, own } = deployRoot();
    const quit = vi.fn();
    let blockers = ["Lead (working)"];
    const deploy = startPreviewDeploy({
      env: { ALFRED_DEPLOY_ROOT: root, ALFRED_DEPLOY_RELEASE: own },
      appPath: path.join(own, "apps", "desktop"),
      windowMaterialQuery: undefined,
      window: () => null,
      quit,
      userDataPath: root,
      restartBlockers: () => blockers,
      liveAgentClientIds: () => ["claude-1", "codex-2"],
    })!;
    const mainFrame = { url: "file:///own/index.html" };
    const contents = { mainFrame, once: vi.fn() };
    configureTrustedIpc(contents as never, mainFrame.url);
    const trusted = { sender: contents, senderFrame: mainFrame };
    const applyUpdate = (restart?: unknown) => handlers.get(desktopStateChannels.applyUpdate)!(trusted, "restart", restart);
    const takeResume = () => handlers.get(desktopStateChannels.takeRestartResume)!(trusted);
    const next = path.join(root, "releases", "next");
    mkdirSync(path.join(next, "e"), { recursive: true });
    writeFileSync(path.join(next, "e", "Electron"), "");
    writeFileSync(path.join(root, "ready.json"), JSON.stringify({ ...release(next, "changed"), electron: path.join(next, "e", "Electron") }));

    // The window waits and asks again, showing what Alfred still waits for.
    expect(await applyUpdate()).toEqual({ waitingFor: ["Lead (working)"] });
    expect(quit).not.toHaveBeenCalled();
    // Restart now goes through the quit question; cancelled there, it writes nothing for a later start.
    await applyUpdate({ now: true });
    expect(deploy.restartSkipsQuitDialog()).toBe(false);
    deploy.cancelRestart();
    expect(await takeResume()).toEqual([]);

    blockers = [];
    // Whatever the window names, main resumes its own running agents.
    expect(await applyUpdate({ resume: ["asleep-9"] })).toBeUndefined();
    expect(quit).toHaveBeenCalledTimes(2);
    expect(deploy.restartSkipsQuitDialog()).toBe(true);
    expect(deploy.relaunchIfArmed(vi.fn(), root)).toBe(true);
    expect(await takeResume()).toEqual(["claude-1", "codex-2"]);
    expect(await takeResume()).toEqual([]);
  });

  it("resumes nothing from a list a restart left long ago, one dated ahead, or a broken one", () => {
    const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "alfred-resume-")));
    roots.push(dir);
    const file = path.join(dir, "restart-resume.json");
    const write = (writtenAt: number) => writeFileSync(file, JSON.stringify({ clientIds: ["claude-1", 7, "x".repeat(201)], writtenAt }));
    write(1_000);
    expect(takeRestartResume(file, 1_000 + 2 * 60_000)).toEqual(["claude-1"]);
    write(1_000);
    expect(takeRestartResume(file, 1_001 + 2 * 60_000)).toEqual([]);
    expect(existsSync(file)).toBe(false);
    write(1_000_000);
    expect(takeRestartResume(file, 1_000)).toEqual([]);
    writeFileSync(file, "{");
    expect(takeRestartResume(file)).toEqual([]);
  });
});
