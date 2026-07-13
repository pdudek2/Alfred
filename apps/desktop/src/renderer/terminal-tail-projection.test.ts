import { describe, expect, it } from "vitest";
import {
  projectTerminalTail,
  type TerminalTailSource,
} from "./terminal-tail-projection";

function source(lines: string[], rows = lines.length): TerminalTailSource {
  return {
    rows,
    buffer: {
      active: {
        baseY: Math.max(0, lines.length - rows),
        length: lines.length,
        getLine: (index: number) => {
          const value = lines[index];
          return value === undefined
            ? undefined
            : { translateToString: () => value };
        },
      },
    },
  };
}

describe("projectTerminalTail", () => {
  it("returns at most eight non-empty visual rows from the active xterm screen", () => {
    const projection = projectTerminalTail(
      source(["old scrollback", "", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"], 10),
      "codex-1",
      1_720_000_000_000,
    );
    expect(projection).toEqual({
      sessionId: "codex-1",
      lines: ["two", "three", "four", "five", "six", "seven", "eight", "nine"],
      updatedAt: "2024-07-03T09:46:40.000Z",
      source: "xterm-projection",
    });
  });

  it("returns an empty projection without inventing a raw-buffer fallback", () => {
    expect(projectTerminalTail(source(["", "   "]), "manual-1", 100)).toEqual({
      sessionId: "manual-1",
      lines: [],
      updatedAt: null,
      source: "xterm-projection",
    });
  });
});
