import { describe, expect, it } from "vitest";
import { sessionRelaunchSafety } from "./relaunch-safety";

describe("sessionRelaunchSafety", () => {
  it("allows empty manual shells and first-class agent sessions", () => {
    expect(sessionRelaunchSafety({ source: "manual" })).toEqual({ safe: true });
    expect(sessionRelaunchSafety({ source: "manual", agentKind: "codex", command: "codex", args: [] })).toEqual({
      safe: true,
    });
  });

  it("requires review before replaying destructive file commands", () => {
    expect(sessionRelaunchSafety({ source: "manual", command: "rm", args: ["-rf", "dist"] })).toEqual({
      safe: false,
      reason: "rm -rf would be replayed",
    });
    expect(sessionRelaunchSafety({
      source: "manual",
      command: "find",
      args: ["/Users/patryk/Desktop", "-maxdepth", "1", "-exec", "mv", "{}", "/tmp/Alfred", ";"],
    })).toEqual({
      safe: false,
      reason: "find -exec mutates files when replayed",
    });
  });

  it("requires review before shell snippets are replayed", () => {
    expect(sessionRelaunchSafety({ source: "manual", command: "bash", args: ["-lc", "pnpm test"] })).toEqual({
      safe: false,
      reason: "shell command replay needs review",
    });
  });
});
