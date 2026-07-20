export const SESSIONS_PAGE_SIZE = 80;
export const TRANSCRIPT_BLOCK_LIMIT = 50;
export const TRANSCRIPT_TEXT_LIMIT = 256 * 1024;
export const TRANSCRIPT_CACHE_SESSION_LIMIT = 3;
export const TRANSCRIPT_CACHE_TEXT_LIMIT = 16 * 1024 * 1024;
export const SUMMARY_CACHE_COUNT_LIMIT = 5_000;
export const SUMMARY_CACHE_TEXT_LIMIT = 10 * 1024 * 1024;

export type SessionProjectRef = { id: string | null; label: string };
export type SessionLifecycle = "live" | "recoverable" | "resumable" | "read-only";

export type SessionSummary = {
  sessionKey: string;
  lineageKey: string;
  contentSessionKey: string | null;
  source: "managed" | "external-codex";
  kind: "codex" | "claude" | "manual";
  title: string;
  project: SessionProjectRef;
  locationLabel: string;
  snippet?: string;
  branch?: string;
  model?: string;
  originator?: string;
  updatedAt: number;
  lifecycle: SessionLifecycle;
};

export type ExternalSessionSummary = SessionSummary & {
  source: "external-codex";
  kind: "codex";
  contentSessionKey: string;
  lifecycle: "resumable" | "read-only";
};

export type SessionsProjectInput = { id: string; label: string; rootPath?: string };
export type ListExternalSessionsRequest = {
  projects: SessionsProjectInput[];
  query?: string;
  cursor?: string;
  limit?: number;
};
export type ListExternalSessionsResult = {
  sessions: ExternalSessionSummary[];
  nextCursor: string | null;
  total: number;
};
export type ResolveExternalSessionResult =
  | { kind: "resume"; projectId: string; cwd: string; sessionId: string }
  | { kind: "add-project" }
  | { kind: "none" };

export type TranscriptBlock =
  | { id: string; kind: "message"; role: "user" | "assistant" | "system"; text: string }
  | { id: string; kind: "terminal"; text: string }
  | { id: string; kind: "notice"; text: string };

export type TranscriptPage = {
  sessionKey: string;
  blocks: TranscriptBlock[];
  nextCursor: string | null;
  revision: string;
  partial: boolean;
};

export type SessionsDiagnostics = {
  cachedSessionCount: number;
  decodedTranscriptBytes: number;
  summaryCount: number;
  summaryBytes: number;
  resumeAliasCount: number;
  contentAliasCount: number;
};

export type SessionsApi = {
  listExternalSessions(request: ListExternalSessionsRequest): Promise<ListExternalSessionsResult>;
  releaseListSnapshot(request: { cursor: string }): Promise<void>;
  resolveExternalSession(request: { sessionKey: string }): Promise<ResolveExternalSessionResult>;
  readTranscriptPage(request: { sessionKey: string; cursor?: string }): Promise<TranscriptPage>;
  getDiagnostics(): Promise<SessionsDiagnostics>;
  clearCaches(): Promise<void>;
};

export const sessionsChannels = {
  listExternal: "alfred:sessions:list-external",
  releaseListSnapshot: "alfred:sessions:release-list-snapshot",
  resolveExternal: "alfred:sessions:resolve-external",
  readTranscriptPage: "alfred:sessions:read-transcript-page",
  getDiagnostics: "alfred:sessions:get-diagnostics",
  clearCaches: "alfred:sessions:clear-caches",
} as const;

export type SessionsChannels = typeof sessionsChannels;
