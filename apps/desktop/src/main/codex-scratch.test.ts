import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  codexScratchRootPath,
  scratchWorkspaceDirectoryName,
  scratchWorkspacePath,
} from "./codex-scratch.js";

describe("codex scratch workspace paths", () => {
  it("uses the Codex documents day folder as the scratch root", () => {
    expect(
      codexScratchRootPath("/Users/patryk/Documents", new Date("2026-06-24T12:34:56Z")),
    ).toBe(path.join("/Users/patryk/Documents", "Codex", "2026-06-24"));
  });

  it("names Alfred scratch workspaces without trusting the whole Codex day folder", () => {
    expect(scratchWorkspaceDirectoryName("W13")).toBe("alfred-W13");
    expect(scratchWorkspaceDirectoryName("Workspace 13 workspace")).toBe("alfred-Workspace-13-workspace");
    expect(scratchWorkspaceDirectoryName("   ")).toBe("alfred-default");
  });

  it("resolves a concrete Alfred scratch workspace path", () => {
    expect(scratchWorkspacePath("/Users/patryk/Documents/Codex/2026-06-24", "W13")).toBe(
      path.join("/Users/patryk/Documents/Codex/2026-06-24", "alfred-W13"),
    );
  });
});
