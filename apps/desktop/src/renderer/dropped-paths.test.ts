import { describe, expect, it } from "vitest";
import { droppedPathsText } from "./dropped-paths";

describe("droppedPathsText", () => {
  it("escapes shell syntax in each path and leaves a space to keep typing", () => {
    expect(droppedPathsText(["/Users/p/Desktop/Screenshot 11.52.png"])).toBe("/Users/p/Desktop/Screenshot\\ 11.52.png ");
    expect(droppedPathsText(["/tmp/it's (final) & $done.txt"])).toBe("/tmp/it\\'s\\ \\(final\\)\\ \\&\\ \\$done.txt ");
    expect(droppedPathsText(["/tmp/a~b=c^d.txt"])).toBe("/tmp/a\\~b\\=c\\^d.txt ");
    expect(droppedPathsText(["/tmp/zdjęcie-ą.png"])).toBe("/tmp/zdjęcie-ą.png ");
  });

  it("joins several files and skips files without a path", () => {
    expect(droppedPathsText(["/a/one.png", "", "/b/two words.md"])).toBe("/a/one.png /b/two\\ words.md ");
    expect(droppedPathsText([""])).toBe("");
  });

  it("skips a file whose name holds a newline or another control byte, so a drop never runs a line", () => {
    expect(droppedPathsText(["/tmp/a\nrm -rf ~", "/tmp/tab\there.png", "/tmp/ok.png"])).toBe("/tmp/ok.png ");
  });

  it("quotes every Windows path and skips ones whose characters stay live inside quotes", () => {
    expect(droppedPathsText(["C:\\Users\\p\\My Pictures\\shot (1).png"])).toBe("\"C:\\Users\\p\\My Pictures\\shot (1).png\" ");
    expect(droppedPathsText(["C:\\temp\\a&calc.png"])).toBe("\"C:\\temp\\a&calc.png\" ");
    expect(droppedPathsText(["C:\\temp\\$(calc).png", "C:\\temp\\%PATH%.png", "C:\\temp\\ok.png"])).toBe("\"C:\\temp\\ok.png\" ");
  });
});
