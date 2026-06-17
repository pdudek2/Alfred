import { app, ipcMain } from "electron";
import { opendir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sessionIndexChannels } from "../shared/session-index-ipc.js";
import type { ExternalCodexSessionSummary } from "../shared/session-index-ipc.js";

const DEFAULT_LIMIT = 80;
const MAX_SCAN_FILES = 600;
const MAX_TITLE_LENGTH = 92;

type RegisterSessionIndexOptions = {
  codexHome?: string;
};

type SessionMetaPayload = {
  cwd?: unknown;
  id?: unknown;
  model?: unknown;
  originator?: unknown;
  parent_thread_id?: unknown;
  timestamp?: unknown;
};

export function registerSessionIndexIpc(options: RegisterSessionIndexOptions = {}): void {
  ipcMain.handle(sessionIndexChannels.listExternalCodexSessions, async () => ({
    sessions: await listExternalCodexSessions({
      codexHome: options.codexHome ?? defaultCodexHome(),
      limit: DEFAULT_LIMIT,
    }),
  }));
}

export async function listExternalCodexSessions({
  codexHome = defaultCodexHome(),
  limit = DEFAULT_LIMIT,
}: {
  codexHome?: string;
  limit?: number;
} = {}): Promise<ExternalCodexSessionSummary[]> {
  const sessionsRoot = path.join(codexHome, "sessions");
  const titleIndex = await readCodexSessionTitleIndex(codexHome);
  const files = await findJsonlFiles(sessionsRoot);
  const newestFiles = files
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, Math.max(limit * 4, limit));
  const sessions: ExternalCodexSessionSummary[] = [];

  for (const file of newestFiles) {
    const summary = await summarizeCodexSessionFile(file.path, file.updatedAt, titleIndex);
    if (summary) sessions.push(summary);
    if (sessions.length >= limit) break;
  }

  return sessions.sort((left, right) => right.updatedAt - left.updatedAt);
}

function defaultCodexHome(): string {
  return process.env.CODEX_HOME ?? path.join(app?.getPath?.("home") ?? os.homedir(), ".codex");
}

async function readCodexSessionTitleIndex(codexHome: string): Promise<Map<string, string>> {
  let content: string;
  try {
    content = await readFile(path.join(codexHome, "session_index.jsonl"), "utf8");
  } catch {
    return new Map();
  }

  const titles = new Map<string, string>();
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const record = parseJsonRecord(line);
    const id = stringValue(record?.id);
    const title = titleFromText(stringValue(record?.thread_name) ?? "");
    if (id && title) titles.set(id, title);
  }
  return titles;
}

async function findJsonlFiles(root: string): Promise<Array<{ path: string; updatedAt: number }>> {
  const files: Array<{ path: string; updatedAt: number }> = [];

  async function visit(dir: string): Promise<void> {
    if (files.length >= MAX_SCAN_FILES) return;
    let handle: Awaited<ReturnType<typeof opendir>>;
    try {
      handle = await opendir(dir);
    } catch {
      return;
    }

    for await (const entry of handle) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      try {
        const info = await stat(entryPath);
        files.push({ path: entryPath, updatedAt: info.mtimeMs });
      } catch {
        // Ignore files that disappear while the Codex app writes its session index.
      }
      if (files.length >= MAX_SCAN_FILES) break;
    }
  }

  await visit(root);
  return files;
}

async function summarizeCodexSessionFile(
  transcriptPath: string,
  updatedAt: number,
  titleIndex: Map<string, string>,
): Promise<ExternalCodexSessionSummary | null> {
  let content: string;
  try {
    content = await readFile(transcriptPath, "utf8");
  } catch {
    return null;
  }

  let meta: SessionMetaPayload | null = null;
  let titleText = "";
  let firstTimestamp = 0;

  for (const line of content.split(/\r?\n/).slice(0, 140)) {
    if (!line.trim()) continue;
    const record = parseJsonRecord(line);
    if (!record) continue;

    const timestamp = timestampToMs(record.timestamp);
    if (timestamp > 0 && firstTimestamp === 0) firstTimestamp = timestamp;

    if (record.type === "session_meta" && isRecord(record.payload)) {
      meta = record.payload as SessionMetaPayload;
      continue;
    }

    if (!titleText) {
      const candidate = extractUserText(record);
      if (candidate && !isInjectedSessionContext(candidate)) {
        titleText = candidate;
      }
    }

    if (meta && titleText) break;
  }

  const id = stringValue(meta?.id) ?? idFromFilename(transcriptPath);
  const cwd = stringValue(meta?.cwd) ?? "";
  const createdAt = timestampToMs(meta?.timestamp) || firstTimestamp || updatedAt;
  const titleFromUser = titleFromText(titleText);
  const indexedTitle = titleIndex.get(id);
  const title = indexedTitle || titleFromUser || fallbackTitle(cwd, id);
  const model = stringValue(meta?.model);
  const originator = stringValue(meta?.originator);
  const parentThreadId = stringValue(meta?.parent_thread_id);

  return {
    id,
    title,
    cwd,
    createdAt,
    updatedAt,
    transcriptPath,
    ...(parentThreadId ? { parentThreadId } : {}),
    ...(model ? { model } : {}),
    ...(originator ? { originator } : {}),
  };
}

function parseJsonRecord(line: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(line) as unknown;
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function extractUserText(record: Record<string, unknown>): string {
  if (record.type === "event_msg" && isRecord(record.payload)) {
    const message = stringValue(record.payload.message);
    if (message) return message;
  }

  if (record.type !== "response_item" || !isRecord(record.payload)) return "";
  if (record.payload.type !== "message" || record.payload.role !== "user") return "";
  const content = record.payload.content;
  if (!Array.isArray(content)) return "";

  return content
    .flatMap((item) => {
      if (!isRecord(item)) return [];
      return [stringValue(item.text) ?? stringValue(item.input_text) ?? ""];
    })
    .join(" ")
    .trim();
}

function titleFromText(value: string): string {
  const firstLine = value.replace(/\s+/g, " ").trim();
  if (!firstLine) return "";
  return firstLine.length > MAX_TITLE_LENGTH ? `${firstLine.slice(0, MAX_TITLE_LENGTH - 1)}...` : firstLine;
}

function isInjectedSessionContext(value: string): boolean {
  const normalized = value.trim();
  return /^#\s*AGENTS\.md instructions\b/i.test(normalized);
}

function fallbackTitle(cwd: string, id: string): string {
  const projectName = cwd ? path.basename(cwd) : "";
  return projectName ? `${projectName} Codex session` : id;
}

function idFromFilename(filePath: string): string {
  const basename = path.basename(filePath, ".jsonl");
  return basename.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)?.[0] ?? basename;
}

function timestampToMs(value: unknown): number {
  if (typeof value !== "string") return 0;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
