import type { AlfredError } from "../shared/alfred-ipc";

export type AlfredStatus =
  | { kind: "idle" }
  | { kind: "thinking" }
  | { kind: "error"; error: AlfredError };

export type SquadPlan = {
  id: string;
  name?: string;
  prompt: string;
  sessionIds: string[];
};

export function idle(): AlfredStatus {
  return { kind: "idle" };
}

export function thinking(): AlfredStatus {
  return { kind: "thinking" };
}

export function errored(error: AlfredError): AlfredStatus {
  return { kind: "error", error };
}

export function isThinking(status: AlfredStatus): boolean {
  return status.kind === "thinking";
}
