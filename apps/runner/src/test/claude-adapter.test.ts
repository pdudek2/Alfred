import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
    const events = await collectClaudeEvents({
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

  it("skips Claude events at or before the configured since timestamp", async () => {
    const events = await collectClaudeEvents({
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

    const events = await collectClaudeEvents({
      claudeHome,
      workspaceId,
      deviceId,
      privacyMode: "standard",
    });

    expect(events.length).toBeGreaterThan(0);
    expect(events.every((event) => event.project_key === "client-app")).toBe(true);
  });
});

function trackedTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
