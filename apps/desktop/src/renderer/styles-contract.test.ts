import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const stylesPath = [
  resolve(process.cwd(), "src/renderer/styles.css"),
  resolve(process.cwd(), "apps/desktop/src/renderer/styles.css"),
].find((candidate) => existsSync(candidate));

if (!stylesPath) {
  throw new Error("Unable to locate renderer styles.css");
}

const styles = readFileSync(stylesPath, "utf8");
const flatStylesStart = styles.indexOf("ALFRED CLEAN FLAT v4");

if (flatStylesStart < 0) {
  throw new Error("Unable to locate CLEAN FLAT v4 styles");
}

const flatStyles = styles.slice(flatStylesStart);

function blockFor(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...styles.matchAll(new RegExp(`${escapedSelector}\\s*\\{(?<body>[^}]*)\\}`, "gm"))];
  return matches.at(-1)?.groups?.body ?? "";
}

describe("renderer CSS contracts", () => {
  it("keeps Arrange mode scrollable with room for the bottom resize handle", () => {
    const arrangeCanvas = blockFor(".terminal-stage.arranging .terminal-grid-column");
    const arrangingGrid = blockFor(".terminal-stage.arranging .terminal-grid");

    expect(arrangeCanvas).toContain("overflow-y: auto");
    expect(arrangeCanvas).toContain("scrollbar-gutter: stable");
    expect(arrangingGrid).toContain("--arrange-bottom-safe-zone");
    expect(arrangingGrid).toContain("flex: 0 0 auto");
    expect(arrangingGrid).toContain("min-height: 100%");
    expect(arrangingGrid).toContain("padding-bottom: var(--arrange-bottom-safe-zone)");
  });

  it("keeps Inbox section titles separated from explanatory copy", () => {
    const inboxHeader = blockFor(".inbox-section > header");
    const inboxHeaderCopy = blockFor(".inbox-section > header div");
    const emptyCopy = blockFor(".inbox-section-empty");

    expect(inboxHeader).toContain("grid-template-columns: minmax(0, 1fr) auto");
    expect(inboxHeaderCopy).toContain("display: grid");
    expect(inboxHeaderCopy).toContain("gap: 4px");
    expect(emptyCopy).toContain("font: 500 13px/1.4 var(--sans)");
  });

  it("keeps the clean flat workbench controls proportional", () => {
    expect(flatStyles).toContain(".workbench-actions button,");
    expect(flatStyles).toContain("height: var(--flat-control-height)");
    expect(flatStyles).toContain("background: var(--flat-control)");
    expect(flatStyles).toContain(".workbench-tool-group");
    expect(flatStyles).toContain("padding: 2px");
    expect(flatStyles).toContain(".workbench-primary-action");
    expect(flatStyles).toContain("background-image: none !important");
  });

  it("keeps legacy gradients out of the main clean flat surfaces", () => {
    expect(flatStyles).toContain(".workspace-popover");
    expect(flatStyles).toContain("background: var(--flat-panel-2)");
    expect(flatStyles).toContain(".terminal-tile");
    expect(flatStyles).toContain("background-image: none");
    expect(flatStyles).toContain(".workspace-button.active");
  });
});
