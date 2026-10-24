import { chmod, mkdir, unlink, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { SessionActivityInput } from "../shared/session-activity.js";
import type { TerminalAgentSignal } from "../shared/terminal-ipc.js";
import { WORKER_TOOL_DEFINITIONS } from "./worker-tools.js";

/** Session model contract §3: how Alfred senses agent and shell state. */

export type AgentSignalUpdate = Pick<TerminalAgentSignal, "detail" | "state"> & {
  /** What the hook says the agent did: the tool it ran or the message you sent. Its history comes from these, not its screen. */
  activity?: SessionActivityInput;
  /** The whole answer a turn ended with, for an orchestrator reading its worker. */
  answer?: string;
};

const HOOK_EVENTS = ["UserPromptSubmit", "PermissionRequest", "PostToolUse", "Stop"] as const;
const KNOWN_SHELLS = new Set(["zsh", "bash", "sh", "fish", "nu", "dash", "ksh", "tcsh", "csh"]);
const MAX_HOOK_MESSAGE_BYTES = 1_000_000;
const MAX_OSC_CARRY = 1_024;
const MAX_DETAIL = 240;
const MAX_ANSWER = 20_000;
/** Long enough for wait_for_worker's two minutes; Claude reads it from the environment, Codex from its server entry. */
const MCP_TOOL_TIMEOUT_SECONDS = 150;
/** macOS limits unix socket paths to 104 bytes. */
const MAX_SOCKET_PATH = 100;

const RELAY_SOURCE = `// Forwards one agent hook event to Alfred. It must never fail the agent, so it always exits 0.
const net = require("node:net");
const chunks = [];
process.stdin.on("data", (chunk) => chunks.push(chunk));
process.stdin.on("end", () => {
  const socketPath = process.env.ALFRED_HOOK_SOCKET;
  if (!socketPath) process.exit(0);
  const message = JSON.stringify({
    sessionId: process.env.ALFRED_SESSION_ID,
    event: process.argv[2],
    payload: Buffer.concat(chunks).toString("utf8"),
  }) + "\\n";
  const socket = net.connect(socketPath, () => socket.end(message));
  socket.on("error", () => process.exit(0));
  socket.on("close", () => process.exit(0));
});
setTimeout(() => process.exit(0), 1500).unref();
`;

/** Alfred's worker tools as an MCP server over stdio. It forwards each call to Alfred and never fails the agent. */
const MCP_SERVER_SOURCE = `// Alfred's tools for an orchestrator agent. Started as: <this file> <Alfred socket> <session id>.
const net = require("node:net");
const [socketPath, sessionId] = process.argv.slice(2);
const TOOLS = __TOOLS__;
let pending = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  pending += chunk;
  for (let end = pending.indexOf("\\n"); end !== -1; end = pending.indexOf("\\n")) {
    const line = pending.slice(0, end).trim();
    pending = pending.slice(end + 1);
    if (line) void handle(line);
  }
});
process.stdin.on("end", () => process.exit(0));
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n");
async function handle(line) {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return send({ id: null, error: { code: -32700, message: "Parse error" } });
  }
  const { id, method, params } = request;
  if (id === undefined || id === null) return;
  if (method === "initialize") {
    return send({ id, result: {
      protocolVersion: (params && params.protocolVersion) || "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "alfred", version: "1.0.0" },
    } });
  }
  if (method === "ping") return send({ id, result: {} });
  if (method === "tools/list") return send({ id, result: { tools: TOOLS } });
  if (method === "tools/call") {
    const reply = await callAlfred(params && params.name, (params && params.arguments) || {});
    const text = reply.ok ? JSON.stringify(reply.result, null, 2) : String(reply.error);
    return send({ id, result: { content: [{ type: "text", text }], ...(reply.ok ? {} : { isError: true }) } });
  }
  send({ id, error: { code: -32601, message: "Method not found: " + method } });
}
function callAlfred(tool, args) {
  return new Promise((resolve) => {
    let received = "";
    let done = false;
    const finish = (reply) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(reply);
    };
    const socket = net.connect(socketPath, () => socket.write(JSON.stringify({ type: "tool", sessionId, tool, args }) + "\\n"));
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      received += chunk;
      const end = received.indexOf("\\n");
      if (end === -1) return;
      try {
        finish(JSON.parse(received.slice(0, end)));
      } catch {
        finish({ ok: false, error: "Alfred sent a reply this server cannot read." });
      }
    });
    socket.on("error", () => finish({ ok: false, error: "Alfred is not reachable. It may have quit." }));
    socket.on("close", () => finish({ ok: false, error: "Alfred closed the connection without a reply." }));
  });
}
`;

export function isShellProcess(processName: string): boolean {
  const name = path.basename(processName.trim().split(/\s+/, 1)[0] ?? "").replace(/^-/, "").toLowerCase();
  return KNOWN_SHELLS.has(name);
}

/** Splits terminal output into complete OSC 9 messages; a trailing partial sequence is carried over. */
export function parseOsc9(carry: string, data: string): { carry: string; messages: string[] } {
  const text = carry + data;
  const messages: string[] = [];
  // eslint-disable-next-line no-control-regex
  const pattern = /\x1b\]9;([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
  let consumed = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    messages.push(match[1]!);
    consumed = pattern.lastIndex;
  }
  const rest = text.slice(consumed);
  const partialStart = rest.lastIndexOf("\x1b]9;");
  const nextCarry = partialStart === -1 ? "" : rest.slice(partialStart);
  return { carry: nextCarry.length > MAX_OSC_CARRY ? "" : nextCarry, messages };
}

/**
 * The Codex notifications that stop it until you answer: "Approval requested…" (a command, network access or
 * an MCP server), "Codex wants to edit …" and "Plan mode prompt: …". Any other message, such as the turn-end
 * preview or "Question: …" (answered with your next message), marks the end of its turn.
 */
const CODEX_WAITING = /^(?:approval requested\b|codex wants to edit\b|plan mode prompt:)/i;

export function signalFromOsc9(message: string): AgentSignalUpdate | null {
  const detail = message.trim().slice(0, MAX_DETAIL);
  if (!detail) return null;
  return CODEX_WAITING.test(detail) ? { state: "needs-you", detail } : { state: "your-turn", detail };
}

/**
 * What a terminal sends on its own once a program asks for it, as Codex does: focus in and out, mouse
 * movement, clicks and scrolling (Codex 0.163 turns on any-motion tracking), and answers to cursor
 * position, device, mode, keyboard-flag and colour queries. None of it answers an agent.
 */
const TERMINAL_REPORT = new RegExp(`^(?:${[
  String.raw`\x1b\[[IO]`,
  String.raw`\x1b\[<\d+;\d+;\d+[Mm]`,
  String.raw`\x1b\[M[\s\S]{3}`,
  String.raw`\x1b\[\??\d+;\d+(?:;\d+)?R`,
  String.raw`\x1b\[[?>=][\d;]*c`,
  String.raw`\x1b\[\?[\d;]*\$y`,
  String.raw`\x1b\[\?\d*u`,
  String.raw`\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)`,
].join("|")})+$`);

// ponytail: Ctrl+F3 is encoded like a cursor position report (CSI 1;5 R), so it does not clear Needs you either.
export function isTerminalReport(data: string): boolean {
  return TERMINAL_REPORT.test(data);
}

export function signalFromHook(event: string, payload: unknown): AgentSignalUpdate | null {
  switch (event) {
    case "UserPromptSubmit":
      return withActivity({ state: "working" }, promptActivity(payload));
    case "PostToolUse":
      return withActivity({ state: "working" }, toolActivity(payload));
    case "Stop": {
      const detail = describeTurnEnd(payload);
      const answer = turnAnswer(payload);
      return { state: "your-turn", ...(detail ? { detail } : {}), ...(answer ? { answer } : {}) };
    }
    case "PermissionRequest":
      return { state: "needs-you", detail: describePermissionRequest(payload) };
    default:
      return null;
  }
}

/** The agent's last answer. Claude and Codex both send it with Stop. */
function turnAnswer(payload: unknown): string | undefined {
  const message = typeof payload === "object" && payload !== null
    ? (payload as { last_assistant_message?: unknown }).last_assistant_message
    : undefined;
  return typeof message === "string" && message.trim() ? message.trim().slice(0, MAX_ANSWER) : undefined;
}

/** The first line of the agent's last answer, without Markdown marks. */
function describeTurnEnd(payload: unknown): string | undefined {
  const message = turnAnswer(payload);
  if (message === undefined) return undefined;
  const line = message
    .split("\n")
    .map((part) => part.replace(/^\s*(?:#+|[-*>]|\d+\.)\s+/, "").replace(/`|\*\*|__/g, "").trim())
    .find(Boolean);
  return line?.slice(0, MAX_DETAIL);
}

function describePermissionRequest(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) return "Waiting for approval";
  const { name, fields } = toolCall(payload);
  const target = toolTarget(fields);
  const toolName = name || "a tool";
  const patchedFile = toolName === "apply_patch" ? firstPatchedFile(target) : undefined;
  if (patchedFile) return `Edit ${patchedFile}`.slice(0, MAX_DETAIL);
  return `${toolName}: ${target || "waiting for approval"}`.slice(0, MAX_DETAIL);
}

function withActivity(update: AgentSignalUpdate, activity: SessionActivityInput | null): AgentSignalUpdate {
  return activity ? { ...update, activity } : update;
}

function toolCall(payload: unknown): { name: string; fields: Record<string, unknown> } {
  const { tool_name: tool, tool_input: input } = typeof payload === "object" && payload !== null
    ? payload as { tool_input?: unknown; tool_name?: unknown }
    : {};
  return {
    name: typeof tool === "string" ? tool : "",
    fields: typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {},
  };
}

function toolTarget(fields: Record<string, unknown>): string {
  return [fields.command, fields.file_path, fields.notebook_path, fields.pattern, fields.url, fields.query, fields.subject, fields.description]
    .find((value): value is string => typeof value === "string" && value.trim() !== "") ?? "";
}

// Codex sends a file edit as the whole patch; its first file says what changed better than the patch text.
function firstPatchedFile(patch: string): string | undefined {
  return /^\*\*\* (?:Add|Update|Delete) File: (.+)$/m.exec(patch)?.[1];
}

const FILE_TOOLS: Readonly<Record<string, "edited" | "read" | "wrote">> = {
  Edit: "edited",
  MultiEdit: "edited",
  NotebookEdit: "edited",
  Read: "read",
  Write: "wrote",
};
const FILE_VERBS = { edited: "Edited", read: "Read", wrote: "Wrote" } as const;
const SHELL_TOOLS = new Set(["Bash", "shell", "exec_command", "local_shell"]);
const PLAN_TOOLS = new Set(["TodoWrite", "TaskCreate", "TaskUpdate", "update_plan"]);
// Claude Code loads its deferred tools through ToolSearch: its own housekeeping, not the agent's work.
const HOUSEKEEPING_TOOLS = new Set(["ToolSearch"]);

/** One tool call from PostToolUse, in the shapes the screen classifier gives the same work. */
function toolActivity(payload: unknown): SessionActivityInput | null {
  const { name, fields } = toolCall(payload);
  if (!name || HOUSEKEEPING_TOOLS.has(name)) return null;
  const target = toolTarget(fields);
  if (SHELL_TOOLS.has(name) && target) {
    const description = typeof fields.description === "string" ? firstLine(fields.description) : "";
    return {
      kind: "command",
      title: "Ran command",
      detail: firstLine(target),
      payload: { type: "command", command: target, ...(description ? { description } : {}) },
    };
  }
  const patched = name === "apply_patch" ? firstPatchedFile(target) : undefined;
  const operation = patched ? "edited" : FILE_TOOLS[name];
  const filePath = patched ?? target;
  if (operation && filePath) {
    return {
      kind: "file",
      title: "File activity",
      detail: `${FILE_VERBS[operation]} ${filePath}`.slice(0, MAX_DETAIL),
      payload: { type: "file", operation, path: filePath },
    };
  }
  if (PLAN_TOOLS.has(name)) {
    const summary = typeof fields.subject === "string" ? firstLine(fields.subject) : "";
    return { kind: "plan", title: "Plan updated", detail: summary, payload: { type: "plan", summary } };
  }
  const input = firstLine(target);
  return { kind: "tool", title: `Used ${name}`, detail: input, payload: { type: "tool", name, input } };
}

/** The message you sent, from UserPromptSubmit: its first line, as the turn's start in the history. */
function promptActivity(payload: unknown): SessionActivityInput | null {
  const prompt = typeof payload === "object" && payload !== null ? (payload as { prompt?: unknown }).prompt : undefined;
  const line = typeof prompt === "string" ? firstLine(prompt) : "";
  return line ? { kind: "prompt", title: "You asked", detail: line } : null;
}

function firstLine(value: string): string {
  return (value.split("\n").map((part) => part.trim()).find(Boolean) ?? "").slice(0, MAX_DETAIL);
}

/** The agent's own transcript file, which Claude and Codex name in every hook. */
function transcriptPathFrom(payload: unknown): string | undefined {
  const transcript = typeof payload === "object" && payload !== null
    ? (payload as { transcript_path?: unknown }).transcript_path
    : undefined;
  return typeof transcript === "string" && path.isAbsolute(transcript) && transcript.endsWith(".jsonl") ? transcript : undefined;
}

export type AgentSignalListener = (sessionId: string, update: AgentSignalUpdate, transcriptPath?: string) => void;
/** Answers one call from a session's worker tools; a thrown error's message is what the agent reads. */
export type AgentToolHandler = (sessionId: string, tool: string, args: unknown) => Promise<unknown>;

export type AgentSignalBridge = {
  close(): Promise<void>;
  /** Environment for a session's PTY; the relay uses it to find Alfred. */
  env(sessionId: string, command?: string): Record<string, string>;
  /**
   * Extra leading arguments that make `claude` or `codex` report their state. Given the session, a top-level agent
   * also gets Alfred's worker tools; a worker does not, because it cannot have workers.
   */
  launchArgs(command: string | undefined, session?: { id: string; worker: boolean }): string[];
  setListener(listener: AgentSignalListener | null): void;
  setToolHandler(handler: AgentToolHandler | null): void;
};

type BridgeOptions = {
  /** Directory for the relay script and settings file; Alfred owns it. */
  dir: string;
  /** Node-compatible executable that runs the relay (Electron with ELECTRON_RUN_AS_NODE). */
  execPath: string;
  socketPath?: string;
};

export async function createAgentSignalBridge(options: BridgeOptions): Promise<AgentSignalBridge | null> {
  // ponytail: hooks run through a POSIX shell command line; Windows keeps the output-window fallback.
  if (process.platform === "win32") return null;

  const socketPath = options.socketPath ?? path.join(os.tmpdir(), `alfred-${process.pid}-${randomBytes(3).toString("hex")}.sock`);
  if (Buffer.byteLength(socketPath) > MAX_SOCKET_PATH) return null;

  await mkdir(options.dir, { recursive: true, mode: 0o700 });
  const relayPath = path.join(options.dir, "hook-relay.cjs");
  const mcpServerPath = path.join(options.dir, "alfred-mcp.cjs");
  const settingsPath = path.join(options.dir, "claude-hooks.json");
  await writeFile(relayPath, RELAY_SOURCE, { mode: 0o600 });
  await writeFile(mcpServerPath, MCP_SERVER_SOURCE.replace("__TOOLS__", JSON.stringify(WORKER_TOOL_DEFINITIONS)), { mode: 0o600 });
  const relayCommand = (event: string) =>
    `ELECTRON_RUN_AS_NODE=1 ${shellQuote(options.execPath)} ${shellQuote(relayPath)} ${event}`;
  await writeFile(
    settingsPath,
    JSON.stringify({
      hooks: Object.fromEntries(
        HOOK_EVENTS.map((event) => [event, [{ hooks: [{ type: "command", command: relayCommand(event) }] }]]),
      ),
      // Starting a worker is the orchestrator's own step; the user already chose not to be asked (plan of 2026-10-24).
      permissions: { allow: ["mcp__alfred"] },
    }),
    { mode: 0o600 },
  );
  // Codex reads the same hooks as launch overrides. It runs them only once you trust them in its own terminal,
  // and remembers that by the definition's hash, so the command must not change between launches.
  // ponytail: a Codex without hooks (before mid 2026) would need a version check here.
  const codexHookArgs = HOOK_EVENTS.flatMap((event) => [
    "-c",
    `hooks.${event}=[{hooks=[{type="command",command=${JSON.stringify(relayCommand(event))}}]}]`,
  ]);

  const mcpServer = (sessionId: string) => ({
    command: options.execPath,
    args: [mcpServerPath, socketPath, sessionId],
    env: { ELECTRON_RUN_AS_NODE: "1" },
  });

  let listener: AgentSignalListener | null = null;
  let toolHandler: AgentToolHandler | null = null;
  // Each connection carries one JSON line: a hook event, or a tool call answered with one line on the same connection.
  const server = net.createServer((connection) => {
    let received = "";
    let handled = false;
    const handle = (line: string) => {
      if (handled) return;
      handled = true;
      handleLine(line, connection);
    };
    connection.setEncoding("utf8");
    connection.on("data", (chunk: string) => {
      received += chunk;
      if (received.length > MAX_HOOK_MESSAGE_BYTES) {
        connection.destroy();
        return;
      }
      const end = received.indexOf("\n");
      if (end !== -1) handle(received.slice(0, end));
    });
    connection.on("error", () => {});
    connection.on("end", () => handle(received));
  });

  function handleLine(line: string, connection: net.Socket): void {
    let message: { args?: unknown; event?: unknown; payload?: unknown; sessionId?: unknown; tool?: unknown; type?: unknown };
    try {
      message = JSON.parse(line) as typeof message;
    } catch {
      connection.end();
      return;
    }
    if (message.type === "tool") {
      void answerTool(message, connection);
      return;
    }
    connection.end();
    handleMessage(message);
  }

  async function answerTool(message: { args?: unknown; sessionId?: unknown; tool?: unknown }, connection: net.Socket): Promise<void> {
    let reply: { ok: true; result: unknown } | { ok: false; error: string };
    if (typeof message.sessionId !== "string" || typeof message.tool !== "string" || !toolHandler) {
      reply = { ok: false, error: "Alfred cannot run worker tools for this session." };
    } else {
      try {
        reply = { ok: true, result: await toolHandler(message.sessionId, message.tool, message.args) };
      } catch (error) {
        reply = { ok: false, error: error instanceof Error && error.message ? error.message : "Alfred could not run this tool." };
      }
    }
    if (!connection.destroyed) connection.end(`${JSON.stringify(reply)}\n`);
  }

  function handleMessage(message: { event?: unknown; payload?: unknown; sessionId?: unknown }): void {
    try {
      if (typeof message.sessionId !== "string" || typeof message.event !== "string") return;
      let payload: unknown;
      try {
        payload = typeof message.payload === "string" ? JSON.parse(message.payload) : undefined;
      } catch {
        payload = undefined;
      }
      const update = signalFromHook(message.event, payload);
      if (update) listener?.(message.sessionId, update, transcriptPathFrom(payload));
    } catch {
      // A malformed hook message must never disturb a session.
    }
  }

  await unlink(socketPath).catch(() => {});
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });
  await chmod(socketPath, 0o600).catch(() => {});

  return {
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        void unlink(socketPath).catch(() => {});
      }),
    env: (sessionId, command) => ({
      ALFRED_HOOK_SOCKET: socketPath,
      ALFRED_SESSION_ID: sessionId,
      ...(command === "claude" ? { MCP_TOOL_TIMEOUT: String(MCP_TOOL_TIMEOUT_SECONDS * 1000) } : {}),
    }),
    launchArgs: (command, session) => {
      const tools = session && !session.worker ? mcpServer(session.id) : null;
      if (command === "claude") {
        // --mcp-config takes several values, so a following option has to end its list before the prompt.
        return tools
          ? ["--mcp-config", JSON.stringify({ mcpServers: { alfred: { type: "stdio", ...tools } } }), "--settings", settingsPath]
          : ["--settings", settingsPath];
      }
      // ponytail: Codex older than April 2026 ignores notification_condition and notifies only while its terminal is unfocused.
      // The notifications stay as the fallback for hooks you chose not to trust.
      if (command === "codex") {
        return [
          "-c", "tui.notifications=true", "-c", 'tui.notification_method="osc9"', "-c", 'tui.notification_condition="always"',
          ...codexHookArgs,
          ...(tools
            ? [
                "-c", `mcp_servers.alfred.command=${JSON.stringify(tools.command)}`,
                "-c", `mcp_servers.alfred.args=${JSON.stringify(tools.args)}`,
                "-c", "mcp_servers.alfred.env={ELECTRON_RUN_AS_NODE=\"1\"}",
                "-c", `mcp_servers.alfred.tool_timeout_sec=${MCP_TOOL_TIMEOUT_SECONDS}`,
              ]
            : []),
        ];
      }
      return [];
    },
    setListener: (next) => {
      listener = next;
    },
    setToolHandler: (next) => {
      toolHandler = next;
    },
  };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
