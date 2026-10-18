import { describe, expect, it } from "vitest";
import { imagePathFromLink, imagePathsInLine } from "./terminal-image-links";

describe("terminal image links", () => {
  it("reads the image file behind an OSC 8 link and ignores every other link", () => {
    expect(imagePathFromLink("file:///private/tmp/claude-501/project/session/images/1.png"))
      .toBe("/private/tmp/claude-501/project/session/images/1.png");
    expect(imagePathFromLink("file:///Users/p/Zrzut%20ekranu%2011.52.png")).toBe("/Users/p/Zrzut ekranu 11.52.png");
    expect(imagePathFromLink("file://localhost/Users/p/a.jpg")).toBe("/Users/p/a.jpg");
    expect(imagePathFromLink("file://other-host/Users/p/a.png")).toBeNull();
    expect(imagePathFromLink("file:///Users/p/notes.txt")).toBeNull();
    expect(imagePathFromLink("https://example.com/a.png")).toBeNull();
    expect(imagePathFromLink("file:///Users/p/%E0%A4%A.png")).toBeNull();
    expect(imagePathFromLink("not a url")).toBeNull();
  });

  it("finds image paths in a line of agent output", () => {
    expect(imagePathsInLine("Saved the screenshot to /Users/p/out/shot.png.")).toEqual([
      { start: 24, end: 45, path: "/Users/p/out/shot.png" },
    ]);
    // Quoted, relative, ~/ and the escaped form a file drop pastes.
    expect(imagePathsInLine("see `output/review/1.png` and ~/Desktop/a.JPG")).toEqual([
      { start: 5, end: 24, path: "output/review/1.png" },
      { start: 30, end: 45, path: "~/Desktop/a.JPG" },
    ]);
    expect(imagePathsInLine("❯ /Users/p/Zrzut\\ ekranu\\ 11.52.png ")).toEqual([
      { start: 2, end: 35, path: "/Users/p/Zrzut ekranu 11.52.png" },
    ]);
    expect(imagePathsInLine("(file:///Users/p/a%20b.webp)")).toEqual([
      { start: 1, end: 27, path: "/Users/p/a b.webp" },
    ]);
  });

  it("leaves bare names, web addresses and other files alone", () => {
    expect(imagePathsInLine("logo.png https://example.com/a.png /Users/p/notes.txt /Users/p/build")).toEqual([]);
  });
});
