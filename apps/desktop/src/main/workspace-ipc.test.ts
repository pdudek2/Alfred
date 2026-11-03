import { describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openExternalTerminal } from "./external-terminal.js";
import { scratchWorkspacePath } from "./codex-scratch.js";
import { resolveWorkspacePathForReveal } from "./workspace-path.js";
import { allowedWorkspaceRoots, folderDialogOptions } from "./workspace-ipc.js";
import type { WorkspaceStore } from "./workspace-store.js";

// Importing the real module downloads Electron's binary when it is missing, as on CI's Linux runner.
vi.mock("electron", () => ({ BrowserWindow: {}, dialog: {}, nativeImage: {}, shell: {} }));

function fakeWorkspaceStore(rootPaths: Array<string | undefined>): WorkspaceStore {
  return {
    bindWorkspaceToPath: vi.fn(),
    createWorkspaceFromPath: vi.fn(),
    getWorkspaceState: vi.fn(async () => ({
      activeWorkspaceId: "workspace-1",
      workspaces: rootPaths.map((rootPath, index) => ({
        id: `workspace-${index + 1}`,
        label: `Workspace ${index + 1}`,
        shortLabel: `${index + 1}`,
        ...(rootPath === undefined ? {} : { rootPath }),
      })),
    })),
    setWorkspaceState: vi.fn(),
  };
}

describe("folder dialog", () => {
  it("opens beside the active project, or at Electron's default without one", async () => {
    const state = await fakeWorkspaceStore(["/Users/sample/Desktop/Alfred", "/Users/sample/Code/Other"]).getWorkspaceState();

    expect(folderDialogOptions(state).defaultPath).toBe("/Users/sample/Desktop");
    expect(folderDialogOptions({ ...state, activeWorkspaceId: "workspace-2" }).defaultPath).toBe("/Users/sample/Code");
    expect(folderDialogOptions({ ...state, activeWorkspaceId: "missing" })).toEqual({ properties: ["openDirectory"] });
  });
});

describe("workspace IPC allowed roots", () => {
  it("allows bound workspace roots only", async () => {
    const alfredRoot = "/Users/sample/Desktop/Alfred";
    const otherRoot = "/Users/sample/Desktop/Other App";
    const roots = await allowedWorkspaceRoots(fakeWorkspaceStore([alfredRoot, otherRoot, undefined]));

    expect(roots).toEqual([alfredRoot, otherRoot]);
  });

  it("allows the worktrees git lists for a project's repository and nothing beside them", async () => {
    const temporaryDirectory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "alfred-workspace-ipc-")));
    const project = path.join(temporaryDirectory, "project");
    const worktree = path.join(temporaryDirectory, "codex-worktree");
    const otherRepo = path.join(temporaryDirectory, "other");
    const git = (cwd: string, ...args: string[]) =>
      execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-C", cwd, ...args], { stdio: "pipe" });
    await fs.mkdir(project);
    await fs.mkdir(otherRepo);
    git(project, "init", "-b", "main");
    git(project, "commit", "--allow-empty", "-m", "first");
    git(project, "worktree", "add", "-b", "fix", worktree);
    git(otherRepo, "init", "-b", "main");
    await fs.writeFile(path.join(worktree, "notes.txt"), "notes\n");
    await fs.writeFile(path.join(otherRepo, "notes.txt"), "notes\n");

    try {
      const roots = await allowedWorkspaceRoots(fakeWorkspaceStore([project]));

      expect(roots).toContain(worktree);
      await expect(resolveWorkspacePathForReveal({ cwd: worktree, path: "notes.txt" }, { allowedRoots: roots }))
        .resolves.toMatchObject({ ok: true });
      await expect(resolveWorkspacePathForReveal({ cwd: otherRepo, path: "notes.txt" }, { allowedRoots: roots }))
        .resolves.toMatchObject({ ok: false });
    } finally {
      await fs.rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("allows app-owned scratch paths for reveal and external terminal actions", async () => {
    const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "alfred-workspace-ipc-"));
    const workspaceRoot = path.join(temporaryDirectory, "workspace");
    const userDataRoot = path.join(temporaryDirectory, "userData");
    const scratchRoot = path.join(userDataRoot, "scratch");
    const scratchCwd = scratchWorkspacePath(scratchRoot, "workspace-1");
    const scratchFile = path.join(scratchCwd, "notes.txt");
    await fs.mkdir(workspaceRoot, { recursive: true });
    await fs.mkdir(scratchCwd, { recursive: true });
    await fs.writeFile(scratchFile, "scratch\n");
    const spawned = vi.fn(() => {
      const child = new EventEmitter() as EventEmitter & { unref: () => void };
      child.unref = vi.fn();
      queueMicrotask(() => child.emit("spawn"));
      return child;
    });

    try {
      const roots = await allowedWorkspaceRoots(fakeWorkspaceStore([workspaceRoot]), { scratchRootPath: scratchRoot });

      await expect(
        resolveWorkspacePathForReveal({ cwd: scratchCwd, path: "notes.txt" }, { allowedRoots: roots }),
      ).resolves.toEqual({
        ok: true,
        resolvedPath: scratchFile,
      });
      await expect(
        openExternalTerminal(
          { cwd: scratchCwd },
          { allowedRoots: roots, platform: "darwin", env: {}, spawnImpl: spawned as never },
        ),
      ).resolves.toEqual({
        ok: true,
        resolvedPath: scratchCwd,
        terminal: "Ghostty",
      });
      expect(roots).toContain(path.resolve(scratchCwd));
      expect(roots).not.toContain(path.resolve(scratchRoot));
      expect(roots).not.toContain(path.resolve(userDataRoot));
    } finally {
      await fs.rm(temporaryDirectory, { force: true, recursive: true });
    }
  });
});
