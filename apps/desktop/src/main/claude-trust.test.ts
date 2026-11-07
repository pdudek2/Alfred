import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { claudeTrustsFolder } from "./claude-trust.js";

let configDir: string;
beforeEach(async () => {
  configDir = await mkdtemp(path.join(os.tmpdir(), "alfred-claude-trust-"));
});
afterEach(() => rm(configDir, { recursive: true, force: true }));

it("reads Claude's answer for the exact folder, not its parent", async () => {
  const env = { CLAUDE_CONFIG_DIR: configDir };
  await expect(claudeTrustsFolder("/repo", env)).resolves.toBe(false);

  await writeFile(path.join(configDir, ".claude.json"), JSON.stringify({
    projects: {
      "/home": { hasTrustDialogAccepted: true },
      "/repo": { hasTrustDialogAccepted: true },
      "/home/new": { hasTrustDialogAccepted: false },
    },
  }));
  await expect(claudeTrustsFolder("/repo/", env)).resolves.toBe(true);
  await expect(claudeTrustsFolder("/home/new", env)).resolves.toBe(false);
  await expect(claudeTrustsFolder("/home/other", env)).resolves.toBe(false);

  // A file it cannot parse says nothing either way.
  await writeFile(path.join(configDir, ".claude.json"), '{"projects":');
  await expect(claudeTrustsFolder("/home/other", env)).resolves.toBe(true);
});
