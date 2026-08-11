import { describe, expect, it } from "vitest";
import {
  appendActivityEvent,
  classifyTerminalOutputActivities,
  classifyTerminalOutputActivity,
  classifyTerminalOutputChunk,
} from "./session-activity";
import type { SessionActivityEvent } from "./session-activity";

describe("session activity classifier", () => {
  it("carries a prompt split across arbitrary PTY chunks and emits it once", () => {
    const first = classifyTerminalOutputChunk({ carry: "" }, "Approval re");
    expect(first.activities).toEqual([]);
    expect(first.state).toEqual({ carry: "Approval re" });

    const second = classifyTerminalOutputChunk(first.state, "quired: apply patch?");
    expect(second.activities).toEqual([
      {
        kind: "approval",
        title: "Waiting for approval",
        detail: "Approval required: apply patch?",
        payload: { type: "approval", prompt: "Approval required: apply patch?" },
      },
    ]);
    expect(second.state).toEqual({ carry: "" });

    const third = classifyTerminalOutputChunk(second.state, "\n");
    expect(third.activities).toEqual([]);
  });

  it("does not leak fragmented OSC payloads into streamed activity details", () => {
    const belStart = classifyTerminalOutputChunk({ carry: "" }, "\u001b]0;spoof");
    expect(belStart).toEqual({
      activities: [],
      state: { carry: "", terminalControlCarry: "\u001b]0;spoof" },
    });
    expect(classifyTerminalOutputChunk(belStart.state, "\u0007Error: build failed\n").activities).toEqual([
      {
        kind: "error",
        title: "Error reported",
        detail: "Error: build failed",
        payload: { type: "error", message: "Error: build failed" },
      },
    ]);

    const stStart = classifyTerminalOutputChunk({ carry: "" }, "\u001b]8;;https://example.com\u001b");
    expect(stStart.state).toEqual({
      carry: "",
      terminalControlCarry: "\u001b]8;;https://example.com\u001b",
    });
    expect(classifyTerminalOutputChunk(stStart.state, "\\Warning: deprecated API\n").activities[0]).toMatchObject({
      kind: "warning",
      detail: "Warning: deprecated API",
    });
  });

  it("classifies complete lines while retaining only the unfinished tail", () => {
    const result = classifyTerminalOutputChunk(
      { carry: "" },
      'Bash("pnpm test")\nEdit(app.tsx)\npartial',
    );

    expect(result.activities.map((activity) => activity.kind)).toEqual(["command", "file"]);
    expect(result.state).toEqual({ carry: "partial" });
  });

  it("bounds an unterminated PTY carry", () => {
    const result = classifyTerminalOutputChunk({ carry: "" }, "x".repeat(5_000));
    expect(result.state.carry).toHaveLength(4_096);
  });

  it("classifies agent command, file, plan, and tool lines", () => {
    expect(classifyTerminalOutputActivity('Bash("pnpm test")')).toEqual({
      kind: "command",
      title: "Ran command",
      detail: '"pnpm test"',
      payload: { type: "command", command: "pnpm test" },
    });

    expect(classifyTerminalOutputActivity("Edit(apps/desktop/src/renderer/app.tsx)")).toEqual({
      kind: "file",
      title: "Edit file",
      detail: "apps/desktop/src/renderer/app.tsx",
      payload: { type: "file", operation: "edited", path: "apps/desktop/src/renderer/app.tsx" },
    });

    expect(classifyTerminalOutputActivity("• Edited apps/desktop/src/renderer/styles.css")).toEqual({
      kind: "file",
      title: "File activity",
      detail: "Edited apps/desktop/src/renderer/styles.css",
      payload: { type: "file", operation: "edited", path: "apps/desktop/src/renderer/styles.css" },
    });

    expect(classifyTerminalOutputActivity("MultiEdit(path: \"apps/desktop/src/renderer/app.tsx\")")).toEqual({
      kind: "file",
      title: "MultiEdit file",
      detail: "path: \"apps/desktop/src/renderer/app.tsx\"",
      payload: { type: "file", operation: "edited", path: "apps/desktop/src/renderer/app.tsx" },
    });

    expect(classifyTerminalOutputActivity("• Edited Dockerfile")).toEqual({
      kind: "file",
      title: "File activity",
      detail: "Edited Dockerfile",
      payload: { type: "file", operation: "edited", path: "Dockerfile" },
    });

    expect(classifyTerminalOutputActivity("• Wrote .env.local")).toEqual({
      kind: "file",
      title: "File activity",
      detail: "Wrote .env.local",
      payload: { type: "file", operation: "wrote", path: ".env.local" },
    });

    expect(classifyTerminalOutputActivity("TodoWrite(update launcher checklist)")).toEqual({
      kind: "plan",
      title: "Plan updated",
      detail: "update launcher checklist",
      payload: { type: "plan", summary: "update launcher checklist" },
    });

    expect(classifyTerminalOutputActivity("WebSearch(Alfred desktop app patterns)")).toEqual({
      kind: "tool",
      title: "WebSearch tool",
      detail: "Alfred desktop app patterns",
      payload: { type: "tool", name: "WebSearch", input: "Alfred desktop app patterns" },
    });
  });

  it("keeps multiple structured events from the same output chunk", () => {
    expect(classifyTerminalOutputActivities('Bash("pnpm test")\nEdit(apps/desktop/src/renderer/app.tsx)\n')).toEqual([
      {
        kind: "command",
        title: "Ran command",
        detail: '"pnpm test"',
        payload: { type: "command", command: "pnpm test" },
      },
      {
        kind: "file",
        title: "Edit file",
        detail: "apps/desktop/src/renderer/app.tsx",
        payload: { type: "file", operation: "edited", path: "apps/desktop/src/renderer/app.tsx" },
      },
    ]);
  });

  it("removes OSC controls from activity output through the shared terminal sanitizer", () => {
    expect(classifyTerminalOutputActivity("\u001b]0;spoof\u0007Error: build failed")).toEqual({
      kind: "error",
      title: "Error reported",
      detail: "Error: build failed",
      payload: { type: "error", message: "Error: build failed" },
    });
  });

  it("keeps explicit approval, error, and warning reasons as payload", () => {
    expect(classifyTerminalOutputActivity("Do you want to proceed? y/N")).toEqual({
      kind: "approval",
      title: "Waiting for approval",
      detail: "Do you want to proceed? y/N",
      payload: { type: "approval", prompt: "Do you want to proceed? y/N" },
    });

    expect(classifyTerminalOutputActivity("Error: build failed")).toEqual({
      kind: "error",
      title: "Error reported",
      detail: "Error: build failed",
      payload: { type: "error", message: "Error: build failed" },
    });

    expect(classifyTerminalOutputActivity("Warning: deprecated API")).toEqual({
      kind: "warning",
      title: "Warning reported",
      detail: "Warning: deprecated API",
      payload: { type: "warning", message: "Warning: deprecated API" },
    });
  });

  it("recognizes Swift build completion after an earlier error", () => {
    expect(classifyTerminalOutputActivity("Build complete! (0.28s)")).toEqual({
      kind: "output",
      title: "Progress reported",
      detail: "Build complete! (0.28s)",
    });
  });

  it("keeps command payloads precise and does not treat permission failures as approvals", () => {
    expect(classifyTerminalOutputActivity("Running pnpm typecheck")).toEqual({
      kind: "command",
      title: "Ran command",
      detail: "Running pnpm typecheck",
      payload: { type: "command", command: "pnpm typecheck" },
    });

    expect(classifyTerminalOutputActivity("Permission denied: ./scripts/start.sh")).toEqual({
      kind: "error",
      title: "Error reported",
      detail: "Permission denied: ./scripts/start.sh",
      payload: { type: "error", message: "Permission denied: ./scripts/start.sh" },
    });
  });

  it("does not let broad prompt keywords steal tool calls or version strings", () => {
    expect(classifyTerminalOutputActivity("TodoWrite(allow editing if tests pass)")).toEqual({
      kind: "plan",
      title: "Plan updated",
      detail: "allow editing if tests pass",
      payload: { type: "plan", summary: "allow editing if tests pass" },
    });

    expect(classifyTerminalOutputActivity("WebSearch(how to allow network access)")).toEqual({
      kind: "tool",
      title: "WebSearch tool",
      detail: "how to allow network access",
      payload: { type: "tool", name: "WebSearch", input: "how to allow network access" },
    });

    expect(classifyTerminalOutputActivity('Bash("grep error app.log")')).toEqual({
      kind: "command",
      title: "Ran command",
      detail: '"grep error app.log"',
      payload: { type: "command", command: "grep error app.log" },
    });

    expect(classifyTerminalOutputActivity("Updated to version 1.2.3")).toBeNull();
  });

  it.each([
    ["Updated app.tsx", "updated"],
    ["Modified app.tsx", "updated"],
    ["Wrote report.md", "wrote"],
    ["Written report.md", "wrote"],
  ] as const)("classifies complete file operation words: %s", (line, operation) => {
    expect(classifyTerminalOutputActivity(line)).toMatchObject({
      kind: "file",
      payload: { type: "file", operation },
    });
  });

  it.each([
    "unmodified file.ts",
    "overwritten output.log",
    "rewritten config.json",
  ])("does not classify embedded operation words: %s", (line) => {
    expect(classifyTerminalOutputActivity(line)).toBeNull();
  });
});

describe("session activity identity", () => {
  it("keeps increasing the sequence after retained events reach the cap", () => {
    let events: SessionActivityEvent[] = [];
    for (let index = 0; index < 40; index += 1) {
      events = appendActivityEvent(events, "manual-1", {
        kind: "command",
        title: "Ran command",
        detail: `seed-${index}`,
      }, 1_000 + index, 40).events;
    }

    events = appendActivityEvent(events, "manual-1", {
      kind: "command",
      title: "Ran command",
      detail: "overflow-a",
    }, 5_000, 40).events;
    events = appendActivityEvent(events, "manual-1", {
      kind: "command",
      title: "Ran command",
      detail: "overflow-b",
    }, 5_000, 40).events;

    expect(events.slice(-2).map((event) => event.id)).toEqual([
      "manual-1-activity-5000-41",
      "manual-1-activity-5000-42",
    ]);
  });
});
