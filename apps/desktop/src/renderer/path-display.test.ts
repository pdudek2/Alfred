import { describe, expect, it } from "vitest";
import { shortenPath, shortenWorktreeLabel } from "./path-display";

describe("shortenPath", () => {
  it("keeps short relative paths intact", () => {
    expect(shortenPath("apps/desktop/src")).toBe("apps/desktop/src");
  });

  it("shortens long relative paths to the final two segments", () => {
    expect(shortenPath("apps/desktop/src/renderer")).toBe("…/src/renderer");
  });

  it("shortens absolute paths after two meaningful segments", () => {
    expect(shortenPath("/Users/patryk/Desktop/Alfred")).toBe("…/Desktop/Alfred");
  });

  it("normalizes Windows separators for display", () => {
    expect(shortenPath("C:\\Users\\patryk\\Desktop\\Alfred")).toBe("…/Desktop/Alfred");
  });
});

describe("shortenWorktreeLabel", () => {
  it("keeps short branch identifiers intact", () => {
    expect(shortenWorktreeLabel("feature/path-noise-pass")).toBe("feature/path-noise-pass");
  });

  it("shortens long path-like identifiers to recognizable trailing segments", () => {
    expect(shortenWorktreeLabel("codex/alfred/focus/right-dock/path-noise-pass-branch")).toBe(
      "…/right-dock/path-noise-pass-branch",
    );
  });

  it("bounds very long final worktree names with a middle ellipsis", () => {
    expect(shortenWorktreeLabel("/Users/patryk/Desktop/Alfred/.worktrees/path-noise-pass-with-extra-detail")).toBe(
      "…/.worktrees/path…with-extra-detail",
    );
  });
});
