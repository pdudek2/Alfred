import { describe, expect, it } from "vitest";
import { idle, thinking, errored, isThinking, type AlfredStatus } from "./alfred-state";
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
});
