import { z } from "zod";
import { LOCAL_DEVICE_ID, LOCAL_USER_ID, LOCAL_WORKSPACE_ID } from "@alfred/schema";

const DEFAULT_RUNNER_DEVICE_TOKEN = "dev-device-token";

const BooleanEnv = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((value, ctx) => {
    if (value === undefined) return undefined;
    if (typeof value === "boolean") return value;
    if (value === "true" || value === "1") return true;
    if (value === "false" || value === "0") return false;

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Expected boolean env value",
    });
    return z.NEVER;
  });

function createEnvSchema(devAuthEnabled: boolean) {
  return z.object({
    API_PORT: z.coerce.number().int().positive().default(8787),
    DEV_AUTH_ENABLED: BooleanEnv.default(devAuthEnabled),
    ALFRED_BOOTSTRAP_ADMIN_EMAIL: z.string().email().default("local@alfred.local"),
    ALFRED_BOOTSTRAP_USER_ID: z.string().uuid().default(LOCAL_USER_ID),
    ALFRED_BOOTSTRAP_WORKSPACE_ID: z.string().uuid().default(LOCAL_WORKSPACE_ID),
    RUNNER_WORKSPACE_ID: z.string().uuid().default(LOCAL_WORKSPACE_ID),
    RUNNER_DEVICE_ID: z.string().uuid().default(LOCAL_DEVICE_ID),
    RUNNER_DEVICE_TOKEN: z
      .string()
      .min(1)
      .optional()
      .transform((value, ctx) => {
        if (value) return value;
        if (devAuthEnabled) return DEFAULT_RUNNER_DEVICE_TOKEN;

        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "RUNNER_DEVICE_TOKEN is required unless NODE_ENV=test or dev auth is explicitly enabled",
        });
        return z.NEVER;
      }),
  });
}

export function parseApiEnv(input: NodeJS.ProcessEnv) {
  const devAuthEnabled = shouldEnableDevAuth(input);
  const parsed = createEnvSchema(devAuthEnabled).parse(input);
  const hostedDevAuth = parsed.DEV_AUTH_ENABLED && isHostedRuntime(input);

  if (hostedDevAuth && parsed.RUNNER_DEVICE_TOKEN === DEFAULT_RUNNER_DEVICE_TOKEN) {
    throw new Error("RUNNER_DEVICE_TOKEN must be explicitly set when dev auth is enabled in hosted runtime");
  }

  return parsed;
}

function shouldEnableDevAuth(input: NodeJS.ProcessEnv): boolean {
  return input.NODE_ENV === "test" || booleanFlag(input.ALFRED_ALLOW_DEV_AUTH) || booleanFlag(input.DEV_AUTH_ENABLED);
}

function booleanFlag(value: NodeJS.ProcessEnv[string]): boolean {
  return value === "true" || value === "1";
}

function isHostedRuntime(input: NodeJS.ProcessEnv): boolean {
  return input.NODE_ENV === "production" || booleanFlag(input.VERCEL);
}

export const env = parseApiEnv(process.env);
