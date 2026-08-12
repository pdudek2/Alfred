import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  legacyProjectIdentity,
  resolveProjectIdentity,
} from "../sources/project-identity.js";
import { projectKeyFromCwdPath } from "../sources/worktree-project-key.js";

const execFile = promisify(execFileCallback);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function git(cwd: string, ...args: string[]) {
  await execFile("git", ["-C", cwd, ...args]);
}

describe("project identity", () => {
  it("separates same-named clones and unifies one clone's worktrees", async () => {
    const root = await mkdtemp(join(tmpdir(), "alfred-project-identity-"));
    roots.push(root);
    const first = join(root, "one", "client");
    const second = join(root, "two", "client");
    const worktree = join(root, "client-feature");
    await mkdir(first, { recursive: true });
    await mkdir(second, { recursive: true });
    await git(first, "init");
    await git(second, "init");
    await git(
      first,
      "-c",
      "user.name=Alfred Test",
      "-c",
      "user.email=alfred@example.test",
      "commit",
      "--allow-empty",
      "-m",
      "initial",
    );
    await git(first, "worktree", "add", "-b", "feature", worktree, "HEAD");

    const baseIdentity = await resolveProjectIdentity({ cwd: first });
    expect(await resolveProjectIdentity({ cwd: worktree })).toEqual(baseIdentity);
    expect((await resolveProjectIdentity({ cwd: second })).key).not.toBe(baseIdentity.key);
    expect(baseIdentity).toMatchObject({ name: "client" });
    expect(baseIdentity.key).toMatch(/^local-git-v1:[a-f0-9]{16}$/);
  });

  it("canonicalizes aliases and separates same-named non-Git directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "alfred-project-paths-"));
    roots.push(root);
    const project = join(root, "project");
    const alias = join(root, "project-alias");
    const first = join(root, "one", "client");
    const second = join(root, "two", "client");
    await mkdir(project, { recursive: true });
    await mkdir(first, { recursive: true });
    await mkdir(second, { recursive: true });
    await git(project, "init");
    await symlink(project, alias);

    expect(await resolveProjectIdentity({ cwd: alias }))
      .toEqual(await resolveProjectIdentity({ cwd: project }));
    const firstFallback = await resolveProjectIdentity({ cwd: first });
    const secondFallback = await resolveProjectIdentity({ cwd: second });
    expect(firstFallback.key).toMatch(/^local-path-v1:[a-f0-9]{16}$/);
    expect(secondFallback.key).not.toBe(firstFallback.key);
  });

  it("keeps two clones of the same remote as separate local projects", async () => {
    const root = await mkdtemp(join(tmpdir(), "alfred-project-clones-"));
    roots.push(root);
    const remote = join(root, "remote.git");
    const first = join(root, "one", "client");
    const second = join(root, "two", "client");
    await mkdir(join(root, "one"), { recursive: true });
    await mkdir(join(root, "two"), { recursive: true });
    await execFile("git", ["init", "--bare", remote]);
    await execFile("git", ["clone", remote, first]);
    await execFile("git", ["clone", remote, second]);

    const firstIdentity = await resolveProjectIdentity({ cwd: first });
    const secondIdentity = await resolveProjectIdentity({ cwd: second });
    expect(firstIdentity.name).toBe("client");
    expect(secondIdentity.name).toBe("client");
    expect(secondIdentity.key).not.toBe(firstIdentity.key);
  });

  it("falls back deterministically when Git and realpath are unavailable", async () => {
    const options = {
      execFile: async () => { throw new Error("git unavailable"); },
      realpath: async () => { throw new Error("path unavailable"); },
    };
    const first = await resolveProjectIdentity({ cwd: "/missing/client" }, options);
    const second = await resolveProjectIdentity({ cwd: "/missing/client" }, options);
    expect(first).toEqual(second);
    expect(first.name).toBe("client");
    expect(first.key).toMatch(/^local-path-v1:[a-f0-9]{16}$/);
    await expect(resolveProjectIdentity({ fallbackName: " Free Chat " }, options))
      .resolves.toEqual({ key: "unknown-project", name: "Free Chat" });
    await expect(resolveProjectIdentity({
      fallbackPath: "/missing/claude/client",
      fallbackName: ` ${"x".repeat(170)} `,
    }, options)).resolves.toMatchObject({ name: "x".repeat(160) });
  });

  it("preserves the legacy worktree and basename keys through the compatibility export", () => {
    const worktree = "/Users/patryk/Desktop/.alfred-worktrees/Alfred/audit-hardening";
    expect(projectKeyFromCwdPath(worktree)).toBe("Alfred");
    expect(projectKeyFromCwdPath("/Users/patryk/Desktop/client")).toBe("client");
    expect(projectKeyFromCwdPath(undefined)).toBeUndefined();
    expect(legacyProjectIdentity({ cwd: worktree, fallbackName: "Ignored" }))
      .toEqual({ key: "Alfred", name: "Alfred" });
    expect(legacyProjectIdentity({ fallbackName: " Free Chat " }))
      .toEqual({ key: "Free Chat", name: "Free Chat" });
  });
});
