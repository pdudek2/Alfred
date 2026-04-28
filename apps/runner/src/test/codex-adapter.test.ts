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

function createCodexHome() {
  const codexHome = mkdtempSync(join(tmpdir(), "alfred-codex-home-"));
  const target = join(codexHome, "sessions/2026/04/28/session.jsonl");
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(fixturePath(), target);
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
});
