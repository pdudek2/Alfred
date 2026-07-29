import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { IngestEventSchema } from "@alfred/schema";
import { afterEach, describe, expect, it } from "vitest";

import { collectCodexEvents } from "../sources/codex/codex-adapter.js";
import { readJsonlFile, readJsonlRecords } from "../sources/codex/codex-jsonl.js";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const deviceId = "00000000-0000-4000-8000-000000000101";
const tempDirs: string[] = [];

function fixturePath() {
  return fileURLToPath(new URL("./fixtures/codex-session.jsonl", import.meta.url));
}

function turnCompleteFixturePath() {
  return fileURLToPath(new URL("./fixtures/codex-turn-complete.jsonl", import.meta.url));
}

function createCodexHome(sourceFixturePath = fixturePath()) {
  const codexHome = trackedTempDir("alfred-codex-home-");
  const target = join(codexHome, "sessions/2026/04/28/session.jsonl");
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(sourceFixturePath, target);
  return codexHome;
}

describe("readJsonlFile", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("reads jsonl records and ignores invalid lines", async () => {
    const records = await readJsonlFile(fixturePath());

    expect(records).toHaveLength(4);
  });

  it("streams jsonl records without whole-file readFile", async () => {
    const dir = trackedTempDir("alfred-codex-jsonl-");
    const file = join(dir, "large-session.jsonl");
    writeFileSync(
      file,
      [
        JSON.stringify({ timestamp: "2026-04-28T10:00:00.000Z", type: "session_meta" }),
        "not json",
        JSON.stringify({ timestamp: "2026-04-28T10:00:01.000Z", type: "event_msg" }),
      ].join("\n"),
    );

    const records: unknown[] = [];
    for await (const record of readJsonlRecords(file)) {
      records.push(record);
    }

    expect(records).toEqual([
      { timestamp: "2026-04-28T10:00:00.000Z", type: "session_meta" },
      { timestamp: "2026-04-28T10:00:01.000Z", type: "event_msg" },
    ]);
    expect(
      readFileSync(fileURLToPath(new URL("../sources/codex/codex-jsonl.ts", import.meta.url)), "utf8"),
    ).not.toMatch(/readFile\(/);
  });
});

describe("collectCodexEvents", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("collects Codex session events into ingest events", async () => {
    const { events } = await collectCodexEvents({
      codexHome: createCodexHome(),
      workspaceId,
      deviceId,
      privacyMode: "standard",
    });

    expect(events).toHaveLength(4);
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "tool.started",
      "tool.completed",
      "run.completed",
    ]);
    expect(events.every((event) => event.source_id === "codex-cli")).toBe(true);
    expect(events.every((event) => event.workspace_id === workspaceId)).toBe(true);
    expect(events.every((event) => event.device_id === deviceId)).toBe(true);
    expect(IngestEventSchema.array().safeParse(events).success).toBe(true);
  });

  it("skips Codex events at or before the configured since timestamp", async () => {
    const { events } = await collectCodexEvents({
      codexHome: createCodexHome(),
      workspaceId,
      deviceId,
      privacyMode: "standard",
      codexSince: "2026-04-28T10:00:02.000Z",
    });

    expect(events.map((event) => event.type)).toEqual([
      "run.completed",
    ]);
    expect(events.map((event) => event.occurred_at)).toEqual([
      "2026-04-28T10:00:03.000Z",
    ]);
  });

  it("treats Codex task completion as waiting for the next user turn", async () => {
    const { events } = await collectCodexEvents({
      codexHome: createCodexHome(turnCompleteFixturePath()),
      workspaceId,
      deviceId,
      privacyMode: "standard",
    });

    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "tool.started",
      "tool.completed",
      "agent.waiting",
    ]);
    expect(events.at(-1)).toMatchObject({
      type: "agent.waiting",
      status: "waiting",
    });
  });

  it("attributes legacy Alfred worktree cwd to the base project", async () => {
    const codexHome = trackedTempDir("alfred-codex-home-");
    const target = join(codexHome, "sessions/2026/06/19/worktree-session.jsonl");
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(
      target,
      `${JSON.stringify({
        timestamp: "2026-06-19T08:00:00.000Z",
        type: "session.start",
        id: "codex-worktree-run",
        cwd: "/Users/patryk/Desktop/.alfred-worktrees/Alfred/audit-hardening",
      })}\n`,
    );

    const { events } = await collectCodexEvents({
      codexHome,
      workspaceId,
      deviceId,
      privacyMode: "standard",
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      project_key: "Alfred",
    });
  });

  it("uses distinct source event ids for call and output payloads with the same call id", async () => {
    const { events } = await collectCodexEvents({
      codexHome: createCodexHome(turnCompleteFixturePath()),
      workspaceId,
      deviceId,
      privacyMode: "standard",
    });

    expect(events.map((event) => event.source_event_id)).toEqual([
      "codex-run-1",
      "tool-1:call",
      "tool-1:output",
      "turn-1",
    ]);
  });

  it("skips invalid Codex records while preserving later normalized events", async () => {
    const codexHome = trackedTempDir("alfred-codex-home-");
    const target = join(codexHome, "sessions/2026/04/28/session.jsonl");
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(
      target,
      [
        JSON.stringify({
          timestamp: "2026-04-28T12:00:00+02:00",
          type: "session.start",
          id: "offset-codex-run",
          cwd: "/Users/patryk/Desktop/Alfred",
        }),
        JSON.stringify({
          timestamp: "not-a-timestamp",
          type: "tool.call",
          id: "invalid-record",
          session_id: "offset-codex-run",
          secret: "secret source payload",
        }),
        JSON.stringify({
          timestamp: "2026-04-28T12:00:01+02:00",
          type: "tool.call",
          id: "valid-after-invalid",
          session_id: "offset-codex-run",
          tool: "exec_command",
        }),
      ].join("\n"),
    );
    const warnings: string[] = [];

    const { events } = await collectCodexEvents({
      codexHome,
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
});

function trackedTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
