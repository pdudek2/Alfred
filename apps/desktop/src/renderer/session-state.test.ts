import { describe, expect, it } from "vitest";
import { addManualSession, closeSession, createInitialSessions } from "./session-state";

describe("desktop session state", () => {
  it("starts with one first-class manual terminal session", () => {
    const sessions = createInitialSessions("/Users/patryk/Desktop/Alfred");

    expect(sessions).toEqual([
      {
        id: "manual-1",
        source: "manual",
        stage: "live",
        title: "Manual · zsh 1",
        cwd: "/Users/patryk/Desktop/Alfred",
      },
    ]);
  });

  it("adds manual terminal sessions with stable titles", () => {
    const initial = createInitialSessions("/Users/patryk/Desktop/Alfred");
    const next = addManualSession(initial, "/Users/patryk/Desktop/Alfred");

    expect(next).toHaveLength(2);
    expect(next[1]).toEqual({
      id: "manual-2",
      source: "manual",
      stage: "live",
      title: "Manual · zsh 2",
      cwd: "/Users/patryk/Desktop/Alfred",
    });
  });

  it("does not reuse an existing session id after close", () => {
    const initial = createInitialSessions("/Users/patryk/Desktop/Alfred");
    const twoSessions = addManualSession(initial, "/Users/patryk/Desktop/Alfred");
    const closedFirst = closeSession(twoSessions, "manual-1");
    const next = addManualSession(closedFirst, "/Users/patryk/Desktop/Alfred");

    expect(next.map((session) => session.id)).toEqual(["manual-2", "manual-3"]);
    expect(next.map((session) => session.title)).toEqual(["Manual · zsh 2", "Manual · zsh 3"]);
  });
});
