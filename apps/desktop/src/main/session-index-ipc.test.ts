import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { listExternalCodexSessions, registerSessionIndexIpc } from "./session-index-ipc.js";
import { sessionIndexChannels } from "../shared/session-index-ipc.js";

const handlers = new Map<string, () => unknown>();

vi.mock("electron", () => ({
  app: {
    getPath: () => "/Users/patryk",
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: () => unknown) => {
      handlers.set(channel, handler);
    }),
  },
}));

describe("session-index IPC", () => {
  it("indexes external Codex sessions from metadata without exposing raw transcript text", async () => {
    const codexHome = mkdtempSync(path.join(tmpdir(), "alfred-codex-home-"));
    const sessionDir = path.join(codexHome, "sessions", "2026", "06", "17");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      path.join(sessionDir, "rollout-2026-06-17T10-00-00-019eee11-1111-7222-8333-444444444444.jsonl"),
      [
        JSON.stringify({
          timestamp: "2026-06-17T08:00:00.000Z",
          type: "session_meta",
          payload: {
            id: "019eee11-1111-7222-8333-444444444444",
            timestamp: "2026-06-17T07:59:58.000Z",
            cwd: "/Users/patryk/Desktop/Alfred",
            model: "gpt-5.5",
            originator: "Codex Desktop",
            base_instructions: { text: "do not leak this" },
          },
        }),
        JSON.stringify({
          timestamp: "2026-06-17T08:01:00.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Implement Observatory navigation and hide raw hooks" }],
          },
        }),
        JSON.stringify({
          timestamp: "2026-06-17T08:02:00.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "developer",
            content: [{ type: "input_text", text: "secret developer instructions" }],
          },
        }),
      ].join("\n"),
    );

    const result = await listExternalCodexSessions({ codexHome });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "019eee11-1111-7222-8333-444444444444",
      title: "Implement Observatory navigation and hide raw hooks",
      cwd: "/Users/patryk/Desktop/Alfred",
      model: "gpt-5.5",
      originator: "Codex Desktop",
    });
    expect(JSON.stringify(result[0])).not.toContain("secret developer instructions");
    expect(JSON.stringify(result[0])).not.toContain("do not leak this");
  });

  it("ignores invalid lines and missing session directories", async () => {
    const codexHome = mkdtempSync(path.join(tmpdir(), "alfred-codex-home-"));
    const sessionDir = path.join(codexHome, "sessions", "2026", "06", "18");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      path.join(sessionDir, "rollout-2026-06-18T10-00-00-019eee22-1111-7222-8333-444444444444.jsonl"),
      [
        "{broken",
        JSON.stringify({
          timestamp: "2026-06-18T08:00:00.000Z",
          type: "session_meta",
          payload: { id: "019eee22-1111-7222-8333-444444444444", cwd: "/tmp/project" },
        }),
      ].join("\n"),
    );

    await expect(listExternalCodexSessions({ codexHome: path.join(codexHome, "missing") })).resolves.toEqual([]);
    await expect(listExternalCodexSessions({ codexHome })).resolves.toMatchObject([
      { id: "019eee22-1111-7222-8333-444444444444", cwd: "/tmp/project" },
    ]);
  });

  it("registers a desktop bridge handler", async () => {
    const codexHome = mkdtempSync(path.join(tmpdir(), "alfred-codex-home-"));
    registerSessionIndexIpc({ codexHome });

    const handler = handlers.get(sessionIndexChannels.listExternalCodexSessions);

    expect(handler).toBeDefined();
    await expect(handler?.()).resolves.toEqual({ sessions: [] });
  });
});
