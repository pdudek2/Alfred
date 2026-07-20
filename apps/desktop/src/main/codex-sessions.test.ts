import { mkdir, unlink, utimes, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createCodexSessionsReader } from "./codex-sessions.js";
import { SUMMARY_CACHE_COUNT_LIMIT } from "../shared/sessions-ipc.js";
import {
  writeCodexSummaryFixtures,
  writeLargeCodexTranscriptFixture,
} from "../test-support/codex-session-fixtures.js";

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

  it("discovers summaries once for a multi-page cursor snapshot and rediscovers on refresh", async () => {
    const codexHome = mkdtempSync(path.join(tmpdir(), "alfred-codex-home-"));
    await writeCodexSummaryFixtures(codexHome, 120, "/fixture/project");
    const onSummaryDiscovery = vi.fn();
    const reader = createCodexSessionsReader({
      codexHome,
      onSummaryDiscovery,
    });
    const request = {
      projects: [{ id: "A", label: "Fixture project", rootPath: "/fixture/project" }],
      limit: 80,
    };

    const first = await reader.listExternalSessions(request);
    const second = await reader.listExternalSessions({ ...request, cursor: first.nextCursor! });

    expect(first.sessions).toHaveLength(80);
    expect(second.sessions).toHaveLength(40);
    expect(onSummaryDiscovery).toHaveBeenCalledTimes(1);

    const refreshed = await reader.listExternalSessions(request);
    expect(onSummaryDiscovery).toHaveBeenCalledTimes(2);
    await expect(reader.listExternalSessions({ ...request, cursor: first.nextCursor! }))
      .rejects.toThrow("Invalid external sessions cursor.");

    reader.clearCaches();
    await expect(reader.listExternalSessions({ ...request, cursor: refreshed.nextCursor! }))
      .rejects.toThrow("Invalid external sessions cursor.");
  });

  it("reads a listed external transcript through its content session key without making that key resumable", async () => {
    const { codexHome } = await transcriptFixture("content-alias", [
      { type: "session_meta", payload: { id: "content-alias", cwd: "/repo" } },
      { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Alias question" }] } },
      { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Alias answer" }] } },
    ]);
    const reader = createCodexSessionsReader({ codexHome });
    const listed = await reader.listExternalSessions({
      projects: [{ id: "A", label: "Repo", rootPath: "/repo" }],
    });
    const summary = listed.sessions[0]!;

    const page = await reader.readTranscriptPage({ sessionKey: summary.contentSessionKey });

    expect(page.blocks.filter((block) => block.kind === "message").map((block) => block.text)).toEqual([
      "Alias question",
      "Alias answer",
    ]);
    expect(await reader.resolveExternalSession(summary.contentSessionKey)).toEqual({ kind: "none" });
    expect(await reader.resolveExternalSession(summary.sessionKey)).toEqual({
      kind: "resume",
      projectId: "A",
      cwd: "/repo",
      sessionId: "content-alias",
    });
  });

  it("removes content session aliases when caches are cleared", async () => {
    const { codexHome } = await transcriptFixture("cleared-alias", [
      { type: "session_meta", payload: { id: "cleared-alias", cwd: "/repo" } },
      { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Private transcript" }] } },
    ]);
    const reader = createCodexSessionsReader({ codexHome });
    const listed = await reader.listExternalSessions({ projects: [] });
    const contentSessionKey = listed.sessions[0]!.contentSessionKey;
    await expect(reader.readTranscriptPage({ sessionKey: contentSessionKey })).resolves.toMatchObject({
      blocks: [expect.objectContaining({ text: "Private transcript" })],
    });

    reader.clearCaches();

    await expect(reader.readTranscriptPage({ sessionKey: contentSessionKey })).rejects.toThrow("Unknown external session.");
  });

  it("rejects unknown content-shaped transcript keys without exposing local paths", async () => {
    const codexHome = mkdtempSync(path.join(tmpdir(), "alfred-codex-home-"));
    const reader = createCodexSessionsReader({ codexHome });
    const error = await reader.readTranscriptPage({ sessionKey: "external-codex:not-listed" }).catch((reason: unknown) => reason as Error);

    expect(error).toMatchObject({ message: "Unknown external session." });
    expect(`${error.message}:${JSON.stringify(error)}`).not.toContain(codexHome);
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

  it("reads only known Codex message roles and marks malformed transcript data as partial", async () => {
    const { codexHome, file } = await transcriptFixture("roles", [
      { type: "session_meta", payload: { id: "roles", cwd: "/repo" } },
      { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Question" }] } },
      { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Answer" }] } },
      { type: "response_item", payload: { type: "message", role: "system", content: [{ type: "output_text", text: "Instruction" }] } },
      { type: "response_item", payload: { type: "message", role: "tool", content: [{ type: "output_text", text: "Do not show" }] } },
      { type: "response_item", payload: { type: "function_call", name: "exec_command", arguments: "{}" } },
      "{ not json",
    ]);
    const reader = createCodexSessionsReader({ codexHome });
    const listed = await reader.listExternalSessions({ projects: [{ id: "A", label: "Repo", rootPath: "/repo" }] });

    const page = await reader.readTranscriptPage({ sessionKey: listed.sessions[0]!.sessionKey });

    expect(page.blocks.filter((block) => block.kind === "message").map((block) => block.text)).toEqual(["Question", "Answer", "Instruction"]);
    expect(page.blocks.every((block) => block.kind !== "message" || ["user", "assistant", "system"].includes(block.role))).toBe(true);
    expect(page.blocks.some((block) => block.kind === "notice")).toBe(true);
    expect(page.partial).toBe(true);
    expect(file).toContain("roles.jsonl");
  });

  it("bounds transcript pages by 50 blocks and 256 KiB and rejects opaque or stale cursors", async () => {
    const records = [{ type: "session_meta", payload: { id: "bounded", cwd: "/repo" } }];
    for (let index = 0; index < 60; index += 1) {
      records.push({ type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: `message-${index}` }] } });
    }
    const { codexHome, file } = await transcriptFixture("bounded", records);
    const reader = createCodexSessionsReader({ codexHome });
    const listed = await reader.listExternalSessions({ projects: [{ id: "A", label: "Repo", rootPath: "/repo" }] });
    const first = await reader.readTranscriptPage({ sessionKey: listed.sessions[0]!.sessionKey });

    expect(first.blocks).toHaveLength(50);
    expect(first.blocks.reduce((sum, block) => sum + Buffer.byteLength(block.text), 0)).toBeLessThanOrEqual(256 * 1024);
    expect(first.nextCursor).toEqual(expect.any(String));
    await expect(reader.readTranscriptPage({ sessionKey: listed.sessions[0]!.sessionKey, cursor: "opaque-path" })).rejects.toThrow("Transcript cursor is invalid or stale.");
    await writeFile(file, `${await readText(file)}\n${JSON.stringify({ type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "changed" }] } })}`);
    await expect(reader.readTranscriptPage({ sessionKey: listed.sessions[0]!.sessionKey, cursor: first.nextCursor! })).rejects.toThrow("Transcript cursor is invalid or stale.");

    const huge = await transcriptFixture("large-block", [
      { type: "session_meta", payload: { id: "large-block", cwd: "/repo" } },
      { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "x".repeat(300 * 1024) }] } },
      { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "After oversized record" }] } },
    ]);
    const hugeReader = createCodexSessionsReader({ codexHome: huge.codexHome });
    const hugeListed = await hugeReader.listExternalSessions({ projects: [{ id: "A", label: "Repo", rootPath: "/repo" }] });
    const hugePage = await hugeReader.readTranscriptPage({ sessionKey: hugeListed.sessions[0]!.sessionKey });
    expect(Buffer.byteLength(hugePage.blocks[0]!.text)).toBeLessThan(256 * 1024);
    expect(hugePage.nextCursor).toEqual(expect.any(String));
    expect(hugePage.partial).toBe(true);
    expect(hugePage.blocks.some((block) => block.kind === "notice" && block.text === "Some transcript content was truncated to fit this page.")).toBe(true);
    const afterHuge = await hugeReader.readTranscriptPage({ sessionKey: hugeListed.sessions[0]!.sessionKey, cursor: hugePage.nextCursor! });
    expect(afterHuge.blocks.filter((block) => block.kind === "message").map((block) => block.text)).toEqual(["After oversized record"]);
  });

  it("keeps a near-limit valid message intact and reports a following malformed record on the next page", async () => {
    const intact = "n".repeat(256 * 1024 - 8);
    const { codexHome } = await transcriptFixture("notice-boundary", [
      { type: "session_meta", payload: { id: "notice-boundary", cwd: "/repo" } },
      { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: intact }] } },
      "{ malformed",
      { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "After malformed" }] } },
    ]);
    const reader = createCodexSessionsReader({ codexHome });
    const listed = await reader.listExternalSessions({ projects: [{ id: "A", label: "Repo", rootPath: "/repo" }] });
    const first = await reader.readTranscriptPage({ sessionKey: listed.sessions[0]!.sessionKey });
    const second = await reader.readTranscriptPage({ sessionKey: listed.sessions[0]!.sessionKey, cursor: first.nextCursor! });

    expect(first.partial).toBe(false);
    expect(first.blocks.filter((block) => block.kind === "message").map((block) => block.text)).toEqual([intact]);
    expect(Buffer.byteLength(first.blocks[0]!.text)).toBe(Buffer.byteLength(intact));
    expect(second.partial).toBe(true);
    expect(second.blocks.some((block) => block.kind === "notice" && block.text === "Some malformed transcript records were omitted.")).toBe(true);
    expect(second.blocks.filter((block) => block.kind === "message").map((block) => block.text)).toEqual(["After malformed"]);
  });

  it("reserves a pending malformed notice before admitting a near-limit valid message", async () => {
    const nearLimit = "r".repeat(256 * 1024 - 8);
    const { codexHome } = await transcriptFixture("notice-reserve", [
      { type: "session_meta", payload: { id: "notice-reserve", cwd: "/repo" } },
      "{ malformed",
      { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: nearLimit }] } },
      { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Later valid" }] } },
    ]);
    const reader = createCodexSessionsReader({ codexHome });
    const listed = await reader.listExternalSessions({ projects: [{ id: "A", label: "Repo", rootPath: "/repo" }] });
    const sessionKey = listed.sessions[0]!.sessionKey;
    const pages = [];
    let cursor: string | undefined;
    do {
      const page = await reader.readTranscriptPage({ sessionKey, ...(cursor ? { cursor } : {}) });
      pages.push(page);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);

    expect(pages.flatMap((page) => page.blocks.filter((block) => block.kind === "notice").map((block) => block.text))).toEqual(["Some malformed transcript records were omitted."]);
    expect(pages.flatMap((page) => page.blocks.filter((block) => block.kind === "message").map((block) => block.text))).toEqual([nearLimit, "Later valid"]);
    expect(Buffer.byteLength(pages.flatMap((page) => page.blocks).find((block) => block.kind === "message")!.text)).toBe(Buffer.byteLength(nearLimit));
  });

  it("uses UTF-8 byte cursors and returns every source message exactly once across byte-limited pages", async () => {
    const messages = Array.from({ length: 120 }, (_, index) => `${String(index).padStart(3, "0")}:${"x".repeat(6_000)}`);
    const records = [
      { type: "session_meta", payload: { id: "byte-pages", cwd: "/repo" } },
      ...messages.map((text) => ({ type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text }] } })),
    ];
    const { codexHome } = await transcriptFixture("byte-pages", records);
    const reader = createCodexSessionsReader({ codexHome });
    const listed = await reader.listExternalSessions({ projects: [{ id: "A", label: "Repo", rootPath: "/repo" }] });
    const sessionKey = listed.sessions[0]!.sessionKey;
    const first = await reader.readTranscriptPage({ sessionKey });
    const firstCursor = decodeCursor(first.nextCursor!);
    const expectedFirstOffset = Buffer.byteLength(records.slice(0, 44).map((record) => JSON.stringify(record)).join("\n") + "\n");
    const received = first.blocks.filter((block) => block.kind === "message").map((block) => block.text);
    let cursor = first.nextCursor;
    while (cursor) {
      const page = await reader.readTranscriptPage({ sessionKey, cursor });
      received.push(...page.blocks.filter((block) => block.kind === "message").map((block) => block.text));
      cursor = page.nextCursor;
    }

    expect(firstCursor.offset).toBe(expectedFirstOffset);
    expect(firstCursor.offset).toBeGreaterThan(120);
    expect(received).toEqual(messages);
  });

  it("refreshes an unchanged transcript when the Codex title index changes", async () => {
    const { codexHome } = await transcriptFixture("indexed", [
      { type: "session_meta", payload: { id: "indexed", cwd: "/repo" } },
      { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Fallback" }] } },
    ]);
    const index = path.join(codexHome, "session_index.jsonl");
    await writeFile(index, JSON.stringify({ id: "indexed", thread_name: "First indexed title" }));
    const reader = createCodexSessionsReader({ codexHome });
    expect((await reader.listExternalSessions({ projects: [] })).sessions[0]?.title).toBe("First indexed title");

    await writeFile(index, JSON.stringify({ id: "indexed", thread_name: "Updated indexed title" }));
    expect((await reader.listExternalSessions({ projects: [] })).sessions[0]?.title).toBe("Updated indexed title");

    await writeFile(index, "");
    expect((await reader.listExternalSessions({ projects: [] })).sessions[0]?.title).toBe("Fallback");
  });

  it("accounts for private source data when evicting summary cache entries", async () => {
    const codexHome = mkdtempSync(path.join(tmpdir(), "alfred-codex-home-"));
    const sessionDir = path.join(codexHome, "sessions", "2026", "07", "20");
    await mkdir(sessionDir, { recursive: true });
    const privateCwd = `/repo/${"x".repeat(3 * 1024 * 1024)}`;
    for (let index = 0; index < 4; index += 1) {
      await writeFile(path.join(sessionDir, `private-${index}.jsonl`), JSON.stringify({ type: "session_meta", payload: { id: `private-${index}`, cwd: privateCwd } }));
    }

    const reader = createCodexSessionsReader({ codexHome });
    await reader.listExternalSessions({ projects: [] });

    expect(reader.getDiagnostics().summaryCount).toBeLessThan(4);
    expect(reader.getDiagnostics().summaryBytes).toBeLessThanOrEqual(10 * 1024 * 1024);
  });

  it("returns a path-free transcript error when a listed source disappears", async () => {
    const { codexHome, file } = await transcriptFixture("gone", [
      { type: "session_meta", payload: { id: "gone", cwd: "/repo" } },
      { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Gone" }] } },
    ]);
    const reader = createCodexSessionsReader({ codexHome });
    const listed = await reader.listExternalSessions({ projects: [{ id: "A", label: "Repo", rootPath: "/repo" }] });
    await unlink(file);
    const error = await reader.readTranscriptPage({ sessionKey: listed.sessions[0]!.sessionKey }).catch((reason: unknown) => reason as Error);

    expect(error).toMatchObject({ message: "Unable to read external session transcript." });
    expect(`${error.message}:${JSON.stringify(error)}`).not.toContain(file);
    expect(`${error.message}:${JSON.stringify(error)}`).not.toContain(codexHome);
  });

  it("evicts transcript pages by session LRU and respects decoded byte diagnostics", async () => {
    const codexHome = mkdtempSync(path.join(tmpdir(), "alfred-codex-home-"));
    const sessionDir = path.join(codexHome, "sessions", "2026", "07", "20");
    await mkdir(sessionDir, { recursive: true });
    for (let index = 0; index < 4; index += 1) {
      await writeFile(path.join(sessionDir, `session-${index}.jsonl`), codexLines({ id: `session-${index}`, cwd: "/repo", title: "x".repeat(64 * 1024) }));
    }
    const reader = createCodexSessionsReader({ codexHome });
    const listed = await reader.listExternalSessions({ projects: [{ id: "A", label: "Repo", rootPath: "/repo" }] });
    for (const session of listed.sessions) await reader.readTranscriptPage({ sessionKey: session.sessionKey });

    expect(reader.getDiagnostics()).toMatchObject({ cachedSessionCount: 3 });
    expect(reader.getDiagnostics().decodedTranscriptBytes).toBeLessThanOrEqual(16 * 1024 * 1024);
  });

  it("bounds summary cache diagnostics beyond the configured entry limit", async () => {
    const codexHome = mkdtempSync(path.join(tmpdir(), "alfred-codex-home-"));
    const sessionDir = path.join(codexHome, "sessions", "2026", "07", "20");
    await mkdir(sessionDir, { recursive: true });
    await Promise.all(Array.from({ length: 5 }, (_, index) => writeFile(
      path.join(sessionDir, `summary-${index}.jsonl`),
      JSON.stringify({ type: "session_meta", payload: { id: `summary-${index}` } }),
    )));
    expect(SUMMARY_CACHE_COUNT_LIMIT).toBe(5_000);
    vi.resetModules();
    vi.doMock("../shared/sessions-ipc.js", async (importOriginal) => ({
      ...await importOriginal<typeof import("../shared/sessions-ipc.js")>(),
      SUMMARY_CACHE_COUNT_LIMIT: 3,
    }));
    try {
      const { createCodexSessionsReader: createReaderWithSmallCache } = await import("./codex-sessions.js");
      const reader = createReaderWithSmallCache({ codexHome });
      await reader.listExternalSessions({ projects: [], limit: 1 });

      expect(reader.getDiagnostics().summaryCount).toBe(3);
      expect(reader.getDiagnostics().summaryBytes).toBeLessThanOrEqual(10 * 1024 * 1024);
    } finally {
      vi.doUnmock("../shared/sessions-ipc.js");
      vi.resetModules();
    }
  });

  it("indexes 5,000 deterministic summaries while keeping summary diagnostics capped", async () => {
    const codexHome = mkdtempSync(path.join(tmpdir(), "alfred-codex-home-"));
    await writeCodexSummaryFixtures(codexHome, 5_000, "/fixture/project");
    const reader = createCodexSessionsReader({ codexHome });

    const listed = await reader.listExternalSessions({
      projects: [{ id: "A", label: "Fixture project", rootPath: "/fixture/project" }],
      limit: 1,
    });
    const diagnostics = reader.getDiagnostics();

    expect(listed.total).toBe(5_000);
    expect(listed.sessions).toHaveLength(1);
    expect(diagnostics.summaryCount).toBe(SUMMARY_CACHE_COUNT_LIMIT);
    expect(diagnostics.summaryBytes).toBeLessThanOrEqual(10 * 1024 * 1024);
    console.info(JSON.stringify({
      evidence: "sessions-summary-resource",
      listedTotal: listed.total,
      summaryBytes: diagnostics.summaryBytes,
      summaryCount: diagnostics.summaryCount,
    }));
  });

  it("streams the first page of a 10 MiB 100k-line transcript without reading to EOF", async () => {
    const codexHome = mkdtempSync(path.join(tmpdir(), "alfred-codex-home-"));
    const resource = await writeLargeCodexTranscriptFixture(codexHome);
    const reader = createCodexSessionsReader({ codexHome });
    const listed = await reader.listExternalSessions({ projects: [{ id: "A", label: "Repo", rootPath: "/fixture/project" }], limit: 1 });
    const large = listed.sessions.find((session) => session.contentSessionKey === "external-codex:resource-100k-lines")!;
    const startedAt = performance.now();
    const first = await reader.readTranscriptPage({ sessionKey: large.sessionKey });
    const firstPageMs = performance.now() - startedAt;

    expect(resource.lineCount).toBe(100_000);
    expect(resource.size).toBeGreaterThanOrEqual(10 * 1024 * 1024);
    expect(first.blocks).toHaveLength(50);
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(decodeCursor(first.nextCursor!).offset).toBeLessThan(resource.size / 100);
    if (process.env.ALFRED_ENFORCE_SESSIONS_REFERENCE_TIMING === "1") {
      expect(firstPageMs).toBeLessThanOrEqual(750);
    }
    console.info(JSON.stringify({
      evidence: "sessions-first-page-resource",
      fileBytes: resource.size,
      firstPageMs: Number(firstPageMs.toFixed(3)),
      firstCursorOffset: decodeCursor(first.nextCursor!).offset,
      lineCount: resource.lineCount,
      referenceBudgetMs: 750,
      timingEnforced: process.env.ALFRED_ENFORCE_SESSIONS_REFERENCE_TIMING === "1",
    }));
  });
});

async function transcriptFixture(id: string, records: Array<unknown>): Promise<{ codexHome: string; file: string }> {
  const codexHome = mkdtempSync(path.join(tmpdir(), "alfred-codex-home-"));
  const sessionDir = path.join(codexHome, "sessions", "2026", "07", "20");
  await mkdir(sessionDir, { recursive: true });
  const file = path.join(sessionDir, `${id}.jsonl`);
  await writeFile(file, records.map((record) => typeof record === "string" ? record : JSON.stringify(record)).join("\n"));
  return { codexHome, file };
}

async function readText(file: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  return readFile(file, "utf8");
}

function decodeCursor(value: string): { offset: number; revision: string } {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { offset: number; revision: string };
}

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
