import { describe, expect, it } from "vitest";
import { MAX_SESSION_TITLE_LENGTH, normalizeSessionTitle, stripTerminalControlSequences } from "./session-title";

describe("session title normalization", () => {
  it.each([
    ["removes CSI color and cursor sequences", "\u001b[31mReview\u001b[0m \u001b[2Kready", "Review ready"],
    ["removes OSC title and hyperlink sequences terminated by BEL or ST", "\u001b]0;spoof\u0007Review \u001b]8;;https://example.com\u001b\\notes\u001b]8;;\u0007", "Review notes"],
    ["removes remaining escape sequences without losing Unicode", "\u001b7Żółw \u001b8— review", "Żółw — review"],
  ])("%s", (_name, input, expected) => {
    expect(stripTerminalControlSequences(input)).toBe(expected);
  });

  it("removes title-only controls, collapses whitespace, and caps the title", () => {
    expect(normalizeSessionTitle(" \u0000Review\u001f\t\nPR ")).toBe("Review PR");
    expect(normalizeSessionTitle("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"))
      .toBe("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(MAX_SESSION_TITLE_LENGTH).toBe(80);
  });

  it("leaves a clean title unchanged", () => {
    expect(normalizeSessionTitle("Przegląd API — żółw")).toBe("Przegląd API — żółw");
  });
});
