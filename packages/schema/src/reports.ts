import { z } from "zod";

import { AgentSource } from "./enums.js";

export const FieldReportSchema = z.object({
  mission_id: z.string().uuid().optional(),
  run_id: z.string().uuid().optional(),
  source_id: AgentSource,
  summary: z.string().min(1).max(4000),
  completed_work: z.array(z.string().min(1)).default([]),
  files_touched: z.array(z.string()).default([]),
  commands_run: z.array(z.string()).default([]),
  tests_run: z.array(z.string()).default([]),
  decisions: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  blockers: z.array(z.string()).default([]),
  next_steps: z.array(z.string()).default([]),
  confidence: z.enum(["low", "medium", "high"]).default("medium"),
  needs_human_review: z.boolean().default(false),
});

export type FieldReportInput = z.input<typeof FieldReportSchema>;
export type FieldReport = z.output<typeof FieldReportSchema>;
