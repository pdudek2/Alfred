import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { IngestEventSchema } from "@alfred/schema";
import { afterEach, describe, expect, it } from "vitest";

import { collectClaudeEvents } from "../sources/claude/claude-adapter.js";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const deviceId = "00000000-0000-4000-8000-000000000101";
const tempDirs: string[] = [];

function fixturePath() {
  return fileURLToPath(new URL("./fixtures/claude-multi-turn-session.jsonl", import.meta.url));
}

function createClaudeHome() {
  const claudeHome = trackedTempDir("alfred-claude-home-");
  const target = join(claudeHome, "projects/-Users-patryk-Desktop-Alfred/claude-session-1.jsonl");
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(fixturePath(), target);
  return claudeHome;
}

describe("collectClaudeEvents", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("collects multi-turn Claude sessions without treating end_turn as session completion", async () => {
    const { events } = await collectClaudeEvents({
      claudeHome: createClaudeHome(),
      workspaceId,
      deviceId,
      privacyMode: "standard",
    });

    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "tool.started",
      "tool.completed",
      "agent.waiting",
      "run.updated",
      "agent.waiting",
    ]);
    expect(events.map((event) => event.status)).toEqual([
      "running",
      undefined,
      undefined,
      "waiting",
      "running",
      "waiting",
    ]);
    expect(events.some((event) => event.type === "run.completed")).toBe(false);
    expect(events.every((event) => event.source_id === "claude-code")).toBe(true);
    expect(events.every((event) => event.source_run_id === "claude-session-1")).toBe(true);
    expect(events.every((event) => event.project_key === "Alfred")).toBe(true);
    expect(events.every((event) => event.workspace_id === workspaceId)).toBe(true);
    expect(events.every((event) => event.device_id === deviceId)).toBe(true);
    expect(IngestEventSchema.array().safeParse(events).success).toBe(true);
  });

  it("collects a later Claude record with the same timestamp", async () => {
    const claudeHome = createClaudeHome();
    const first = await collectClaudeEvents({
      claudeHome,
      workspaceId,
      deviceId,
      privacyMode: "standard",
    });
    appendFileSync(
      join(claudeHome, "projects/-Users-patryk-Desktop-Alfred/claude-session-1.jsonl"),
      `\n${JSON.stringify({
        sessionId: "claude-session-1",
        type: "user",
        uuid: "same-ms-later",
        timestamp: "2026-04-28T12:00:06.000Z",
        cwd: "/Users/patryk/Desktop/Alfred",
        message: { role: "user", content: "later" },
      })}\n`,
    );

    const second = await collectClaudeEvents({
      claudeHome,
      workspaceId,
      deviceId,
      privacyMode: "standard",
      getCursor: () => first.cursorUpdates[0]?.value ?? null,
    });

    expect(second.events.map((event) => event.source_event_id)).toEqual(["same-ms-later"]);
  });

  it("upgrades a legacy Claude timestamp by replaying equality and writing v1", async () => {
    const result = await collectClaudeEvents({
      claudeHome: createClaudeHome(),
      workspaceId,
      deviceId,
      privacyMode: "standard",
      getCursor: () => "2026-04-28T12:00:06.000Z",
    });

    expect(result.events.map((event) => event.occurred_at)).toContain("2026-04-28T12:00:06.000Z");
    expect(JSON.parse(result.cursorUpdates[0]!.value)).toMatchObject({
      v: 1,
      project: { key: "Alfred", name: "Alfred" },
    });
  });

  it("keeps configured Claude since strict with a matched position", async () => {
    const claudeHome = createClaudeHome();
    const target = join(claudeHome, "projects/-Users-patryk-Desktop-Alfred/claude-session-1.jsonl");
    const first = await collectClaudeEvents({
      claudeHome,
      workspaceId,
      deviceId,
      privacyMode: "standard",
    });
    appendFileSync(
      target,
      `\n${JSON.stringify({
        sessionId: "claude-session-1",
        type: "user",
        uuid: "at-configured-floor",
        timestamp: "2026-04-28T12:00:07.000Z",
        cwd: "/Users/patryk/Desktop/Alfred",
        message: { role: "user", content: "at floor" },
      })}\n`,
    );

    const second = await collectClaudeEvents({
      claudeHome,
      workspaceId,
      deviceId,
      privacyMode: "standard",
      claudeSince: "2026-04-28T12:00:07.000Z",
      getCursor: () => first.cursorUpdates[0]?.value ?? null,
    });

    expect(second.events).toEqual([]);
    expect(JSON.parse(second.cursorUpdates[0]!.value)).toMatchObject({ v: 1, line: 9 });
  });

  it("skips Claude events at or before the configured since timestamp", async () => {
    const { events } = await collectClaudeEvents({
      claudeHome: createClaudeHome(),
      workspaceId,
      deviceId,
      privacyMode: "standard",
      claudeSince: "2026-04-28T12:00:04.000Z",
    });

    expect(events.map((event) => event.type)).toEqual([
      "run.updated",
      "agent.waiting",
    ]);
    expect(events.map((event) => event.occurred_at)).toEqual([
      "2026-04-28T12:00:05.000Z",
      "2026-04-28T12:00:06.000Z",
    ]);
  });

  it("preserves hyphenated project names when cwd is absent", async () => {
    const claudeHome = trackedTempDir("alfred-claude-home-");
    const target = join(claudeHome, "projects/-Users-patryk-Desktop-client-app/claude-session-1.jsonl");
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(
      target,
      `${JSON.stringify({
        sessionId: "claude-session-1",
        type: "user",
        timestamp: "2026-04-28T12:00:00.000Z",
        message: { role: "user", content: "hello" },
      })}\n`,
    );

    const { events } = await collectClaudeEvents({
      claudeHome,
      workspaceId,
      deviceId,
      privacyMode: "standard",
    });

    expect(events.length).toBeGreaterThan(0);
    expect(events.every((event) => event.project_key === "client-app")).toBe(true);
  });

  it("attributes legacy Alfred worktree cwd to the base project", async () => {
    const claudeHome = trackedTempDir("alfred-claude-home-");
    const target = join(
      claudeHome,
      "projects/-Users-patryk-Desktop--alfred-worktrees-Alfred-audit-hardening/claude-session-1.jsonl",
    );
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(
      target,
      `${JSON.stringify({
        sessionId: "claude-session-1",
        type: "user",
        timestamp: "2026-06-19T08:00:00.000Z",
        cwd: "/Users/patryk/Desktop/.alfred-worktrees/Alfred/audit-hardening",
        message: { role: "user", content: "hello" },
      })}\n`,
    );

    const { events } = await collectClaudeEvents({
      claudeHome,
      workspaceId,
      deviceId,
      privacyMode: "standard",
    });

    expect(events.length).toBeGreaterThan(0);
    expect(events.every((event) => event.project_key === "Alfred")).toBe(true);
  });

  it("skips invalid Claude records while preserving later normalized events", async () => {
    const claudeHome = trackedTempDir("alfred-claude-home-");
    const target = join(claudeHome, "projects/-Users-patryk-Desktop-Alfred/claude-session-1.jsonl");
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(
      target,
      [
        JSON.stringify({
          sessionId: "offset-claude-run",
          type: "user",
          uuid: "offset-start",
          timestamp: "2026-04-28T12:00:00+02:00",
          cwd: "/Users/patryk/Desktop/Alfred",
          message: { role: "user", content: "start" },
        }),
        JSON.stringify({
          sessionId: "offset-claude-run",
          type: "assistant",
          uuid: "invalid-record",
          timestamp: "not-a-timestamp",
          secret: "secret source payload",
          message: { role: "assistant", content: [] },
        }),
        JSON.stringify({
          sessionId: "offset-claude-run",
          type: "user",
          uuid: "valid-after-invalid",
          timestamp: "2026-04-28T12:00:01+02:00",
          cwd: "/Users/patryk/Desktop/Alfred",
          message: { role: "user", content: "later" },
        }),
      ].join("\n"),
    );
    const warnings: string[] = [];

    const { events } = await collectClaudeEvents({
      claudeHome,
      workspaceId,
      deviceId,
      privacyMode: "standard",
      onWarning: (message) => warnings.push(message),
    });

    expect(events.map((event) => event.occurred_at)).toContain(
      "2026-04-28T10:00:00.000Z",
    );
    expect(events.some((event) => event.source_event_id === "valid-after-invalid")).toBe(true);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).not.toContain("secret source payload");
  });

  it("warns once for a corrupt Claude JSONL line without exposing its payload", async () => {
    const claudeHome = trackedTempDir("alfred-claude-home-");
    const target = join(
      claudeHome,
      "projects/-Users-patryk-Desktop-Alfred/corrupt-session.jsonl",
    );
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(
      target,
      [
        JSON.stringify({
          sessionId: "corrupt-claude-run",
          type: "user",
          uuid: "corrupt-start",
          timestamp: "2026-04-28T10:00:00.000Z",
          cwd: "/Users/patryk/Desktop/Alfred",
          message: { role: "user", content: "start" },
        }),
        '{"secret":"CLAUDE_CORRUPT_SECRET",',
        JSON.stringify({
          sessionId: "corrupt-claude-run",
          type: "user",
          uuid: "healthy-after-corrupt",
          timestamp: "2026-04-28T10:00:01.000Z",
          cwd: "/Users/patryk/Desktop/Alfred",
          message: { role: "user", content: "later" },
        }),
      ].join("\n"),
    );
    const warnings: string[] = [];

    const { events } = await collectClaudeEvents({
      claudeHome,
      workspaceId,
      deviceId,
      privacyMode: "standard",
      onWarning: (message) => warnings.push(message),
    });

    expect(events.some((event) => event.source_event_id === "healthy-after-corrupt")).toBe(true);
    expect(warnings).toEqual([
      "Skipped corrupt claude-code JSONL in projects/-Users-patryk-Desktop-Alfred/corrupt-session.jsonl at line 2",
    ]);
    expect(warnings[0]).not.toContain("CLAUDE_CORRUPT_SECRET");
  });

  it("keeps a Claude cursor before an invalid unterminated tail", async () => {
    const claudeHome = createClaudeHome();
    const target = join(claudeHome, "projects/-Users-patryk-Desktop-Alfred/claude-session-1.jsonl");
    const first = await collectClaudeEvents({
      claudeHome,
      workspaceId,
      deviceId,
      privacyMode: "standard",
    });
    appendFileSync(target, '{"sessionId":');

    const second = await collectClaudeEvents({
      claudeHome,
      workspaceId,
      deviceId,
      privacyMode: "standard",
      getCursor: () => first.cursorUpdates[0]?.value ?? null,
    });

    expect(second.events).toEqual([]);
    expect(second.cursorUpdates[0]?.value).toBe(first.cursorUpdates[0]?.value);
  });

  it("advances a Claude cursor over terminated blank lines", async () => {
    const claudeHome = createClaudeHome();
    const target = join(claudeHome, "projects/-Users-patryk-Desktop-Alfred/claude-session-1.jsonl");
    const first = await collectClaudeEvents({
      claudeHome,
      workspaceId,
      deviceId,
      privacyMode: "standard",
    });
    appendFileSync(target, "\n\n");

    const second = await collectClaudeEvents({
      claudeHome,
      workspaceId,
      deviceId,
      privacyMode: "standard",
      getCursor: () => first.cursorUpdates[0]?.value ?? null,
    });

    expect(second.events).toEqual([]);
    expect(JSON.parse(second.cursorUpdates[0]!.value)).toMatchObject({ v: 1, line: 9 });
  });

  it("replays a replaced Claude file when the saved prefix no longer matches", async () => {
    const claudeHome = createClaudeHome();
    const target = join(claudeHome, "projects/-Users-patryk-Desktop-Alfred/claude-session-1.jsonl");
    const first = await collectClaudeEvents({
      claudeHome,
      workspaceId,
      deviceId,
      privacyMode: "standard",
    });
    writeFileSync(target, JSON.stringify({
      sessionId: "replacement-claude-run",
      type: "user",
      uuid: "replacement-start",
      timestamp: "2026-04-28T12:00:00.000Z",
      cwd: "/Users/patryk/Desktop/Replacement",
      message: { role: "user", content: "replacement" },
    }));
    const warnings: string[] = [];

    const second = await collectClaudeEvents({
      claudeHome,
      workspaceId,
      deviceId,
      privacyMode: "standard",
      getCursor: () => first.cursorUpdates[0]?.value ?? null,
      onWarning: (message) => warnings.push(message),
    });

    expect(second.events.every((event) => event.source_run_id === "replacement-claude-run")).toBe(true);
    expect(second.events.length).toBeGreaterThan(0);
    expect(second.events.every((event) => event.project_key === "Replacement")).toBe(true);
    expect(JSON.parse(second.cursorUpdates[0]!.value)).toMatchObject({
      v: 1,
      line: 1,
      project: { key: "Replacement", name: "Replacement" },
    });
    expect(warnings).toContain("Replayed 1 claude-code session file after cursor mismatch");
    expect(warnings.join("\n")).not.toContain(claudeHome);
  });

  it("resets an invalid Claude cursor without exposing its value", async () => {
    const warnings: string[] = [];
    const result = await collectClaudeEvents({
      claudeHome: createClaudeHome(),
      workspaceId,
      deviceId,
      privacyMode: "standard",
      getCursor: () => '{"secret":"CLAUDE_CURSOR_SECRET"}',
      onWarning: (message) => warnings.push(message),
    });

    expect(JSON.parse(result.cursorUpdates[0]!.value)).toMatchObject({ v: 1 });
    expect(warnings).toEqual(["Reset 1 invalid claude-code cursor"]);
    expect(warnings.join("\n")).not.toContain("CLAUDE_CURSOR_SECRET");
  });
});

function trackedTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
