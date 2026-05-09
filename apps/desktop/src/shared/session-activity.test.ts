import { describe, expect, it } from "vitest";
import { classifyTerminalOutputActivity } from "./session-activity";

describe("session activity classifier", () => {
  it("classifies agent command, file, plan, and tool lines", () => {
    expect(classifyTerminalOutputActivity('Bash("pnpm test")')).toEqual({
      kind: "command",
      title: "Ran command",
      detail: '"pnpm test"',
    });

    expect(classifyTerminalOutputActivity("Edit(apps/desktop/src/renderer/app.tsx)")).toEqual({
      kind: "file",
      title: "Edit file",
      detail: "apps/desktop/src/renderer/app.tsx",
    });

    expect(classifyTerminalOutputActivity("• Edited apps/desktop/src/renderer/styles.css")).toEqual({
      kind: "file",
      title: "File activity",
      detail: "Edited apps/desktop/src/renderer/styles.css",
    });

    expect(classifyTerminalOutputActivity("TodoWrite(update launcher checklist)")).toEqual({
      kind: "plan",
      title: "Plan updated",
      detail: "update launcher checklist",
    });

    expect(classifyTerminalOutputActivity("WebSearch(Alfred desktop app patterns)")).toEqual({
      kind: "tool",
      title: "WebSearch tool",
      detail: "Alfred desktop app patterns",
    });
  });
});
