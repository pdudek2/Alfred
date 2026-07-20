import { createReadStream } from "node:fs";
import { opendir, readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { createInterface } from "node:readline";
import {
  SESSIONS_PAGE_SIZE,
  type ExternalSessionSummary,
  type ListExternalSessionsRequest,
  type ListExternalSessionsResult,
  type ResolveExternalSessionResult,
  type SessionProjectRef,
  type SessionsProjectInput,
} from "../shared/sessions-ipc.js";

const MAX_TITLE_LENGTH = 92;
const MAX_TRANSCRIPT_PREFIX_LINES = 140;
const MAX_DISPLAY_TEXT_LENGTH = 512;
const MAX_SESSION_ID_LENGTH = 512;
const MAX_PROJECT_ID_BYTES = 256;
const MAX_LIST_RESPONSE_BYTES = 512 * 1024;

type SessionMetaPayload = { cwd?: unknown; id?: unknown; model?: unknown; originator?: unknown; parent_thread_id?: unknown; timestamp?: unknown };
type CodexSessionSource = { path: string; id: string; cwd: string; revision: number; projectId: string | null };
type CodexSummary = { summary: ExternalSessionSummary; source: CodexSessionSource };

export function createCodexSessionsReader(options: { codexHome: string; summaryLimit?: number }) {
  const sourceBySessionKey = new Map<string, CodexSessionSource>();

  return {
    async listExternalSessions(request: ListExternalSessionsRequest): Promise<ListExternalSessionsResult> {
      validateProjects(request.projects);
      const limit = Math.min(Math.max(request.limit ?? options.summaryLimit ?? SESSIONS_PAGE_SIZE, 1), 100);
      const summaries = await discoverCodexSummaries(options.codexHome, request.projects);
      const filtered = filterSummaryMetadata(summaries, request.query ?? "");
      const offset = decodeListCursor(request.cursor, filtered.length);
      const page = pageWithinResponseCeiling(filtered, offset, limit);
      for (const item of page) sourceBySessionKey.set(item.summary.sessionKey, item.source);
      return {
        sessions: page.map((item) => item.summary),
        nextCursor: offset + page.length < filtered.length ? encodeListCursor(offset + page.length) : null,
        total: filtered.length,
      };
    },
    async resolveExternalSession(request: { sessionKey: string } | string): Promise<ResolveExternalSessionResult> {
      const sessionKey = typeof request === "string" ? request : request.sessionKey;
      const source = sourceBySessionKey.get(sessionKey);
      if (!source) return { kind: "none" };
      if (!source.projectId) return { kind: "add-project" };
      return { kind: "resume", projectId: source.projectId, cwd: source.cwd, sessionId: source.id };
    },
    clear(): void {
      sourceBySessionKey.clear();
    },
  };
}

async function discoverCodexSummaries(codexHome: string, projects: SessionsProjectInput[]): Promise<CodexSummary[]> {
  const titleIndex = await readCodexSessionTitleIndex(codexHome);
  const files = (await findJsonlFiles(path.join(codexHome, "sessions"))).sort((left, right) => right.updatedAt - left.updatedAt);
  const summaries: CodexSummary[] = [];
  const ids = new Set<string>();
  for (const file of files) {
    const parsed = await summarizeCodexSessionFile(file.path, file.updatedAt, titleIndex, projects);
    if (!parsed || ids.has(parsed.source.id)) continue;
    ids.add(parsed.source.id);
    summaries.push(parsed);
  }
  return summaries.sort((left, right) => right.summary.updatedAt - left.summary.updatedAt);
}

async function summarizeCodexSessionFile(
  transcriptPath: string,
  updatedAt: number,
  titleIndex: Map<string, string>,
  projects: SessionsProjectInput[],
): Promise<CodexSummary | null> {
  let lines: string[];
  try { lines = await readTranscriptPrefixLines(transcriptPath, MAX_TRANSCRIPT_PREFIX_LINES); } catch { return null; }
  let meta: SessionMetaPayload | null = null;
  let titleText = "";
  for (const line of lines) {
    const record = parseJsonRecord(line);
    if (!record) continue;
    if (record.type === "session_meta" && isRecord(record.payload)) { meta = record.payload as SessionMetaPayload; continue; }
    if (!titleText) {
      const candidate = extractUserText(record);
      if (candidate && !isInjectedSessionContext(candidate)) titleText = candidate;
    }
    if (meta && titleText) break;
  }
  const id = stringValue(meta?.id) ?? idFromFilename(transcriptPath);
  const cwd = stringValue(meta?.cwd) ?? "";
  const project = projectForCwd(cwd, projects);
  const title = titleFromText(titleIndex.get(id) ?? "") || titleFromText(titleText) || titleFromText(fallbackTitle(cwd, id));
  const model = stringValue(meta?.model);
  const originator = stringValue(meta?.originator);
  const sessionKey = `external-codex:${opaqueSessionToken(id, updatedAt)}`;
  const contentId = boundedSessionIdentity(id);
  const parentThreadId = stringValue(meta?.parent_thread_id);
  const summary: ExternalSessionSummary = {
    sessionKey,
    lineageKey: `external-codex:${boundedSessionIdentity(parentThreadId ?? id)}`,
    contentSessionKey: `external-codex:${contentId}`,
    source: "external-codex",
    kind: "codex",
    title,
    project,
    locationLabel: boundedDisplayText(project.id ? project.label : (cwd ? path.basename(cwd) : "Unknown workspace")),
    updatedAt,
    lifecycle: project.id ? "resumable" : "read-only",
    ...(model ? { model: boundedDisplayText(model) } : {}),
    ...(originator ? { originator: boundedDisplayText(originator) } : {}),
  };
  return { summary, source: { path: transcriptPath, id, cwd, revision: updatedAt, projectId: project.id } };
}

function filterSummaryMetadata(summaries: CodexSummary[], query: string): CodexSummary[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return summaries;
  return summaries.filter(({ summary }) => terms.every((term) => [summary.title, summary.project.label, summary.locationLabel, summary.model, summary.originator].filter(Boolean).join(" ").toLowerCase().includes(term)));
}

function validateProjects(projects: SessionsProjectInput[]): void {
  for (const project of projects) {
    if (!project.id.trim() || Buffer.byteLength(project.id, "utf8") > MAX_PROJECT_ID_BYTES) {
      throw new Error("Invalid external sessions project id.");
    }
  }
}

function pageWithinResponseCeiling(summaries: CodexSummary[], offset: number, limit: number): CodexSummary[] {
  const page: CodexSummary[] = [];
  for (const item of summaries.slice(offset, offset + limit)) {
    const candidate = [...page, item];
    const candidateOffset = offset + candidate.length;
    const result = {
      sessions: candidate.map((entry) => entry.summary),
      nextCursor: candidateOffset < summaries.length ? encodeListCursor(candidateOffset) : null,
      total: summaries.length,
    };
    if (Buffer.byteLength(JSON.stringify(result)) > MAX_LIST_RESPONSE_BYTES) break;
    page.push(item);
  }
  return page;
}

function encodeListCursor(offset: number): string { return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url"); }
function decodeListCursor(cursor: string | undefined, total: number): number {
  if (!cursor) return 0;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { offset?: unknown };
    if (typeof value.offset !== "number" || !Number.isInteger(value.offset) || value.offset < 0 || value.offset > total) {
      throw new Error("invalid");
    }
    return value.offset;
  } catch { throw new Error("Invalid external sessions cursor."); }
}

function projectForCwd(cwd: string, projects: SessionsProjectInput[]): SessionProjectRef {
  const project = projects.filter((candidate) => pathMatchesWorkspace(cwd, candidate.rootPath)).sort((left, right) => (right.rootPath?.length ?? 0) - (left.rootPath?.length ?? 0))[0];
  return project ? { id: project.id, label: boundedDisplayText(project.label) } : { id: null, label: "External Codex" };
}
function pathMatchesWorkspace(cwd: string, rootPath: string | undefined): boolean {
  const root = rootPath?.replace(/\/+$/, "");
  if (!cwd || !root) return false;
  const legacyRoot = `${path.dirname(root)}/.alfred-worktrees/${path.basename(root)}`;
  return cwd === root || cwd.startsWith(`${root}/`) || cwd === legacyRoot || cwd.startsWith(`${legacyRoot}/`);
}
async function readCodexSessionTitleIndex(codexHome: string): Promise<Map<string, string>> {
  let content: string; try { content = await readFile(path.join(codexHome, "session_index.jsonl"), "utf8"); } catch { return new Map(); }
  const titles = new Map<string, string>();
  for (const line of content.split(/\r?\n/)) { const record = parseJsonRecord(line); const id = stringValue(record?.id); const title = titleFromText(stringValue(record?.thread_name) ?? ""); if (id && title) titles.set(id, title); }
  return titles;
}
async function findJsonlFiles(root: string): Promise<Array<{ path: string; updatedAt: number }>> {
  const files: Array<{ path: string; updatedAt: number }> = [];
  async function visit(dir: string): Promise<void> {
    let handle: Awaited<ReturnType<typeof opendir>>; try { handle = await opendir(dir); } catch { return; }
    for await (const entry of handle) { const entryPath = path.join(dir, entry.name); if (entry.isDirectory()) await visit(entryPath); else if (entry.isFile() && entry.name.endsWith(".jsonl")) try { files.push({ path: entryPath, updatedAt: (await stat(entryPath)).mtimeMs }); } catch { /* File changed while Codex was writing it. */ } }
  }
  await visit(root); return files;
}
async function readTranscriptPrefixLines(filePath: string, maxLines: number): Promise<string[]> {
  const stream = createReadStream(filePath, { encoding: "utf8" }); const reader = createInterface({ input: stream, crlfDelay: Infinity }); const lines: string[] = [];
  try { for await (const line of reader) { lines.push(line); if (lines.length >= maxLines) { reader.close(); stream.destroy(); break; } } } finally { reader.close(); stream.destroy(); }
  return lines;
}
function parseJsonRecord(line: string): Record<string, unknown> | null { try { const value = JSON.parse(line) as unknown; return isRecord(value) ? value : null; } catch { return null; } }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function stringValue(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value : undefined; }
function extractUserText(record: Record<string, unknown>): string {
  if (record.type === "event_msg" && isRecord(record.payload)) return stringValue(record.payload.message) ?? "";
  if (record.type !== "response_item" || !isRecord(record.payload) || record.payload.type !== "message" || record.payload.role !== "user" || !Array.isArray(record.payload.content)) return "";
  return record.payload.content.flatMap((item) => isRecord(item) ? [stringValue(item.text) ?? stringValue(item.input_text) ?? ""] : []).join(" ").trim();
}
function titleFromText(value: string): string { const text = value.replace(/\s+/g, " ").trim(); return !text ? "" : text.length > MAX_TITLE_LENGTH ? `${text.slice(0, MAX_TITLE_LENGTH - 1)}...` : text; }
function boundedDisplayText(value: string): string { const text = value.replace(/\s+/g, " ").trim(); return text.length > MAX_DISPLAY_TEXT_LENGTH ? `${text.slice(0, MAX_DISPLAY_TEXT_LENGTH - 1)}...` : text; }
function isInjectedSessionContext(value: string): boolean { return /^#\s*AGENTS\.md instructions\b/i.test(value.trim()); }
function fallbackTitle(cwd: string, id: string): string { return cwd ? `${path.basename(cwd)} Codex session` : id; }
function idFromFilename(filePath: string): string { const basename = path.basename(filePath, ".jsonl"); return basename.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)?.[0] ?? basename; }
function opaqueSessionToken(id: string, revision: number): string { return createHash("sha256").update(`${id}:${revision}`).digest("base64url"); }
function boundedSessionIdentity(id: string): string { return id.length <= MAX_SESSION_ID_LENGTH ? id : opaqueSessionToken(id, 0); }
