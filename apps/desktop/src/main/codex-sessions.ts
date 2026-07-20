import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { opendir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import {
  SESSIONS_PAGE_SIZE,
  SUMMARY_CACHE_COUNT_LIMIT,
  SUMMARY_CACHE_TEXT_LIMIT,
  TRANSCRIPT_BLOCK_LIMIT,
  TRANSCRIPT_CACHE_SESSION_LIMIT,
  TRANSCRIPT_CACHE_TEXT_LIMIT,
  TRANSCRIPT_TEXT_LIMIT,
  type ExternalSessionSummary,
  type ListExternalSessionsRequest,
  type ListExternalSessionsResult,
  type ResolveExternalSessionResult,
  type SessionsDiagnostics,
  type SessionsProjectInput,
  type SessionProjectRef,
  type TranscriptBlock,
  type TranscriptPage,
} from "../shared/sessions-ipc.js";

const MAX_TITLE_LENGTH = 92;
const MAX_TRANSCRIPT_PREFIX_LINES = 140;
const MAX_DISPLAY_TEXT_LENGTH = 512;
const MAX_SESSION_ID_LENGTH = 512;
const MAX_PROJECT_ID_BYTES = 256;
const MAX_LIST_RESPONSE_BYTES = 512 * 1024;
const PARTIAL_NOTICE = "Some malformed transcript records were omitted.";

type SessionMetaPayload = { cwd?: unknown; id?: unknown; model?: unknown; originator?: unknown; parent_thread_id?: unknown; timestamp?: unknown };
type CodexSessionSource = { path: string; id: string; cwd: string; revision: string; projectId: string | null };
type CodexSummary = { summary: ExternalSessionSummary; source: CodexSessionSource };
type SessionFile = { path: string; updatedAt: number; size: number };
type SummaryCacheEntry = { summary: CodexSummary; bytes: number };
type TranscriptCursor = { offset: number; revision: string };

export function createCodexSessionsReader(options: { codexHome: string; summaryLimit?: number }) {
  const sourceBySessionKey = new Map<string, CodexSessionSource>();
  const summaryCache = new Map<string, SummaryCacheEntry>();
  const summaryOrder: string[] = [];
  const pageCache = new Map<string, TranscriptPage>();
  const pageKeysBySession = new Map<string, Set<string>>();
  const sessionOrder: string[] = [];
  let summaryBytes = 0;
  let decodedTranscriptBytes = 0;

  const touchSummary = (key: string): void => {
    const index = summaryOrder.indexOf(key);
    if (index >= 0) summaryOrder.splice(index, 1);
    summaryOrder.push(key);
  };
  const cacheSummary = (key: string, summary: CodexSummary): void => {
    const bytes = Buffer.byteLength(JSON.stringify(summary.summary), "utf8");
    const existing = summaryCache.get(key);
    if (existing) summaryBytes -= existing.bytes;
    summaryCache.set(key, { summary, bytes });
    summaryBytes += bytes;
    touchSummary(key);
    while (summaryOrder.length > SUMMARY_CACHE_COUNT_LIMIT || summaryBytes > SUMMARY_CACHE_TEXT_LIMIT) {
      const oldest = summaryOrder.shift();
      if (!oldest) break;
      const evicted = summaryCache.get(oldest);
      if (evicted) summaryBytes -= evicted.bytes;
      summaryCache.delete(oldest);
    }
  };
  const touchSession = (sessionKey: string): void => {
    const index = sessionOrder.indexOf(sessionKey);
    if (index >= 0) sessionOrder.splice(index, 1);
    sessionOrder.push(sessionKey);
  };
  const evictSession = (sessionKey: string): void => {
    const keys = pageKeysBySession.get(sessionKey);
    if (keys) for (const key of keys) {
      const page = pageCache.get(key);
      if (page) decodedTranscriptBytes -= decodedBytes(page);
      pageCache.delete(key);
    }
    pageKeysBySession.delete(sessionKey);
    const index = sessionOrder.indexOf(sessionKey);
    if (index >= 0) sessionOrder.splice(index, 1);
  };
  const cachePage = (sessionKey: string, requestCursor: string | undefined, page: TranscriptPage): void => {
    const key = `${sessionKey}:${page.revision}:${requestCursor ?? "start"}`;
    const previous = pageCache.get(key);
    if (previous) decodedTranscriptBytes -= decodedBytes(previous);
    pageCache.set(key, page);
    decodedTranscriptBytes += decodedBytes(page);
    let keys = pageKeysBySession.get(sessionKey);
    if (!keys) { keys = new Set(); pageKeysBySession.set(sessionKey, keys); }
    keys.add(key);
    touchSession(sessionKey);
    while (sessionOrder.length > TRANSCRIPT_CACHE_SESSION_LIMIT || decodedTranscriptBytes > TRANSCRIPT_CACHE_TEXT_LIMIT) {
      const oldest = sessionOrder[0];
      if (!oldest) break;
      evictSession(oldest);
    }
  };
  const clearCaches = (): void => {
    sourceBySessionKey.clear();
    summaryCache.clear();
    summaryOrder.splice(0);
    summaryBytes = 0;
    pageCache.clear();
    pageKeysBySession.clear();
    sessionOrder.splice(0);
    decodedTranscriptBytes = 0;
  };

  return {
    async listExternalSessions(request: ListExternalSessionsRequest): Promise<ListExternalSessionsResult> {
      validateProjects(request.projects);
      const limit = Math.min(Math.max(request.limit ?? options.summaryLimit ?? SESSIONS_PAGE_SIZE, 1), 100);
      const summaries = await discoverCodexSummaries(options.codexHome, request.projects, summaryCache, touchSummary, cacheSummary);
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
    async readTranscriptPage(request: { sessionKey: string; cursor?: string }): Promise<TranscriptPage> {
      const source = sourceBySessionKey.get(request.sessionKey);
      if (!source) throw new Error("Unknown external session.");
      const revision = await currentRevision(source.path);
      const cursor = decodeTranscriptCursor(request.cursor, revision);
      const cacheKey = `${request.sessionKey}:${revision}:${request.cursor ?? "start"}`;
      const cached = pageCache.get(cacheKey);
      if (cached) { touchSession(request.sessionKey); return cached; }
      const page = await streamTranscriptPage(source, request.sessionKey, cursor);
      cachePage(request.sessionKey, request.cursor, page);
      return page;
    },
    getDiagnostics(): SessionsDiagnostics {
      return {
        cachedSessionCount: sessionOrder.length,
        decodedTranscriptBytes,
        summaryCount: summaryCache.size,
        summaryBytes,
      };
    },
    clearCaches,
  };
}

async function discoverCodexSummaries(
  codexHome: string,
  projects: SessionsProjectInput[],
  cache: Map<string, SummaryCacheEntry>,
  touch: (key: string) => void,
  cacheSummary: (key: string, summary: CodexSummary) => void,
): Promise<CodexSummary[]> {
  const titleIndex = await readCodexSessionTitleIndex(codexHome);
  const files = (await findJsonlFiles(path.join(codexHome, "sessions"))).sort((left, right) => right.updatedAt - left.updatedAt);
  const summaries: CodexSummary[] = [];
  const ids = new Set<string>();
  for (const file of files) {
    const cacheKey = `${file.path}:${file.updatedAt}:${file.size}`;
    const cached = cache.get(cacheKey);
    const parsed = cached ? (touch(cacheKey), remapProject(cached.summary, projects)) : await summarizeCodexSessionFile(file, titleIndex, projects);
    if (!cached && parsed) cacheSummary(cacheKey, parsed);
    if (!parsed || ids.has(parsed.source.id)) continue;
    ids.add(parsed.source.id);
    summaries.push(parsed);
  }
  return summaries.sort((left, right) => right.summary.updatedAt - left.summary.updatedAt);
}

function remapProject(value: CodexSummary, projects: SessionsProjectInput[]): CodexSummary {
  const project = projectForCwd(value.source.cwd, projects);
  return {
    summary: {
      ...value.summary,
      project,
      locationLabel: boundedDisplayText(project.id ? project.label : (value.source.cwd ? path.basename(value.source.cwd) : "Unknown workspace")),
      lifecycle: project.id ? "resumable" : "read-only",
    },
    source: { ...value.source, projectId: project.id },
  };
}

async function summarizeCodexSessionFile(
  file: SessionFile,
  titleIndex: Map<string, string>,
  projects: SessionsProjectInput[],
): Promise<CodexSummary | null> {
  let lines: string[];
  try { lines = await readTranscriptPrefixLines(file.path, MAX_TRANSCRIPT_PREFIX_LINES); } catch { return null; }
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
  const id = stringValue(meta?.id) ?? idFromFilename(file.path);
  const cwd = stringValue(meta?.cwd) ?? "";
  const project = projectForCwd(cwd, projects);
  const title = titleFromText(titleIndex.get(id) ?? "") || titleFromText(titleText) || titleFromText(fallbackTitle(cwd, id));
  const model = stringValue(meta?.model);
  const originator = stringValue(meta?.originator);
  const sessionKey = `external-codex:${opaqueSessionToken(id, file.updatedAt)}`;
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
    updatedAt: file.updatedAt,
    lifecycle: project.id ? "resumable" : "read-only",
    ...(model ? { model: boundedDisplayText(model) } : {}),
    ...(originator ? { originator: boundedDisplayText(originator) } : {}),
  };
  return { summary, source: { path: file.path, id, cwd, revision: revisionFrom(file.updatedAt, file.size), projectId: project.id } };
}

async function streamTranscriptPage(source: CodexSessionSource, sessionKey: string, cursor: TranscriptCursor): Promise<TranscriptPage> {
  const stream = createReadStream(source.path, { encoding: "utf8" });
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  const blocks: TranscriptBlock[] = [];
  let offset = 0;
  let textBytes = 0;
  let malformedCount = 0;
  const pageLimit = (): number => TRANSCRIPT_BLOCK_LIMIT - (malformedCount > 0 ? 1 : 0);
  const makePage = (nextOffset: number | null): TranscriptPage => ({
    sessionKey,
    blocks: malformedCount > 0 ? appendPartialNotice(blocks, textBytes) : blocks,
    nextCursor: nextOffset === null ? null : encodeTranscriptCursor({ offset: nextOffset, revision: cursor.revision }),
    revision: cursor.revision,
    partial: malformedCount > 0,
  });
  try {
    for await (const line of reader) {
      const lineOffset = offset;
      offset += 1;
      if (lineOffset < cursor.offset) continue;
      const parsed = parseTranscriptRecord(line, `${sessionKey}:${lineOffset}`);
      if (parsed.kind === "malformed") { malformedCount += 1; continue; }
      if (!parsed.block) continue;
      const block = parsed.block;
      const blockBytes = Buffer.byteLength(block.text, "utf8");
      if (blocks.length >= pageLimit()) return makePage(lineOffset);
      if (textBytes + blockBytes + (blocks.length ? 1 : 0) > TRANSCRIPT_TEXT_LIMIT) {
        if (!blocks.length) {
          const noticeReserve = malformedCount > 0 ? Buffer.byteLength(PARTIAL_NOTICE, "utf8") + 1 : 0;
          const text = truncateUtf8(block.text, TRANSCRIPT_TEXT_LIMIT - noticeReserve);
          blocks.push({ ...block, text });
          textBytes = Buffer.byteLength(text, "utf8");
        }
        return makePage(offset);
      }
      blocks.push(block);
      textBytes += blockBytes + (blocks.length > 1 ? 1 : 0);
      if (blocks.length >= pageLimit()) return makePage(offset);
    }
    return makePage(null);
  } finally {
    reader.close();
    stream.destroy();
  }
}

function appendPartialNotice(blocks: TranscriptBlock[], textBytes: number): TranscriptBlock[] {
  const noticeBytes = Buffer.byteLength(PARTIAL_NOTICE, "utf8");
  if (blocks.length >= TRANSCRIPT_BLOCK_LIMIT) return blocks;
  const requiredBytes = noticeBytes + (blocks.length ? 1 : 0);
  if (textBytes + requiredBytes > TRANSCRIPT_TEXT_LIMIT && blocks.length) {
    const last = blocks.at(-1)!;
    const shortage = textBytes + requiredBytes - TRANSCRIPT_TEXT_LIMIT;
    blocks = [...blocks.slice(0, -1), { ...last, text: truncateUtf8(last.text, Math.max(0, Buffer.byteLength(last.text, "utf8") - shortage)) }];
  }
  return [...blocks, { id: `notice:${blocks.length}`, kind: "notice", text: PARTIAL_NOTICE }];
}

function parseTranscriptRecord(line: string, id: string): { block?: TranscriptBlock; kind: "known" | "unknown" | "malformed" } {
  const record = parseJsonRecord(line);
  if (!record) return { kind: "malformed" };
  if (record.type !== "response_item" || !isRecord(record.payload)) return { kind: "unknown" };
  const payload = record.payload;
  if (payload.type !== "message" || !isTranscriptRole(payload.role) || !Array.isArray(payload.content)) return { kind: "unknown" };
  const text = payload.content.flatMap((item) => isRecord(item) ? [stringValue(item.text) ?? stringValue(item.input_text) ?? stringValue(item.output_text) ?? ""] : []).join("\n").trim();
  return text ? { kind: "known", block: { id, kind: "message", role: payload.role, text } } : { kind: "unknown" };
}

function isTranscriptRole(value: unknown): value is "user" | "assistant" | "system" { return value === "user" || value === "assistant" || value === "system"; }
function decodedBytes(page: TranscriptPage): number { return page.blocks.reduce((total, block) => total + Buffer.byteLength(block.text, "utf8"), 0); }
function encodeTranscriptCursor(value: TranscriptCursor): string { return Buffer.from(JSON.stringify(value), "utf8").toString("base64url"); }
function decodeTranscriptCursor(value: string | undefined, revision: string): TranscriptCursor {
  if (!value) return { offset: 0, revision };
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (!isTranscriptCursor(parsed) || parsed.revision !== revision) throw new Error("invalid");
    return parsed;
  } catch { throw new Error("Transcript cursor is invalid or stale."); }
}
function isTranscriptCursor(value: unknown): value is TranscriptCursor {
  return isRecord(value) && typeof value.offset === "number" && Number.isInteger(value.offset) && value.offset >= 0 && typeof value.revision === "string";
}
function truncateUtf8(value: string, limit: number): string {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length <= limit) return value;
  let end = limit;
  while (end > 0 && ((bytes[end] ?? 0) & 0b1100_0000) === 0b1000_0000) end -= 1;
  return bytes.subarray(0, end).toString("utf8");
}
async function currentRevision(filePath: string): Promise<string> { const details = await stat(filePath); return revisionFrom(details.mtimeMs, details.size); }
function revisionFrom(updatedAt: number, size: number): string { return `${updatedAt}:${size}`; }

function filterSummaryMetadata(summaries: CodexSummary[], query: string): CodexSummary[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return summaries;
  return summaries.filter(({ summary }) => terms.every((term) => [summary.title, summary.project.label, summary.locationLabel, summary.model, summary.originator].filter(Boolean).join(" ").toLowerCase().includes(term)));
}
function validateProjects(projects: SessionsProjectInput[]): void { for (const project of projects) if (!project.id.trim() || Buffer.byteLength(project.id, "utf8") > MAX_PROJECT_ID_BYTES) throw new Error("Invalid external sessions project id."); }
function pageWithinResponseCeiling(summaries: CodexSummary[], offset: number, limit: number): CodexSummary[] {
  const page: CodexSummary[] = [];
  for (const item of summaries.slice(offset, offset + limit)) {
    const candidate = [...page, item];
    const candidateOffset = offset + candidate.length;
    const result = { sessions: candidate.map((entry) => entry.summary), nextCursor: candidateOffset < summaries.length ? encodeListCursor(candidateOffset) : null, total: summaries.length };
    if (Buffer.byteLength(JSON.stringify(result)) > MAX_LIST_RESPONSE_BYTES) break;
    page.push(item);
  }
  return page;
}
function encodeListCursor(offset: number): string { return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url"); }
function decodeListCursor(cursor: string | undefined, total: number): number {
  if (!cursor) return 0;
  try { const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { offset?: unknown }; if (typeof value.offset !== "number" || !Number.isInteger(value.offset) || value.offset < 0 || value.offset > total) throw new Error("invalid"); return value.offset; } catch { throw new Error("Invalid external sessions cursor."); }
}
function projectForCwd(cwd: string, projects: SessionsProjectInput[]): SessionProjectRef {
  const project = projects.filter((candidate) => pathMatchesWorkspace(cwd, candidate.rootPath)).sort((left, right) => (right.rootPath?.length ?? 0) - (left.rootPath?.length ?? 0))[0];
  return project ? { id: project.id, label: boundedDisplayText(project.label) } : { id: null, label: "External Codex" };
}
function pathMatchesWorkspace(cwd: string, rootPath: string | undefined): boolean { const root = rootPath?.replace(/\/+$/, ""); if (!cwd || !root) return false; const legacyRoot = `${path.dirname(root)}/.alfred-worktrees/${path.basename(root)}`; return cwd === root || cwd.startsWith(`${root}/`) || cwd === legacyRoot || cwd.startsWith(`${legacyRoot}/`); }
async function readCodexSessionTitleIndex(codexHome: string): Promise<Map<string, string>> { let content: string; try { content = await readFile(path.join(codexHome, "session_index.jsonl"), "utf8"); } catch { return new Map(); } const titles = new Map<string, string>(); for (const line of content.split(/\r?\n/)) { const record = parseJsonRecord(line); const id = stringValue(record?.id); const title = titleFromText(stringValue(record?.thread_name) ?? ""); if (id && title) titles.set(id, title); } return titles; }
async function findJsonlFiles(root: string): Promise<SessionFile[]> { const files: SessionFile[] = []; async function visit(dir: string): Promise<void> { let handle: Awaited<ReturnType<typeof opendir>>; try { handle = await opendir(dir); } catch { return; } for await (const entry of handle) { const entryPath = path.join(dir, entry.name); if (entry.isDirectory()) await visit(entryPath); else if (entry.isFile() && entry.name.endsWith(".jsonl")) try { const details = await stat(entryPath); files.push({ path: entryPath, updatedAt: details.mtimeMs, size: details.size }); } catch { /* File changed while Codex was writing it. */ } } } await visit(root); return files; }
async function readTranscriptPrefixLines(filePath: string, maxLines: number): Promise<string[]> { const stream = createReadStream(filePath, { encoding: "utf8" }); const reader = createInterface({ input: stream, crlfDelay: Infinity }); const lines: string[] = []; try { for await (const line of reader) { lines.push(line); if (lines.length >= maxLines) { reader.close(); stream.destroy(); break; } } } finally { reader.close(); stream.destroy(); } return lines; }
function parseJsonRecord(line: string): Record<string, unknown> | null { try { const value = JSON.parse(line) as unknown; return isRecord(value) ? value : null; } catch { return null; } }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function stringValue(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value : undefined; }
function extractUserText(record: Record<string, unknown>): string { if (record.type === "event_msg" && isRecord(record.payload)) return stringValue(record.payload.message) ?? ""; if (record.type !== "response_item" || !isRecord(record.payload) || record.payload.type !== "message" || record.payload.role !== "user" || !Array.isArray(record.payload.content)) return ""; return record.payload.content.flatMap((item) => isRecord(item) ? [stringValue(item.text) ?? stringValue(item.input_text) ?? ""] : []).join(" ").trim(); }
function titleFromText(value: string): string { const text = value.replace(/\s+/g, " ").trim(); return !text ? "" : text.length > MAX_TITLE_LENGTH ? `${text.slice(0, MAX_TITLE_LENGTH - 1)}...` : text; }
function boundedDisplayText(value: string): string { const text = value.replace(/\s+/g, " ").trim(); return text.length > MAX_DISPLAY_TEXT_LENGTH ? `${text.slice(0, MAX_DISPLAY_TEXT_LENGTH - 1)}...` : text; }
function isInjectedSessionContext(value: string): boolean { return /^#\s*AGENTS\.md instructions\b/i.test(value.trim()); }
function fallbackTitle(cwd: string, id: string): string { return cwd ? `${path.basename(cwd)} Codex session` : id; }
function idFromFilename(filePath: string): string { const basename = path.basename(filePath, ".jsonl"); return basename.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)?.[0] ?? basename; }
function opaqueSessionToken(id: string, revision: number): string { return createHash("sha256").update(`${id}:${revision}`).digest("base64url"); }
function boundedSessionIdentity(id: string): string { return id.length <= MAX_SESSION_ID_LENGTH ? id : opaqueSessionToken(id, 0); }
