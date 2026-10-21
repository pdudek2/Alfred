import { describe, expect, it } from "vitest";
import {
  MAX_SESSION_TITLE_LENGTH,
  normalizeSessionTitle,
  stripTerminalControlSequences,
  stripTerminalControlSequencesWithRemainder,
  terminalOutputLines,
} from "./session-title";

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

  it("retains an incomplete OSC sequence until its next chunk can strip it", () => {
    const first = stripTerminalControlSequencesWithRemainder("\u001b]0;spoof");
    expect(first).toEqual({ text: "", remainder: "\u001b]0;spoof" });
    expect(stripTerminalControlSequencesWithRemainder(`${first.remainder}\u0007Review`).text).toBe("Review");

    const opening = stripTerminalControlSequencesWithRemainder("\u001b]8;;https://example.com\u001b");
    expect(opening).toEqual({ text: "", remainder: "\u001b]8;;https://example.com\u001b" });
    expect(stripTerminalControlSequencesWithRemainder(`${opening.remainder}\\PR`).text).toBe("PR");
  });
});

describe("terminal output lines", () => {
  it("reads saved terminal output as the lines a terminal showed", () => {
    const output = [
      // zsh marks output without a final newline with "%", pads the row and returns to its start for the prompt.
      `%${" ".repeat(79)}\r \r\u001b[1m\u001b[0m\u001b[32mpatryk@mac\u001b[0m ~ % printf 'ok'\r\n`,
      // Its line editor echoes the first key, then redraws the whole line from the row's start.
      "p\rpatryk@mac ~ % printf 'ok'\r\n",
      // A tool that prints a link, a progress line, and a typo taken back.
      "see \u001b]8;;https://example.com\u0007the docs\u001b]8;;\u0007\n",
      "downloading 10%\rdownloading 100%\n",
      "lss\b \b -la\n",
      "line left at its end\r",
    ].join("");
    expect(terminalOutputLines(output)).toEqual([
      "patryk@mac ~ % printf 'ok'",
      "patryk@mac ~ % printf 'ok'",
      "see the docs",
      "downloading 100%",
      "ls -la",
      "line left at its end",
    ]);
  });

  it("keeps output that zsh marks as lacking a final newline", () => {
    // As zsh 5.9 writes it: a reverse-video "%", the row padded to its width, then " \r" past the wrap.
    const mark = `\u001b[1m\u001b[7m%\u001b[27m\u001b[1m\u001b[0m${" ".repeat(103)}\r \r\r\u001b[0m\u001b[27m\u001b[24m\u001b[J`;
    const prompt = "patryk@mac workspace-a % \u001b[K\u001b[?2004h";
    const output = `${prompt}p\bprintf 'no final newline'\u001b[?2004l\r\r\nno final newline${mark}`
      + `${prompt}p\bprintf 'ok\\n'\u001b[?2004l\r\r\nok\r\n${mark}${prompt}`;
    expect(terminalOutputLines(output)).toEqual([
      "patryk@mac workspace-a % printf 'no final newline'",
      "no final newline",
      "patryk@mac workspace-a % printf 'ok\\n'",
      "ok",
      "patryk@mac workspace-a %",
    ]);
  });
});
