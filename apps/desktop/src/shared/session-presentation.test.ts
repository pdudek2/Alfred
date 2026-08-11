import { describe, expect, it } from "vitest";
import { sessionPresentationText, sessionPresentationTitle } from "./session-presentation";

describe("session presentation", () => {
  it("removes runtime envelopes before presentation", () => {
    expect(sessionPresentationText("<environment_context>private</environment_context>\n# My request for Codex: Review the app"))
      .toBe("Review the app");
  });

  it("uses the product fallback when a title becomes empty after control stripping", () => {
    expect(sessionPresentationTitle("\u001b]0;spoof\u0007\u001b[2J\u0000", "Codex session")).toBe("Codex session");
  });

  it("removes C1 controls from presented titles", () => {
    expect(sessionPresentationTitle("Review\u009f PR", "Codex session")).toBe("Review PR");
  });

  it("does not expose terminal controls in presented external titles or snippets", () => {
    expect(sessionPresentationTitle("\u001b[31mReview\u001b[0m \u001b]8;;https://example.com\u001b\\PR\u001b]8;;\u0007", "Codex session"))
      .toBe("Review PR");
    expect(sessionPresentationText("\u001b]0;spoof\u0007\u001b[2KLatest \u001b[32mresult\u001b[0m"))
      .toBe("Latest result");
  });
});
