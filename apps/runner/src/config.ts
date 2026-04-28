import { runnerEnv, type RunnerEnv } from "./env.js";

export type RunnerConfig = {
  apiUrl: string;
  deviceToken: string;
  workspaceId: string;
  deviceId: string;
  privacyMode: "minimal" | "standard" | "full";
  outboxPath: string;
  codexHome: string;
  codexSince?: string;
};

export function loadRunnerConfig(env: RunnerEnv = runnerEnv): RunnerConfig {
  return {
    apiUrl: env.RUNNER_API_URL.replace(/\/$/, ""),
    deviceToken: env.RUNNER_DEVICE_TOKEN,
    workspaceId: env.RUNNER_WORKSPACE_ID,
    deviceId: env.RUNNER_DEVICE_ID,
    privacyMode: env.ALFRED_PRIVACY_MODE,
    outboxPath: env.ALFRED_RUNNER_DB_PATH,
    codexHome: env.ALFRED_CODEX_HOME,
    ...(env.ALFRED_CODEX_SINCE !== undefined
      ? { codexSince: env.ALFRED_CODEX_SINCE }
      : {}),
  };
}
