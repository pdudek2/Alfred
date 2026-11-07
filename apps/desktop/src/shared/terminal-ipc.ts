import type { AgentKind } from "./alfred-ipc.js";
import type { SessionActivityEvent } from "./session-activity.js";

export type TerminalSessionId = string;
export type TerminalSessionSource = "manual" | "alfred";
export type TerminalForegroundAgentKind = Extract<AgentKind, "codex" | "claude">;
/** Claude and Codex name a conversation by UUID; only such an id goes back to them as a Resume argument. */
export function isAgentConversationId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/** The agent conversation a session resumes; agent-hook ids come from the agent's own hooks while it runs. */
export type TerminalResumeTarget = {
  agentKind: TerminalForegroundAgentKind;
  sessionId: string;
  source: "codex-session-index" | "external-session-index" | "agent-hook";
};

/** Lines the agent's own edits added and removed in this conversation, read from its transcript at each turn's end. */
export type TerminalChangeStats = { additions: number; deletions: number };
export type TerminalFileChange = TerminalChangeStats & { path: string };
/** The git worktree an agent last worked in, as git reports it. */
export type TerminalWorkTree = { root: string; branch?: string };

export type TerminalCreateRequest = {
  clientId?: string;
  launchTicketId?: string;
  title?: string;
  source?: TerminalSessionSource;
  agentKind?: AgentKind;
  workspaceId?: string;
  cwd?: string;
  cols: number;
  rows: number;
  command?: string;
  args?: string[];
  resumeTarget?: TerminalResumeTarget;
  /** The session this one was started as a worker of. */
  parentClientId?: string;
};

export type TerminalPrepareLaunchResult = {
  launchTicketId: string;
  expiresAt: number;
};

export type TerminalCreateResult = {
  id: TerminalSessionId;
  clientId?: string;
  title: string;
  source: TerminalSessionSource;
  agentKind?: AgentKind;
  workspaceId?: string;
  cwd: string;
  createdAt?: number;
  shell: string;
  command?: string;
  args?: string[];
  resumeTarget?: TerminalResumeTarget;
  parentClientId?: string;
};

export type TerminalSessionSnapshot = TerminalCreateResult & {
  buffer: string;
  foregroundAgentKind?: TerminalForegroundAgentKind;
  agentSignal?: TerminalAgentSignal;
  shellBusy?: boolean;
  /** The program holding a plain shell's foreground, as a title ("pnpm dev"). */
  foregroundCommand?: string;
  /** You have sent this session a message. */
  changeStats?: TerminalChangeStats;
  /** The same edits per file. */
  changedFiles?: TerminalFileChange[];
  workTree?: TerminalWorkTree;
  promptSubmitted?: boolean;
  activityEvents?: SessionActivityEvent[];
  lastActivityAt?: number;
  lastOutputAt?: number;
  namedByYou?: true;
};

export type PersistedTerminalSessionSnapshot = {
  clientId: string;
  title: string;
  source: TerminalSessionSource;
  agentKind?: AgentKind;
  workspaceId?: string;
  createdAt?: number;
  /** Names this session in the agent event log, across resumes; its client id can return for a later session. */
  eventLogKey?: string;
  cwd?: string;
  /** The worktree the agent last worked in, where a Codex resume returns. */
  workTree?: TerminalWorkTree;
  shell?: string;
  command?: string;
  args?: string[];
  resumeTarget?: TerminalResumeTarget;
  parentClientId?: string;
  /** You renamed this session, so the agent's name for the conversation stays out. */
  namedByYou?: true;
  buffer?: string;
  activityEvents?: SessionActivityEvent[];
  lastActivityAt?: number;
  lastOutputAt?: number;
};

export type TerminalListResult = {
  sessions: TerminalSessionSnapshot[];
  restoredSessions?: PersistedTerminalSessionSnapshot[];
};

export type TerminalSnapshotRequest = {
  id: TerminalSessionId;
};

export type TerminalSnapshotResult = TerminalSessionSnapshot | null;

export type TerminalReconcileRequest = {
  id: TerminalSessionId;
  clientId?: string;
};

export type TerminalReconcileResult =
  | { state: "running"; snapshot: TerminalSessionSnapshot }
  | { state: "exited"; snapshot: TerminalSessionSnapshot; event: TerminalExitEvent }
  | { state: "missing" };

export type TerminalResizeRequest = {
  id: TerminalSessionId;
  cols: number;
  rows: number;
};

export type TerminalWriteRequest = {
  id: TerminalSessionId;
  data: string;
  /** The terminal shows an agent's start screen, so Enter answers it rather than sending a message. */
  answersStartScreen?: boolean;
};

export type TerminalKillRequest = {
  id: TerminalSessionId;
};

export type TerminalForgetRequest = {
  clientId: string;
};

export type TerminalForgetResult =
  | { ok: true }
  | { ok: false; error: string };

export type TerminalRenameRequest = {
  clientId: string;
  title: string;
  /** You typed this name, so the agent's name for the conversation no longer replaces it. */
  byYou?: true;
};

export type TerminalCodexImagesRequest = {
  clientId: string;
  /** The sent messages the terminal shows, top to bottom, as drawn; spaces and line breaks need not match. */
  messages: string[];
  /** Which of them holds the placeholder. */
  index: number;
};

/** The message's image files by placeholder, such as "[Image #1]"; empty when it is not known. */
export type TerminalCodexImagesResult = { images: Record<string, string> };

export type TerminalExitEvent = {
  id: TerminalSessionId;
  clientId?: string;
  exitCode: number;
  signal?: number;
};

/** What an agent or shell reports about itself; see the session model contract §3. */
export type TerminalAgentSignal = {
  state: "working" | "needs-you" | "your-turn";
  source: "hook" | "osc9";
  at: number;
  detail?: string;
};

export type TerminalDataEvent = {
  id: TerminalSessionId;
  clientId?: string;
  data: string;
  /** When the main process received this output (ms since epoch). */
  at?: number;
  foregroundAgentKind?: TerminalForegroundAgentKind;
  activities: SessionActivityEvent[];
  /** A new signal, or null when it was cleared. Absent means unchanged. */
  agentSignal?: TerminalAgentSignal | null;
  /** Whether a program other than the shell holds the foreground. Absent means unchanged. */
  shellBusy?: boolean;
  /** Sent once the program in a plain shell's foreground has held it a while; shellBusy false ends it. */
  foregroundCommand?: string;
  /** Sent once, when you first send the session a message. */
  promptSubmitted?: true;
  /** Sent when the agent's hooks name a conversation other than the one known. */
  resumeTarget?: TerminalResumeTarget;
  changeStats?: TerminalChangeStats;
  changedFiles?: TerminalFileChange[];
  /** Sent when the agent moved to another worktree; null when it left every repository. */
  workTree?: TerminalWorkTree | null;
  /** The agent's own name for the conversation, sent when it replaces the session's title. */
  agentTitle?: string;
};

/** An orchestrator agent asked for a worker; the renderer adds it under its parent and answers with the new session. */
export type TerminalWorkerRequest = {
  requestId: string;
  parentClientId: string;
  agent: "claude" | "codex";
  prompt: string;
  title?: string;
  model?: string;
  effort?: string;
};

export type TerminalWorkerReply =
  | { requestId: string; clientId: string; title: string }
  | { requestId: string; error: string };

export type TerminalApi = {
  list(): Promise<TerminalListResult>;
  snapshot(request: TerminalSnapshotRequest): Promise<TerminalSnapshotResult>;
  reconcile(request: TerminalReconcileRequest): Promise<TerminalReconcileResult>;
  prepareLaunch(request: TerminalCreateRequest): Promise<TerminalPrepareLaunchResult>;
  create(request: TerminalCreateRequest): Promise<TerminalCreateResult>;
  write(request: TerminalWriteRequest): void;
  resize(request: TerminalResizeRequest): void;
  kill(request: TerminalKillRequest): void;
  forget(request: TerminalForgetRequest): Promise<TerminalForgetResult>;
  rename(request: TerminalRenameRequest): Promise<void>;
  codexImages(request: TerminalCodexImagesRequest): Promise<TerminalCodexImagesResult>;
  onData(callback: (event: TerminalDataEvent) => void): () => void;
  onExit(callback: (event: TerminalExitEvent) => void): () => void;
  onWorkerRequest(callback: (request: TerminalWorkerRequest) => void): () => void;
  answerWorkerRequest(reply: TerminalWorkerReply): void;
};

export const terminalChannels = {
  list: "alfred:terminal:list",
  snapshot: "alfred:terminal:snapshot",
  reconcile: "alfred:terminal:reconcile",
  prepareLaunch: "alfred:terminal:prepare-launch",
  create: "alfred:terminal:create",
  write: "alfred:terminal:write",
  resize: "alfred:terminal:resize",
  kill: "alfred:terminal:kill",
  forget: "alfred:terminal:forget",
  rename: "alfred:terminal:rename",
  codexImages: "alfred:terminal:codex-images",
  data: "alfred:terminal:data",
  exit: "alfred:terminal:exit",
  workerRequest: "alfred:terminal:worker-request",
  workerReply: "alfred:terminal:worker-reply",
} as const;
