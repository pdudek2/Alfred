import { describe, expect, it } from "vitest";
import { agentPages, openedFile, pagePanelFile, pagePanelPage, pickedPage } from "./page-panel-state";

const file = (path: string, additions = 1) => ({ path, additions, deletions: 0 });

describe("pagePanelPage", () => {
  it("opens with the first page, follows the last edit and stays shut once closed", () => {
    expect(pagePanelPage([file("/r/app.ts")], undefined)).toBeNull();
    expect(pagePanelPage(undefined, undefined)).toBeNull();
    expect(pagePanelPage([file("/r/app.ts"), file("/r/a.html")], undefined)?.path).toBe("/r/a.html");
    // Changed files lists the page edited last at the end.
    expect(pagePanelPage([file("/r/a.html"), file("/r/b.svg")], undefined)?.path).toBe("/r/b.svg");
    expect(pagePanelPage([file("/r/a.html"), file("/r/b.svg"), file("/r/c.htm")], { closed: true })).toBeNull();
  });

  it("holds a picked page until the agent edits a page again", () => {
    const files = [file("/r/a.html"), file("/r/b.html")];
    const choice = pickedPage(files, "/r/a.html");
    expect(pagePanelPage(files, choice)?.path).toBe("/r/a.html");
    expect(pagePanelPage([...files, file("/r/notes.ts")], choice)?.path).toBe("/r/a.html");
    // The agent edits b.html again: same page last, new counts.
    expect(pagePanelPage([file("/r/a.html"), file("/r/b.html", 2)], choice)?.path).toBe("/r/b.html");
    expect(pagePanelPage([file("/r/b.html"), file("/r/c.html")], choice)?.path).toBe("/r/c.html");
  });

  it("shows an image or PDF opened from the terminal until the agent edits a page again, and keeps its tab", () => {
    const files = [file("/r/a.html")];
    const shot = { path: "out/shot.png", cwd: "/r" };
    const report = { path: "/r/report.pdf", cwd: "/r" };
    let choice = openedFile(files, undefined, shot);
    choice = openedFile(files, choice, report);
    expect(pagePanelFile(files, choice)).toEqual(report);
    expect(choice.files).toEqual([shot, report]);
    // Opening one again moves it to the end, once.
    expect(openedFile(files, choice, shot).files).toEqual([report, shot]);
    // A page pick keeps the opened files as tabs.
    const page = pickedPage(files, "/r/a.html", choice);
    expect(pagePanelFile(files, page)).toBeNull();
    expect(page.files).toEqual([shot, report]);
    // The agent edits a page: the panel follows it.
    expect(pagePanelFile([file("/r/a.html", 2)], choice)).toBeNull();
    expect(pagePanelFile(files, { ...choice, closed: true })).toBeNull();
    // Without pages a file still opens.
    expect(pagePanelFile(undefined, openedFile(undefined, undefined, shot))).toEqual(shot);
  });

  it("keeps pages only, in the order of last edit", () => {
    expect(agentPages([file("/r/a.HTML"), file("/r/app.ts"), file("/r/b.svg"), file("/r/c.md")]).map((page) => page.path))
      .toEqual(["/r/a.HTML", "/r/b.svg"]);
  });
});
