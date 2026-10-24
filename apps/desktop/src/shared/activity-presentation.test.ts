import { describe, expect, it } from "vitest";
import {
  activitySentence,
  classifyActivityPresentationLayer,
  presentActivityEvents,
  waitingSentence,
} from "./activity-presentation";
import type { SessionActivityEvent } from "./session-activity";

const baseEvent = {
  at: 1,
  id: "event",
} satisfies Pick<SessionActivityEvent, "at" | "id">;

describe("activity sentences", () => {
  const approval = (prompt: string): SessionActivityEvent => ({
    ...baseEvent, kind: "approval", title: "Waiting for approval", detail: prompt, payload: { type: "approval", prompt },
  });

  it.each([
    // Claude's hook detail: "<tool>: <target>".
    ["Edit: /repo/src/renderer/session-status.ts", "Wants to edit session-status.ts", "Asked to edit session-status.ts"],
    ["Bash: pnpm test\nsecond line", "Wants to run pnpm test", "Asked to run pnpm test"],
    ["WebFetch: https://example.com/docs", "Wants to fetch https://example.com/docs", "Asked to fetch https://example.com/docs"],
    ["mcp__github__create_issue: waiting for approval", "Wants to use create_issue from github", "Asked to use create_issue from github"],
    ["WebSearch: waiting for approval", "Wants to use WebSearch", "Asked to use WebSearch"],
    ["ExitPlanMode: waiting for approval", "Wants to start on the plan", "Asked to start on the plan"],
    // Codex's notifications.
    ["Approval requested: pnpm test", "Wants to run pnpm test", "Asked to run pnpm test"],
    ["Approval requested by github", "Wants to use github", "Asked to use github"],
    ["Codex wants to edit src/app.ts", "Wants to edit app.ts", "Asked to edit app.ts"],
    ["Codex wants to edit 3 files", "Wants to edit 3 files", "Asked to edit 3 files"],
    ["Plan mode prompt: Implement this plan?", "Implement this plan?", "Asked: Implement this plan?"],
    // A question the terminal printed, even one with a colon.
    ["Proceed: overwrite the file?", "Proceed: overwrite the file?", "Asked: Proceed: overwrite the file?"],
  ])("reads %j as a plain sentence", (prompt, waiting, asked) => {
    expect(waitingSentence(approval(prompt))).toBe(waiting);
    expect(activitySentence(approval(prompt))).toBe(asked);
  });

  it("names the agent when the strip says why a session waits", () => {
    expect(waitingSentence(approval("Edit: /repo/app.tsx"), "Claude")).toBe("Claude wants to edit app.tsx");
    expect(waitingSentence(approval("Plan mode prompt: Implement this plan?"), "Codex")).toBe("Codex asks: Implement this plan?");
  });

  it("writes the other steps as the Details board does", () => {
    expect(activitySentence({ ...baseEvent, kind: "file", title: "Edit file", detail: "src/app.tsx", payload: { type: "file", operation: "edited", path: "src/app.tsx" } }))
      .toBe("Edited app.tsx");
    expect(activitySentence({ ...baseEvent, kind: "command", title: "Ran command", detail: "\"pnpm test\"", payload: { type: "command", command: "pnpm test" } }))
      .toBe("Ran pnpm test");
    expect(activitySentence({ ...baseEvent, kind: "lifecycle", title: "Applied to project", detail: "1 file applied to the base project. Review and commit normally." }))
      .toBe("1 file applied to the base project.");
    expect(activitySentence({ ...baseEvent, kind: "lifecycle", title: "Session asleep", detail: "" })).toBe("Session asleep");
    expect(activitySentence({ ...baseEvent, kind: "error", title: "Error reported", detail: "build failed", payload: { type: "error", message: "build failed" } }))
      .toBe("build failed");
  });

  it("writes a command as the agent described it, or as the command without its output plumbing", () => {
    const ran = (command: string, description?: string): SessionActivityEvent => ({
      ...baseEvent, kind: "command", title: "Ran command", detail: command,
      payload: { type: "command", command, ...(description === undefined ? {} : { description }) },
    });
    expect(activitySentence(ran("pnpm --filter @alfred/desktop typecheck 2>&1 | tail -40", "Run typecheck"))).toBe("Run typecheck");
    expect(activitySentence(ran("pnpm typecheck 2>&1 | tail -40"))).toBe("Ran pnpm typecheck");
    expect(activitySentence(ran("git log --oneline | head -n 5 2>&1"))).toBe("Ran git log --oneline");
    expect(activitySentence(ran("pnpm test | tail -n40\nnext line"))).toBe("Ran pnpm test");
    // The pipe that does the work stays.
    expect(activitySentence(ran("rg TODO | wc -l"))).toBe("Ran rg TODO | wc -l");
    expect(activitySentence(ran("pnpm lint", "  "))).toBe("Ran pnpm lint");
  });

  it("writes Alfred's worker tools as steps, and other MCP tools by tool and server", () => {
    const used = (name: string, input = ""): SessionActivityEvent => ({
      ...baseEvent, kind: "tool", title: `Used ${name}`, detail: input, payload: { type: "tool", name, input },
    });
    expect(activitySentence(used("mcp__alfred__start_worker", "Run the typecheck"))).toBe("Started worker: Run the typecheck");
    expect(activitySentence(used("mcp__alfred__list_workers"))).toBe("Listed workers");
    expect(activitySentence(used("mcp__alfred__read_worker", "codex-1"))).toBe("Read worker codex-1");
    expect(activitySentence(used("mcp__alfred__wait_for_worker", "codex-1"))).toBe("Waited for worker codex-1");
    expect(activitySentence(used("mcp__alfred__send_to_worker", "codex-1"))).toBe("Sent worker codex-1 a message");
    expect(activitySentence(used("mcp__alfred__stop_worker", "codex-1"))).toBe("Stopped worker codex-1");
    expect(activitySentence(used("mcp__github__get_issue", "42"))).toBe("Used get_issue from github (42)");
    expect(activitySentence(used("mcp__github__get_issue"))).toBe("Used get_issue from github");
    expect(activitySentence(used("WebSearch", "Alfred terminal UX"))).toBe("Used WebSearch (Alfred terminal UX)");
  });

  it("lists events of the same millisecond newest first, as they happened", () => {
    const at = (id: string, time: number): SessionActivityEvent => ({ id, at: time, kind: "command", title: "Ran command", detail: id, payload: { type: "command", command: id } });
    const events = [at("prompt", 1), at("test", 1), at("edit", 2), at("stop", 2)];
    expect(presentActivityEvents(events).visibleEvents.map((event) => event.id)).toEqual(["stop", "edit", "test", "prompt"]);
  });

  it("writes the message you sent as the start of the agent's history", () => {
    const prompt: SessionActivityEvent = { ...baseEvent, kind: "prompt", title: "You asked", detail: "Split History into a list" };
    expect(activitySentence(prompt)).toBe("You asked: Split History into a list");
    expect(classifyActivityPresentationLayer(prompt)).toBe("signal");
  });
});

describe("activity presentation", () => {
  it.each(["Resuming session", "Relaunching session", "Session asleep"])(
    "keeps the %s lifecycle event visible, including titles saved before the vocabulary change",
    (title) => {
      const event: SessionActivityEvent = { ...baseEvent, kind: "lifecycle", title, detail: "Alfred is starting a fresh process." };
      expect(presentActivityEvents([event]).visibleEvents.map((item) => item.title)).toEqual([title]);
    },
  );

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
    // Same millisecond: the later event first.
    expect(presented.rawEvents.map((event) => event.id)).toEqual(["git", "hook"]);
    expect(presented.hiddenRawCount).toBe(2);
  });

  it("keeps approval and real errors as key signals while demoting plugin hook parse noise", () => {
    const events: SessionActivityEvent[] = [
      {
        ...baseEvent,
        id: "plugin",
        kind: "error",
        title: "Error reported",
        detail: "failed to parse plugin hooks config /Users/sample/.codex/plugins/cache/openai",
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
  });

  it("can include raw events explicitly for inspection", () => {
    const events: SessionActivityEvent[] = [
      { ...baseEvent, id: "raw", kind: "output", title: "Progress reported", detail: "PostToolUse hook (completed)" },
      { ...baseEvent, id: "work", kind: "command", title: "Ran command", detail: "Ran pnpm test" },
    ];

    expect(presentActivityEvents(events, { includeRaw: true }).visibleEvents.map((event) => event.id)).toEqual([
      "work",
      "raw",
    ]);
  });
});
