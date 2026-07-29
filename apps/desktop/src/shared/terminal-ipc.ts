import type { AgentKind } from "./alfred-ipc.js";
import type { SessionActivityEvent } from "./session-activity.js";

export type TerminalSessionId = string;
export type TerminalSessionSource = "manual" | "alfred";
export type TerminalSessionIsolation = "shared" | "worktree";
export type TerminalResumeTarget = {
  agentKind: "codex";
  sessionId: string;
  source: "codex-session-index" | "external-session-index";
};

export type TerminalCreateRequest = {
  clientId?: string;
  launchTicketId?: string;
  title?: string;
  source?: TerminalSessionSource;
  agentKind?: AgentKind;
  workspaceId?: string;
  cwd?: string;
  isolation?: TerminalSessionIsolation;
  branchName?: string;
  baseCwd?: string;
  cols: number;
  rows: number;
  command?: string;
  args?: string[];
  resumeTarget?: TerminalResumeTarget;
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
  isolation?: TerminalSessionIsolation;
  branchName?: string;
  baseCwd?: string;
  createdAt?: number;
  shell: string;
  command?: string;
  args?: string[];
  resumeTarget?: TerminalResumeTarget;
};

export type TerminalSessionSnapshot = TerminalCreateResult & {
  buffer: string;
  activityEvents?: SessionActivityEvent[];
  lastActivityAt?: number;
  lastOutputAt?: number;
};

export type PersistedTerminalSessionSnapshot = Omit<TerminalSessionSnapshot, "id"> & {
  clientId: string;
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
};

export type TerminalKillRequest = {
  id: TerminalSessionId;
  cleanupWorktree?: boolean;
};

export type TerminalForgetRequest = {
  clientId: string;
  cleanupWorktree?: boolean;
};

export type TerminalRenameRequest = {
  clientId: string;
  title: string;
};

export type TerminalWorktreeDiffRequest = {
  clientId: string;
};

export type TerminalWorktreeDiffResult =
  | { ok: true; summary: string; files: Array<{ path: string; status: string }> }
  | { ok: false; error: string };

export type TerminalWorktreeApplyRequest = {
  clientId: string;
};

export type TerminalWorktreeApplyResult =
  | { ok: true; appliedFiles: number }
  | { ok: false; error: string; needsManualReview?: boolean };

export type TerminalExitEvent = {
  id: TerminalSessionId;
  clientId?: string;
  exitCode: number;
  signal?: number;
};

export type TerminalDataEvent = {
  id: TerminalSessionId;
  clientId?: string;
  data: string;
  activities: SessionActivityEvent[];
};

export type TerminalApi = {
  list(): Promise<TerminalListResult>;
  snapshot(request: TerminalSnapshotRequest): Promise<TerminalSnapshotResult>;
  reconcile(request: TerminalReconcileRequest): Promise<TerminalReconcileResult>;
  prepareLaunch(request: TerminalCreateRequest): Promise<TerminalPrepareLaunchResult>;
  create(request: TerminalCreateRequest): Promise<TerminalCreateResult>;
  write(request: TerminalWriteRequest): void;
  resize(request: TerminalResizeRequest): void;
  kill(request: TerminalKillRequest): void;
  forget(request: TerminalForgetRequest): void;
  rename(request: TerminalRenameRequest): Promise<void>;
  worktreeDiff(request: TerminalWorktreeDiffRequest): Promise<TerminalWorktreeDiffResult>;
  worktreeApply(request: TerminalWorktreeApplyRequest): Promise<TerminalWorktreeApplyResult>;
  onData(callback: (event: TerminalDataEvent) => void): () => void;
  onExit(callback: (event: TerminalExitEvent) => void): () => void;
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
  worktreeDiff: "alfred:terminal:worktree-diff",
  worktreeApply: "alfred:terminal:worktree-apply",
  data: "alfred:terminal:data",
  exit: "alfred:terminal:exit",
} as const;
