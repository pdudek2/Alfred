import { z } from "zod";

const DEFAULT_API_URL = "http://127.0.0.1:4301";
const DEFAULT_DEVICE_TOKEN = "dev-device-token";
const DEFAULT_WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
const DEFAULT_DEVICE_ID = "00000000-0000-4000-8000-000000000101";
const DEFAULT_OUTBOX_PATH = ".alfred-runner/outbox.sqlite";

const PrivacyModeSchema = z.enum(["minimal", "standard", "full"]);
const RunnerSourceSchema = z.enum(["codex", "claude"]);
const UuidSchema = z.string().uuid();
const IsoTimestampSchema = z.string().datetime({ offset: true });

export type RunnerSource = z.infer<typeof RunnerSourceSchema>;

export type RunnerEnv = {
  RUNNER_API_URL: string;
  RUNNER_DEVICE_TOKEN: string;
  RUNNER_WORKSPACE_ID: string;
  RUNNER_DEVICE_ID: string;
  ALFRED_SOURCES: RunnerSource[];
  ALFRED_PRIVACY_MODE: "minimal" | "standard" | "full";
  ALFRED_RUNNER_DB_PATH: string;
  ALFRED_CODEX_HOME: string;
  ALFRED_CODEX_SINCE?: string;
  ALFRED_CLAUDE_HOME: string;
  ALFRED_CLAUDE_SINCE?: string;
};

function parseRunnerSources(raw: string | undefined): RunnerSource[] {
  return (raw ?? "codex").split(",").map((source) => {
    const trimmed = source.trim();
    if (trimmed.length === 0) {
      throw new Error("Invalid ALFRED_SOURCES: empty source");
    }

    const parsed = RunnerSourceSchema.safeParse(trimmed);
    if (!parsed.success) {
      throw new Error(`Invalid ALFRED_SOURCES: unknown source "${trimmed}"`);
    }

    return parsed.data;
  });
}

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

  if (
    input.ALFRED_CODEX_SINCE !== undefined &&
    !IsoTimestampSchema.safeParse(input.ALFRED_CODEX_SINCE).success
  ) {
    throw new Error("Invalid ALFRED_CODEX_SINCE");
  }

  if (
    input.ALFRED_CLAUDE_SINCE !== undefined &&
    !IsoTimestampSchema.safeParse(input.ALFRED_CLAUDE_SINCE).success
  ) {
    throw new Error("Invalid ALFRED_CLAUDE_SINCE");
  }

  return {
    RUNNER_API_URL: input.RUNNER_API_URL ?? DEFAULT_API_URL,
    RUNNER_DEVICE_TOKEN: deviceToken,
    RUNNER_WORKSPACE_ID: workspaceId,
    RUNNER_DEVICE_ID: deviceId,
    ALFRED_SOURCES: parseRunnerSources(input.ALFRED_SOURCES),
    ALFRED_PRIVACY_MODE: privacyMode.data,
    ALFRED_RUNNER_DB_PATH: input.ALFRED_RUNNER_DB_PATH ?? DEFAULT_OUTBOX_PATH,
    ALFRED_CODEX_HOME: input.ALFRED_CODEX_HOME ?? `${home}/.codex`,
    ...(input.ALFRED_CODEX_SINCE !== undefined
      ? { ALFRED_CODEX_SINCE: input.ALFRED_CODEX_SINCE }
      : {}),
    ALFRED_CLAUDE_HOME: input.ALFRED_CLAUDE_HOME ?? `${home}/.claude`,
    ...(input.ALFRED_CLAUDE_SINCE !== undefined
      ? { ALFRED_CLAUDE_SINCE: input.ALFRED_CLAUDE_SINCE }
      : {}),
  };
}

export const runnerEnv = parseRunnerEnv(process.env);
