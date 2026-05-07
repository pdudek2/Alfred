// apps/desktop/src/shared/alfred-ipc.ts
export type AgentKind = "codex" | "claude" | "dev-server" | "shell";

export type AlfredPlanRequest = {
  prompt: string;
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

export type AlfredApi = {
  requestPlan(request: AlfredPlanRequest): Promise<AlfredPlanResponse>;
};

export const alfredChannels = {
  planRequest: "alfred:plan:request",
} as const;
