import { describe, expect, it } from "vitest";

import {
  deskPresentationSlot,
  nextDeskPresentationIds,
} from "./terminal-desk-presentation";

describe("terminal desk presentation", () => {
  it("keeps the selected session first and preserves visible peers", () => {
    expect(nextDeskPresentationIds(["one", "two", "three", "four"], "one", [])).toEqual([
      "one",
      "two",
      "three",
    ]);
    expect(nextDeskPresentationIds(["one", "two", "three", "four"], "four", ["one", "two", "three"])).toEqual([
      "four",
      "one",
      "two",
    ]);
    expect(nextDeskPresentationIds(["one", "two", "four"], "four", ["four", "one", "two"])).toEqual([
      "four",
      "one",
      "two",
    ]);
  });

  it("maps visible IDs to their presentation slots", () => {
    expect(deskPresentationSlot("four", ["four", "one", "two"])).toBe("primary");
    expect(deskPresentationSlot("three", ["four", "one", "two"])).toBeNull();
  });
});
