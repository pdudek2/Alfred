import { describe, expect, it } from "vitest";
import { historyKindLabel, historySummarySentence } from "./history-presentation";

const now = new Date("2026-05-09T12:00:00Z").getTime();
const day = 24 * 60 * 60_000;
const managed = {
  source: "managed" as const,
  kind: "codex" as const,
  project: { id: "A", label: "Alfred" },
  locationLabel: "Alfred",
  updatedAt: now - 9 * day,
};
const sentence = (...args: Parameters<typeof historySummarySentence>) => {
  const { before, where, after } = historySummarySentence(...args);
  return `${before}${where}${after}`;
};

describe("History presentation", () => {
  it("names kinds in contract vocabulary and marks transcripts Alfred did not run", () => {
    expect(historyKindLabel({ source: "managed", kind: "codex" })).toBe("Codex");
    expect(historyKindLabel({ source: "managed", kind: "claude" })).toBe("Claude");
    expect(historyKindLabel({ source: "managed", kind: "manual" })).toBe("Terminal");
    expect(historyKindLabel({ source: "external-codex", kind: "codex" })).toBe("Codex CLI");
  });

  it("says who worked where and what became of the session", () => {
    expect(sentence({ ...managed, branch: "wt/oracle-v2" }, "asleep", now))
      .toBe("Codex worked in wt/oracle-v2. Asleep for 9 days.");
    expect(sentence({ ...managed, kind: "claude", updatedAt: now - 2 * 60 * 60_000 }, "done", now))
      .toBe("Claude worked in Alfred. Ended 2 hours ago.");
    expect(sentence({ ...managed, kind: "manual", updatedAt: now - 20_000 }, "failed", now))
      .toBe("Terminal session in Alfred. Failed just now.");
    expect(sentence({ ...managed, updatedAt: now - 20_000 }, "asleep", now)).toBe("Codex worked in Alfred. Asleep.");
    expect(sentence(managed, "working", now)).toBe("Codex worked in Alfred. Live in the deck.");
    expect(sentence(managed, "unavailable", now)).toBe("Codex worked in Alfred. Unavailable.");
  });

  it("describes a Codex CLI transcript by its project, or by its folder when the project is unknown", () => {
    const external = { ...managed, source: "external-codex" as const, updatedAt: now - 4 * day };
    expect(sentence(external, "done", now)).toBe("Codex CLI session in Alfred. Last active 4 days ago.");
    expect(sentence({ ...external, project: { id: null, label: "Unassigned" }, locationLabel: "scratch" }, "done", now))
      .toBe("Codex CLI session in scratch. Last active 4 days ago.");
  });
});
