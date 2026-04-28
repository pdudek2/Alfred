import { z } from "zod";

export const AgentSource = z.enum([
  "claude-code",
  "codex-cli",
  "openai-agents-sdk",
  "langgraph",
  "custom",
]);

export const PrivacyMode = z.enum(["minimal", "standard", "full"]);

export const RunStatus = z.enum([
  "running",
  "waiting",
  "completed",
  "failed",
  "cancelled",
  "unknown",
]);

export const EventType = z.enum([
  "run.started",
  "run.updated",
  "run.completed",
  "run.failed",
  "agent.waiting",
  "tool.started",
  "tool.completed",
  "tool.failed",
  "file.touched",
  "command.executed",
  "test.result",
  "spawn.created",
  "field_report.submitted",
  "alert.raised",
]);

export type AgentSource = z.infer<typeof AgentSource>;
export type PrivacyMode = z.infer<typeof PrivacyMode>;
export type RunStatus = z.infer<typeof RunStatus>;
export type EventType = z.infer<typeof EventType>;
