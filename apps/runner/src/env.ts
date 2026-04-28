import { z } from "zod";

const DEFAULT_API_URL = "http://127.0.0.1:4301";
const DEFAULT_DEVICE_TOKEN = "dev-device-token";
const DEFAULT_WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
const DEFAULT_DEVICE_ID = "00000000-0000-4000-8000-000000000101";
const DEFAULT_OUTBOX_PATH = ".alfred-runner/outbox.sqlite";

const PrivacyModeSchema = z.enum(["minimal", "standard", "full"]);
const UuidSchema = z.string().uuid();

export type RunnerEnv = {
  RUNNER_API_URL: string;
  RUNNER_DEVICE_TOKEN: string;
  RUNNER_WORKSPACE_ID: string;
  RUNNER_DEVICE_ID: string;
  ALFRED_PRIVACY_MODE: "minimal" | "standard" | "full";
  ALFRED_RUNNER_DB_PATH: string;
  ALFRED_CODEX_HOME: string;
};

export function parseRunnerEnv(input: NodeJS.ProcessEnv): RunnerEnv {
  const allowDevDefaults = input.NODE_ENV === "test" || input.ALFRED_ALLOW_DEV_CONFIG === "1";
  const home = input.HOME ?? process.env.HOME ?? ".";

  const deviceToken = input.RUNNER_DEVICE_TOKEN ?? (allowDevDefaults ? DEFAULT_DEVICE_TOKEN : undefined);
  if (!deviceToken) {
    throw new Error("RUNNER_DEVICE_TOKEN is required");
  }

  const workspaceId = input.RUNNER_WORKSPACE_ID ?? (allowDevDefaults ? DEFAULT_WORKSPACE_ID : undefined);
  if (!workspaceId) {
    throw new Error("RUNNER_WORKSPACE_ID is required");
  }

  if (!UuidSchema.safeParse(workspaceId).success) {
    throw new Error("Invalid RUNNER_WORKSPACE_ID");
  }

  const deviceId = input.RUNNER_DEVICE_ID ?? (allowDevDefaults ? DEFAULT_DEVICE_ID : undefined);
  if (!deviceId) {
    throw new Error("RUNNER_DEVICE_ID is required");
  }

  if (!UuidSchema.safeParse(deviceId).success) {
    throw new Error("Invalid RUNNER_DEVICE_ID");
  }

  const privacyMode = PrivacyModeSchema.safeParse(input.ALFRED_PRIVACY_MODE ?? "standard");
  if (!privacyMode.success) {
    throw new Error("Invalid ALFRED_PRIVACY_MODE");
  }

  return {
    RUNNER_API_URL: input.RUNNER_API_URL ?? DEFAULT_API_URL,
    RUNNER_DEVICE_TOKEN: deviceToken,
    RUNNER_WORKSPACE_ID: workspaceId,
    RUNNER_DEVICE_ID: deviceId,
    ALFRED_PRIVACY_MODE: privacyMode.data,
    ALFRED_RUNNER_DB_PATH: input.ALFRED_RUNNER_DB_PATH ?? DEFAULT_OUTBOX_PATH,
    ALFRED_CODEX_HOME: input.ALFRED_CODEX_HOME ?? `${home}/.codex`,
  };
}

export const runnerEnv = parseRunnerEnv(process.env);
