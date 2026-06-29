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
const prototypeStylesStart = styles.indexOf("ALFRED PROTOTYPE CLEAN v5");

if (prototypeStylesStart < 0) {
  throw new Error("Unable to locate PROTOTYPE CLEAN v5 styles");
}

const prototypeStyles = styles.slice(prototypeStylesStart);
const polishStylesStart = styles.indexOf("ALFRED PROTOTYPE POLISH v6");
const polishStyles = polishStylesStart >= 0 ? styles.slice(polishStylesStart) : "";

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

  it("keeps the clean-depth shell close to the prototype layout", () => {
    expect(prototypeStyles).toContain("grid-template-columns: 48px minmax(196px, 232px) minmax(0, 1fr)");
    expect(prototypeStyles).toContain(".context-column {");
    expect(prototypeStyles).toContain("position: absolute");
    expect(prototypeStyles).toContain("width: min(360px, calc(100% - 32px))");
    expect(prototypeStyles).toContain(".context-column.closed");
    expect(prototypeStyles).toContain("display: none");
  });

  it("keeps the Inbox empty state compact instead of a stretched dashboard card", () => {
    const emptyLanes = blockFor(".review-empty-lanes div");

    expect(prototypeStyles).toContain(".review-surface-empty {");
    expect(prototypeStyles).toContain("align-self: start");
    expect(prototypeStyles).toContain("min-height: 0");
    expect(prototypeStyles).toContain("grid-template-columns: minmax(0, 1fr) auto");
    expect(prototypeStyles).toContain("background-image: none");
    expect(emptyLanes).toContain("grid-template-columns: auto minmax(0, 1fr) auto");
  });

  it("styles workspace scrollbars so native white rails do not dominate the shell", () => {
    expect(prototypeStyles).toContain(".workspace-nav-scroll,");
    expect(prototypeStyles).toContain("scrollbar-width: thin");
    expect(prototypeStyles).toContain("scrollbar-color: rgba(216, 255, 235, 0.18) transparent");
    expect(prototypeStyles).toContain(".workspace-nav-scroll::-webkit-scrollbar-thumb");
    expect(prototypeStyles).toContain("background: rgba(216, 255, 235, 0.16)");
  });

  it("keeps the workspace title in the normal top row so it cannot overlap the workbench", () => {
    const frame = blockFor(".desktop-frame");
    const missionBar = blockFor(".mission-bar");

    expect(frame).toContain("grid-template-rows: 52px minmax(0, 1fr) 58px");
    expect(missionBar).toContain("position: static");
    expect(missionBar).toContain("height: 52px");
    expect(polishStyles).toContain(".mission-bar .mission-name {");
    expect(polishStyles).toContain("position: static");
    expect(polishStyles).toContain("max-width: min(420px, 48vw)");
  });

  it("makes the context drawer itself scrollable instead of clipping the lower timeline", () => {
    const contextColumn = blockFor(".context-column");
    const contextDrawer = blockFor(".context-drawer");
    const timelinePanel = blockFor(".context-drawer .agent-timeline-panel");

    expect(contextColumn).toContain("bottom: 66px");
    expect(contextDrawer).toContain("overflow-y: auto");
    expect(contextDrawer).toContain("overscroll-behavior: contain");
    expect(timelinePanel).toContain("overflow: visible");
  });

  it("removes old glass gradients from the Sessions modal", () => {
    expect(polishStyles).toContain(".session-observatory-backdrop");
    expect(polishStyles).toContain("backdrop-filter: none");
    expect(polishStyles).toContain(".session-observatory-panel");
    expect(polishStyles).toContain("background-image: none");
    expect(polishStyles).toContain(".session-observatory-stat");
    expect(polishStyles).toContain(".session-observatory-main");
  });

  it("keeps recovery strip text from visually colliding", () => {
    const recoveryCopy = blockFor(".recovery-workspace-strip p");

    expect(recoveryCopy).toContain("gap: 4px");
  });
});
