import { runnerEnv, type RunnerEnv, type RunnerSource } from "./env.js";

export type RunnerConfig = {
  apiUrl: string;
  deviceToken: string;
  workspaceId: string;
  deviceId: string;
  runnerSources?: RunnerSource[];
  privacyMode: "minimal" | "standard" | "full";
  outboxPath: string;
  pollMs?: number;
  codexHome: string;
  codexSince?: string;
  claudeHome?: string;
  claudeSince?: string;
  vercelAutomationBypassSecret?: string;
};

export function loadRunnerConfig(env: RunnerEnv = runnerEnv): RunnerConfig {
  return {
    apiUrl: env.RUNNER_API_URL.replace(/\/$/, ""),
    deviceToken: env.RUNNER_DEVICE_TOKEN,
    workspaceId: env.RUNNER_WORKSPACE_ID,
    deviceId: env.RUNNER_DEVICE_ID,
    runnerSources: env.ALFRED_SOURCES,
    privacyMode: env.ALFRED_PRIVACY_MODE,
    outboxPath: env.ALFRED_RUNNER_DB_PATH,
    pollMs: env.ALFRED_RUNNER_POLL_MS,
    codexHome: env.ALFRED_CODEX_HOME,
    ...(env.ALFRED_CODEX_SINCE !== undefined
      ? { codexSince: env.ALFRED_CODEX_SINCE }
      : {}),
    claudeHome: env.ALFRED_CLAUDE_HOME,
    ...(env.ALFRED_CLAUDE_SINCE !== undefined
      ? { claudeSince: env.ALFRED_CLAUDE_SINCE }
      : {}),
    ...(env.VERCEL_AUTOMATION_BYPASS_SECRET !== undefined
      ? { vercelAutomationBypassSecret: env.VERCEL_AUTOMATION_BYPASS_SECRET }
      : {}),
  };
}
