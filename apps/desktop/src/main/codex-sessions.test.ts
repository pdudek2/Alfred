import { mkdir, utimes, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createCodexSessionsReader } from "./codex-sessions.js";

describe("Codex sessions reader", () => {
  it("returns display-safe opaque summaries in cursor pages and resolves selected keys", async () => {
    const codexHome = mkdtempSync(path.join(tmpdir(), "alfred-codex-home-"));
    const workspaceA = "/workspaces/alfred";
    const sessionDir = path.join(codexHome, "sessions", "2026", "07", "20");
    const sessionId = "019fff00-1111-7222-8333-444444444444";
    await mkdir(sessionDir, { recursive: true });

    await Promise.all(
      Array.from({ length: 81 }, async (_, index) => {
        const id = index === 0 ? sessionId : `session-${String(index).padStart(3, "0")}`;
        const file = path.join(sessionDir, `rollout-${id}.jsonl`);
        await writeFile(file, codexLines({ id, cwd: workspaceA, title: `Session ${index}` }));
        const when = index === 0
          ? new Date("2026-07-20T12:00:00.000Z")
          : new Date(`2026-07-20T10:${String(index % 60).padStart(2, "0")}:00.000Z`);
        await utimes(file, when, when);
      }),
    );

    const reader = createCodexSessionsReader({ codexHome });
    const result = await reader.listExternalSessions({
      projects: [{ id: "A", label: "Alfred", rootPath: workspaceA }],
    });

    expect(result.sessions[0]).not.toHaveProperty("transcriptPath");
    expect(JSON.stringify(result)).not.toContain(codexHome);
    expect(result.sessions).toHaveLength(80);
    expect(result.sessions[0]?.sessionKey).not.toContain(sessionId);
    expect(result.sessions[0]?.contentSessionKey).toEqual(`external-codex:${sessionId}`);
    expect(result.nextCursor).toEqual(expect.any(String));
    expect(await reader.resolveExternalSession(result.sessions[0]!.sessionKey)).toEqual({
      kind: "resume",
      projectId: "A",
      cwd: workspaceA,
      sessionId,
    });
  });

  it("keeps the newest duplicate and prioritizes the Codex title index", async () => {
    const codexHome = mkdtempSync(path.join(tmpdir(), "alfred-codex-home-"));
    const olderDir = path.join(codexHome, "sessions", "2026", "07", "19");
    const newerDir = path.join(codexHome, "sessions", "2026", "07", "20");
    const sessionId = "019fff11-1111-7222-8333-444444444444";
    await mkdir(olderDir, { recursive: true });
    await mkdir(newerDir, { recursive: true });
    await writeFile(path.join(codexHome, "session_index.jsonl"), JSON.stringify({ id: sessionId, thread_name: "Indexed title" }));
    const olderFile = path.join(olderDir, `rollout-old-${sessionId}.jsonl`);
    const newerFile = path.join(newerDir, `rollout-new-${sessionId}.jsonl`);
    await writeFile(olderFile, codexLines({ id: sessionId, cwd: "/workspaces/alfred", title: "Older title" }));
    await writeFile(newerFile, codexLines({ id: sessionId, cwd: "/workspaces/alfred", title: "Newest title" }));
    await utimes(olderFile, new Date("2026-07-19T10:00:00.000Z"), new Date("2026-07-19T10:00:00.000Z"));
    await utimes(newerFile, new Date("2026-07-20T10:00:00.000Z"), new Date("2026-07-20T10:00:00.000Z"));

    const result = await createCodexSessionsReader({ codexHome }).listExternalSessions({
      projects: [{ id: "A", label: "Alfred", rootPath: "/workspaces/alfred" }],
    });

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toMatchObject({ title: "Indexed title", updatedAt: Date.parse("2026-07-20T10:00:00.000Z") });
  });

  it("rejects invalid cursors and clamps the requested page limit", async () => {
    const codexHome = mkdtempSync(path.join(tmpdir(), "alfred-codex-home-"));
    const sessionDir = path.join(codexHome, "sessions", "2026", "07", "20");
    await mkdir(sessionDir, { recursive: true });
    await Promise.all(Array.from({ length: 101 }, async (_, index) => {
      await writeFile(path.join(sessionDir, `rollout-${index}.jsonl`), codexLines({ id: `session-${index}`, cwd: "/workspaces/alfred", title: `Session ${index}` }));
    }));
    const reader = createCodexSessionsReader({ codexHome });

    await expect(reader.listExternalSessions({ projects: [], cursor: "not-a-cursor" })).rejects.toThrow("Invalid external sessions cursor.");
    await expect(reader.listExternalSessions({ projects: [], limit: 101 })).resolves.toMatchObject({ sessions: expect.any(Array) });
    expect((await reader.listExternalSessions({ projects: [], limit: 101 })).sessions).toHaveLength(100);
  });

  it("keeps oversized metadata pages within the 512 KiB response ceiling", async () => {
    const codexHome = mkdtempSync(path.join(tmpdir(), "alfred-codex-home-"));
    const sessionDir = path.join(codexHome, "sessions", "2026", "07", "20");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      path.join(sessionDir, "oversized.jsonl"),
      [
        JSON.stringify({
          type: "session_meta",
          payload: {
            id: "oversized-session",
            cwd: "/workspaces/alfred",
            model: "m".repeat(600 * 1024),
            originator: "o".repeat(600 * 1024),
          },
        }),
        JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Large metadata" }] } }),
      ].join("\n"),
    );

    const result = await createCodexSessionsReader({ codexHome }).listExternalSessions({
      projects: [{ id: "A", label: "p".repeat(600 * 1024), rootPath: "/workspaces/alfred" }],
    });

    expect(result.sessions).toHaveLength(1);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(512 * 1024);
    expect(result.sessions[0]?.contentSessionKey).toBe("external-codex:oversized-session");
  });

  it("advances the cursor when the byte ceiling shortens a metadata page", async () => {
    const codexHome = mkdtempSync(path.join(tmpdir(), "alfred-codex-home-"));
    const sessionDir = path.join(codexHome, "sessions", "2026", "07", "20");
    const largeMetadata = "ࠀ".repeat(512);
    await mkdir(sessionDir, { recursive: true });
    await Promise.all(Array.from({ length: 100 }, (_, index) => writeFile(
      path.join(sessionDir, `metadata-${index}.jsonl`),
      JSON.stringify({
        type: "session_meta",
        payload: { id: `metadata-${index}`, cwd: "/workspaces/alfred", model: largeMetadata, originator: largeMetadata },
      }),
    )));
    const reader = createCodexSessionsReader({ codexHome });
    const request = { projects: [{ id: "A", label: largeMetadata, rootPath: "/workspaces/alfred" }], limit: 100 };

    const first = await reader.listExternalSessions(request);
    const second = await reader.listExternalSessions({ ...request, cursor: first.nextCursor! });

    expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThanOrEqual(512 * 1024);
    expect(first.sessions).not.toHaveLength(100);
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(second.sessions).not.toHaveLength(0);
    expect(second.sessions.some((session) => first.sessions.some((firstSession) => firstSession.sessionKey === session.sessionKey))).toBe(false);
  });

  it("rejects an oversized project id before it can stall a byte-limited cursor", async () => {
    const codexHome = mkdtempSync(path.join(tmpdir(), "alfred-codex-home-"));
    const reader = createCodexSessionsReader({ codexHome });

    await expect(reader.listExternalSessions({
      projects: [{ id: "x".repeat(512 * 1024), label: "Alfred", rootPath: "/workspaces/alfred" }],
    })).rejects.toThrow("Invalid external sessions project id.");
  });
});

function codexLines({ cwd, id, title }: { cwd: string; id: string; title: string }): string {
  return [
    JSON.stringify({
      timestamp: "2026-07-20T10:00:00.000Z",
      type: "session_meta",
      payload: { id, cwd, timestamp: "2026-07-20T09:59:00.000Z", model: "gpt-5.5", originator: "Codex Desktop" },
    }),
    JSON.stringify({
      type: "response_item",
      payload: { type: "message", role: "user", content: [{ type: "input_text", text: title }] },
    }),
  ].join("\n");
}
