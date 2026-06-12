import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import { managedProjectWorktreeRoot } from "./git-worktree.js";
import { allowedWorkspaceRoots } from "./workspace-ipc.js";
import type { WorkspaceStore } from "./workspace-store.js";

function fakeWorkspaceStore(rootPaths: Array<string | undefined>): WorkspaceStore {
  return {
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
});
