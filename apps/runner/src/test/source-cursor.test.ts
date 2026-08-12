import { describe, expect, it } from "vitest";

import {
  cursorMatchesFile,
  encodeFileCursor,
  parseStoredSourceCursor,
  resolveSourceTimeFloor,
} from "../sources/source-cursor.js";

describe("source cursor", () => {
  it("round-trips a versioned file cursor with a pinned project", () => {
    const value = encodeFileCursor({
      v: 1,
      line: 8,
      prefixHash: "a".repeat(64),
      project: { key: "Alfred", name: "Alfred" },
    });

    expect(parseStoredSourceCursor(value)).toEqual({
      kind: "position",
      cursor: {
        v: 1,
        line: 8,
        prefixHash: "a".repeat(64),
        project: { key: "Alfred", name: "Alfred" },
      },
    });
  });

  it("recognizes legacy ISO cursors and rejects malformed structured values", () => {
    expect(parseStoredSourceCursor("2026-04-28T10:00:00.000Z")).toEqual({
      kind: "legacy-time",
      occurredAt: "2026-04-28T10:00:00.000Z",
    });
    expect(parseStoredSourceCursor('{"v":1,"line":-1}')).toEqual({ kind: "invalid" });
  });

  it("rejects positional cursors without a complete project pin", () => {
    expect(parseStoredSourceCursor(JSON.stringify({
      v: 1,
      line: 8,
      prefixHash: "a".repeat(64),
    }))).toEqual({ kind: "invalid" });
    expect(parseStoredSourceCursor(JSON.stringify({
      v: 1,
      line: 8,
      prefixHash: "a".repeat(64),
      project: { key: "Alfred" },
    }))).toEqual({ kind: "invalid" });
  });

  it("replays equality only when the stored legacy time is the active floor", () => {
    expect(resolveSourceTimeFloor("2026-04-28T09:00:00.000Z", {
      kind: "legacy-time",
      occurredAt: "2026-04-28T10:00:00.000Z",
    })).toEqual({ occurredAtMs: Date.parse("2026-04-28T10:00:00.000Z"), includeEqual: true });
    expect(resolveSourceTimeFloor("2026-04-28T11:00:00.000Z", {
      kind: "legacy-time",
      occurredAt: "2026-04-28T10:00:00.000Z",
    })).toEqual({ occurredAtMs: Date.parse("2026-04-28T11:00:00.000Z"), includeEqual: false });
  });

  it("skips to a saved line only when its prefix hash matches", () => {
    const cursor = {
      v: 1 as const,
      line: 8,
      prefixHash: "b".repeat(64),
      project: { key: "Alfred", name: "Alfred" },
    };
    expect(cursorMatchesFile(cursor, "b".repeat(64))).toBe(true);
    expect(cursorMatchesFile(cursor, "c".repeat(64))).toBe(false);
  });
});
