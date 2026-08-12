import { execFile as nodeExecFile } from "node:child_process";
import { createHash } from "node:crypto";
import { realpath as nodeRealpath } from "node:fs/promises";
import { basename, dirname, normalize, resolve } from "node:path";

export type ProjectIdentity = { key: string; name: string };

export type ProjectIdentityInput = {
  cwd?: string;
  fallbackPath?: string;
  fallbackName?: string;
};

type ProjectIdentityOptions = {
  execFile?: (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;
  realpath?: (path: string) => Promise<string>;
};

export async function resolveProjectIdentity(
  input: ProjectIdentityInput,
  options: ProjectIdentityOptions = {},
): Promise<ProjectIdentity> {
  const execFile = options.execFile ?? executeFile;
  const realpath = options.realpath ?? nodeRealpath;

  if (input.cwd) {
    try {
      const { stdout } = await execFile("git", [
        "-C",
        input.cwd,
        "rev-parse",
        "--git-common-dir",
      ]);
      const gitCommonDir = stdout.trim();
      if (!gitCommonDir) throw new Error("Git common directory is empty");
      const commonDir = await canonicalPath(resolve(input.cwd, gitCommonDir), realpath);
      const commonDirName = basename(commonDir);
      const name = commonDirName === ".git"
        ? readableName(basename(dirname(commonDir)))
        : readableName(input.fallbackName, commonDirName);
      return {
        key: fingerprint("local-git-v1", commonDir),
        name: name ?? "Unknown project",
      };
    } catch {
      // Non-Git directories and unavailable Git use the supported local-path identity.
    }
  }

  const fallbackPath = input.cwd ?? input.fallbackPath;
  if (!fallbackPath) {
    return {
      key: "unknown-project",
      name: readableName(input.fallbackName) ?? "Unknown project",
    };
  }

  const canonicalFallback = await canonicalPath(resolve(fallbackPath), realpath);
  return {
    key: fingerprint("local-path-v1", canonicalFallback),
    name: readableName(input.fallbackName, basename(canonicalFallback)) ?? "Unknown project",
  };
}

export function legacyProjectIdentity(
  input: Pick<ProjectIdentityInput, "cwd" | "fallbackName">,
): ProjectIdentity {
  const parts = input.cwd ? normalize(input.cwd).split(/[\\/]+/).filter(Boolean) : [];
  const markerIndex = parts.lastIndexOf(".alfred-worktrees");
  const worktreeProject = markerIndex >= 0 ? parts[markerIndex + 1] : undefined;
  const legacyKey = worktreeProject ?? (input.cwd ? basename(input.cwd) || undefined : undefined);
  if (legacyKey) return { key: legacyKey, name: readableName(legacyKey) ?? "Unknown project" };

  const fallbackName = readableName(input.fallbackName);
  return {
    key: fallbackName && fallbackName !== "Unknown project" ? fallbackName : "unknown-project",
    name: fallbackName ?? "Unknown project",
  };
}

async function canonicalPath(
  path: string,
  realpath: (path: string) => Promise<string>,
): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

function fingerprint(prefix: "local-git-v1" | "local-path-v1", path: string): string {
  return `${prefix}:${createHash("sha256").update(path).digest("hex").slice(0, 16)}`;
}

function readableName(...candidates: Array<string | undefined>): string | undefined {
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed) return trimmed.slice(0, 160);
  }
  return undefined;
}

function executeFile(file: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    nodeExecFile(file, args, { encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolvePromise({ stdout, stderr });
    });
  });
}
