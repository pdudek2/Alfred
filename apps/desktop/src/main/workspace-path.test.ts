import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveWorkspacePathForReveal } from "./workspace-path.js";

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
  it("resolves relative activity paths from the session cwd", async () => {
    const filePath = path.join(temporaryDirectory, "src", "app.tsx");
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, "export {};\n");

    await expect(resolveWorkspacePathForReveal({ cwd: temporaryDirectory, path: "src/app.tsx" })).resolves.toEqual({
      ok: true,
      resolvedPath: filePath,
    });
  });

  it("accepts absolute paths", async () => {
    const filePath = path.join(temporaryDirectory, "Dockerfile");
    await fs.writeFile(filePath, "FROM scratch\n");

    await expect(resolveWorkspacePathForReveal({ cwd: "/tmp/elsewhere", path: filePath })).resolves.toEqual({
      ok: true,
      resolvedPath: filePath,
    });
  });

  it("returns a resolved path for missing files without opening them", async () => {
    const missingPath = path.join(temporaryDirectory, "missing.ts");

    await expect(resolveWorkspacePathForReveal({ cwd: temporaryDirectory, path: "missing.ts" })).resolves.toEqual({
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
