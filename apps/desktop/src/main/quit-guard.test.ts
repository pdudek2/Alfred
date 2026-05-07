import { describe, expect, it } from "vitest";
import {
  QUIT_GUARD_CANCEL_BUTTON,
  QUIT_GUARD_CONFIRM_BUTTON,
  didCancelTerminalQuit,
  shouldConfirmTerminalQuit,
} from "./quit-guard.js";

describe("quit guard", () => {
  it("asks for confirmation only when terminal sessions are active", () => {
    expect(shouldConfirmTerminalQuit(0)).toBe(false);
    expect(shouldConfirmTerminalQuit(1)).toBe(true);
    expect(shouldConfirmTerminalQuit(3)).toBe(true);
  });

  it("treats every non-confirm button as cancel", () => {
    expect(didCancelTerminalQuit(QUIT_GUARD_CANCEL_BUTTON)).toBe(true);
    expect(didCancelTerminalQuit(QUIT_GUARD_CONFIRM_BUTTON)).toBe(false);
    expect(didCancelTerminalQuit(-1)).toBe(true);
  });
});
