import { mkdir, utimes, writeFile } from "node:fs/promises";
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

  it("uses Codex session index thread names before transcript-derived titles", async () => {
    const codexHome = mkdtempSync(path.join(tmpdir(), "alfred-codex-home-"));
    const sessionDir = path.join(codexHome, "sessions", "2026", "06", "18");
    await mkdir(sessionDir, { recursive: true });
    await writeSessionIndex(codexHome, [
      {
        id: "019eee33-1111-7222-8333-444444444444",
        thread_name: "Load Alfred memory",
        updated_at: "2026-06-18T08:05:00.000Z",
      },
    ]);
    await writeFile(
      path.join(sessionDir, "rollout-2026-06-18T10-00-00-019eee33-1111-7222-8333-444444444444.jsonl"),
      codexSessionLines({
        id: "019eee33-1111-7222-8333-444444444444",
        cwd: "/Users/patryk/Desktop/Alfred",
        messages: [
          "# AGENTS.md instructions for /Users/patryk/Desktop/Alfred <INSTRUCTIONS> keep this out of titles",
          "Fix Observatory session grouping",
        ],
      }),
    );

    const result = await listExternalCodexSessions({ codexHome });

    expect(result).toHaveLength(1);
    expect(result[0]?.title).toBe("Load Alfred memory");
  });

  it("keeps separate Codex sessions even when they share a parent thread", async () => {
    const codexHome = mkdtempSync(path.join(tmpdir(), "alfred-codex-home-"));
    const sessionDir = path.join(codexHome, "sessions", "2026", "06", "18");
    const olderPath = path.join(sessionDir, "rollout-2026-06-18T10-00-00-019eee44-1111-7222-8333-444444444444.jsonl");
    const newerPath = path.join(sessionDir, "rollout-2026-06-18T10-05-00-019eee55-1111-7222-8333-444444444444.jsonl");
    await mkdir(sessionDir, { recursive: true });
    await writeSessionIndex(codexHome, [
      {
        id: "019eee44-1111-7222-8333-444444444444",
        thread_name: "Spec compliance review",
        updated_at: "2026-06-18T10:00:00.000Z",
      },
      {
        id: "019eee55-1111-7222-8333-444444444444",
        thread_name: "Code quality review",
        updated_at: "2026-06-18T10:05:00.000Z",
      },
    ]);
    await writeFile(
      olderPath,
      codexSessionLines({
        id: "019eee44-1111-7222-8333-444444444444",
        cwd: "/Users/patryk/Desktop/Alfred",
        parentThreadId: "019parent-1111-7222-8333-444444444444",
        messages: ["# AGENTS.md instructions for /Users/patryk/Desktop/Alfred <INSTRUCTIONS>"],
      }),
    );
    await writeFile(
      newerPath,
      codexSessionLines({
        id: "019eee55-1111-7222-8333-444444444444",
        cwd: "/Users/patryk/Desktop/Alfred",
        parentThreadId: "019parent-1111-7222-8333-444444444444",
        messages: ["Fix Observatory session grouping"],
      }),
    );
    await utimes(olderPath, new Date("2026-06-18T10:00:00.000Z"), new Date("2026-06-18T10:00:00.000Z"));
    await utimes(newerPath, new Date("2026-06-18T10:05:00.000Z"), new Date("2026-06-18T10:05:00.000Z"));

    const result = await listExternalCodexSessions({ codexHome });

    expect(result).toHaveLength(2);
    expect(result.map((session) => session.title)).toEqual(["Code quality review", "Spec compliance review"]);
  });

  it("finds the newest Codex session after scanning more than the legacy traversal cap", async () => {
    const codexHome = mkdtempSync(path.join(tmpdir(), "alfred-codex-home-"));
    const oldSessionDir = path.join(codexHome, "sessions", "2026", "06", "18");
    const newestSessionDir = path.join(codexHome, "sessions", "2026", "06", "19");
    await mkdir(oldSessionDir, { recursive: true });
    await mkdir(newestSessionDir, { recursive: true });

    for (let index = 0; index < 605; index += 1) {
      const id = `old-${String(index).padStart(4, "0")}`;
      const filePath = path.join(oldSessionDir, `old-${String(index).padStart(4, "0")}.jsonl`);
      await writeFile(
        filePath,
        codexSessionLines({
          id,
          cwd: "/Users/patryk/Desktop/Old",
          messages: [`Old session ${index}`],
        }),
      );
      await utimes(filePath, new Date("2026-06-18T08:00:00.000Z"), new Date("2026-06-18T08:00:00.000Z"));
    }

    const newestPath = path.join(newestSessionDir, "newest.jsonl");
    await writeFile(
      newestPath,
      codexSessionLines({
        id: "newest-session",
        cwd: "/Users/patryk/Desktop/Alfred",
        messages: ["Newest session should win"],
      }),
    );
    await utimes(newestPath, new Date("2026-06-19T08:00:00.000Z"), new Date("2026-06-19T08:00:00.000Z"));

    const result = await listExternalCodexSessions({ codexHome, limit: 1 });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "newest-session",
      title: "Newest session should win",
    });
  });

  it("ignores transcript title candidates beyond the 140-line prefix", async () => {
    const codexHome = mkdtempSync(path.join(tmpdir(), "alfred-codex-home-"));
    const sessionDir = path.join(codexHome, "sessions", "2026", "06", "19");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      path.join(sessionDir, "prefix-limited.jsonl"),
      [
        JSON.stringify({
          timestamp: "2026-06-19T08:00:00.000Z",
          type: "session_meta",
          payload: {
            id: "prefix-limited",
            timestamp: "2026-06-19T07:59:58.000Z",
            cwd: "/Users/patryk/Desktop/Alfred",
          },
        }),
        ...Array.from({ length: 139 }, (_, index) =>
          JSON.stringify({
            type: "response_item",
            payload: {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: `noise ${index}` }],
            },
          }),
        ),
        JSON.stringify({
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "This title is too late" }],
          },
        }),
      ].join("\n"),
    );

    const result = await listExternalCodexSessions({ codexHome, limit: 1 });

    expect(result[0]?.title).toBe("Alfred Codex session");
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

async function writeSessionIndex(
  codexHome: string,
  entries: Array<{ id: string; thread_name: string; updated_at: string }>,
): Promise<void> {
  await writeFile(path.join(codexHome, "session_index.jsonl"), entries.map((entry) => JSON.stringify(entry)).join("\n"));
}

function codexSessionLines({
  cwd,
  id,
  messages,
  parentThreadId,
}: {
  cwd: string;
  id: string;
  messages: string[];
  parentThreadId?: string;
}): string {
  return [
    JSON.stringify({
      timestamp: "2026-06-18T08:00:00.000Z",
      type: "session_meta",
      payload: {
        id,
        timestamp: "2026-06-18T07:59:58.000Z",
        cwd,
        model: "gpt-5.5",
        originator: "Codex Desktop",
        ...(parentThreadId ? { parent_thread_id: parentThreadId } : {}),
      },
    }),
    ...messages.map((text, index) =>
      JSON.stringify({
        timestamp: `2026-06-18T08:0${index + 1}:00.000Z`,
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text }],
        },
      }),
    ),
  ].join("\n");
}
