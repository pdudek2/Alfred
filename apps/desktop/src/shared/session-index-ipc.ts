export type ExternalCodexSessionSummary = {
  id: string;
  title: string;
  cwd: string;
  createdAt: number;
  updatedAt: number;
  transcriptPath: string;
  parentThreadId?: string;
  model?: string;
  originator?: string;
};

export type ExternalCodexSessionListResult = {
  sessions: ExternalCodexSessionSummary[];
};

export type SessionIndexApi = {
  listExternalCodexSessions(): Promise<ExternalCodexSessionListResult>;
};

export const sessionIndexChannels = {
  listExternalCodexSessions: "alfred:session-index:list-external-codex",
} as const;
