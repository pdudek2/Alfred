import { describe, expect, it } from "vitest";
import { terminalTail } from "./terminal-tail";

describe("terminalTail", () => {
  it("starts the kept end at an escape sequence or a line, never inside a sequence", () => {
    const frame = "\u001b[5;9Hworking\u001b[7;1Htokens 28";
    // The cut lands inside "\u001b[7;1H".
    const cut = frame.length - frame.indexOf(";1H");
    expect(terminalTail(`${frame}\u001b[0m`, cut + 4)).toBe("\u001b[0m");
    expect(terminalTail("first line\nsecond line", 15)).toBe("second line");
    expect(terminalTail("abc\u001b[1mdef\ngh", 10)).toBe("\u001b[1mdef\ngh");
    expect(terminalTail("short", 10)).toBe("short");
    // With no boundary in reach, the plain cut is all there is.
    expect(terminalTail("no boundary at all", 5)).toBe("t all");
  });
});
