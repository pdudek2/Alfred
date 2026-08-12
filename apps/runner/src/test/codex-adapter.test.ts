import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
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
    expect(events.every((event) => event.project_key === "Alfred")).toBe(true);
    expect(IngestEventSchema.array().safeParse(events).success).toBe(true);
  });

  it("collects a later Codex record with the same timestamp", async () => {
    const codexHome = createCodexHome();
    const first = await collectCodexEvents({ codexHome, workspaceId, deviceId, privacyMode: "standard" });
    const stored = first.cursorUpdates[0]?.value;
    expect(stored).toBeDefined();

    appendFileSync(
      join(codexHome, "sessions/2026/04/28/session.jsonl"),
      `\n${JSON.stringify({
        timestamp: "2026-04-28T10:00:03.000Z",
        type: "tool.call",
        id: "same-ms-later",
        session_id: "codex-run-1",
        tool: "exec_command",
      })}\n`,
    );

    const second = await collectCodexEvents({
      codexHome,
      workspaceId,
      deviceId,
      privacyMode: "standard",
      getCursor: () => stored ?? null,
    });
    expect(second.events.map((event) => event.source_event_id)).toEqual(["same-ms-later"]);
  });

  it("upgrades a legacy Codex timestamp by replaying equality and writing v1", async () => {
    const result = await collectCodexEvents({
      codexHome: createCodexHome(),
      workspaceId,
      deviceId,
      privacyMode: "standard",
      getCursor: () => "2026-04-28T10:00:03.000Z",
    });
    expect(result.events.map((event) => event.occurred_at)).toContain("2026-04-28T10:00:03.000Z");
    expect(JSON.parse(result.cursorUpdates[0]!.value)).toMatchObject({
      v: 1,
      project: { key: "Alfred", name: "Alfred" },
    });
  });

  it("keeps configured Codex since strict with a matched position", async () => {
    const codexHome = createCodexHome();
    const target = join(codexHome, "sessions/2026/04/28/session.jsonl");
    const prefixHash = createHash("sha256")
      .update(`${readFileSync(target, "utf8")}\n`)
      .digest("hex");
    const stored = JSON.stringify({
      v: 1,
      line: 4,
      prefixHash,
      project: { key: "Alfred", name: "Alfred" },
    });
    appendFileSync(
      target,
      `\n${JSON.stringify({
        timestamp: "2026-04-28T10:00:04.000Z",
        type: "tool.call",
        id: "at-configured-floor",
        session_id: "codex-run-1",
        tool: "exec_command",
      })}\n`,
    );

    const second = await collectCodexEvents({
      codexHome,
      workspaceId,
      deviceId,
      privacyMode: "standard",
      codexSince: "2026-04-28T10:00:04.000Z",
      getCursor: () => stored,
    });

    expect(second.events).toEqual([]);
    expect(JSON.parse(second.cursorUpdates[0]!.value)).toMatchObject({ v: 1, line: 6 });
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

  it("pins one project for a Codex source file despite tool payload cwd", async () => {
    const codexHome = trackedTempDir("alfred-codex-home-");
    const target = join(codexHome, "sessions/2026/04/28/session.jsonl");
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(
      target,
      [
        JSON.stringify({
          timestamp: "2026-04-28T10:00:00.000Z",
          type: "session_meta",
          payload: {
            id: "pinned-project-run",
            cwd: "/Users/patryk/Desktop/Alfred",
          },
        }),
        JSON.stringify({
          timestamp: "2026-04-28T10:00:01.000Z",
          type: "event_msg",
          payload: {
            type: "exec_command_end",
            call_id: "tool-1",
            cwd: "/Users/patryk/Desktop/Replacement",
            status: "completed",
          },
        }),
      ].join("\n"),
    );

    const result = await collectCodexEvents({
      codexHome,
      workspaceId,
      deviceId,
      privacyMode: "standard",
    });

    expect(result.events.map((event) => event.project_key)).toEqual(["Alfred", "Alfred"]);
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

  it("warns once for a corrupt Codex JSONL line without exposing its payload", async () => {
    const codexHome = trackedTempDir("alfred-codex-home-");
    const target = join(codexHome, "sessions/2026/04/28/corrupt-session.jsonl");
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(
      target,
      [
        JSON.stringify({
          timestamp: "2026-04-28T10:00:00.000Z",
          type: "session.start",
          id: "corrupt-codex-run",
          cwd: "/Users/patryk/Desktop/Alfred",
        }),
        '{"secret":"CODEX_CORRUPT_SECRET",',
        JSON.stringify({
          timestamp: "2026-04-28T10:00:01.000Z",
          type: "tool.call",
          id: "healthy-after-corrupt",
          session_id: "corrupt-codex-run",
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

    expect(events.some((event) => event.source_event_id === "healthy-after-corrupt")).toBe(true);
    expect(warnings).toEqual([
      "Skipped corrupt codex-cli JSONL in sessions/2026/04/28/corrupt-session.jsonl at line 2",
    ]);
    expect(warnings[0]).not.toContain("CODEX_CORRUPT_SECRET");
  });

  it("does not advance a Codex cursor over an invalid unterminated tail", async () => {
    const codexHome = createCodexHome();
    const target = join(codexHome, "sessions/2026/04/28/session.jsonl");
    const first = await collectCodexEvents({ codexHome, workspaceId, deviceId, privacyMode: "standard" });
    appendFileSync(target, '{"timestamp":');
    const second = await collectCodexEvents({
      codexHome,
      workspaceId,
      deviceId,
      privacyMode: "standard",
      getCursor: () => first.cursorUpdates[0]?.value ?? null,
    });
    expect(second.events).toEqual([]);
    expect(second.cursorUpdates[0]?.value).toBe(first.cursorUpdates[0]?.value);
  });

  it("advances a Codex cursor over terminated blank lines", async () => {
    const codexHome = createCodexHome();
    const target = join(codexHome, "sessions/2026/04/28/session.jsonl");
    const first = await collectCodexEvents({ codexHome, workspaceId, deviceId, privacyMode: "standard" });
    appendFileSync(target, "\n\n");

    const second = await collectCodexEvents({
      codexHome,
      workspaceId,
      deviceId,
      privacyMode: "standard",
      getCursor: () => first.cursorUpdates[0]?.value ?? null,
    });

    expect(second.events).toEqual([]);
    expect(JSON.parse(second.cursorUpdates[0]!.value)).toMatchObject({ v: 1, line: 6 });
  });

  it("replays a replaced Codex file when the saved prefix no longer matches", async () => {
    const codexHome = createCodexHome();
    const target = join(codexHome, "sessions/2026/04/28/session.jsonl");
    const first = await collectCodexEvents({ codexHome, workspaceId, deviceId, privacyMode: "standard" });
    writeFileSync(target, JSON.stringify({
      timestamp: "2026-04-28T10:00:00.000Z",
      type: "session.start",
      id: "replacement-run",
      cwd: "/Users/patryk/Desktop/Replacement",
    }));
    const warnings: string[] = [];
    const second = await collectCodexEvents({
      codexHome,
      workspaceId,
      deviceId,
      privacyMode: "standard",
      getCursor: () => first.cursorUpdates[0]?.value ?? null,
      onWarning: (message) => warnings.push(message),
    });
    expect(second.events.map((event) => event.source_run_id)).toEqual(["replacement-run"]);
    expect(second.events[0]).toMatchObject({ project_key: "Replacement" });
    expect(warnings).toContain("Replayed 1 codex-cli session file after cursor mismatch");
    expect(warnings.join("\n")).not.toContain(codexHome);
  });

  it("resets an invalid Codex cursor without exposing its value", async () => {
    const warnings: string[] = [];
    const result = await collectCodexEvents({
      codexHome: createCodexHome(),
      workspaceId,
      deviceId,
      privacyMode: "standard",
      getCursor: () => '{"secret":"CURSOR_SECRET"}',
      onWarning: (message) => warnings.push(message),
    });
    expect(JSON.parse(result.cursorUpdates[0]!.value)).toMatchObject({ v: 1 });
    expect(warnings).toEqual(["Reset 1 invalid codex-cli cursor"]);
    expect(warnings.join("\n")).not.toContain("CURSOR_SECRET");
  });
});

function trackedTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
