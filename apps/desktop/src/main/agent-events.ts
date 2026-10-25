import { randomBytes } from "node:crypto";
import { appendFile, mkdir, rm } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { redactUnknown } from "@alfred/schema";

/**
 * Claude Code and Codex export their own OpenTelemetry log events: prompts, API calls with tokens, tool approvals
 * with their source, and tool results. Alfred points the agents it launches at a local endpoint and appends each
 * event as one JSON line to a file per day, so their work stays on record after the session ends.
 */
export type AgentEventLog = {
  /** Deletes every recorded event. */
  clear(): Promise<void>;
  close(): Promise<void>;
  /** Environment that makes a `claude` session send its events here. */
  env(sessionId: string, command?: string): Record<string, string>;
  /** Leading arguments that make a `codex` session send its events here. */
  launchArgs(sessionId: string, command?: string): string[];
};

type AgentEventLogOptions = {
  /** Directory for the day files; Alfred owns it. */
  dir: string;
  /** Whether Alfred may write to disk now; read for every launch and every delivery. */
  isRecording: () => boolean;
};

export type AgentEventLine = {
  agent: "claude" | "codex";
  at: string;
  attributes: Record<string, unknown>;
  event: string;
  session: string;
  version?: string;
};

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_STRING_LENGTH = 2000;
/** Who sent an event, not what was done; never written. */
const IDENTITY_KEY = /^user\.|^organization\.id$/;
/** /<secret>/<agent>/<Alfred session id, a UUID>/v1/logs */
const ENDPOINT_PATH = /^\/([0-9a-f]{32})\/(claude|codex)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/v1\/logs$/;

export async function createAgentEventLog(options: AgentEventLogOptions): Promise<AgentEventLog> {
  let secret = randomBytes(16).toString("hex");
  // One write at a time, so lines from two sessions never interleave and a clear never races a write.
  let queue = Promise.resolve();
  const enqueue = (task: () => Promise<unknown>): Promise<void> => {
    queue = queue.then(task).then(
      () => {},
      (error: unknown) => console.error("Failed to write agent events.", error),
    );
    return queue;
  };

  const server = http.createServer((request, response) => {
    const match = ENDPOINT_PATH.exec(request.url ?? "");
    if (request.method !== "POST" || !match || match[1] !== secret) {
      request.resume();
      response.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        response.writeHead(413, { connection: "close" }).end();
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (size > MAX_BODY_BYTES) return;
      let body: unknown;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        response.writeHead(400).end();
        return;
      }
      // Answer first: the agent's exporter never waits on Alfred's disk.
      response.writeHead(200, { "content-type": "application/json" }).end("{}");
      if (!options.isRecording()) return;
      const lines = agentEventLines(match[2] as AgentEventLine["agent"], match[3]!, body);
      if (lines.length === 0) return;
      const file = path.join(options.dir, `${new Date().toISOString().slice(0, 10)}.jsonl`);
      void enqueue(async () => {
        await mkdir(options.dir, { recursive: true, mode: 0o700 });
        await appendFile(file, lines.map((line) => JSON.stringify(line) + "\n").join(""), { mode: 0o600 });
      });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  const endpoint = (agent: string, sessionId: string): string =>
    `http://127.0.0.1:${port}/${secret}/${agent}/${sessionId}/v1/logs`;

  return {
    clear: () => {
      // Sessions launched before the clear keep the old address, so they cannot write the log again.
      secret = randomBytes(16).toString("hex");
      return enqueue(() => rm(options.dir, { recursive: true, force: true }));
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeIdleConnections();
      }).then(() => queue),
    env: (sessionId, command) =>
      command === "claude" && options.isRecording()
        ? {
            CLAUDE_CODE_ENABLE_TELEMETRY: "1",
            OTEL_LOGS_EXPORTER: "otlp",
            OTEL_EXPORTER_OTLP_LOGS_PROTOCOL: "http/json",
            OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: endpoint("claude", sessionId),
            // Commands and file paths, but never the text of prompts or replies, even if the shell turned it on.
            OTEL_LOG_TOOL_DETAILS: "1",
            OTEL_LOG_USER_PROMPTS: "0",
            OTEL_LOG_ASSISTANT_RESPONSES: "0",
          }
        : {},
    launchArgs: (sessionId, command) =>
      command === "codex" && options.isRecording()
        ? [
            "-c",
            `otel.exporter={otlp-http={endpoint=${JSON.stringify(endpoint("codex", sessionId))},protocol="json"}}`,
            "-c",
            "otel.log_user_prompt=false",
          ]
        : [],
  };
}

/** The named events in one OTLP/JSON logs request, redacted and without who sent them. */
export function agentEventLines(agent: AgentEventLine["agent"], session: string, body: unknown): AgentEventLine[] {
  const lines: AgentEventLine[] = [];
  for (const resourceLog of arrayAt(body, "resourceLogs")) {
    const version = attributesOf(recordAt(resourceLog, "resource"))["service.version"];
    for (const scopeLog of arrayAt(resourceLog, "scopeLogs")) {
      for (const record of arrayAt(scopeLog, "logRecords")) {
        const attributes = attributesOf(record);
        const event = attributes["event.name"];
        // Unnamed records are the exporters' own diagnostics, such as Codex's "flushing OTEL metrics".
        if (typeof event !== "string") continue;
        for (const key of Object.keys(attributes)) if (IDENTITY_KEY.test(key)) delete attributes[key];
        lines.push({
          agent,
          at: timeOf(record),
          attributes: redacted(attributes),
          event,
          session,
          ...(typeof version === "string" ? { version } : {}),
        });
      }
    }
  }
  return lines;
}

function redacted(attributes: Record<string, unknown>): Record<string, unknown> {
  // The redactor blanks a value by its key's name too, which would take every *_token_count; numbers hold no secret.
  const text = Object.fromEntries(Object.entries(attributes).filter(([, value]) => typeof value !== "number" && typeof value !== "boolean"));
  return capStrings({ ...attributes, ...(redactUnknown(text) as Record<string, unknown>) }) as Record<string, unknown>;
}

function capStrings(value: unknown): unknown {
  if (typeof value === "string") return value.length > MAX_STRING_LENGTH ? value.slice(0, MAX_STRING_LENGTH) + "…" : value;
  if (Array.isArray(value)) return value.map(capStrings);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, capStrings(entry)]));
  return value;
}

/** Codex leaves timeUnixNano at 0 and sets only the observed time. */
function timeOf(record: unknown): string {
  for (const key of ["timeUnixNano", "observedTimeUnixNano"]) {
    // Nanoseconds since 1970 lose their last digits as a double; rounding keeps the millisecond.
    const ms = Math.round(Number(recordAt(record, key) ?? Number.NaN) / 1e6);
    if (ms > 0) return new Date(ms).toISOString();
  }
  return new Date().toISOString();
}

function attributesOf(owner: unknown): Record<string, unknown> {
  return Object.fromEntries(
    arrayAt(owner, "attributes").flatMap((entry) => {
      const key = recordAt(entry, "key");
      return typeof key === "string" ? [[key, plainValue(recordAt(entry, "value"))]] : [];
    }),
  );
}

/** An OTLP AnyValue as plain JSON; 64-bit integers arrive as strings. */
function plainValue(value: unknown): unknown {
  if (!value || typeof value !== "object") return undefined;
  const any = value as Record<string, unknown>;
  if ("stringValue" in any) return any.stringValue;
  if ("boolValue" in any) return any.boolValue;
  if ("intValue" in any) return Number(any.intValue);
  if ("doubleValue" in any) return any.doubleValue;
  if ("arrayValue" in any) return arrayAt(any.arrayValue, "values").map(plainValue);
  if ("kvlistValue" in any) return attributesOf({ attributes: recordAt(any.kvlistValue, "values") });
  return undefined;
}

function recordAt(value: unknown, key: string): unknown {
  return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

function arrayAt(value: unknown, key: string): unknown[] {
  const entry = recordAt(value, key);
  return Array.isArray(entry) ? entry : [];
}
