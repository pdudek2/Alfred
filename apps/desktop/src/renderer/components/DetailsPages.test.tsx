import { describe, expect, it } from "vitest";
import { pagesToShow } from "./DetailsPages";

const file = (path: string) => ({ path, additions: 1, deletions: 0 });

describe("pagesToShow", () => {
  it("shows the three pages edited last, the latest first, and nothing else", () => {
    // Changed files in the order of last edit: a.html was edited again after the others.
    const changed = [file("/r/b.html"), file("/r/c.svg"), file("/r/app.ts"), file("/r/d.htm"), file("/r/e.HTML"), file("/r/a.html")];
    expect(pagesToShow(changed).map((page) => page.path)).toEqual(["/r/a.html", "/r/e.HTML", "/r/d.htm"]);
    expect(pagesToShow([file("/r/app.ts"), file("/r/notes.md")])).toEqual([]);
    expect(pagesToShow(undefined)).toEqual([]);
  });
});
