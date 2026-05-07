import { describe, expect, it } from "vitest";
import { idle, thinking, errored, isThinking, canRequestPlan, type AlfredStatus } from "./alfred-state";
import type { AlfredError } from "../shared/alfred-ipc";

describe("alfred-state", () => {
  it("idle() returns idle status", () => {
    const s: AlfredStatus = idle();
    expect(s).toEqual({ kind: "idle" });
    expect(isThinking(s)).toBe(false);
  });

  it("thinking() returns thinking status", () => {
    const s: AlfredStatus = thinking();
    expect(s).toEqual({ kind: "thinking" });
    expect(isThinking(s)).toBe(true);
  });

  it("errored(error) wraps the error in an error status", () => {
    const error: AlfredError = { code: "auth", message: "OpenRouter rejected the API key. Verify .env." };
    const s: AlfredStatus = errored(error);
    expect(s).toEqual({ kind: "error", error });
    expect(isThinking(s)).toBe(false);
  });

  it("allows a new plan request only when Alfred is idle and no staged tiles remain", () => {
    expect(canRequestPlan(idle(), 0)).toBe(true);
    expect(canRequestPlan(thinking(), 0)).toBe(false);
    expect(canRequestPlan(idle(), 2)).toBe(false);
  });
});
