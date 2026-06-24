import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openExternalTerminal } from "./external-terminal.js";
import { managedProjectWorktreeRoot } from "./git-worktree.js";
import { resolveWorkspacePathForReveal } from "./workspace-path.js";
import { allowedWorkspaceRoots } from "./workspace-ipc.js";
import type { WorkspaceStore } from "./workspace-store.js";

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

describe("workspace IPC allowed roots", () => {
  it("allows workspace roots plus their managed and legacy project worktree roots only", async () => {
    const managedRoot = "/Users/patryk/Library/Application Support/Alfred/worktrees";
    const alfredRoot = "/Users/patryk/Desktop/Alfred";
    const otherRoot = "/Users/patryk/Desktop/Other App";
    const legacyAlfredRoot = "/Users/patryk/Desktop/.alfred-worktrees/Alfred";
    const legacyOtherRoot = "/Users/patryk/Desktop/.alfred-worktrees/Other App";
    const roots = await allowedWorkspaceRoots(
      fakeWorkspaceStore([alfredRoot, otherRoot, undefined]),
      { managedWorktreeRootPath: managedRoot },
    );

    expect(roots).toEqual([
      alfredRoot,
      otherRoot,
      legacyAlfredRoot,
      legacyOtherRoot,
      managedProjectWorktreeRoot(managedRoot, alfredRoot),
      managedProjectWorktreeRoot(managedRoot, otherRoot),
    ]);
    expect(roots).not.toContain(managedRoot);
    expect(roots).not.toContain("/Users/patryk/Desktop/.alfred-worktrees");
    expect(roots).not.toContain(path.join(managedRoot, "unregistered-12345678"));
  });

  it("allows app-owned scratch paths for reveal and external terminal actions", async () => {
    const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "alfred-workspace-ipc-"));
    const workspaceRoot = path.join(temporaryDirectory, "workspace");
    const userDataRoot = path.join(temporaryDirectory, "userData");
    const scratchRoot = path.join(userDataRoot, "scratch");
    const scratchCwd = path.join(scratchRoot, "workspace-1");
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
      expect(roots).toContain(path.resolve(scratchRoot));
      expect(roots).not.toContain(path.resolve(userDataRoot));
    } finally {
      await fs.rm(temporaryDirectory, { force: true, recursive: true });
    }
  });
});
