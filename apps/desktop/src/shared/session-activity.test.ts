import { describe, expect, it } from "vitest";
import { classifyTerminalOutputActivities, classifyTerminalOutputActivity } from "./session-activity";

describe("session activity classifier", () => {
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
});
