import type { AgentKind } from "./alfred-ipc.js";
import type { SessionActivityEvent } from "./session-activity.js";

export type TerminalSessionId = string;
export type TerminalSessionSource = "manual" | "alfred";

export type TerminalCreateRequest = {
  clientId?: string;
  title?: string;
  source?: TerminalSessionSource;
  agentKind?: AgentKind;
  workspaceId?: string;
  cwd?: string;
  cols: number;
  rows: number;
  command?: string;
  args?: string[];
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
};

export type TerminalForgetRequest = {
  clientId: string;
};

export type TerminalExitEvent = {
  id: TerminalSessionId;
  exitCode: number;
  signal?: number;
};

export type TerminalDataEvent = {
  id: TerminalSessionId;
  data: string;
};

export type TerminalApi = {
  list(): Promise<TerminalListResult>;
  create(request: TerminalCreateRequest): Promise<TerminalCreateResult>;
  write(request: TerminalWriteRequest): void;
  resize(request: TerminalResizeRequest): void;
  kill(request: TerminalKillRequest): void;
  forget(request: TerminalForgetRequest): void;
  onData(callback: (event: TerminalDataEvent) => void): () => void;
  onExit(callback: (event: TerminalExitEvent) => void): () => void;
};

export const terminalChannels = {
  list: "alfred:terminal:list",
  create: "alfred:terminal:create",
  write: "alfred:terminal:write",
  resize: "alfred:terminal:resize",
  kill: "alfred:terminal:kill",
  forget: "alfred:terminal:forget",
  data: "alfred:terminal:data",
  exit: "alfred:terminal:exit",
} as const;
