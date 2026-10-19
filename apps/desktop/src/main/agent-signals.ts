import { chmod, mkdir, unlink, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { TerminalAgentSignal } from "../shared/terminal-ipc.js";

/** Session model contract §3: how Alfred senses agent and shell state. */

export type AgentSignalUpdate = Pick<TerminalAgentSignal, "detail" | "state">;

const HOOK_EVENTS = ["UserPromptSubmit", "PermissionRequest", "PostToolUse", "Stop"] as const;
const KNOWN_SHELLS = new Set(["zsh", "bash", "sh", "fish", "nu", "dash", "ksh", "tcsh", "csh"]);
const MAX_HOOK_MESSAGE_BYTES = 1_000_000;
const MAX_OSC_CARRY = 1_024;
const MAX_DETAIL = 240;
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
    case "PostToolUse":
      return { state: "working" };
    case "Stop": {
      const detail = describeTurnEnd(payload);
      return detail ? { state: "your-turn", detail } : { state: "your-turn" };
    }
    case "PermissionRequest":
      return { state: "needs-you", detail: describePermissionRequest(payload) };
    default:
      return null;
  }
}

/** The first line of the agent's last answer, without Markdown marks. Claude and Codex both send it with Stop. */
function describeTurnEnd(payload: unknown): string | undefined {
  const message = typeof payload === "object" && payload !== null
    ? (payload as { last_assistant_message?: unknown }).last_assistant_message
    : undefined;
  if (typeof message !== "string") return undefined;
  const line = message
    .split("\n")
    .map((part) => part.replace(/^\s*(?:#+|[-*>]|\d+\.)\s+/, "").replace(/`|\*\*|__/g, "").trim())
    .find(Boolean);
  return line?.slice(0, MAX_DETAIL);
}

function describePermissionRequest(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) return "Waiting for approval";
  const { tool_name: tool, tool_input: input } = payload as { tool_input?: unknown; tool_name?: unknown };
  const fields = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const target = [fields.command, fields.file_path, fields.url, fields.description].find(
    (value): value is string => typeof value === "string" && value.trim() !== "",
  );
  const toolName = typeof tool === "string" && tool ? tool : "a tool";
  // Codex sends a file edit as the whole patch; its first file says what waits better than the patch text.
  const patchedFile = toolName === "apply_patch" ? /^\*\*\* (?:Add|Update|Delete) File: (.+)$/m.exec(target ?? "")?.[1] : undefined;
  if (patchedFile) return `Edit ${patchedFile}`.slice(0, MAX_DETAIL);
  return `${toolName}: ${target ?? "waiting for approval"}`.slice(0, MAX_DETAIL);
}

/** The agent's own transcript file, which Claude and Codex name in every hook. */
function transcriptPathFrom(payload: unknown): string | undefined {
  const transcript = typeof payload === "object" && payload !== null
    ? (payload as { transcript_path?: unknown }).transcript_path
    : undefined;
  return typeof transcript === "string" && path.isAbsolute(transcript) && transcript.endsWith(".jsonl") ? transcript : undefined;
}

export type AgentSignalListener = (sessionId: string, update: AgentSignalUpdate, transcriptPath?: string) => void;

export type AgentSignalBridge = {
  close(): Promise<void>;
  /** Environment for a session's PTY; the relay uses it to find Alfred. */
  env(sessionId: string): Record<string, string>;
  /** Extra leading arguments that make `claude` or `codex` report their state. */
  launchArgs(command: string | undefined): string[];
  setListener(listener: AgentSignalListener | null): void;
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
  const settingsPath = path.join(options.dir, "claude-hooks.json");
  await writeFile(relayPath, RELAY_SOURCE, { mode: 0o600 });
  const relayCommand = (event: string) =>
    `ELECTRON_RUN_AS_NODE=1 ${shellQuote(options.execPath)} ${shellQuote(relayPath)} ${event}`;
  await writeFile(
    settingsPath,
    JSON.stringify({
      hooks: Object.fromEntries(
        HOOK_EVENTS.map((event) => [event, [{ hooks: [{ type: "command", command: relayCommand(event) }] }]]),
      ),
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

  let listener: AgentSignalListener | null = null;
  const server = net.createServer((connection) => {
    let received = "";
    connection.setEncoding("utf8");
    connection.on("data", (chunk: string) => {
      received += chunk;
      if (received.length > MAX_HOOK_MESSAGE_BYTES) connection.destroy();
    });
    connection.on("error", () => {});
    connection.on("end", () => handleMessage(received));
  });

  function handleMessage(raw: string): void {
    try {
      const message = JSON.parse(raw) as { event?: unknown; payload?: unknown; sessionId?: unknown };
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
    env: (sessionId) => ({ ALFRED_HOOK_SOCKET: socketPath, ALFRED_SESSION_ID: sessionId }),
    launchArgs: (command) => {
      if (command === "claude") return ["--settings", settingsPath];
      // ponytail: Codex older than April 2026 ignores notification_condition and notifies only while its terminal is unfocused.
      // The notifications stay as the fallback for hooks you chose not to trust.
      if (command === "codex") {
        return [
          "-c", "tui.notifications=true", "-c", 'tui.notification_method="osc9"', "-c", 'tui.notification_condition="always"',
          ...codexHookArgs,
        ];
      }
      return [];
    },
    setListener: (next) => {
      listener = next;
    },
  };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
