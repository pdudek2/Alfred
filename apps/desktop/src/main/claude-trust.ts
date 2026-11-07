import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Whether Claude Code has been told to trust this folder. `claude --worktree` fails in a folder it does not trust
 * yet, instead of asking as plain `claude` does. Only this one answer is read from Claude's settings file.
 * Unknown (a file Alfred cannot read or parse) counts as trusted, so Alfred never claims a refusal it did not see.
 */
export async function claudeTrustsFolder(folder: string, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const settingsPath = path.join(env.CLAUDE_CONFIG_DIR ?? os.homedir(), ".claude.json");
  let text: string;
  try {
    text = await readFile(settingsPath, "utf8");
  } catch (error) {
    // Claude has never run here, so it trusts no folder yet.
    return (error as NodeJS.ErrnoException).code !== "ENOENT";
  }
  try {
    const projects = (JSON.parse(text) as { projects?: unknown }).projects;
    const entry = typeof projects === "object" && projects !== null
      ? (projects as Record<string, unknown>)[path.resolve(folder)]
      : undefined;
    return typeof entry === "object" && entry !== null && (entry as { hasTrustDialogAccepted?: unknown }).hasTrustDialogAccepted === true;
  } catch {
    return true;
  }
}
