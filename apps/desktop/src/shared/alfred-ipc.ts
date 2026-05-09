// apps/desktop/src/shared/alfred-ipc.ts
export type AgentKind = "codex" | "claude" | "dev-server" | "shell";

export type AlfredWorkspaceSessionContext = {
  title: string;
  kind?: AgentKind;
  status?: string;
  cwd?: string;
  command?: string;
};

export type AlfredWorkspaceContext = {
  id: string;
  label: string;
  rootPath?: string;
  gitBranch?: string;
  sessions?: AlfredWorkspaceSessionContext[];
};

export type AlfredPlanRequest = {
  prompt: string;
  workspace?: AlfredWorkspaceContext;
};

export type AlfredPlanSession = {
  kind: AgentKind;
  title: string;
  cwd?: string;
  command: string;
  args: string[];
  safetyNote?: string;
};

export type AlfredPlan = {
  name?: string;
  sessions: AlfredPlanSession[];
};

export type AlfredErrorCode =
  | "no_api_key"
  | "auth"
  | "rate_limit"
  | "timeout"
  | "network"
  | "malformed"
  | "in_flight";

export type AlfredError = {
  code: AlfredErrorCode;
  message: string;
};

export type AlfredPlanResponse =
  | { ok: true; plan: AlfredPlan }
  | { ok: false; error: AlfredError };

export type AlfredStagedSession = AlfredPlanSession & {
  id: string;
  workspaceId?: string;
};

export type AlfredStagedPlanSnapshot = {
  id: string;
  prompt: string;
  name?: string;
  sessions: AlfredStagedSession[];
};

export type AlfredStagedPlanSetRequest = AlfredStagedPlanSnapshot;

export type AlfredStagedPlanResolveRequest = {
  sessionIds: string[];
};

export type AlfredStagedPlanSnapshotResponse = {
  plan: AlfredStagedPlanSnapshot | null;
};

export type AlfredRuntimeStatus = {
  model: string;
  openRouterConfigured: boolean;
};

export type AlfredApi = {
  requestPlan(request: AlfredPlanRequest): Promise<AlfredPlanResponse>;
  getRuntimeStatus(): Promise<AlfredRuntimeStatus>;
  getStagedPlan(): Promise<AlfredStagedPlanSnapshotResponse>;
  setStagedPlan(request: AlfredStagedPlanSetRequest): Promise<AlfredStagedPlanSnapshotResponse>;
  resolveStagedPlan(request: AlfredStagedPlanResolveRequest): Promise<AlfredStagedPlanSnapshotResponse>;
  clearStagedPlan(): Promise<AlfredStagedPlanSnapshotResponse>;
};

export const alfredChannels = {
  planClear: "alfred:plan:clear",
  planGet: "alfred:plan:get",
  planRequest: "alfred:plan:request",
  planResolve: "alfred:plan:resolve",
  planSet: "alfred:plan:set",
  runtimeStatus: "alfred:runtime:status",
} as const;
