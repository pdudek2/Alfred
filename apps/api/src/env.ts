import { z } from "zod";

const DEFAULT_RUNNER_DEVICE_TOKEN = "dev-device-token";

const devAuthEnabled = process.env.NODE_ENV === "test" || process.env.ALFRED_ALLOW_DEV_AUTH === "1";
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

const envSchema = z.object({
  API_PORT: z.coerce.number().int().positive().default(8787),
  DEV_AUTH_ENABLED: BooleanEnv.default(devAuthEnabled),
  AUTH_DEV_SESSION_TOKEN: z.string().min(1).default("dev-session-token"),
  AUTH_OIDC_ISSUER: z.string().url().optional(),
  AUTH_OIDC_CLIENT_ID: z.string().min(1).optional(),
  AUTH_OIDC_CLIENT_SECRET: z.string().min(1).optional(),
  APP_BASE_URL: z.string().url().default("http://127.0.0.1:4300"),
  ALFRED_BOOTSTRAP_ADMIN_EMAIL: z.string().email().default("local@alfred.local"),
  ALFRED_BOOTSTRAP_USER_ID: z.string().uuid().default("00000000-0000-4000-8000-000000000011"),
  ALFRED_BOOTSTRAP_WORKSPACE_ID: z.string().uuid().default("00000000-0000-4000-8000-000000000001"),
  RUNNER_WORKSPACE_ID: z.string().uuid().default("00000000-0000-4000-8000-000000000001"),
  RUNNER_DEVICE_ID: z.string().uuid().default("00000000-0000-4000-8000-000000000101"),
  RUNNER_DEVICE_TOKEN: z
    .string()
    .min(1)
    .optional()
    .transform((value, ctx) => {
      if (value) return value;
      if (devAuthEnabled) return DEFAULT_RUNNER_DEVICE_TOKEN;

      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "RUNNER_DEVICE_TOKEN is required unless NODE_ENV=test or ALFRED_ALLOW_DEV_AUTH=1",
      });
      return z.NEVER;
    }),
});

export const env = envSchema.parse(process.env);
