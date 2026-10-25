import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { stripTerminalControlSequences } from "../shared/session-title.js";
import type { TranscriptReadMode } from "../shared/sessions-ipc.js";
import { isAgentConversationId } from "../shared/terminal-ipc.js";
import type { ParsedRecord, SessionFormat, TranscriptDetails } from "./external-sessions.js";
import {
  isRecord,
  parseJsonRecord,
  readTranscriptPrefixLines,
  readTranscriptTailLines,
  stringValue,
  type SessionFile,
} from "./transcript-files.js";

const HEAD_LINES = 140;
// Claude Code keeps appending its title records, so the newest one sits near the end; 64 KB found every one measured.
const TAIL_BYTES = 64 * 1024;

/**
 * Claude Code keeps one transcript per conversation, `projects/<folder>/<id>.jsonl`, and its subagents' runs in
 * `projects/<folder>/<id>/subagents/`. A subagent's run is listed under its conversation and cannot be resumed.
 */
export function claudeFormat(claudeHome: string): SessionFormat {
  return {
    source: "external-claude",
    kind: "claude",
    findFiles: () => findClaudeTranscripts(path.join(claudeHome, "projects")),
    readTitles: async () => new Map(),
    readDetails: readClaudeDetails,
    untitled: (cwd, id) => (cwd ? `${path.basename(cwd)} Claude session` : id),
    parseRecord: parseClaudeRecord,
  };
}

async function findClaudeTranscripts(root: string): Promise<SessionFile[]> {
  const files: SessionFile[] = [];
  const add = async (filePath: string): Promise<void> => {
    try {
      const details = await stat(filePath);
      files.push({ path: filePath, updatedAt: details.mtimeMs, size: details.size });
    } catch { /* Claude Code moved or removed it meanwhile. */ }
  };
  for (const project of await entries(root)) {
    if (!project.isDirectory()) continue;
    const projectDir = path.join(root, project.name);
    for (const entry of await entries(projectDir)) {
      if (entry.isFile() && entry.name.endsWith(".jsonl") && isAgentConversationId(entry.name.slice(0, -".jsonl".length))) {
        await add(path.join(projectDir, entry.name));
      } else if (entry.isDirectory() && isAgentConversationId(entry.name)) {
        const subagents = path.join(projectDir, entry.name, "subagents");
        for (const run of await entries(subagents)) {
          if (run.isFile() && run.name.endsWith(".jsonl")) await add(path.join(subagents, run.name));
        }
      }
    }
  }
  return files;
}

async function entries(dir: string) {
  try { return await readdir(dir, { withFileTypes: true }); } catch { return []; }
}

async function readClaudeDetails(file: SessionFile): Promise<TranscriptDetails | null> {
  const subagent = path.basename(path.dirname(file.path)) === "subagents";
  let head: string[];
  let tail: string[];
  try {
    [head, tail] = await Promise.all([readTranscriptPrefixLines(file.path, HEAD_LINES), readTranscriptTailLines(file.path, TAIL_BYTES)]);
  } catch {
    return null;
  }

  let cwd = "";
  let branch: string | undefined;
  let model: string | undefined;
  let firstPrompt = "";
  for (const line of head) {
    const record = parseJsonRecord(line);
    if (!record) continue;
    cwd ||= stringValue(record.cwd) ?? "";
    branch ??= stringValue(record.gitBranch);
    if (record.type === "assistant" && isRecord(record.message)) model ??= stringValue(record.message.model);
    if (!firstPrompt && record.type === "user" && !record.isMeta && (subagent || !record.isSidechain)) {
      firstPrompt = claudePromptText(record.message);
    }
    if (cwd && firstPrompt && model) break;
  }

  // Your own name for the conversation wins over the one Claude Code gave it.
  let customTitle: string | undefined;
  let aiTitle: string | undefined;
  for (const line of tail.reverse()) {
    if (!line.includes('"custom-title"') && !line.includes('"ai-title"')) continue;
    const record = parseJsonRecord(line);
    if (record?.type === "custom-title") customTitle ??= stringValue(record.customTitle);
    if (record?.type === "ai-title") aiTitle ??= stringValue(record.aiTitle);
    if (customTitle) break;
  }

  const title = customTitle ?? aiTitle;
  const parentId = subagent ? path.basename(path.dirname(path.dirname(file.path))) : undefined;
  return {
    id: path.basename(file.path, ".jsonl"),
    cwd,
    firstPrompt,
    ...(title ? { title } : {}),
    ...(branch ? { branch } : {}),
    ...(model ? { model } : {}),
    ...(parentId ? { parentId, readOnly: true as const } : {}),
  };
}

function parseClaudeRecord(line: string, id: string, mode: TranscriptReadMode): ParsedRecord {
  const record = parseJsonRecord(line);
  if (!record) return { kind: "malformed" };
  if ((record.type !== "user" && record.type !== "assistant") || !isRecord(record.message)) return { kind: "unknown" };
  if (record.type === "user") {
    if (mode === "conversation" && record.isMeta) return { kind: "known" };
    const text = mode === "conversation" ? claudePromptText(record.message) : textOf(record.message).trim();
    return text ? { kind: "known", block: { id, kind: "message", role: "user", text } } : { kind: "known" };
  }
  // The answer, without its thinking and tool calls.
  const text = textOf(record.message).trim();
  return text ? { kind: "known", block: { id, kind: "message", role: "assistant", text } } : { kind: "known" };
}

/**
 * What you typed, without what Claude Code puts in your turn on its own: task notifications, a local command's
 * output, an interruption marker and reminders. A slash command reads as you typed it.
 */
export function claudePromptText(message: unknown): string {
  const text = stripTerminalControlSequences(textOf(message))
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/<artifact-content-authored-by-others\s*\/>/g, "")
    .trim();
  if (!text || /^<(?:task-notification|local-command-(?:stdout|stderr|caveat))\b/.test(text) || text.startsWith("[Request interrupted")) {
    return "";
  }
  const command = /<command-name>([^<]*)<\/command-name>/.exec(text)?.[1]?.trim();
  if (command) {
    const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1]?.trim();
    return args ? `${command} ${args}` : command;
  }
  return text.replace(/<\/?pasted_content[^>]*>/g, "").trim();
}

/** A message's text: the string itself, or its text items; images, thinking and tool calls are left out. */
function textOf(message: unknown): string {
  if (!isRecord(message)) return "";
  const { content } = message;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((item) => (isRecord(item) && item.type === "text" ? [stringValue(item.text) ?? ""] : [])).join("\n");
}
