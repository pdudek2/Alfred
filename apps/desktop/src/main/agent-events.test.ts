import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { agentEventLines, createAgentEventLog, type AgentEventLine } from "./agent-events.js";

const SESSION = "6f1c2a4e-8b1d-4c3e-9f2a-0d5e7b8c9a10";

const text = (key: string, value: string) => ({ key, value: { stringValue: value } });
const int = (key: string, value: number) => ({ key, value: { intValue: String(value) } });

/** Trimmed from what Claude Code 2.1.310 sent with OTEL_LOG_TOOL_DETAILS=1. */
const claudeBody = {
  resourceLogs: [{
    resource: { attributes: [text("service.name", "claude-code"), text("service.version", "2.1.310")] },
    scopeLogs: [{
      logRecords: [
        {
          timeUnixNano: "1792936399146000000",
          body: { stringValue: "claude_code.tool_decision" },
          attributes: [
            text("user.email", "someone@example.com"),
            text("user.id", "abc"),
            text("organization.id", "org"),
            text("session.id", "20f1a15f-0000-4000-8000-000000000000"),
            text("event.name", "tool_decision"),
            text("decision", "accept"),
            text("source", "config"),
            text("tool_name", "Bash"),
            text("tool_parameters", JSON.stringify({ full_command: "export OPENAI_API_KEY=sk-test-1234567890abcdef && pnpm test" })),
          ],
        },
        {
          timeUnixNano: "1792936399286000000",
          attributes: [text("event.name", "api_request"), int("input_tokens", 1234), int("cache_read_tokens", 99)],
        },
      ],
    }],
  }],
};

/** Trimmed from what Codex 0.164.0 sent with protocol="json". */
const codexBody = {
  resourceLogs: [{
    resource: { attributes: [text("service.version", "0.164.0")] },
    scopeLogs: [{
      logRecords: [
        {
          timeUnixNano: "0",
          observedTimeUnixNano: "1792936349821001000",
          attributes: [
            text("event.name", "codex.tool_result"),
            text("tool_name", "exec_command"),
            text("arguments", JSON.stringify({ cmd: "echo probe" })),
            text("output", "x".repeat(5000)),
            { key: "success", value: { boolValue: true } },
          ],
        },
        { timeUnixNano: "0", observedTimeUnixNano: "1792936349821001000", attributes: [text("event.name", "codex.sse_event"), int("cached_token_count", 512)] },
        { timeUnixNano: "0", observedTimeUnixNano: "1792936349821001000", body: { stringValue: "flushing OTEL metrics" } },
      ],
    }],
  }],
};

describe("agentEventLines", () => {
  it("keeps what Claude did, redacted, and drops who it was", () => {
    const [decision, request] = agentEventLines("claude", SESSION, claudeBody);

    expect(decision).toMatchObject({
      agent: "claude",
      at: "2026-10-25T13:53:19.146Z",
      event: "tool_decision",
      session: SESSION,
      version: "2.1.310",
      attributes: { decision: "accept", source: "config", tool_name: "Bash" },
    });
    // An array names one dotted key rather than a path.
    for (const key of ["user.email", "user.id", "organization.id"]) expect(decision!.attributes).not.toHaveProperty([key]);
    expect(decision!.attributes).toHaveProperty(["session.id"]);
    expect(decision!.attributes["tool_parameters"]).toContain("pnpm test");
    expect(decision!.attributes["tool_parameters"]).not.toContain("sk-test-1234567890abcdef");
    // Token counts survive although the redactor blanks values under keys that name a token.
    expect(request!.attributes).toMatchObject({ input_tokens: 1234, cache_read_tokens: 99 });
  });

  it("takes Codex's observed time, caps long output and skips the exporter's own records", () => {
    const lines = agentEventLines("codex", SESSION, codexBody);

    expect(lines.map((line) => line.event)).toEqual(["codex.tool_result", "codex.sse_event"]);
    expect(lines[0]!.at).toBe("2026-10-25T13:52:29.821Z");
    expect(lines[0]!.attributes["output"]).toBe("x".repeat(2000) + "…");
    expect(lines[0]!.attributes).toMatchObject({ arguments: JSON.stringify({ cmd: "echo probe" }), success: true });
    expect(lines[1]!.attributes).toMatchObject({ cached_token_count: 512 });
  });

  it("ignores bodies that are not OTLP logs", () => {
    for (const body of [null, "text", [], { resourceLogs: "x" }, { resourceLogs: [{ scopeLogs: [{ logRecords: [42] }] }] }]) {
      expect(agentEventLines("claude", SESSION, body)).toEqual([]);
    }
  });
});

describe("createAgentEventLog", () => {
  let dir: string;
  let recording = true;
  afterEach(async () => {
    recording = true;
    await rm(dir, { recursive: true, force: true });
  });

  async function open() {
    dir = path.join(await mkdtemp(path.join(os.tmpdir(), "alfred-agent-events-")), "agent-events");
    return createAgentEventLog({ dir, isRecording: () => recording });
  }

  async function recorded(): Promise<AgentEventLine[]> {
    const files = await readdir(dir).catch(() => []);
    const text = (await Promise.all(files.map((file) => readFile(path.join(dir, file), "utf8")))).join("");
    return text.split("\n").filter(Boolean).map((line) => JSON.parse(line) as AgentEventLine);
  }

  const post = (url: string, body: string) => fetch(url, { method: "POST", body, headers: { "content-type": "application/json" } });

  it("points each agent at its own session's endpoint and appends what arrives there", async () => {
    const log = await open();
    const env = log.env({ id: SESSION }, "claude");
    expect(env).toMatchObject({
      CLAUDE_CODE_ENABLE_TELEMETRY: "1",
      OTEL_LOGS_EXPORTER: "otlp",
      OTEL_EXPORTER_OTLP_LOGS_PROTOCOL: "http/json",
      OTEL_LOG_TOOL_DETAILS: "1",
      OTEL_LOG_USER_PROMPTS: "0",
    });
    const codexArgs = log.launchArgs({ id: SESSION }, "codex");
    expect(codexArgs[0]).toBe("-c");
    const codexUrl = /endpoint="([^"]+)"/.exec(codexArgs[1]!)![1]!;
    expect(codexUrl).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:\\d+/[0-9a-f]{32}/codex/${SESSION}/v1/logs$`));
    expect(log.env({ id: SESSION }, "codex")).toEqual({});
    expect(log.launchArgs({ id: SESSION }, "claude")).toEqual([]);
    expect(log.env({ id: SESSION }, undefined)).toEqual({});

    expect((await post(env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT!, JSON.stringify(claudeBody))).status).toBe(200);
    expect((await post(codexUrl, JSON.stringify(codexBody))).status).toBe(200);
    await log.close();

    const lines = await recorded();
    expect(lines.map((line) => [line.agent, line.event, line.session])).toEqual([
      ["claude", "tool_decision", SESSION],
      ["claude", "api_request", SESSION],
      ["codex", "codex.tool_result", SESSION],
      ["codex", "codex.sse_event", SESSION],
    ]);
  });

  it("records under the Alfred session's own id, which a resumed process keeps", async () => {
    const log = await open();
    const first = log.env({ id: SESSION, clientId: "claude-9" }, "claude").OTEL_EXPORTER_OTLP_LOGS_ENDPOINT!;
    const resumed = log.env({ id: "0e776fc8-3e7a-4735-8edc-fe9394830346", clientId: "claude-9" }, "claude").OTEL_EXPORTER_OTLP_LOGS_ENDPOINT!;
    expect(first).toMatch(/\/claude\/claude-9\/v1\/logs$/);
    expect(resumed).toBe(first);
    expect(log.launchArgs({ id: SESSION, clientId: "external-codex-019a2b3c-1792" }, "codex")[1]).toContain("/codex/external-codex-019a2b3c-1792/");
    // An id that does not fit an address segment falls back to the process's own.
    for (const clientId of ["../x", "a b", "", "x".repeat(129)]) {
      expect(log.env({ id: SESSION, clientId }, "claude").OTEL_EXPORTER_OTLP_LOGS_ENDPOINT).toContain(`/claude/${SESSION}/`);
    }

    await post(first, JSON.stringify(claudeBody));
    await log.close();

    expect((await recorded()).map((line) => line.session)).toEqual(["claude-9", "claude-9"]);
  });

  it("writes nothing for a wrong secret, an oversized body or broken JSON", async () => {
    const log = await open();
    const url = log.env({ id: SESSION }, "claude").OTEL_EXPORTER_OTLP_LOGS_ENDPOINT!;
    const wrongSecret = url.replace(/\/[0-9a-f]{32}\//, `/${"0".repeat(32)}/`);

    expect((await post(wrongSecret, JSON.stringify(claudeBody))).status).toBe(404);
    expect((await post(url.replace(SESSION, "bad%20id"), JSON.stringify(claudeBody))).status).toBe(404);
    expect((await post(url, "{")).status).toBe(400);
    expect((await post(url, JSON.stringify({ pad: "x".repeat(1024 * 1024) })).catch(() => ({ status: 413 }))).status).toBe(413);
    await log.close();

    expect(await recorded()).toEqual([]);
  });

  it("neither launches with export settings nor writes while terminal data is not saved", async () => {
    const log = await open();
    const url = log.env({ id: SESSION }, "claude").OTEL_EXPORTER_OTLP_LOGS_ENDPOINT!;
    recording = false;

    expect(log.env({ id: SESSION }, "claude")).toEqual({});
    expect(log.launchArgs({ id: SESSION }, "codex")).toEqual([]);
    expect((await post(url, JSON.stringify(claudeBody))).status).toBe(200);
    await log.close();

    expect(await recorded()).toEqual([]);
  });

  it("deletes every recorded day on clear, and sessions launched before it cannot write again", async () => {
    const log = await open();
    const before = log.env({ id: SESSION }, "claude").OTEL_EXPORTER_OTLP_LOGS_ENDPOINT!;
    await post(before, JSON.stringify(claudeBody));
    await log.clear();

    expect((await post(before, JSON.stringify(claudeBody))).status).toBe(404);
    const after = log.env({ id: SESSION }, "claude").OTEL_EXPORTER_OTLP_LOGS_ENDPOINT!;
    expect(after).not.toBe(before);
    await log.close();

    expect(await recorded()).toEqual([]);
  });
});
