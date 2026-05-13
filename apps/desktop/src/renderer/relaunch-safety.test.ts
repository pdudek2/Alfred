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

  it.each([
    [
      "force push",
      { source: "manual" as const, command: "git", args: ["push", "--force-with-lease=origin/main"] },
      "git push --force would be replayed",
    ],
    [
      "sudo",
      { source: "manual" as const, command: "sudo", args: ["pnpm", "install"] },
      "sudo command would be replayed",
    ],
    [
      "dropdb",
      { source: "manual" as const, command: "dropdb", args: ["alfred"] },
      "database drop command would be replayed",
    ],
    [
      "sql database drop",
      { source: "manual" as const, command: "psql", args: ["-c", "drop database alfred"] },
      "database drop command would be replayed",
    ],
    [
      "rsync delete",
      { source: "manual" as const, command: "rsync", args: ["-av", "--delete", "dist/", "deploy/"] },
      "rsync --delete would be replayed",
    ],
    [
      "recursive chmod",
      { source: "manual" as const, command: "chmod", args: ["-R", "755", "dist"] },
      "chmod -R would be replayed",
    ],
    [
      "recursive chown",
      { source: "manual" as const, command: "chown", args: ["-R", "patryk", "dist"] },
      "chown -R would be replayed",
    ],
    [
      "copy",
      { source: "manual" as const, command: "cp", args: ["source", "target"] },
      "cp command mutates files when replayed",
    ],
  ])("requires review before replaying %s", (_label, session, reason) => {
    expect(sessionRelaunchSafety(session)).toEqual({ safe: false, reason });
  });

  it("requires review before shell snippets are replayed", () => {
    expect(sessionRelaunchSafety({ source: "manual", command: "bash", args: ["-lc", "pnpm test"] })).toEqual({
      safe: false,
      reason: "shell command replay needs review",
    });
  });
});
