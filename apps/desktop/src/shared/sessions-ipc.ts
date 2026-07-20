export const SESSIONS_PAGE_SIZE = 80;

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

export type SessionsApi = {
  listExternalSessions(request: ListExternalSessionsRequest): Promise<ListExternalSessionsResult>;
  resolveExternalSession(request: { sessionKey: string }): Promise<ResolveExternalSessionResult>;
};

export const sessionsChannels = {
  listExternal: "alfred:sessions:list-external",
  resolveExternal: "alfred:sessions:resolve-external",
} as const;
