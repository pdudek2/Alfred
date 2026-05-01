import { copyFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { IngestEventSchema } from "@alfred/schema";
import { describe, expect, it } from "vitest";

import { collectCodexEvents } from "../sources/codex/codex-adapter.js";
import { readJsonlFile } from "../sources/codex/codex-jsonl.js";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const deviceId = "00000000-0000-4000-8000-000000000101";

function fixturePath() {
  return fileURLToPath(new URL("./fixtures/codex-session.jsonl", import.meta.url));
}

function turnCompleteFixturePath() {
  return fileURLToPath(new URL("./fixtures/codex-turn-complete.jsonl", import.meta.url));
}

function createCodexHome(sourceFixturePath = fixturePath()) {
  const codexHome = mkdtempSync(join(tmpdir(), "alfred-codex-home-"));
  const target = join(codexHome, "sessions/2026/04/28/session.jsonl");
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(sourceFixturePath, target);
  return codexHome;
}

describe("readJsonlFile", () => {
  it("reads jsonl records and ignores invalid lines", async () => {
    const records = await readJsonlFile(fixturePath());

    expect(records).toHaveLength(4);
  });
});

describe("collectCodexEvents", () => {
  it("collects Codex session events into ingest events", async () => {
    const events = await collectCodexEvents({
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
    const events = await collectCodexEvents({
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
    const events = await collectCodexEvents({
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
});
