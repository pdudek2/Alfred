// apps/desktop/src/shared/alfred-ipc.ts
export type AgentKind = "codex" | "claude" | "dev-server" | "shell";

export type AlfredLaunchPreflight =
  | {
      status: "ready";
      label: string;
      detail: string;
      isolation?: "shared" | "worktree";
      branchName?: string;
      baseCwd?: string;
      cwd?: string;
    }
  | {
      status: "blocked";
      code: "command_missing" | "cwd_outside_workspace" | "git_not_ready" | "no_workspace";
      label: string;
      reason: string;
      detail?: string;
    };

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
  launchPreflight?: AlfredLaunchPreflight;
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
  | "in_flight"
  | "not_found";

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

export type AlfredStagedSessionPatch = {
  title?: string;
  cwd?: string;
  command?: string;
  args?: string[];
};

export type AlfredStagedPlanSessionUpdateRequest = {
  planId: string;
  sessionId: string;
  patch: AlfredStagedSessionPatch;
  workspace?: AlfredWorkspaceContext;
};

export type AlfredStagedPlanSessionUpdateResponse =
  | { ok: true; plan: AlfredStagedPlanSnapshot }
  | { ok: false; error: AlfredError };

export type AlfredRuntimeStatus = {
  model: string;
  openRouterConfigured: boolean;
};

export type AlfredApi = {
  requestPlan(request: AlfredPlanRequest): Promise<AlfredPlanResponse>;
  getRuntimeStatus(): Promise<AlfredRuntimeStatus>;
  getStagedPlan(): Promise<AlfredStagedPlanSnapshotResponse>;
  setStagedPlan(request: AlfredStagedPlanSetRequest): Promise<AlfredStagedPlanSnapshotResponse>;
  updateStagedSession(request: AlfredStagedPlanSessionUpdateRequest): Promise<AlfredStagedPlanSessionUpdateResponse>;
  resolveStagedPlan(request: AlfredStagedPlanResolveRequest): Promise<AlfredStagedPlanSnapshotResponse>;
  clearStagedPlan(): Promise<AlfredStagedPlanSnapshotResponse>;
};

export const alfredChannels = {
  planClear: "alfred:plan:clear",
  planGet: "alfred:plan:get",
  planRequest: "alfred:plan:request",
  planResolve: "alfred:plan:resolve",
  planSessionUpdate: "alfred:plan:session:update",
  planSet: "alfred:plan:set",
  runtimeStatus: "alfred:runtime:status",
} as const;
