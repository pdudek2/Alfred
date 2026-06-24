import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isAllowedWorkspacePath, resolveWorkspacePathForReveal } from "./workspace-path.js";

let temporaryDirectory = "";

beforeEach(async () => {
  temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "alfred-workspace-path-"));
});

afterEach(async () => {
  if (temporaryDirectory) {
    await fs.rm(temporaryDirectory, { force: true, recursive: true });
  }
});

describe("workspace-path", () => {
  it("denies paths when no allowed roots are registered", async () => {
    await expect(isAllowedWorkspacePath("/private/etc", [])).resolves.toBe(false);
    await expect(isAllowedWorkspacePath("/private/etc", undefined)).resolves.toBe(false);
  });

  it("resolves relative activity paths from the session cwd", async () => {
    const filePath = path.join(temporaryDirectory, "src", "app.tsx");
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, "export {};\n");

    await expect(
      resolveWorkspacePathForReveal(
        { cwd: temporaryDirectory, path: "src/app.tsx" },
        { allowedRoots: [temporaryDirectory] },
      ),
    ).resolves.toEqual({
      ok: true,
      resolvedPath: filePath,
    });
  });

  it("accepts absolute paths", async () => {
    const filePath = path.join(temporaryDirectory, "Dockerfile");
    await fs.writeFile(filePath, "FROM scratch\n");

    await expect(
      resolveWorkspacePathForReveal(
        { cwd: "/tmp/elsewhere", path: filePath },
        { allowedRoots: [temporaryDirectory] },
      ),
    ).resolves.toEqual({
      ok: true,
      resolvedPath: filePath,
    });
  });

  it("rejects paths outside allowed workspace roots", async () => {
    const allowedRoot = path.join(temporaryDirectory, "workspace");
    const outsideFile = path.join(temporaryDirectory, "outside.txt");
    await fs.mkdir(allowedRoot);
    await fs.writeFile(outsideFile, "secret\n");

    await expect(
      resolveWorkspacePathForReveal({ cwd: allowedRoot, path: outsideFile }, { allowedRoots: [allowedRoot] }),
    ).resolves.toEqual({
      ok: false,
      error: "Path is outside registered workspaces.",
      resolvedPath: outsideFile,
    });
  });

  it("rejects symlinked paths that resolve outside allowed workspace roots", async () => {
    const allowedRoot = path.join(temporaryDirectory, "workspace");
    const outsideRoot = path.join(temporaryDirectory, "outside");
    const outsideFile = path.join(outsideRoot, "secret.txt");
    const symlinkPath = path.join(allowedRoot, "linked-outside");
    await fs.mkdir(allowedRoot);
    await fs.mkdir(outsideRoot);
    await fs.writeFile(outsideFile, "secret\n");
    await fs.symlink(outsideRoot, symlinkPath, "dir");

    await expect(
      resolveWorkspacePathForReveal(
        { cwd: allowedRoot, path: "linked-outside/secret.txt" },
        { allowedRoots: [allowedRoot] },
      ),
    ).resolves.toEqual({
      ok: false,
      error: "Path is outside registered workspaces.",
      resolvedPath: path.join(symlinkPath, "secret.txt"),
    });
  });

  it("allows only canonical children of registered roots", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "alfred-root-"));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "alfred-outside-"));
    await fs.symlink(outside, path.join(root, "escape"));

    try {
      await expect(isAllowedWorkspacePath(path.join(root, "escape", "secret.txt"), [root])).resolves.toBe(false);
    } finally {
      await fs.rm(root, { force: true, recursive: true });
      await fs.rm(outside, { force: true, recursive: true });
    }
  });

  it("returns a resolved path for missing files without opening them", async () => {
    const missingPath = path.join(temporaryDirectory, "missing.ts");

    await expect(
      resolveWorkspacePathForReveal(
        { cwd: temporaryDirectory, path: "missing.ts" },
        { allowedRoots: [temporaryDirectory] },
      ),
    ).resolves.toEqual({
      ok: false,
      error: "Path does not exist.",
      resolvedPath: missingPath,
    });
  });

  it("rejects empty paths", async () => {
    await expect(resolveWorkspacePathForReveal({ cwd: temporaryDirectory, path: "  " })).resolves.toEqual({
      ok: false,
      error: "No path to reveal.",
    });
  });

  it("rejects malformed IPC payloads without throwing", async () => {
    await expect(resolveWorkspacePathForReveal(null)).resolves.toEqual({
      ok: false,
      error: "Invalid reveal request.",
    });
    await expect(resolveWorkspacePathForReveal({ cwd: temporaryDirectory })).resolves.toEqual({
      ok: false,
      error: "Invalid reveal path.",
    });
    await expect(resolveWorkspacePathForReveal({ cwd: 42, path: "app.tsx" })).resolves.toEqual({
      ok: false,
      error: "Invalid reveal cwd.",
    });
  });
});
