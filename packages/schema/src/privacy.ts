import { z } from "zod";

import { PrivacyMode } from "./enums.js";

export const PrivacyPolicySchema = z.object({
  mode: PrivacyMode.default("standard"),
  allow_full_transcript: z.boolean().default(false),
  allowed_artifact_globs: z.array(z.string()).default([]),
  denied_artifact_globs: z
    .array(z.string())
    .default([".env", ".env.*", "**/*secret*", "**/*token*"]),
});

export type PrivacyPolicyInput = z.input<typeof PrivacyPolicySchema>;
export type PrivacyPolicy = z.output<typeof PrivacyPolicySchema>;
