import { describe, expect, it } from "vitest";
import { shortenPath } from "./path-display";

describe("shortenPath", () => {
  it("keeps short relative paths intact", () => {
    expect(shortenPath("apps/desktop/src")).toBe("apps/desktop/src");
  });

  it("shortens long relative paths to the final two segments", () => {
    expect(shortenPath("apps/desktop/src/renderer")).toBe("…/src/renderer");
  });

  it("shortens absolute paths after two meaningful segments", () => {
    expect(shortenPath("/Users/patryk/Desktop/Alfred")).toBe("…/Desktop/Alfred");
  });

  it("normalizes Windows separators for display", () => {
    expect(shortenPath("C:\\Users\\patryk\\Desktop\\Alfred")).toBe("…/Desktop/Alfred");
  });
});
