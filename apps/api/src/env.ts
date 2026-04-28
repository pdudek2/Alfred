import { z } from "zod";

const allowDevToken = process.env.NODE_ENV === "test" || process.env.ALFRED_ALLOW_DEV_TOKEN === "1";

const envSchema = z.object({
  API_PORT: z.coerce.number().int().positive().default(8787),
  RUNNER_DEVICE_TOKEN: z
    .string()
    .min(1)
    .optional()
    .transform((value, ctx) => {
      if (value) return value;
      if (allowDevToken) return "dev-runner-token";

      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "RUNNER_DEVICE_TOKEN is required unless NODE_ENV=test or ALFRED_ALLOW_DEV_TOKEN=1",
      });
      return z.NEVER;
    }),
});

export const env = envSchema.parse(process.env);
