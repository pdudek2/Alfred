import { describe, expect, it } from "vitest";
import {
  classifyActivityPresentationLayer,
  meaningfulSignalEvents,
  presentActivityEvents,
} from "./activity-presentation";
import type { SessionActivityEvent } from "./session-state";

const baseEvent = {
  at: 1,
  id: "event",
} satisfies Pick<SessionActivityEvent, "at" | "id">;

describe("activity presentation", () => {
  it("moves hook and repeated git-check noise into raw while keeping real work visible", () => {
    const events: SessionActivityEvent[] = [
      {
        ...baseEvent,
        id: "hook",
        kind: "output",
        title: "Progress reported",
        detail: "SessionStart hook (completed)",
      },
      {
        ...baseEvent,
        id: "git",
        kind: "command",
        title: "Ran command",
        detail: "Ran git diff --check",
        payload: { type: "command", command: "git diff --check" },
      },
      {
        ...baseEvent,
        id: "file",
        kind: "file",
        title: "File activity",
        detail: "apps/desktop/src/renderer/app.tsx modified",
        payload: { type: "file", operation: "edited", path: "apps/desktop/src/renderer/app.tsx" },
      },
    ];

    const presented = presentActivityEvents(events);

    expect(presented.visibleEvents.map((event) => event.id)).toEqual(["file"]);
    expect(presented.rawEvents.map((event) => event.id)).toEqual(["hook", "git"]);
    expect(presented.hiddenRawCount).toBe(2);
  });

  it("keeps approval and real errors as key signals while demoting plugin hook parse noise", () => {
    const events: SessionActivityEvent[] = [
      {
        ...baseEvent,
        id: "plugin",
        kind: "error",
        title: "Error reported",
        detail: "failed to parse plugin hooks config /Users/patryk/.codex/plugins/cache/openai",
        payload: { type: "error", message: "failed to parse plugin hooks config" },
      },
      {
        ...baseEvent,
        id: "approval",
        kind: "approval",
        title: "Waiting for approval",
        detail: "Approve the next command",
        payload: { type: "approval", prompt: "Approve the next command" },
      },
    ];

    expect(classifyActivityPresentationLayer(events[0]!)).toBe("raw");
    expect(classifyActivityPresentationLayer(events[1]!)).toBe("signal");
    expect(meaningfulSignalEvents(events).map((event) => event.id)).toEqual(["approval"]);
  });

  it("can include raw events explicitly for inspection", () => {
    const events: SessionActivityEvent[] = [
      { ...baseEvent, id: "raw", kind: "output", title: "Progress reported", detail: "PostToolUse hook (completed)" },
      { ...baseEvent, id: "work", kind: "command", title: "Ran command", detail: "Ran pnpm test" },
    ];

    expect(presentActivityEvents(events, { includeRaw: true }).visibleEvents.map((event) => event.id)).toEqual([
      "raw",
      "work",
    ]);
  });
});
