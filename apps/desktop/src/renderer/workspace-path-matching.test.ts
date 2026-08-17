import { describe, expect, it } from "vitest";
import { pathsReferToSameLocation } from "./workspace-path-matching";

describe("pathsReferToSameLocation", () => {
  it("matches the macOS /var alias and ignores trailing slashes", () => {
    expect(pathsReferToSameLocation(
      "/private/var/folders/fixture/workspace-a/",
      "/var/folders/fixture/workspace-a",
    )).toBe(true);
  });

  it("does not match unrelated paths with the same suffix", () => {
    expect(pathsReferToSameLocation(
      "/tmp/archive/workspace-a",
      "/var/folders/fixture/workspace-a",
    )).toBe(false);
  });

  it("requires two usable paths", () => {
    expect(pathsReferToSameLocation(undefined, "/var/folders/fixture/workspace-a")).toBe(false);
  });
});
