import { describe, expect, it } from "vitest";
import { resolveDefaultWorkspaceRootPath } from "./default-workspace-root.js";

describe("default-workspace-root", () => {
  it("uses ALFRED_DESKTOP_WORKSPACE_CWD before other fallbacks", () => {
    expect(
      resolveDefaultWorkspaceRootPath("/Users/sample/Desktop/Alfred/apps/desktop", {
        ALFRED_DESKTOP_WORKSPACE_CWD: "/Users/sample/Desktop/Client",
        INIT_CWD: "/tmp/ignored",
      }),
    ).toBe("/Users/sample/Desktop/Client");
  });

  it("falls back to INIT_CWD when the explicit workspace cwd is missing", () => {
    expect(
      resolveDefaultWorkspaceRootPath("/Users/sample/Desktop/Alfred/apps/desktop", {
        INIT_CWD: "/Users/sample/Desktop/Alfred",
      }),
    ).toBe("/Users/sample/Desktop/Alfred");
  });

  it("falls back to the repo root next to the desktop app", () => {
    expect(resolveDefaultWorkspaceRootPath("/Users/sample/Desktop/Alfred/apps/desktop", {})).toBe(
      "/Users/sample/Desktop/Alfred",
    );
  });

  it("ignores empty environment values", () => {
    expect(
      resolveDefaultWorkspaceRootPath("/Users/sample/Desktop/Alfred/apps/desktop", {
        ALFRED_DESKTOP_WORKSPACE_CWD: " ",
        INIT_CWD: "",
      }),
    ).toBe("/Users/sample/Desktop/Alfred");
  });
});
